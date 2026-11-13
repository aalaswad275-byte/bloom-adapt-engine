import { useMutation, useQuery } from "convex/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useExamMonitor } from "@/hooks/useExamMonitor";
import { useI18n } from "@/lib/i18n";
import {
  localizedCorrectAnswer,
  localizedInstructions,
  localizedOptions,
  localizedQuestionText,
} from "@/lib/localizedQuestion";
import { withOverrides, type MonitoringConfig } from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Award,
  Camera,
  CameraOff,
  Eye,
  Loader2,
  Play,
  Send,
  ShieldAlert,
  SkipForward,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";

type PublicQuestion = {
  _id: string;
  questionText: string;
  questionTextAr?: string | null;
  instructionsEn?: string | null;
  instructionsAr?: string | null;
  questionType: string;
  topic: string;
  marks: number;
  expectedTime: number;
  options: string[] | null;
  optionsAr?: string[] | null;
};

type SessionState = {
  sessionId: Id<"examSessions">;
  status: "active" | "paused" | "completed" | "terminated";
  sessionState?: "not_started" | "in_progress" | "completed" | "terminated";
  terminationReason: string | null;
  exam: {
    _id: Id<"exams">;
    title: string;
    totalQuestions: number;
    violationThreshold: number;
    showDebugPanel: boolean;
    monitoringEnabled: boolean;
    monitoringConfig: {
      minConfidence: number;
      thresholds: Record<string, number>;
      warnViolations: number;
      pauseViolations: number;
      maxViolations: number;
      identityVerificationEnabled: boolean;
      phoneMode: "any_visible" | "in_use_only";
    } | null;
  };
  progress: { answered: number; total: number; correct: number };
  currentQuestion: PublicQuestion | null;
  warnings: Array<{ message: string; severity: string; timestamp: number }>;
  integrity: { riskScore: number; confirmedViolations: number };
  debugEnabled: boolean;
  thetaProfile: Record<string, number>;
  diagnosticLevel: string | null;
};

type RespondResult = {
  alreadyAnswered?: boolean;
  correctness: boolean;
  manual: boolean;
  correctAnswer: string;
  correctAnswerAr?: string | null;
  options?: string[] | null;
  optionsAr?: string[] | null;
  explanation: string;
  predictedProbability: number;
  effectiveDifficulty: number;
  T: number;
  V: number;
  thetaBefore: number;
  thetaAfter: number;
  standardError: number;
  itemInformation: number;
  behavioralSignal: string;
  interpretation: string;
  adaptiveAction: string;
  difficultyChange: string;
  bloomTransition: string;
  selectionNote: string;
  bloomProfile: Record<string, number>;
  nextQuestion: PublicQuestion | null;
  sessionComplete: boolean;
  terminated: boolean;
};

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-semibold",
          ok ? "text-foreground" : "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function Exam() {
  const { examId } = useParams<{ examId: string }>();
  const { language } = useI18n();
  const [sessionId, setSessionId] = useState<Id<"examSessions"> | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** Recoverable answer/skip error — never replaces the exam screen. */
  const [actionError, setActionError] = useState<string | null>(null);

  const startSession = useMutation(api.adaptive.startSession);
  const respond = useMutation(api.adaptive.respond);
  const skipQuestion = useMutation(api.adaptive.skipQuestion);
  const [skipping, setSkipping] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [resuming, setResuming] = useState(false);
  const resumeSession = useMutation(api.monitoring.resumeSession);
  const state = useQuery(
    api.adaptive.getSessionState,
    sessionId ? { sessionId } : "skip",
  ) as SessionState | undefined;

  const [selected, setSelected] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<RespondResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const shownRef = useRef<string | null>(null);
  const itemStartRef = useRef<number>(Date.now());

  const examMonCfg = state?.exam.monitoringConfig;
  const monitor = useExamMonitor({
    sessionId,
    enabled: state?.exam.monitoringEnabled ?? false,
    config: examMonCfg
      ? withOverrides({
          ...examMonCfg,
          thresholds: examMonCfg.thresholds as MonitoringConfig["thresholds"],
        })
      : undefined,
  });

  // Start session once.
  const start = useCallback(async () => {
    if (!examId || starting || sessionId) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await startSession({ examId: examId as Id<"exams"> });
      setSessionId(res.sessionId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }, [examId, starting, sessionId, startSession]);

  useEffect(() => {
    void start();
  }, [start]);

  // Timer per item.
  useEffect(() => {
    itemStartRef.current = Date.now();
    setElapsed(0);
    const t = window.setInterval(
      () => setElapsed(Date.now() - itemStartRef.current),
      250,
    );
    return () => window.clearInterval(t);
  }, [state?.currentQuestion?._id]);

  // Reset UI state when a new question is served.
  useEffect(() => {
    const qid = state?.currentQuestion?._id;
    if (!qid || shownRef.current === qid) return;
    shownRef.current = qid;
    setSelected(null);
    setTextAnswer("");
    setFeedback(null);
    monitor.beginItem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentQuestion?._id ?? null]);

  const skip = async () => {
    if (!sessionId || skipping || submitting) return;
    setSkipping(true);
    setActionError(null);
    try {
      await skipQuestion({ sessionId });
      setSkipConfirm(false);
      setFeedback(null);
      // Completion is reflected by the session query; the student explicitly
      // opens the report instead of being redirected off the exam page.
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Skip failed — please retry");
    } finally {
      setSkipping(false);
    }
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!sessionId || !state?.currentQuestion || submitting) return;
    const q = state.currentQuestion;
    // Only choice questions read `selected`. Every other format is rendered
    // with a textarea, including code output and written answers, so their
    // answer must come from `textAnswer`.
    const isChoice = q.questionType === "multiple_choice" || q.questionType === "true_false";
    const answer = isChoice ? (selected ?? "") : textAnswer.trim();
    if (!answer) {
      setActionError("Please enter an answer before submitting.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    const responseTimeMs = Date.now() - itemStartRef.current;
    try {
      const result = (await respond({
        sessionId,
        questionId: q._id as Id<"questions">,
        answer,
        responseTimeMs,
        interaction: monitor.getIntegrationSnapshot(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;
      setFeedback(result);
      // Incorrect answers are ordinary responses. They never navigate away,
      // submit the exam, or terminate the session.
    } catch (err) {
      console.error(err);
      // Keep the session and the current answer on screen so the student can
      // retry. A temporary API failure is not an examination termination.
      setActionError(
        err instanceof Error ? err.message : "Submission failed — please retry",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ------- Start screen while session initializes -------
  if (!sessionId || (state === undefined && !startError)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            Building your initial six-dimensional Bloom profile…
          </p>
        </div>
      </main>
    );
  }

  if (startError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <AlertTriangle className="mx-auto size-6 text-destructive" />
          <p className="mt-4 text-sm">{startError}</p>
          <Link to="/dashboard">
            <Button variant="outline" className="mt-5 rounded-full">
              Back to dashboard
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!state) return null;

  const q = state.currentQuestion;
  const overThreshold =
    state.integrity.confirmedViolations >= state.exam.violationThreshold;

  // ------- Terminated by integrity engine -------
  if (state.status === "paused") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-lg p-8 text-center">
          <ShieldAlert className="mx-auto size-8 text-[oklch(0.65_0.13_85)]" />
          <h1 className="mt-4 text-xl font-bold">Exam paused</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The violation policy paused your exam after {state.integrity.confirmedViolations} confirmed
            violation{state.integrity.confirmedViolations === 1 ? "" : "s"}. Review the warning, make sure
            your setup complies (you alone in frame, no phone, face visible), then resume.
          </p>
          <Button
            className="clay-press mt-6 rounded-full"
            disabled={resuming}
            onClick={async () => {
              setResuming(true);
              try {
                await resumeSession({ sessionId: sessionId! });
              } finally {
                setResuming(false);
              }
            }}
          >
            {resuming ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Resume exam
          </Button>
          <Link to={`/results/${sessionId}`} className="mt-4 block">
            <Button variant="ghost" className="rounded-full">
              Leave and view report
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  if (state.status === "terminated") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-lg p-8 text-center">
          <ShieldAlert className="mx-auto size-8 text-destructive" />
          <h1 className="mt-4 text-xl font-bold">Exam terminated</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The configured violation threshold (
            {state.exam.violationThreshold} confirmed violations) was reached.
            All responses and monitoring evidence have been saved and an
            incident report was generated.
          </p>
          <Link to={`/results/${sessionId}`}>
            <Button className="mt-6 rounded-full">View report</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (state.status === "completed") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-lg p-8 text-center">
          <Award className="mx-auto size-8 text-primary" />
          <h1 className="mt-4 text-xl font-bold">Exam completed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your answers are saved. Open your report when you are ready — you
            will not be redirected automatically.
          </p>
          <Link to={`/results/${sessionId}`}>
            <Button className="mt-6 rounded-full">View results</Button>
          </Link>
        </div>
      </main>
    );
  }

  const isMcq =
    q && ["multiple_choice", "true_false"].includes(q.questionType);
  const choiceOptions = localizedOptions(q, language);
  const questionText = localizedQuestionText(q, language);
  const instructions = localizedInstructions(q, language);
  const expectedMs = (q?.expectedTime ?? 60) * 1000;
  const strainPct = Math.min(100, (elapsed / expectedMs) * 100);
  const strainColor =
    elapsed < expectedMs * 0.85
      ? "bg-[oklch(0.7_0.13_145)]"
      : elapsed < expectedMs * 1.15
        ? "bg-[oklch(0.8_0.14_85)]"
        : "bg-destructive";

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[10%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[5%] size-[280px] bg-[oklch(0.86_0.08_200)]" />

      {/* Top bar */}
      <header className="relative z-10 mx-auto w-full max-w-5xl px-6 pt-6">
        <div className="clay flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <Timer className="size-5 text-primary" />
            <span className="font-mono text-lg font-bold tabular-nums">
              {fmtTime(elapsed)}
            </span>
            <span className="text-xs text-muted-foreground">
              expected {q ? fmtTime(expectedMs) : "—"}
            </span>
          </div>
          <div className="flex min-w-40 flex-1 items-center gap-3">
            <Progress value={(state.progress.answered / state.progress.total) * 100} className="h-3" />
            <span className="text-xs font-semibold tabular-nums">
              {state.progress.answered}/{state.progress.total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "rounded-full",
                overThreshold
                  ? "bg-destructive text-white"
                  : state.integrity.confirmedViolations > 0
                    ? "bg-[oklch(0.9_0.07_85)] text-[oklch(0.35_0.08_85)]"
                    : "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]",
              )}
            >
              <ShieldAlert className="mr-1 size-3" />
              {state.integrity.confirmedViolations}/{state.exam.violationThreshold}
            </Badge>
            {state.exam.showDebugPanel && (
              <Badge className="clay-inset rounded-full text-foreground">
                debug on
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Recoverable submission error — the exam remains in progress */}
      {actionError && (
        <div className="relative z-10 mx-auto mt-4 w-full max-w-5xl px-6">
          <div className="clay-inset flex flex-wrap items-center justify-between gap-3 border border-destructive/30 p-4 text-sm text-destructive">
            <span>{actionError}</span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Warning area */}
      {state.warnings.length > 0 && (
        <div className="relative z-10 mx-auto mt-4 w-full max-w-5xl px-6">
          <div className="clay-inset space-y-2 p-4">
            {state.warnings.map((w, i) => (
              <div
                key={`${w.timestamp}-${i}`}
                className="flex items-center gap-2 text-sm"
              >
                <AlertTriangle
                  className={cn(
                    "size-4",
                    w.severity === "critical" || w.severity === "high"
                      ? "text-destructive"
                      : "text-[oklch(0.65_0.13_85)]",
                  )}
                />
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto mt-6 grid w-full max-w-5xl gap-6 px-6 pb-16 lg:grid-cols-[1fr_280px]">
        {/* Question */}
        <div className="space-y-6">
          {!q ? (
            <div className="clay p-8 text-center">
              <Loader2 className="mx-auto size-5 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">
                {feedback?.sessionComplete
                  ? "Session complete — preparing your report…"
                  : "Selecting your next question…"}
              </p>
            </div>
          ) : (
            <form
              className="clay p-7 sm:p-8"
              onSubmit={(event) => void submit(event)}
            >
              <div className="flex items-center justify-between">
                <Badge className="clay-inset rounded-full text-xs text-foreground">
                  {q.topic}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {q.marks} mark{q.marks > 1 ? "s" : ""} ·{" "}
                  {q.questionType.replace(/_/g, " ")}
                </span>
              </div>

              <h1 className="mt-5 whitespace-pre-line text-lg font-bold leading-relaxed">
                {questionText}
              </h1>
              {instructions && (
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                  {instructions}
                </p>
              )}

              {/* Time-strain bar (live T_t preview) */}
              <div className="mt-5">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--input)]">
                  <div
                    className={cn("h-full rounded-full transition-all", strainColor)}
                    style={{ width: `${strainPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {elapsed < expectedMs * 0.85
                    ? "ahead of expected pace (T will be negative)"
                    : elapsed < expectedMs * 1.15
                      ? "near expected pace (T near zero)"
                      : "over expected pace (T positive — strain)"}
                </p>
              </div>

              {/* Answers */}
              {isMcq && choiceOptions.length > 0 ? (
                <div className="mt-6 grid gap-3">
                  {choiceOptions.map((opt) => {
                    const isSelected = selected === opt.value;
                    const isCorrectOpt =
                      feedback && feedback.correctAnswer === opt.value;
                    const isWrongPick =
                      feedback && isSelected && !feedback.correctness;
                    return (
                      <button
                        key={`${opt.value}-${opt.label}`}
                        type="button"
                        data-state={
                          isCorrectOpt
                            ? "correct"
                            : isWrongPick
                              ? "incorrect"
                              : isSelected
                                ? "selected"
                                : undefined
                        }
                        disabled={!!feedback || submitting}
                        onClick={() => setSelected(opt.value)}
                        className="clay-chip px-5 py-4 text-start text-sm font-medium disabled:cursor-default"
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-6">
                  <textarea
                    value={textAnswer}
                    onChange={(e) => {
                      setTextAnswer(e.target.value);
                      if (actionError) setActionError(null);
                    }}
                    disabled={!!feedback || submitting}
                    placeholder="Type your answer… numbers, code output, paragraphs, Arabic and English are supported"
                    rows={7}
                    className="clay-inset min-h-36 w-full resize-y rounded-2xl px-5 py-4 text-sm leading-relaxed"
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Your full response is saved exactly as written. Evaluation
                    is semantic where available; otherwise it is queued for
                    manual grading.
                  </p>
                </div>
              )}

              {!feedback && (
                <div className="mt-7 flex gap-3">
                  <Button
                    type="submit"
                    className="clay-press flex-1 rounded-full py-6 text-base"
                    disabled={
                      submitting ||
                      skipping ||
                      (isMcq ? !selected : textAnswer.trim().length === 0)
                    }
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 size-4" />
                    )}
                    Submit answer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="clay-press rounded-full px-6"
                    disabled={submitting || skipping}
                    onClick={() => setSkipConfirm(true)}
                  >
                    <SkipForward className="mr-2 size-4" />
                    Skip
                  </Button>
                </div>
              )}

              {/* Post-answer feedback */}
              {feedback && (
                <div className="clay-inset mt-7 p-5">
                  <div className="flex items-center gap-2">
                    {feedback.manual ? (
                      <Badge className="rounded-full bg-[oklch(0.9_0.07_85)] text-[oklch(0.35_0.08_85)]">
                        saved · pending review
                      </Badge>
                    ) : feedback.correctness ? (
                      <Badge className="rounded-full bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]">
                        correct
                      </Badge>
                    ) : (
                      <Badge className="rounded-full bg-destructive text-white">
                        incorrect
                      </Badge>
                    )}
                    <Badge className="clay-inset rounded-full text-xs text-foreground">
                      {feedback.behavioralSignal.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </div>
                  {feedback.manual ? (
                    <p className="mt-3 text-sm">
                      Your written answer has been saved. Automatic semantic
                      evaluation is unavailable, so it is pending manual grading.
                      You can continue to the next question.
                    </p>
                  ) : feedback.correctness ? (
                    <p className="mt-3 text-sm text-[oklch(0.55_0.14_145)]">
                      Answer saved — you'll see every question and answer on
                      your results page.
                    </p>
                  ) : (
                    <>
                      <p className="mt-3 text-sm">
                        <span className="font-semibold">Answer:</span>{" "}
                        {localizedCorrectAnswer(
                          {
                            questionText: "",
                            options: feedback.options ?? null,
                            optionsAr: feedback.optionsAr ?? null,
                          },
                          feedback.correctAnswer,
                          feedback.correctAnswerAr,
                          language,
                        )}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {feedback.explanation}
                      </p>
                    </>
                  )}
                  <p className="mt-3 text-xs italic text-muted-foreground">
                    {feedback.interpretation}
                  </p>
                  {feedback.nextQuestion && !feedback.sessionComplete && (
                    <Button
                      type="button"
                      className="clay-press mt-4 rounded-full"
                      onClick={() => setFeedback(null)}
                    >
                      Next question <Send className="ml-2 size-4" />
                    </Button>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Sidebar: camera + live monitoring status + debug */}
        <div className="space-y-4">
          <div className="clay p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Camera className="size-4 text-primary" /> Monitoring
              </div>
              <Badge
                className={cn(
                  "rounded-full",
                  monitor.status.cameraState === "connected"
                    ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
                    : monitor.status.cameraState === "error"
                      ? "bg-destructive text-white"
                      : "bg-[oklch(0.9_0.06_85)] text-[oklch(0.35_0.08_85)]",
                )}
              >
                {monitor.status.cameraState}
              </Badge>
            </div>
            <div className="clay-inset relative aspect-[4/3] overflow-hidden">
              <video
                ref={monitor.videoRef}
                muted
                playsInline
                className="size-full scale-x-[-1] object-cover"
              />
              {monitor.status.cameraState === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <CameraOff className="size-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {monitor.status.cameraError}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    The exam continues; integrity events still tracked via
                    browser signals.
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <StatusRow
                label="Student"
                value={
                  monitor.status.identityState === "FACE_VERIFIED"
                    ? "Detected"
                    : monitor.status.identityState
                        .replace(/_/g, " ")
                        .toLowerCase()
                }
                ok={
                  monitor.status.identityState === "FACE_VERIFIED" ||
                  monitor.status.identityState === "FACE_NOT_VISIBLE"
                }
              />
              <StatusRow
                label="Identity"
                value={
                  monitor.status.identityState === "IDENTITY_NOT_VERIFIED"
                    ? "Not verified"
                    : "Verified"
                }
                ok={monitor.status.identityState !== "IDENTITY_NOT_VERIFIED"}
              />
              <StatusRow
                label="Persons"
                value={String(monitor.status.personCount)}
                ok={monitor.status.personCount <= 1}
              />
              <StatusRow
                label="Phone"
                value={
                  monitor.status.phoneState === "none"
                    ? "Not detected"
                    : monitor.status.phoneState === "in_use"
                      ? "In use"
                      : "Visible"
                }
                ok={monitor.status.phoneState === "none"}
              />
              <StatusRow
                label="Attention"
                value={
                  monitor.status.gazeDeviation > 0.45
                    ? "Looking away"
                    : "Normal"
                }
                ok={monitor.status.gazeDeviation <= 0.45}
              />
              <StatusRow
                label="Browser focus"
                value={monitor.status.browserFocused ? "Active" : "Lost"}
                ok={monitor.status.browserFocused}
              />
              <div className="flex items-center justify-between pt-1 text-muted-foreground">
                <span>engine</span>
                <span>
                  {monitor.status.cvMode === "coco-ssd"
                    ? "COCO-SSD + face"
                    : monitor.status.cvMode === "facedetector"
                      ? "face detector"
                      : "starting"}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>violations</span>
                <span
                  className={cn(
                    "font-semibold",
                    monitor.status.violationCount > 0 ? "text-destructive" : "text-foreground",
                  )}
                >
                  {monitor.status.violationCount}/{state.exam.monitoringConfig?.maxViolations ?? state.exam.violationThreshold}
                </span>
              </div>
            </div>
          </div>

          {/* Debug panel — admin-gated */}
          {state.debugEnabled && (
            <div className="clay p-5 text-xs">
              <p className="mb-3 text-sm font-semibold">
                Research debug (θ · a · b · T · V · P)
              </p>
              {feedback ? (
                <div className="space-y-1.5 font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span>P (predicted)</span>
                    <span>{feedback.predictedProbability.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>b_eff</span>
                    <span>{feedback.effectiveDifficulty.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>T</span>
                    <span>{feedback.T.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>V</span>
                    <span>{feedback.V.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>θ before → after</span>
                    <span>
                      {feedback.thetaBefore.toFixed(2)} →{" "}
                      {feedback.thetaAfter.toFixed(2)} (±
                      {feedback.standardError.toFixed(2)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>information</span>
                    <span>{feedback.itemInformation.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>difficulty</span>
                    <span>{feedback.difficultyChange}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>bloom transition</span>
                    <span>{feedback.bloomTransition}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>selection</span>
                    <span className="text-right">{feedback.selectionNote}</span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Values appear after your next submission.
                </p>
              )}
              <div className="clay-inset mt-3 p-3">
                <p className="mb-1.5 font-semibold">θ profile (live)</p>
                {Object.entries(state.thetaProfile).map(([level, v]) => (
                  <div key={level} className="flex justify-between font-mono">
                    <span>{level}</span>
                    <span>{v.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={skipConfirm} onOpenChange={setSkipConfirm}>
        <AlertDialogContent className="clay border-0">
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this question?</AlertDialogTitle>
            <AlertDialogDescription>
              The question will not count toward your score or your ability
              profile — a skip provides no evidence for the model. It still
              counts as one of the exam's {state.exam.totalQuestions} items and
              won't be shown again this session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={skipping} className="rounded-full">
              Keep answering
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={skipping}
              className="rounded-full"
              onClick={(e) => {
                e.preventDefault();
                void skip();
              }}
            >
              {skipping ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <SkipForward className="mr-2 size-4" />
              )}
              Skip question
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

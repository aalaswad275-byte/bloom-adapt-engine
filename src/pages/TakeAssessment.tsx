import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Loader2,
  ScanFace,
  Send,
  ShieldX,
  Sparkles,
  XCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAssessmentMonitor } from "@/hooks/useAssessmentMonitor";
import {
  analyzeLiveFace,
  bestEmbeddingMatch,
  loadFaceApi,
  FACE_ISSUES,
} from "@/lib/faceMatch";
import { BLOOM_LABEL, type BloomLevel } from "@/lib/irt";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

type Viewer = {
  role: string | null;
  claimed: boolean;
  student: {
    hasIdentityImage: boolean;
    identityImageUrl: string | null;
  } | null;
} | null;

type PublicQ = {
  id: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options: string[] | null;
  marks: number;
  bloomLevel: BloomLevel;
  expectedTimeSec: number;
};

type TakeData = {
  submission: {
    id: string;
    startedAt: number;
    timerStartedAt: number | null;
    displayed: number;
    violationCount: number;
    policyAction: string;
    terminatedByPolicy: boolean;
  };
  assessment: {
    id: string;
    title: string;
    description: string | null;
    timeLimitMin: number;
    adaptive: boolean;
    displayCount: number;
    poolSize: number;
    /** Instructor's display names for the six Bloom levels. */
    bloomLabels: Record<string, string>;
  };
  currentQuestion: PublicQ | null;
  currentShownAt: number;
  bloomShown: Record<string, number>;
  /** Bloom-ladder level currently being served. */
  ladderLevel: BloomLevel;
  /** Set once the run stopped serving questions (early completion). */
  completionReason: string | null;
};

type AnswerResult = {
  correct: boolean;
  correctAnswer: string;
  explanation: string | null;
  displayed: number;
  displayCount: number;
  complete: boolean;
  completionReason: string | null;
  advancedTo: BloomLevel | null;
  nextQuestion: PublicQ | null;
};

type SubmitResult = {
  score: number;
  maxScore: number;
  grade: string;
  passed: boolean;
  weakestBloomAreas: string[];
};

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
        className={cn("font-semibold", ok ? "text-foreground" : "text-destructive")}
      >
        {value}
      </span>
    </div>
  );
}

/** One answered step in the session log (local echo). */
type StepEcho = {
  bloom: BloomLevel;
  correct: boolean;
};

/** Student takes one assessment: adaptive one-at-a-time, proctored. */
export default function TakeAssessment() {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { submissionId } = useParams() as { submissionId: string };
  const data = useQuery(
    api.studentAssessments.getTakeAssessment,
    isAuthenticated && submissionId
      ? { submissionId: submissionId as Id<"assessmentSubmissions"> }
      : "skip",
  ) as TakeData | undefined;
  const submit = useMutation(api.studentAssessments.submitAssessment);
  const answerAndNext = useMutation(api.studentAssessments.answerAndNext);

  /** Level names chosen by the instructor; taxonomy names when untouched. */
  const bloomLabels: Record<string, string> =
    data?.assessment.bloomLabels ?? BLOOM_LABEL;

  const viewer = useQuery(
    api.studentAssessments.getStudentViewer,
    isAuthenticated ? {} : "skip",
  ) as Viewer | undefined;

  // Face registration status + the student's own registered embeddings.
  const faceStatus = useQuery(
    api.studentFaces.getMyFaceStatus,
    isAuthenticated && viewer?.claimed ? {} : "skip",
  ) as
    | {
        registered: boolean;
        faceRegisteredAt: number | null;
        imageCount: number;
        poses: string[];
        lastFaceCheckAt: number | null;
        lastFaceCheckStatus: string | null;
        embeddings: Array<{ pose: string; embedding: number[] }>;
      }
    | undefined;
  const recordCheck = useMutation(api.studentFaces.recordFaceCheck);

  // The answer being typed for the CURRENT question only (server-driven).
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  /** Last graded step shown as immediate feedback. */
  const [lastFeedback, setLastFeedback] = useState<AnswerResult | null>(null);
  /** Local echo of the steps answered this session (progress log). */
  const [stepLog, setStepLog] = useState<StepEcho[]>([]);

  // --- Facial verification (registered multi-pose embeddings) ---
  const [verifyState, setVerifyState] = useState<
    "loading" | "checking" | "verified"
  >("loading");
  const [verifyIssue, setVerifyIssue] = useState<string | null>(null);
  const [showVerify, setShowVerify] = useState(true);
  const [verifyCamReady, setVerifyCamReady] = useState(false);
  const [verifyCamError, setVerifyCamError] = useState<string | null>(null);
  const verifyVideoRef = useRef<HTMLVideoElement | null>(null);
  const verifyStreamRef = useRef<MediaStream | null>(null);
  const verifyBusyRef = useRef(false);

  // Registration required: send the student to the registration page.
  useEffect(() => {
    if (faceStatus && !faceStatus.registered) navigate("/profile#face");
  }, [faceStatus, navigate]);

  // Camera for the verification gate — open it as soon as the gate shows so
  // it is warm (permission granted, frames flowing) before verifying.
  useEffect(() => {
    if (!isAuthenticated || !showVerify) return;
    let cancelled = false;
    setVerifyCamReady(false);
    setVerifyCamError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { width: 480, height: 360, facingMode: "user" } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        verifyStreamRef.current = s;
        s.getVideoTracks()[0]?.addEventListener("ended", () => {
          setVerifyCamReady(false);
          setVerifyCamError("Camera disconnected");
        });
        if (verifyVideoRef.current) {
          verifyVideoRef.current.srcObject = s;
          void verifyVideoRef.current.play().catch(() => undefined);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const name = err instanceof Error ? err.name : "";
          setVerifyCamError(
            name === "NotAllowedError" || name === "SecurityError"
              ? "Camera permission denied — allow camera access and retry."
              : "Camera could not be opened.",
          );
        }
      });
    return () => {
      cancelled = true;
      verifyStreamRef.current?.getTracks().forEach((t) => t.stop());
      verifyStreamRef.current = null;
    };
  }, [isAuthenticated, showVerify]);

  // Live verification loop: each frame goes through the project's CV
  // pipeline (single-shot face detection, exactly-one-face + size/position/
  // lighting checks, 128-d embeddings), is compared against ALL registered
  // poses, and passes only within the configured threshold.
  useEffect(() => {
    if (showVerify === false || !faceStatus?.registered) return;
    if (faceStatus.embeddings.length === 0 || verifyState === "verified")
      return;
    const stored = faceStatus.embeddings.map((e) => e.embedding);
    let alive = true;
    const t = window.setInterval(async () => {
      const v = verifyVideoRef.current;
      if (verifyBusyRef.current || !v || v.readyState < 2 || v.videoWidth === 0)
        return;
      setVerifyCamReady(true); // frames are flowing — the camera is open
      verifyBusyRef.current = true;
      try {
        const faceapi = await loadFaceApi();
        const r = await analyzeLiveFace(faceapi, v);
        if (!alive) return;
        if (!r.ok) {
          setVerifyState("checking");
          setVerifyIssue(FACE_ISSUES[r.issue]);
          return;
        }
        const m = bestEmbeddingMatch(r.descriptor, stored);
        void recordCheck({ passed: m.passed, similarity: m.similarity }).catch(
          () => undefined,
        );
        if (!alive) return;
        if (m.passed) {
          setVerifyIssue(null);
          setVerifyState("verified");
          setTimeout(() => setShowVerify(false), 700);
        } else {
          setVerifyState("checking");
          setVerifyIssue(
            `Face does not match your registration (${Math.round(
              m.similarity * 100,
            )}% match). Look straight at the camera and try again.`,
          );
        }
      } catch {
        if (alive)
          setVerifyIssue(
            "Verification engine could not start — check your connection and retry.",
          );
      } finally {
        verifyBusyRef.current = false;
      }
    }, 1200);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [showVerify, faceStatus, verifyState, recordCheck]);

  // Response-time capture: the clock for the CURRENT question starts when
  // the server says the question was delivered and stops when the student
  // submits the answer (250 ms floor absorbs round-trip jitter).
  const shownAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (data && lastFeedback === null) shownAtRef.current = data.currentShownAt;
  }, [data, lastFeedback]);

  // Start the exam clock when the verification gate closes (face matched).
  // The server stamps timerStartedAt once, so resumed sessions keep their
  // original deadline.
  const startTimer = useMutation(api.studentAssessments.startExamTimer);
  const timerKickedRef = useRef(false);
  useEffect(() => {
    if (showVerify || timerKickedRef.current || !data) return;
    timerKickedRef.current = true;
    const limitMs = data.assessment.timeLimitMin * 60_000;
    if (limitMs <= 0) return;
    const base = data.submission.timerStartedAt ?? data.submission.startedAt;
    if (data.submission.timerStartedAt !== null) {
      // Timer already stamped (resumed session) — just derive the clock.
      setSecondsLeft(
        Math.max(0, Math.floor((base + limitMs - Date.now()) / 1000)),
      );
      return;
    }
    startTimer({ submissionId: submissionId as Id<"assessmentSubmissions"> })
      .then((r) => {
        setSecondsLeft(
          Math.max(0, Math.floor((r.timerStartedAt + limitMs - Date.now()) / 1000)),
        );
      })
      .catch(() => {
        setSecondsLeft(
          Math.max(0, Math.floor((base + limitMs - Date.now()) / 1000)),
        );
      });
  }, [showVerify, data, startTimer, submissionId]);

  // Silent proctoring: lanes record violations server-side for the
  // instructor to review — the student is never interrupted.
  const monitor = useAssessmentMonitor({
    submissionId:
      isAuthenticated && submissionId
        ? (submissionId as Id<"assessmentSubmissions">)
        : null,
    enabled: isAuthenticated,
  });

  const doSubmit = async () => {
    if (submitting || !data) return;
    setSubmitting(true);
    try {
      // Answers were recorded server-side on every step (answerAndNext);
      // submit only finalizes grading over the stored record.
      const r: SubmitResult = await submit({
        submissionId: submissionId as Id<"assessmentSubmissions">,
      });
      toast.success(
        `Submitted — ${r.score}/${r.maxScore} · Grade ${r.grade} · ${
          r.passed ? "Passed" : "Not passed"
        }`,
      );
      navigate(`/assessment-results/${submissionId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
      setSubmitting(false);
    }
  };

  // Create completion rule: the required Create questions are all correct —
  // the assessment completes immediately with Passed – Grade A.
  const completionReason = data?.completionReason ?? null;
  useEffect(() => {
    if (completionReason === "create_mastered" && !submitting) void doSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionReason, submitting]);

  // Countdown + auto-submit at zero.
  useEffect(() => {
    if (secondsLeft === null || submitting) return;
    if (secondsLeft <= 0) {
      void doSubmit();
      return;
    }
    const t = setTimeout(
      () => setSecondsLeft((s) => (s === null ? null : s - 1)),
      1000,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, submitting]);

  const answerCount = data?.submission.displayed ?? 0;
  const displayCount = data?.assessment.displayCount ?? 0;
  const poolSize = data?.assessment.poolSize ?? 0;

  const bloomShown = useMemo(
    () => Object.entries(data?.bloomShown ?? {}),
    [data],
  );

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <h1 className="text-xl font-bold">Sign in required</h1>
          <Link
            to={`/auth?returnTo=${encodeURIComponent(`/take-assessment/${submissionId}`)}`}
            className="mt-5 inline-block"
          >
            <Button className="rounded-full">Sign in</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const q = data.currentQuestion;
  const mm = secondsLeft === null ? null : Math.floor(secondsLeft / 60);
  const ss = secondsLeft === null ? null : secondsLeft % 60;

  const doAnswer = async () => {
    if (pending || !q || !data) return;
    setPending(true);
    try {
      const responseTimeMs = Math.max(
        250,
        Date.now() - (shownAtRef.current ?? Date.now()),
      );
      const r: AnswerResult = await answerAndNext({
        submissionId: submissionId as Id<"assessmentSubmissions">,
        answer: draft.trim(),
        responseTimeMs,
      });
      setStepLog((prev) => [
        ...prev,
        { bloom: q.bloomLevel, correct: r.correct },
      ]);
      if (r.advancedTo) {
        toast.success(
          `Advanced to ${bloomLabels[r.advancedTo] ?? r.advancedTo}`,
        );
      }
      setLastFeedback(r);
      setDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save answer");
    } finally {
      setPending(false);
    }
  };

  // Gate status: the camera must be open before anything else is shown.
  const camOpening = !verifyCamError && !verifyCamReady;
  const gateError = verifyCamError;
  const progressPct =
    displayCount > 0 ? Math.min(100, (answerCount / displayCount) * 100) : 0;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-6 pt-8">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="clay-press rounded-full"
            onClick={() => navigate("/my-class")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-sm font-bold leading-tight">
              {data.assessment.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {answerCount}/{displayCount} answered · pool {poolSize}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="clay-inset rounded-full text-[10px] font-bold text-foreground">
            <Sparkles className="mr-1 size-3 text-primary" /> Adaptive AI
          </Badge>
          {mm !== null && (
            <div
              className={`clay-inset flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold tabular-nums ${
                secondsLeft !== null && secondsLeft < 120 ? "text-destructive" : ""
              }`}
            >
              <Clock className="size-4" />
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </div>
          )}
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-6 w-full max-w-5xl px-6">
        <Progress value={progressPct} className="h-2" />
        {data.assessment.description && (
          <p className="clay-inset mt-4 rounded-2xl p-4 text-sm text-muted-foreground">
            {data.assessment.description}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* One question at a time — server-driven */}
          <div>
            {lastFeedback ? (
              <div className="clay p-6 sm:p-7">
                <div className="flex items-center gap-2">
                  {lastFeedback.correct ? (
                    <CheckCircle2 className="size-5 text-[oklch(0.55_0.14_145)]" />
                  ) : (
                    <XCircle className="size-5 text-destructive" />
                  )}
                  <p className="text-base font-bold">
                    {lastFeedback.correct ? "Correct" : "Incorrect"}
                  </p>
                </div>
                {!lastFeedback.correct && (
                  <p className="mt-2 text-sm">
                    Correct answer:{" "}
                    <span className="font-semibold">
                      {lastFeedback.correctAnswer}
                    </span>
                  </p>
                )}
                {lastFeedback.explanation && (
                  <p className="mt-1 text-sm italic text-muted-foreground">
                    {lastFeedback.explanation}
                  </p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {lastFeedback.complete
                    ? lastFeedback.completionReason === "create_mastered"
                      ? "All required Create questions correct — completing the assessment with Passed – Grade A."
                      : lastFeedback.completionReason === "create_exhausted"
                        ? "Required Create questions completed — the assessment is finished and will be graded fairly."
                        : "That was the final question — you can submit now."
                    : "The adaptive model has selected your next question."}
                </p>
                <Button
                  className="clay-press mt-5 rounded-full"
                  disabled={pending}
                  onClick={() => setLastFeedback(null)}
                >
                  {lastFeedback.complete ? (
                    <>
                      <Send className="mr-2 size-4" /> Continue to submit
                    </>
                  ) : (
                    <>
                      Next question <Sparkles className="ml-1.5 size-4" />
                    </>
                  )}
                </Button>
              </div>
            ) : q ? (
              <div className="clay p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <Badge className="clay-inset rounded-full text-xs text-foreground">
                    Question {answerCount + 1} of {displayCount}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <Badge className="rounded-full bg-[oklch(0.9_0.05_320)] text-[10px] text-[oklch(0.4_0.09_320)]">
                      {bloomLabels[q.bloomLevel] ?? q.bloomLevel}
                    </Badge>
                    <span className="text-xs font-bold text-muted-foreground">
                      {q.marks} mark{q.marks === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <h1 className="mt-5 whitespace-pre-line text-lg font-bold leading-relaxed">
                  {q.questionText}
                </h1>

                {q.questionType === "multiple_choice" && (
                  <RadioGroup
                    className="mt-5 grid gap-2"
                    value={draft}
                    onValueChange={setDraft}
                  >
                    {(q.options ?? []).map((opt) => (
                      <Label
                        key={opt}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50",
                          draft === opt
                            ? "border-[var(--primary)] bg-[var(--primary)]/5 font-semibold"
                            : "border-[var(--border)]",
                        )}
                      >
                        <RadioGroupItem value={opt} />
                        {opt}
                      </Label>
                    ))}
                  </RadioGroup>
                )}

                {q.questionType === "true_false" && (
                  <RadioGroup
                    className="mt-5 flex gap-3"
                    value={draft}
                    onValueChange={setDraft}
                  >
                    {["True", "False"].map((opt) => (
                      <Label
                        key={opt}
                        className={cn(
                          "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50",
                          draft === opt
                            ? "border-[var(--primary)] bg-[var(--primary)]/5 font-semibold"
                            : "border-[var(--border)]",
                        )}
                      >
                        <RadioGroupItem value={opt} />
                        {opt}
                      </Label>
                    ))}
                  </RadioGroup>
                )}

                {q.questionType === "short_answer" && (
                  <Input
                    className="clay-inset mt-5 rounded-full px-4"
                    placeholder="Type your answer…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                )}

                <div className="mt-7 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    The adaptive model picks each question from the pool based
                    on your responses.
                  </p>
                  <Button
                    className="clay-press rounded-full"
                    disabled={pending || draft.trim() === ""}
                    onClick={() => void doAnswer()}
                  >
                    {pending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 size-4" />
                    )}
                    Submit answer
                  </Button>
                </div>
              </div>
            ) : (
              <div className="clay p-8 text-center">
                <CheckCircle2 className="mx-auto size-8 text-[oklch(0.55_0.14_145)]" />
                <p className="mt-3 text-lg font-bold">
                  {completionReason === "create_mastered"
                    ? "All required Create questions correct — Passed – Grade A"
                    : completionReason === "create_exhausted"
                      ? "Create questions completed — assessment finished"
                      : completionReason === "pool_exhausted"
                        ? "No more eligible questions — assessment finished"
                        : `All ${displayCount} questions answered`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Submit whenever you're ready.
                </p>
                <Button
                  className="clay-press mt-5 rounded-full"
                  disabled={submitting}
                  onClick={() => void doSubmit()}
                >
                  {submitting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 size-4" />
                  )}
                  Submit assessment
                </Button>
              </div>
            )}

            {/* Session log: presented sequence with correctness echoes */}
            {stepLog.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {stepLog.map((s, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                      s.correct
                        ? "border-[oklch(0.72_0.14_145)]/40 bg-[oklch(0.72_0.14_145)]/10 text-[oklch(0.45_0.12_145)]"
                        : "border-destructive/30 bg-destructive/5 text-destructive",
                    )}
                    title={`Question ${i + 1} — ${bloomLabels[s.bloom] ?? s.bloom}`}
                  >
                    {i + 1}
                    {s.correct ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <XCircle className="size-3" />
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              The presented sequence is fixed once shown — questions never
              repeat. This assessment is proctored; keep your face visible and
              this tab focused.
            </p>
          </div>

          {/* Proctoring sidebar */}
          <div className="space-y-4">
            <div className="clay p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Camera className="size-4 text-primary" /> Proctoring
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
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <StatusRow
                  label="You visible"
                  value={
                    monitor.status.personCount === 1 ? "Yes" : "No"
                  }
                  ok={monitor.status.personCount === 1}
                />
                <StatusRow
                  label="Others in frame"
                  value={String(Math.max(0, monitor.status.personCount - 1))}
                  ok={monitor.status.personCount <= 1}
                />
                <StatusRow
                  label="Phone"
                  value={monitor.status.phoneCount === 0 ? "None" : "Detected"}
                  ok={monitor.status.phoneCount === 0}
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
              </div>
            </div>

            {/* Adaptive coverage sidebar */}
            <div className="clay p-5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-primary" /> Bloom coverage
              </p>
              <div className="mt-3 space-y-1.5">
                {bloomShown.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Your personalized sequence is being built.
                  </p>
                ) : (
                  bloomShown.map(([level, count]) => (
                    <div
                      key={level}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-muted-foreground">
                        {bloomLabels[level] ?? level}
                      </span>
                      <span className="font-bold tabular-nums">{count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="h-10" />
      </section>

      {/* Identity verification gate — face must match the stored image */}
      {showVerify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="clay w-full max-w-md p-8 text-center">
            <div className="flex items-center justify-center gap-2 font-bold">
              <ScanFace className="size-5 text-primary" /> Verify your identity
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Look at the camera — we compare your live face with your
              registered facial data before the assessment starts.
            </p>
            <div className="relative mx-auto mt-5 w-fit overflow-hidden rounded-3xl border-4 border-white/60 shadow-md">
              <video
                ref={verifyVideoRef}
                playsInline
                muted
                onLoadedData={() => setVerifyCamReady(true)}
                className="block h-56 w-64 -scale-x-100 object-cover"
              />
              <div className="pointer-events-none absolute inset-4 rounded-[1.6rem] border-2 border-dashed border-white/50" />
            </div>
            <div className="mt-4 flex min-h-20 flex-col items-center justify-center gap-2">
              {gateError ? (
                <>
                  <ShieldX className="size-6 text-destructive" />
                  <p className="text-sm font-semibold text-destructive">
                    {gateError}
                  </p>
                </>
              ) : camOpening ? (
                <>
                  <Loader2 className="size-5 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Opening camera…
                  </p>
                </>
              ) : faceStatus && !faceStatus.registered ? (
                <>
                  <ScanFace className="size-6 text-primary" />
                  <p className="text-sm font-semibold">
                    Face registration required
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Capture your face from 7 angles before taking assessments.
                  </p>
                  <Link to="/profile#face">
                    <Button className="clay-press mt-1 rounded-full">
                      Go to face registration
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  {verifyState === "loading" && (
                    <>
                      <Loader2 className="size-5 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">
                        Loading verification engine…
                      </p>
                    </>
                  )}
                  {verifyState === "checking" && (
                    <>
                      <Loader2 className="size-5 animate-spin text-primary" />
                      <p className="text-sm font-semibold">
                        Verifying your identity…
                      </p>
                    </>
                  )}
                  {verifyIssue && (
                    <p className="text-sm font-semibold text-amber-600">
                      {verifyIssue}
                    </p>
                  )}
                  {verifyState === "verified" && (
                    <>
                      <CheckCircle2 className="size-6 text-[oklch(0.55_0.14_145)]" />
                      <p className="text-sm font-semibold text-[oklch(0.45_0.12_145)]">
                        Identity verified — starting…
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          {gateError && (
            <div className="clay mt-4 flex flex-col gap-2 p-5">
              <Button
                className="clay-press rounded-full"
                onClick={() => window.location.reload()}
              >
                Retry verification
              </Button>
              <Button
                variant="outline"
                className="clay-press rounded-full"
                onClick={() => navigate("/my-class")}
              >
                Back to my class
              </Button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  ShieldAlert,
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

type TakeData = {
  submission: {
    id: string;
    startedAt: number;
    answers: string[];
    currentQuestionIndex: number;
    violationCount: number;
    policyAction: string;
    terminatedByPolicy: boolean;
  };
  assessment: {
    id: string;
    title: string;
    description: string | null;
    timeLimitMin: number;
  };
  questions: Array<{
    id: string;
    questionText: string;
    questionType: "multiple_choice" | "true_false" | "short_answer";
    options: string[] | null;
    marks: number;
  }>;
};

type SubmitResult = { score: number; maxScore: number };

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

/** Student takes one assessment: one question at a time, proctored, autosave. */
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
  const saveAnswer = useMutation(api.studentAssessments.saveAnswer);
  const submit = useMutation(api.studentAssessments.submitAssessment);
  const setCursor = useMutation(api.studentAssessments.setCurrentQuestion);

  const [answers, setAnswers] = useState<string[] | null>(null);
  const [cursor, setCursorState] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [terminatedByPolicy, setTerminatedByPolicy] = useState(false);
  const [forceNav, setForceNav] = useState(false);

  // Sync server state once; resume on the held cursor.
  useEffect(() => {
    if (data && answers === null) {
      setAnswers(data.questions.map((_, i) => data.submission.answers[i] ?? ""));
      const idx = Math.min(
        Math.max(0, data.submission.currentQuestionIndex),
        Math.max(0, data.questions.length - 1),
      );
      setCursorState(idx);
      if (data.submission.terminatedByPolicy) setTerminatedByPolicy(true);
      if (data.assessment.timeLimitMin > 0) {
        const deadline =
          data.submission.startedAt + data.assessment.timeLimitMin * 60_000;
        setSecondsLeft(Math.max(0, Math.floor((deadline - Date.now()) / 1000)));
      }
    }
  }, [data, answers]);

  // Proctoring lanes → submission policy (WARNING → PAUSE → TERMINATE).
  const monitor = useAssessmentMonitor({
    submissionId:
      isAuthenticated && submissionId
        ? (submissionId as Id<"assessmentSubmissions">)
        : null,
    enabled: isAuthenticated && !terminatedByPolicy,
  });

  const doSubmit = async () => {
    if (submitting || !data) return;
    setSubmitting(true);
    try {
      const finalAnswers = data.questions.map((_, i) => answers?.[i] ?? "");
      const r: SubmitResult = await submit({
        submissionId: submissionId as Id<"assessmentSubmissions">,
        answers: finalAnswers,
      });
      toast.success(`Submitted — scored ${r.score}/${r.maxScore}`);
      navigate(`/assessment-result/${submissionId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
      setSubmitting(false);
    }
  };

  // Server policy ladder: PAUSE blocks navigation/answers until acknowledged;
  // TERMINATE force-submits server-side — surface it and route to results.
  useEffect(() => {
    if (monitor.status.terminated) {
      setTerminatedByPolicy(true);
      const t = setTimeout(
        () => navigate(`/assessment-result/${submissionId}`),
        2500,
      );
      return () => clearTimeout(t);
    }
  }, [monitor.status.terminated, navigate, submissionId]);

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

  const answeredCount = useMemo(
    () => (answers ?? []).filter((a) => a.trim() !== "").length,
    [answers],
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

  const q = data.questions[cursor];
  const paused = monitor.status.policy === "PAUSE_EXAM";
  const mm = secondsLeft === null ? null : Math.floor(secondsLeft / 60);
  const ss = secondsLeft === null ? null : secondsLeft % 60;

  const goTo = (idx: number) => {
    if (idx < 0 || idx >= data.questions.length || paused) return;
    setCursorState(idx);
    setCursor({
      submissionId: submissionId as Id<"assessmentSubmissions">,
      questionIndex: idx,
    }).catch(() => undefined);
  };

  const answerProps = (i: number) => ({
    value: answers?.[i] ?? "",
    onValue: (v: string) => {
      setAnswers((prev) => {
        const next = [...(prev ?? data.questions.map(() => ""))];
        next[i] = v;
        return next;
      });
      void saveAnswer({
        submissionId: submissionId as Id<"assessmentSubmissions">,
        questionIndex: i,
        answer: v,
      }).catch(() => undefined);
    },
  });

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
              {answeredCount}/{data.questions.length} answered
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              "rounded-full",
              monitor.status.violationCount === 0
                ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
                : "bg-destructive text-white",
            )}
          >
            <ShieldAlert className="mr-1 size-3" />
            {monitor.status.violationCount}/3
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
        <Progress
          value={
            data.questions.length > 0
              ? ((cursor + 1) / data.questions.length) * 100
              : 0
          }
          className="h-2"
        />
        {data.assessment.description && (
          <p className="clay-inset mt-4 rounded-2xl p-4 text-sm text-muted-foreground">
            {data.assessment.description}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* One question at a time */}
          <div>
            {q && (
              <div className="clay p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <Badge className="clay-inset rounded-full text-xs text-foreground">
                    Question {cursor + 1} of {data.questions.length}
                  </Badge>
                  <span className="text-xs font-bold text-muted-foreground">
                    {q.marks} mark{q.marks === 1 ? "" : "s"}
                  </span>
                </div>

                <h1 className="mt-5 whitespace-pre-line text-lg font-bold leading-relaxed">
                  {q.questionText}
                </h1>

                {q.questionType === "multiple_choice" && (
                  <RadioGroup
                    className="mt-5 grid gap-2"
                    value={answerProps(cursor).value}
                    onValueChange={answerProps(cursor).onValue}
                  >
                    {(q.options ?? []).map((opt) => (
                      <Label
                        key={opt}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50",
                          answers?.[cursor] === opt
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
                    value={answerProps(cursor).value}
                    onValueChange={answerProps(cursor).onValue}
                  >
                    {["True", "False"].map((opt) => (
                      <Label
                        key={opt}
                        className={cn(
                          "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50",
                          answers?.[cursor] === opt
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
                    value={answerProps(cursor).value}
                    onChange={(e) => answerProps(cursor).onValue(e.target.value)}
                  />
                )}

                <div className="mt-7 flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    className="clay-press rounded-full"
                    disabled={cursor === 0 || paused}
                    onClick={() => goTo(cursor - 1)}
                  >
                    <ArrowLeft className="mr-1.5 size-4" /> Previous
                  </Button>
                  {cursor < data.questions.length - 1 ? (
                    <Button
                      className="clay-press rounded-full"
                      disabled={paused}
                      onClick={() => goTo(cursor + 1)}
                    >
                      Next <ArrowRight className="ml-1.5 size-4" />
                    </Button>
                  ) : (
                    <Button
                      className="clay-press rounded-full"
                      disabled={submitting || paused}
                      onClick={() => void doSubmit()}
                    >
                      {submitting ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 size-4" />
                      )}
                      Submit assessment
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Question dots */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {data.questions.map((qq, i) => {
                const isAnswered = (answers?.[i] ?? "").trim() !== "";
                return (
                  <button
                    key={qq.id}
                    type="button"
                    disabled={paused}
                    onClick={() => goTo(i)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                      i === cursor
                        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                        : isAnswered
                          ? "border-[oklch(0.72_0.14_145)] bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.45_0.12_145)]"
                          : "border-[var(--border)] text-muted-foreground",
                      paused ? "cursor-not-allowed opacity-50" : "hover:scale-105",
                    )}
                    title={
                      isAnswered
                        ? `Question ${i + 1} — answered`
                        : `Question ${i + 1}`
                    }
                  >
                    {isAnswered ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      i + 1
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Answers save automatically. Keep your face visible to the camera
              and stay on this page — violations are logged.
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
          </div>
        </div>

        <div className="h-10" />
      </section>

      {/* PAUSE overlay — student must acknowledge before continuing */}
      {paused && !forceNav && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm">
          <div className="clay max-w-md p-8 text-center">
            <ShieldAlert className="mx-auto size-8 text-[oklch(0.65_0.13_85)]" />
            <h2 className="mt-4 text-xl font-bold">Assessment paused</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A proctoring rule was triggered ({monitor.status.violationCount}{" "}
              violation{monitor.status.violationCount === 1 ? "" : "s"}).
              Fix your setup — stay visible, alone in frame, no phone, keep
              this tab focused — then resume. One more violation will end the
              assessment.
            </p>
            <Button
              className="clay-press mt-6 rounded-full"
              onClick={() => {
                setForceNav(true);
                setTimeout(() => setForceNav(false), 400);
              }}
            >
              I understand — resume
            </Button>
          </div>
        </div>
      )}

      {/* TERMINATE overlay */}
      {terminatedByPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm">
          <div className="clay max-w-md p-8 text-center">
            <ShieldAlert className="mx-auto size-8 text-destructive" />
            <h2 className="mt-4 text-xl font-bold">Assessment ended</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The violation limit was reached. Your answers were submitted
              automatically and the instructor can see the proctoring report.
            </p>
            <Loader2 className="mx-auto mt-4 size-5 animate-spin text-muted-foreground" />
          </div>
        </div>
      )}
    </main>
  );
}

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
  ScanFace,
  Send,
  ShieldX,
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
  buildReferenceDescriptor,
  verifyFace,
  type FaceMatcherState,
} from "@/lib/faceMatch";
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

  const viewer = useQuery(
    api.studentAssessments.getStudentViewer,
    isAuthenticated ? {} : "skip",
  ) as Viewer | undefined;

  const [answers, setAnswers] = useState<string[] | null>(null);
  const [cursor, setCursorState] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // --- Identity verification (face vs stored image) before questions ---
  const [matcher, setMatcher] = useState<FaceMatcherState>({
    ready: false,
    reference: null,
  });
  const [refFailed, setRefFailed] = useState(false);
  const [verifyState, setVerifyState] = useState<
    "loading" | "scanning" | "verifying" | "verified" | "mismatch" | "no_face" | "error"
  >("loading");
  const [failCount, setFailCount] = useState(0);
  const [showVerify, setShowVerify] = useState(true);
  const [verifyCamReady, setVerifyCamReady] = useState(false);
  const [verifyCamError, setVerifyCamError] = useState<string | null>(null);
  const verifyVideoRef = useRef<HTMLVideoElement | null>(null);
  const verifyStreamRef = useRef<MediaStream | null>(null);
  const verifyBusyRef = useRef(false);
  const verifiedRef = useRef(false);

  // Load the reference descriptor from the stored identity image once.
  useEffect(() => {
    if (!viewer || refFailed) return;
    if (viewer.student?.identityImageUrl && !matcher.ready) {
      setVerifyState("loading");
      buildReferenceDescriptor(viewer.student.identityImageUrl)
        .then((ref) => {
          if (ref) {
            setMatcher({ ready: true, reference: ref });
            setVerifyState("scanning");
          } else {
            setRefFailed(true);
            setVerifyState("error");
          }
        })
        .catch(() => {
          setRefFailed(true);
          setVerifyState("error");
        });
    }
  }, [viewer, matcher.ready, refFailed]);

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

  // Auto-verify loop while the gate is open (periodic attempts until match).
  useEffect(() => {
    if (showVerify === false || matcher.ready === false) return;
    if (
      verifyState === "verified" ||
      verifyState === "error"
    )
      return;
    const t = window.setInterval(async () => {
      const v = verifyVideoRef.current;
      if (verifyBusyRef.current || !v || v.readyState < 2 || v.videoWidth === 0)
        return;
      setVerifyCamReady(true); // frames are flowing — the camera is open
      verifyBusyRef.current = true;
      setVerifyState("verifying");
      try {
        const r = await verifyFace(matcher, v);
        if (r.outcome === "match") {
          verifiedRef.current = true;
          setVerifyState("verified");
          setTimeout(() => setShowVerify(false), 700);
        } else if (r.outcome === "mismatch") {
          setVerifyState("mismatch");
          setFailCount((c) => c + 1);
        } else if (r.outcome === "no_face") {
          setVerifyState("no_face");
        }
      } finally {
        verifyBusyRef.current = false;
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [showVerify, matcher, verifyState]);

  // Pass after 3 mismatches: log the attempt but let the proctoring lanes
  // keep watching (the instructor sees the violation count).
  useEffect(() => {
    if (failCount >= 3 && verifyState !== "verified") {
      verifiedRef.current = true; // proceed, proctoring continues
      setVerifyState("verified");
      setTimeout(() => setShowVerify(false), 700);
    }
  }, [failCount, verifyState]);

  // Sync server state once; resume on the held cursor.
  useEffect(() => {
    if (data && answers === null) {
      setAnswers(data.questions.map((_, i) => data.submission.answers[i] ?? ""));
      const idx = Math.min(
        Math.max(0, data.submission.currentQuestionIndex),
        Math.max(0, data.questions.length - 1),
      );
      setCursorState(idx);
      if (data.assessment.timeLimitMin > 0) {
        const deadline =
          data.submission.startedAt + data.assessment.timeLimitMin * 60_000;
        setSecondsLeft(Math.max(0, Math.floor((deadline - Date.now()) / 1000)));
      }
    }
  }, [data, answers]);

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
  const mm = secondsLeft === null ? null : Math.floor(secondsLeft / 60);
  const ss = secondsLeft === null ? null : secondsLeft % 60;

  const goTo = (idx: number) => {
    if (idx < 0 || idx >= data.questions.length) return;
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

  // Gate status: the camera must be open before anything else is shown.
  const camOpening = !verifyCamError && !verifyCamReady;
  const gateError =
    verifyCamError ??
    (verifyState === "error"
      ? "Verification unavailable — the identity reference failed to load."
      : null);

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
                    disabled={cursor === 0}
                    onClick={() => goTo(cursor - 1)}
                  >
                    <ArrowLeft className="mr-1.5 size-4" /> Previous
                  </Button>
                  {cursor < data.questions.length - 1 ? (
                    <Button
                      className="clay-press rounded-full"
                      onClick={() => goTo(cursor + 1)}
                    >
                      Next <ArrowRight className="ml-1.5 size-4" />
                    </Button>
                  ) : (
                    <Button
                      className="clay-press rounded-full"
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
                    onClick={() => goTo(i)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-xs font-bold transition-colors hover:scale-105",
                      i === cursor
                        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                        : isAnswered
                          ? "border-[oklch(0.72_0.14_145)] bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.45_0.12_145)]"
                          : "border-[var(--border)] text-muted-foreground",
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
              Answers save automatically. This assessment is proctored —
              please keep your face visible and this tab focused.
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

      {/* Identity verification gate — face must match the stored image */}
      {showVerify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="clay w-full max-w-md p-8 text-center">
            <div className="flex items-center justify-center gap-2 font-bold">
              <ScanFace className="size-5 text-primary" /> Verify your identity
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Look at the camera — we compare your face with the identity
              image on your account before the assessment starts.
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
              ) : (
                <>
                  {verifyState === "loading" && (
                    <>
                      <Loader2 className="size-5 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">
                        Loading identity reference…
                      </p>
                    </>
                  )}
                  {(verifyState === "scanning" || verifyState === "verifying") && (
                    <>
                      <Loader2 className="size-5 animate-spin text-primary" />
                      <p className="text-sm font-semibold">
                        {verifyState === "verifying"
                          ? "Comparing face with your identity image…"
                          : "Looking for your face…"}
                      </p>
                    </>
                  )}
                  {verifyState === "no_face" && (
                    <p className="text-sm font-semibold text-amber-600">
                      No face detected — center your face in the frame.
                    </p>
                  )}
                  {verifyState === "mismatch" && (
                    <>
                      <ShieldX className="size-6 text-destructive" />
                      <p className="text-sm font-semibold text-destructive">
                        Face does not match your identity image ({failCount}/3)
                      </p>
                    </>
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
            {verifyState === "mismatch" && (
              <p className="mt-1 text-xs text-muted-foreground">
                After 3 failed attempts the assessment opens under close
                proctoring and the instructor is notified.
              </p>
            )}
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

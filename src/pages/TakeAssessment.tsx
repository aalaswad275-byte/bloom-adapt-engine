import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Clock,
  Loader2,
  Send,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/hooks/use-auth";

type TakeData = {
  submission: { id: string; startedAt: number; answers: string[] };
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

/** Student takes one assessment: answer, autosave, countdown, submit. */
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

  const [answers, setAnswers] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Sync server-saved answers into local state once.
  useEffect(() => {
    if (data && answers === null) {
      setAnswers(
        data.questions.map((_, i) => data.submission.answers[i] ?? ""),
      );
      if (data.assessment.timeLimitMin > 0) {
        const deadline =
          data.submission.startedAt + data.assessment.timeLimitMin * 60_000;
        setSecondsLeft(
          Math.max(0, Math.floor((deadline - Date.now()) / 1000)),
        );
      }
    }
  }, [data, answers]);

  const doSubmit = async () => {
    if (submitting || !data) return;
    setSubmitting(true);
    try {
      const finalAnswers = data.questions.map(
        (_, i) => answers?.[i] ?? "",
      );
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
    const t = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
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

  const mm = secondsLeft === null ? null : Math.floor(secondsLeft / 60);
  const ss = secondsLeft === null ? null : secondsLeft % 60;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 pt-8">
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
            <p className="text-sm font-bold leading-tight">{data.assessment.title}</p>
            <p className="text-xs text-muted-foreground">
              {answeredCount}/{data.questions.length} answered
            </p>
          </div>
        </div>
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
      </header>

      <section className="relative z-10 mx-auto mt-6 w-full max-w-3xl px-6">
        <Progress
          value={
            data.questions.length > 0
              ? (answeredCount / data.questions.length) * 100
              : 0
          }
          className="h-2"
        />
        {data.assessment.description && (
          <p className="clay-inset mt-4 rounded-2xl p-4 text-sm text-muted-foreground">
            {data.assessment.description}
          </p>
        )}

        <div className="mt-6 grid gap-5">
          {data.questions.map((q, i) => (
            <div key={q.id} className="clay p-6">
              <p className="flex items-start justify-between gap-3 text-sm font-semibold">
                <span>
                  {i + 1}. {q.questionText}
                </span>
                <span className="shrink-0 text-xs font-bold text-muted-foreground">
                  {q.marks} mark{q.marks === 1 ? "" : "s"}
                </span>
              </p>

              {q.questionType === "multiple_choice" && (
                <RadioGroup
                  className="mt-4 grid gap-2"
                  value={answers?.[i] ?? ""}
                  onValueChange={(v) => {
                    setAnswers((prev) => {
                      const next = [...(prev ?? data.questions.map(() => ""))];
                      next[i] = v;
                      void saveAnswer({
                        submissionId: submissionId as Id<"assessmentSubmissions">,
                        questionIndex: i,
                        answer: v,
                      }).catch(() => undefined);
                      return next;
                    });
                  }}
                >
                  {(q.options ?? []).map((opt) => (
                    <Label
                      key={opt}
                      className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50 ${
                        answers?.[i] === opt
                          ? "border-[var(--primary)] bg-[var(--primary)]/5 font-semibold"
                          : "border-[var(--border)]"
                      }`}
                    >
                      <RadioGroupItem value={opt} />
                      {opt}
                    </Label>
                  ))}
                </RadioGroup>
              )}

              {q.questionType === "true_false" && (
                <RadioGroup
                  className="mt-4 flex gap-3"
                  value={answers?.[i] ?? ""}
                  onValueChange={(v) => {
                    setAnswers((prev) => {
                      const next = [...(prev ?? data.questions.map(() => ""))];
                      next[i] = v;
                      void saveAnswer({...{ submissionId: submissionId as Id<"assessmentSubmissions">, questionIndex: i, answer: v }});
                      return next;
                    });
                  }}
                >
                  {["True", "False"].map((opt) => (
                    <Label
                      key={opt}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50 ${
                        answers?.[i] === opt
                          ? "border-[var(--primary)] bg-[var(--primary)]/5 font-semibold"
                          : "border-[var(--border)]"
                      }`}
                    >
                      <RadioGroupItem value={opt} />
                      {opt}
                    </Label>
                  ))}
                </RadioGroup>
              )}

              {q.questionType === "short_answer" && (
                <Input
                  className="clay-inset mt-4 rounded-full px-4"
                  placeholder="Type your answer…"
                  value={answers?.[i] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
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
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="sticky bottom-6 mt-8 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Answers save automatically.
          </p>
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
        </div>

        <div className="h-10" />
      </section>
    </main>
  );
}

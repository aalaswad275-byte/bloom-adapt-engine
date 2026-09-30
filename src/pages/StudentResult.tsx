import { useQuery } from "convex/react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";

type ResultData = {
  assessment: { id: string | null; title: string };
  submittedAt: number | null;
  score: number;
  maxScore: number;
  items: Array<{
    questionText: string;
    type: string;
    yourAnswer: string;
    correctAnswer: string;
    correct: boolean;
    marks: number;
  }>;
};

/** Student view of one graded submission. */
export default function StudentResult() {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { submissionId } = useParams() as { submissionId: string };
  const data = useQuery(
    api.studentAssessments.getMyResult,
    isAuthenticated && submissionId
      ? { submissionId: submissionId as Id<"assessmentSubmissions"> }
      : "skip",
  ) as ResultData | undefined;

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
            to={`/auth?returnTo=${encodeURIComponent(`/assessment-result/${submissionId}`)}`}
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

  const pct = data.maxScore > 0 ? (data.score / data.maxScore) * 100 : 0;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-8">
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
            <p className="text-xs text-muted-foreground">Assessment result</p>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-3xl px-6">
        <div className="clay p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your score
          </p>
          <p className="mt-2 text-4xl font-extrabold tabular-nums">
            {data.score}/{data.maxScore}
          </p>
          <Progress value={pct} className="mx-auto mt-4 h-2.5 max-w-xs" />
          <p
            className={`mt-3 text-sm font-bold ${
              pct >= 50 ? "text-[oklch(0.45_0.12_145)]" : "text-destructive"
            }`}
          >
            {Math.round(pct)}% — {pct >= 85 ? "Excellent" : pct >= 70 ? "Good" : pct >= 55 ? "Average" : pct >= 40 ? "Needs review" : "Keep practicing"}
          </p>
          {data.submittedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Submitted {new Date(data.submittedAt).toLocaleString()}
            </p>
          )}
        </div>

        <h2 className="mt-8 text-lg font-extrabold">Question review</h2>
        <div className="mt-3 grid gap-3">
          {data.items.map((item, i) => (
            <div key={i} className="clay p-5">
              <p className="flex items-start justify-between gap-3 text-sm font-semibold">
                <span>
                  {i + 1}. {item.questionText}
                </span>
                {item.correct ? (
                  <CheckCircle2 className="size-5 shrink-0 text-[oklch(0.55_0.15_145)]" />
                ) : (
                  <XCircle className="size-5 shrink-0 text-destructive" />
                )}
              </p>
              <div className="mt-3 grid gap-1.5 text-xs">
                <p>
                  <span className="font-semibold text-muted-foreground">Your answer:</span>{" "}
                  <span className={item.correct ? "font-semibold" : "font-semibold text-destructive"}>
                    {item.yourAnswer === "" ? "(no answer)" : item.yourAnswer}
                  </span>
                </p>
                {!item.correct && (
                  <p>
                    <span className="font-semibold text-muted-foreground">Correct answer:</span>{" "}
                    <span className="font-semibold">{item.correctAnswer}</span>
                  </p>
                )}
                <p className="text-muted-foreground">
                  {item.correct ? `Earned ${item.marks} mark${item.marks === 1 ? "" : "s"}` : `Worth ${item.marks} mark${item.marks === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link to="/my-class">
            <Button variant="outline" className="clay-press rounded-full">
              ← Back to my class
            </Button>
          </Link>
        </div>
        <div className="h-16" />
      </section>
    </main>
  );
}

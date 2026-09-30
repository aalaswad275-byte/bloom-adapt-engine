import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router";
import {
  BookOpen,
  ClipboardList,
  GraduationCap,
  Layers,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";

type Viewer = {
  role: string | null;
  email: string | null;
  claimed: boolean;
  student: { id: string; name: string } | null;
};

type AssessmentCard = {
  id: string;
  title: string;
  description: string | null;
  timeLimitMin: number;
  questionCount: number;
  totalMarks: number;
  submissionId: string | null;
  submissionStatus: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  submittedAt: number | null;
};

type MyClassData = {
  student: { id: string; name: string };
  classInfo: {
    id: string;
    name: string;
    description: string | null;
    instructorName: string | null;
  } | null;
  assessments: AssessmentCard[];
};

/** Student space: class info + published assessments. */
export default function MyClass() {
  const { isLoading, isAuthenticated, user, signOut } = useAuth();
  const navigate = useNavigate();
  const viewer = useQuery(api.studentAssessments.getStudentViewer, {}) as
    | Viewer
    | undefined;
  const data = useQuery(
    api.studentAssessments.getMyClass,
    viewer?.claimed === true ? {} : "skip",
  ) as MyClassData | undefined;
  const claim = useMutation(api.studentAssessments.claimStudent);
  const start = useMutation(api.studentAssessments.startAssessment);

  const [claimEmail, setClaimEmail] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading || viewer === undefined) {
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
          <GraduationCap className="mx-auto size-8 text-primary" />
          <h1 className="mt-4 text-xl font-bold">Your class</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with the email your instructor registered to see your class
            and take its assessments.
          </p>
          <Link to="/auth?returnTo=%2Fmy-class" className="mt-6 inline-block">
            <Button className="rounded-full">Sign in as student</Button>
          </Link>
        </div>
      </main>
    );
  }

  const doClaim = async () => {
    setClaiming(true);
    try {
      await claim({ email: claimEmail || undefined });
      toast.success("Student record linked — welcome!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaiming(false);
    }
  };

  if (!viewer?.claimed) {
    return (
      <main className="relative min-h-screen overflow-hidden">
        <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
        <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center px-6">
          <div className="clay w-full p-8">
            <div className="flex items-center gap-2 font-bold">
              <GraduationCap className="size-5 text-primary" /> Student space
            </div>
            <h1 className="mt-4 text-xl font-extrabold">
              Link your student record
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="font-semibold text-foreground">
                {viewer?.email ?? user?.email}
              </span>
              . The email must match a roster entry your instructor created.
            </p>
            <div className="mt-4 grid gap-1.5">
              <Label className="text-xs font-semibold">
                Roster email (optional)
              </Label>
              <Input
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
                placeholder="you@school.edu"
                className="clay-inset rounded-full px-4"
              />
            </div>
            <Button
              className="clay-press mt-4 w-full rounded-full"
              disabled={claiming}
              onClick={() => void doClaim()}
            >
              {claiming && <Loader2 className="mr-2 size-4 animate-spin" />}
              Link student record
            </Button>
            <div className="mt-4 flex justify-between text-xs text-muted-foreground">
              <Link to="/dashboard" className="hover:underline">
                ← My dashboard
              </Link>
              <button className="hover:underline" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

  const doStart = (assessmentId: string) => {
    setBusy(assessmentId);
    start({ assessmentId: assessmentId as Id<"instructorAssessments"> })
      .then(({ submissionId }) => navigate(`/take-assessment/${submissionId}`))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Could not start");
        setBusy(null);
      });
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-3">
          <div className="clay-sm flex size-10 items-center justify-center">
            <GraduationCap className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">
              {data?.student.name ?? "Student"}
            </p>
            <p className="text-xs text-muted-foreground">Student space</p>
          </div>
        </div>
        <Button
          variant="outline"
          className="clay-press rounded-full"
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </header>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-6">
        {!data ? (
          <div className="clay p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data.classInfo ? (
          <div className="clay p-10 text-center">
            <Layers className="mx-auto size-8 text-primary" />
            <p className="mt-3 font-bold">Not enrolled in a class yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask your instructor to enroll you — assessments for your class
              will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="clay p-6">
              <p className="flex items-center gap-2 text-base font-bold">
                <Layers className="size-4 text-primary" /> {data.classInfo.name}
              </p>
              {data.classInfo.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {data.classInfo.description}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Instructor: {data.classInfo.instructorName ?? "—"}
              </p>
            </div>

            <h2 className="mt-8 text-lg font-extrabold">Assessments</h2>
            {data.assessments.length === 0 ? (
              <div className="clay mt-3 p-10 text-center">
                <ClipboardList className="mx-auto size-8 text-primary" />
                <p className="mt-3 font-bold">Nothing to take right now</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Published assessments for your class will appear here.
                </p>
              </div>
            ) : (
              <div className="mt-3 grid gap-4">
                {data.assessments.map((a) => (
                  <div key={a.id} className="clay p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-base font-bold">
                          {a.title}
                          {a.timeLimitMin > 0 && (
                            <Badge className="clay-inset rounded-full text-xs text-foreground">
                              {a.timeLimitMin} min
                            </Badge>
                          )}
                        </p>
                        {a.description && (
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {a.description}
                          </p>
                        )}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {a.questionCount} question
                          {a.questionCount === 1 ? "" : "s"} · {a.totalMarks}{" "}
                          marks
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {a.submissionStatus === null && (
                          <Button
                            className="clay-press rounded-full"
                            disabled={busy === a.id}
                            onClick={() => doStart(a.id)}
                          >
                            {busy === a.id ? (
                              <Loader2 className="mr-1.5 size-4 animate-spin" />
                            ) : (
                              <Play className="mr-1.5 size-4" />
                            )}
                            Start
                          </Button>
                        )}
                        {a.submissionStatus === "in_progress" && (
                          <Button
                            className="clay-press rounded-full"
                            onClick={() =>
                              navigate(`/take-assessment/${a.submissionId}`)
                            }
                          >
                            <RotateCcw className="mr-1.5 size-4" /> Resume
                          </Button>
                        )}
                        {a.submissionStatus === "submitted" && (
                          <Button
                            variant="outline"
                            className="clay-press rounded-full"
                            onClick={() => navigate(`/assessment-result/${a.submissionId}`)}
                          >
                            <BookOpen className="mr-1.5 size-4" />
                            {pct(a.percentage)} · View result
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="h-16" />
      </section>
    </main>
  );
}

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router";
import {
  Award,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  GraduationCap,
  History,
  Layers,
  Loader2,
  LogIn,
  Mail,
  Play,
  RotateCcw,
  ShieldAlert,
  Target,
  TrendingUp,
  UserRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import IdentityImageGate from "@/components/IdentityImageGate";
import { useAuth } from "@/hooks/use-auth";
import { FAIR_ADAPTIVE_LABEL } from "@/lib/assessmentType";
import { cn } from "@/lib/utils";

type Viewer = {
  role: string | null;
  email: string | null;
  claimed: boolean;
  student: { id: string; name: string; faceRegistered: boolean } | null;
};

type AssessmentCard = {
  id: string;
  title: string;
  description: string | null;
  timeLimitMin: number;
  questionCount: number;
  totalMarks: number;
  displayCount: number | null;
  poolSize: number | null;
  /** "adaptive" (IRT ladder), "static" (fixed order), "random" draw, or
   *  the class "final" (shared set, personal order). */
  selectionMode: "adaptive" | "static" | "random" | "final";
  submissionId: string | null;
  submissionStatus: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  startedAt: number | null;
  submittedAt: number | null;
};

type EnrolledClass = {
  id: string;
  name: string;
  description: string | null;
  instructorName: string | null;
  instructorEmail: string | null;
  instructorSpecialization: string | null;
  status: "active" | "inactive";
  /** Set when the instructor closed the class for its final exam. */
  closedAt: number | null;
  joinedAt: number;
  assessments: AssessmentCard[];
};

type MyClassData = {
  student: { id: string; name: string };
  email: string | null;
  classes: EnrolledClass[];
};

type JoinableClass = {
  id: string;
  name: string;
  description: string | null;
  instructorName: string | null;
};

const PASS_MARK = 50;

const SECTION_LINKS = [
  { id: "class-overview", label: "Overview", icon: Layers },
  { id: "instructor-details", label: "Instructor", icon: UserRound },
  { id: "available-exams", label: "Available", icon: Play },
  { id: "upcoming-exams", label: "Upcoming", icon: CalendarDays },
  { id: "exam-history", label: "History", icon: History },
  { id: "performance-progress", label: "Progress", icon: TrendingUp },
] as const;

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function SectionHeading({
  icon,
  title,
  subtitle,
  count,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  count?: number;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <span className="text-primary">{icon}</span>
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {count !== undefined && (
        <Badge className="clay-inset rounded-full text-[11px] font-bold text-foreground">
          {count}
        </Badge>
      )}
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="clay-inset inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
      {icon}
      {children}
    </span>
  );
}

function ExamFacts({ assessment }: { assessment: AssessmentCard }) {
  const count =
    assessment.selectionMode === "random"
      ? assessment.displayCount ?? assessment.questionCount
      : assessment.questionCount;
  const modeLabel =
    assessment.selectionMode === "adaptive"
      ? "Adaptive"
      : assessment.selectionMode === "random"
        ? "Random draw"
        : assessment.selectionMode === "final"
          ? FAIR_ADAPTIVE_LABEL
          : "Fixed paper";
  const detail =
    assessment.selectionMode === "final"
      ? "Same questions for the whole class — your order is randomized."
      : assessment.selectionMode === "random"
      ? "Drawn at random from the class question bank."
      : assessment.selectionMode === "adaptive" &&
          assessment.displayCount !== null &&
          assessment.poolSize !== null
        ? `You'll answer ${assessment.displayCount} of ${assessment.poolSize} pool questions, chosen adaptively.`
        : "Questions appear in your instructor's order.";

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Fact icon={<BookOpen className="size-3" />}>
          {count} question{count === 1 ? "" : "s"}
        </Fact>
        {assessment.selectionMode !== "random" && (
          <Fact icon={<Award className="size-3" />}>
            {assessment.totalMarks} mark{assessment.totalMarks === 1 ? "" : "s"}
          </Fact>
        )}
        <Fact icon={<Clock className="size-3" />}>
          {assessment.timeLimitMin > 0
            ? `${assessment.timeLimitMin} min`
            : "Untimed"}
        </Fact>
        <Badge className="clay-inset rounded-full text-[10px] uppercase tracking-wide text-foreground">
          {modeLabel}
        </Badge>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
    </>
  );
}

function ResultBadge({ percentage }: { percentage: number | null }) {
  if (percentage === null) {
    return (
      <Badge className="rounded-full bg-muted text-muted-foreground">
        Pending
      </Badge>
    );
  }
  const passed = percentage >= PASS_MARK;
  return (
    <Badge
      className={cn(
        "rounded-full",
        passed
          ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {passed ? "Passed" : "Below pass"}
    </Badge>
  );
}

/** Student space: one class page at a time, split into anchored sections. */
function MyClassContent() {
  const { isLoading, isAuthenticated, user, signOut } = useAuth();
  const navigate = useNavigate();
  const viewer = useQuery(api.studentAssessments.getStudentViewer, {}) as
    | Viewer
    | undefined;
  const data = useQuery(
    api.studentAssessments.getMyClass,
    viewer?.claimed === true ? {} : "skip",
  ) as MyClassData | undefined;
  const joinable = useQuery(
    api.studentAssessments.getJoinableClasses,
    viewer?.claimed === true ? {} : "skip",
  ) as JoinableClass[] | undefined;
  const claim = useMutation(api.studentAssessments.claimStudent);
  const joinClass = useMutation(api.studentAssessments.joinClass);
  const start = useMutation(api.studentAssessments.startAssessment);

  const [claimEmail, setClaimEmail] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

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

  const faceReady = viewer?.student?.faceRegistered ?? false;
  const selectedClass =
    data?.classes.find((c) => c.id === selectedClassId) ?? data?.classes[0];

  const doStart = (assessmentId: string) => {
    if (!faceReady) {
      toast.info("Complete face registration before starting assessments.");
      navigate("/profile#face");
      return;
    }
    setBusy(assessmentId);
    start({ assessmentId: assessmentId as Id<"instructorAssessments"> })
      .then(({ submissionId }) => navigate(`/take-assessment/${submissionId}`))
      .catch((err: unknown) => {
        // e.g. "You must join this class before taking the assessment."
        toast.error(err instanceof Error ? err.message : "Could not start");
        setBusy(null);
      });
  };

  const doJoin = (classId: string) => {
    setBusy(classId);
    joinClass({ classId: classId as Id<"classes"> })
      .then(() => {
        toast.success("You have joined the class — assessments unlocked!");
        setBusy(null);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Could not join");
        setBusy(null);
      });
  };

  // A closed class only opens its final exam; earlier published papers stay
  // listed in history but can no longer be started.
  const available =
    selectedClass?.assessments.filter(
      (a) =>
        a.submissionStatus === null &&
        (selectedClass.closedAt === null || a.selectionMode === "final"),
    ) ?? [];
  const inProgress =
    selectedClass?.assessments.filter(
      (a) => a.submissionStatus === "in_progress",
    ) ?? [];
  const completed =
    selectedClass?.assessments
      .filter(
        (a) =>
          a.submissionStatus !== null && a.submissionStatus !== "in_progress",
      )
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)) ?? [];

  const graded = completed.filter(
    (a) => a.percentage !== null && a.submittedAt !== null,
  );
  const average =
    graded.length > 0
      ? graded.reduce((sum, a) => sum + (a.percentage ?? 0), 0) / graded.length
      : null;
  const best =
    graded.length > 0
      ? Math.max(...graded.map((a) => a.percentage ?? 0))
      : null;
  const passRate =
    graded.length > 0
      ? (graded.filter((a) => (a.percentage ?? 0) >= PASS_MARK).length /
          graded.length) *
        100
      : null;
  const trend = [...graded]
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
    .map((a) => ({
      label: new Date(a.submittedAt ?? 0).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      score: a.percentage ?? 0,
    }));

  return (
    <main className="relative min-h-screen overflow-x-clip">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 pt-8">
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
        <div className="flex items-center gap-2">
          <Link to="/profile">
            <Button variant="outline" className="clay-press rounded-full">
              <UserRound className="mr-1.5 size-4" /> My profile
            </Button>
          </Link>
          <Button
            variant="outline"
            className="clay-press rounded-full"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-6">
        {!data ? (
          <div className="clay p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : data.classes.length === 0 ? (
          <>
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                Student space
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
                My classes
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Join a class to see its instructor, exams, results, and
                performance in one place.
              </p>
            </div>
            <div className="clay mt-6 p-10 text-center">
              <Layers className="mx-auto size-8 text-primary" />
              <p className="mt-3 font-bold">No joined classes yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {joinable && joinable.length > 0
                  ? "All available classes are listed below — join one to unlock its assessments."
                  : "No classes are available right now — check back soon."}
              </p>
            </div>
            {joinable && joinable.length > 0 && (
              <div className="mt-8">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-extrabold">
                      Classes available to join
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Pick a class and join it — assessments unlock immediately.
                    </p>
                  </div>
                  <Badge className="clay-inset rounded-full text-[11px] font-bold text-foreground">
                    {joinable.length}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {joinable.map((jc) => (
                    <div key={jc.id} className="clay p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="clay-inset flex size-10 shrink-0 items-center justify-center">
                            <LogIn className="size-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-bold">{jc.name}</p>
                            {jc.description && (
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {jc.description}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              Instructor: {jc.instructorName ?? "—"}
                            </p>
                          </div>
                        </div>
                        <Button
                          className="clay-press rounded-full"
                          disabled={busy === jc.id}
                          onClick={() => doJoin(jc.id)}
                        >
                          {busy === jc.id ? (
                            <Loader2 className="mr-1.5 size-4 animate-spin" />
                          ) : (
                            <LogIn className="mr-1.5 size-4" />
                          )}
                          Join class
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(!joinable || joinable.length === 0) && (
              <div className="clay mt-6 flex items-start gap-3 p-5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p className="text-sm text-muted-foreground">
                  You must join a class before taking its assessments. Once a
                  class is available it will appear above.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                Student space
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
                My classes
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Open a class to see its overview, instructor, exams, results, and
                progress in one place.
              </p>
            </div>

            {data.classes.length > 1 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Your classes
                </span>
                {data.classes.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-state={
                      selectedClass?.id === c.id ? "selected" : undefined
                    }
                    className="clay-chip clay-press flex items-center gap-2 px-4 py-2 text-xs font-bold"
                    onClick={() => setSelectedClassId(c.id)}
                  >
                    <Layers className="size-3.5" />
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {selectedClass && (
              <>
                <nav
                  aria-label="Class sections"
                  className="clay-inset sticky top-3 z-30 mt-5 flex gap-1 overflow-x-auto rounded-2xl p-1.5"
                >
                  {SECTION_LINKS.map(({ id, label, icon: Icon }) => (
                    <a
                      key={id}
                      href={`#${id}`}
                      className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-background/80 hover:text-foreground"
                    >
                      <Icon className="size-3.5" />
                      {label}
                    </a>
                  ))}
                </nav>

                <section
                  id="class-overview"
                  className="clay relative mt-6 scroll-mt-24 overflow-hidden p-6 sm:p-8"
                >
                  <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/10 blur-2xl" />
                  <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                          Class Overview
                        </p>
                        <Badge
                          className={cn(
                            "rounded-full",
                            selectedClass.closedAt !== null
                              ? "bg-[oklch(0.9_0.06_25)] text-[oklch(0.35_0.08_25)]"
                              : selectedClass.status === "active"
                                ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {selectedClass.closedAt !== null
                            ? "Closed · Final exam"
                            : selectedClass.status === "active"
                              ? "Active"
                              : "Inactive"}
                        </Badge>
                      </div>
                      <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
                        {selectedClass.name}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                        {selectedClass.description ??
                          "Your instructor has not added a description yet."}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <UserRound className="size-3.5" />
                          {selectedClass.instructorName ?? "Instructor not listed"}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays className="size-3.5" />
                          Joined {fmtDate(selectedClass.joinedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
                      <div className="clay-inset rounded-2xl px-3 py-3 text-center sm:px-4">
                        <p className="text-xl font-extrabold tabular-nums">
                          {available.length}
                        </p>
                        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          To take
                        </p>
                      </div>
                      <div className="clay-inset rounded-2xl px-3 py-3 text-center sm:px-4">
                        <p className="text-xl font-extrabold tabular-nums">
                          {inProgress.length}
                        </p>
                        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          In progress
                        </p>
                      </div>
                      <div className="clay-inset rounded-2xl px-3 py-3 text-center sm:px-4">
                        <p className="text-xl font-extrabold tabular-nums">
                          {completed.length}
                        </p>
                        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          Completed
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="mt-8 space-y-9">
                  <section
                    id="instructor-details"
                    className="scroll-mt-24"
                  >
                    <SectionHeading
                      icon={<UserRound className="size-5" />}
                      title="Instructor Details"
                      subtitle="The teacher responsible for this class."
                    />
                    <div className="clay p-5 sm:p-6">
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                        <div className="clay-inset flex size-16 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-primary">
                          {initialsOf(selectedClass.instructorName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            Instructor
                          </p>
                          <p className="mt-1 text-lg font-extrabold">
                            {selectedClass.instructorName ?? "Instructor not listed"}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {selectedClass.instructorSpecialization ??
                              "Class instructor"}
                          </p>
                        </div>
                        <div className="grid gap-2 sm:min-w-[260px]">
                          <div className="clay-inset flex items-center gap-2 rounded-2xl px-3 py-2 text-xs">
                            <Mail className="size-3.5 shrink-0 text-primary" />
                            {selectedClass.instructorEmail ? (
                              <a
                                href={`mailto:${selectedClass.instructorEmail}`}
                                className="min-w-0 truncate font-semibold hover:underline"
                              >
                                {selectedClass.instructorEmail}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">
                                Email not listed
                              </span>
                            )}
                          </div>
                          <div className="clay-inset flex items-center gap-2 rounded-2xl px-3 py-2 text-xs">
                            <Layers className="size-3.5 shrink-0 text-primary" />
                            <span className="min-w-0 truncate font-semibold">
                              {selectedClass.name}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section id="available-exams" className="scroll-mt-24">
                    <SectionHeading
                      icon={<Play className="size-5" />}
                      title="Available Exams"
                      subtitle="Published exams you can start now."
                      count={available.length}
                    />
                    {available.length === 0 ? (
                      <div className="clay p-8 text-center">
                        <CheckCircle2 className="mx-auto size-7 text-primary" />
                        <p className="mt-2 font-bold">You're all caught up</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          New exams from your instructor will appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        {available.map((a) => (
                          <div key={a.id} className="clay p-5">
                            <div className="flex h-full flex-col">
                              <div className="min-w-0">
                                <p className="text-base font-bold">{a.title}</p>
                                {a.description && (
                                  <p className="mt-0.5 text-sm text-muted-foreground">
                                    {a.description}
                                  </p>
                                )}
                                <ExamFacts assessment={a} />
                              </div>
                              <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                                <span className="text-[11px] text-muted-foreground">
                                  {a.timeLimitMin > 0
                                    ? "Timer starts when you begin"
                                    : "No time limit"}
                                </span>
                                <Button
                                  className="clay-press rounded-full"
                                  disabled={busy === a.id || !faceReady}
                                  title={
                                    faceReady
                                      ? undefined
                                      : "Complete face registration first"
                                  }
                                  onClick={() => doStart(a.id)}
                                >
                                  {busy === a.id ? (
                                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                                  ) : (
                                    <Play className="mr-1.5 size-4" />
                                  )}
                                  Start
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section id="upcoming-exams" className="scroll-mt-24">
                    <SectionHeading
                      icon={<CalendarDays className="size-5" />}
                      title="Upcoming Exams"
                      subtitle="Active attempts ready to be resumed."
                      count={inProgress.length}
                    />
                    {inProgress.length === 0 ? (
                      <div className="clay p-8 text-center">
                        <CalendarDays className="mx-auto size-7 text-primary" />
                        <p className="mt-2 font-bold">
                          No upcoming attempts
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Exams you start will wait here until you submit them.
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        {inProgress.map((a) => (
                          <div key={a.id} className="clay p-5">
                            <div className="flex h-full flex-col">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-base font-bold">{a.title}</p>
                                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                                    In progress
                                  </p>
                                </div>
                                <Badge className="shrink-0 rounded-full bg-[oklch(0.9_0.06_85)] text-[oklch(0.35_0.08_85)]">
                                  Resume
                                </Badge>
                              </div>
                              <ExamFacts assessment={a} />
                              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                                <span className="text-[11px] text-muted-foreground">
                                  Started {fmtDate(a.startedAt)}
                                </span>
                                <Button
                                  className="clay-press rounded-full"
                                  disabled={!faceReady}
                                  title={
                                    faceReady
                                      ? undefined
                                      : "Complete face registration first"
                                  }
                                  onClick={() =>
                                    navigate(`/take-assessment/${a.submissionId}`)
                                  }
                                >
                                  <RotateCcw className="mr-1.5 size-4" />
                                  Resume exam
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section id="exam-history" className="scroll-mt-24">
                    <SectionHeading
                      icon={<History className="size-5" />}
                      title="Exam History"
                      subtitle="Submitted attempts and their results."
                      count={completed.length}
                    />
                    {completed.length === 0 ? (
                      <div className="clay p-8 text-center">
                        <History className="mx-auto size-7 text-primary" />
                        <p className="mt-2 font-bold">No completed exams yet</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Your submitted exams and scores will be listed here.
                        </p>
                      </div>
                    ) : (
                      <div className="clay p-2 sm:p-3">
                        <div className="divide-y divide-border/50">
                          {completed.map((a) => (
                            <div
                              key={a.id}
                              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_6.5rem_auto]"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold">
                                  {a.title}
                                </p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  Submitted {fmtDate(a.submittedAt)}
                                </p>
                              </div>
                              <div>
                                <p
                                  className={cn(
                                    "text-sm font-extrabold tabular-nums",
                                    a.percentage !== null &&
                                      a.percentage < PASS_MARK &&
                                      "text-destructive",
                                  )}
                                >
                                  {fmtPct(a.percentage)}
                                </p>
                                {a.score !== null && a.maxScore !== null && (
                                  <p className="text-[10px] text-muted-foreground">
                                    {a.score}/{a.maxScore}
                                  </p>
                                )}
                              </div>
                              <ResultBadge percentage={a.percentage} />
                              <Button
                                variant="outline"
                                size="sm"
                                className="clay-press rounded-full"
                                disabled={!a.submissionId}
                                onClick={() =>
                                  navigate(
                                    `/assessment-results/${a.submissionId}`,
                                  )
                                }
                              >
                                View result
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  <section id="performance-progress" className="scroll-mt-24">
                    <SectionHeading
                      icon={<TrendingUp className="size-5" />}
                      title="Performance Progress"
                      subtitle="Your scores over time. The pass mark is 50%."
                    />
                    {graded.length === 0 ? (
                      <div className="clay p-8 text-center">
                        <TrendingUp className="mx-auto size-7 text-primary" />
                        <p className="mt-2 font-bold">
                          Your progress starts with your first result
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Complete an exam to unlock your average, pass rate, and
                          score trend.
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
                        <div className="clay p-5 sm:p-6">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-bold">Score trend</p>
                              <p className="text-[11px] text-muted-foreground">
                                {graded.length} graded exam
                                {graded.length === 1 ? "" : "s"}
                              </p>
                            </div>
                            <Badge className="clay-inset rounded-full text-[10px] font-bold text-foreground">
                              Pass mark {PASS_MARK}%
                            </Badge>
                          </div>
                          <div className="mt-4 h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart
                                data={trend}
                                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                              >
                                <defs>
                                  <linearGradient
                                    id="scoreFill"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                  >
                                    <stop
                                      offset="5%"
                                      stopColor="var(--primary)"
                                      stopOpacity={0.35}
                                    />
                                    <stop
                                      offset="95%"
                                      stopColor="var(--primary)"
                                      stopOpacity={0.02}
                                    />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  vertical={false}
                                  stroke="var(--border)"
                                />
                                <XAxis
                                  dataKey="label"
                                  tickLine={false}
                                  axisLine={false}
                                  minTickGap={16}
                                  tick={{
                                    fill: "var(--muted-foreground)",
                                    fontSize: 10,
                                  }}
                                />
                                <YAxis
                                  domain={[0, 100]}
                                  ticks={[0, 25, 50, 75, 100]}
                                  tickLine={false}
                                  axisLine={false}
                                  width={38}
                                  tick={{
                                    fill: "var(--muted-foreground)",
                                    fontSize: 10,
                                  }}
                                />
                                <Tooltip
                                  cursor={{ stroke: "var(--border)" }}
                                  contentStyle={{
                                    borderRadius: 12,
                                    border: "1px solid var(--border)",
                                    background: "var(--card)",
                                    fontSize: 12,
                                  }}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="score"
                                  name="Score"
                                  unit="%"
                                  stroke="var(--primary)"
                                  strokeWidth={2.5}
                                  fill="url(#scoreFill)"
                                  dot={{
                                    r: 3,
                                    fill: "var(--primary)",
                                    strokeWidth: 0,
                                  }}
                                  activeDot={{ r: 5, strokeWidth: 0 }}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="clay-inset rounded-2xl p-4">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              <Target className="size-3.5 text-primary" />
                              Average
                            </div>
                            <p
                              className={cn(
                                "mt-2 text-2xl font-extrabold tabular-nums",
                                average !== null &&
                                  average < PASS_MARK &&
                                  "text-destructive",
                              )}
                            >
                              {fmtPct(average)}
                            </p>
                          </div>
                          <div className="clay-inset rounded-2xl p-4">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              <Award className="size-3.5 text-primary" />
                              Best score
                            </div>
                            <p className="mt-2 text-2xl font-extrabold tabular-nums">
                              {fmtPct(best)}
                            </p>
                          </div>
                          <div className="clay-inset rounded-2xl p-4">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              <CheckCircle2 className="size-3.5 text-primary" />
                              Pass rate
                            </div>
                            <p className="mt-2 text-2xl font-extrabold tabular-nums">
                              {fmtPct(passRate)}
                            </p>
                          </div>
                          <div className="clay-inset rounded-2xl p-4">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              <History className="size-3.5 text-primary" />
                              Completed
                            </div>
                            <p className="mt-2 text-2xl font-extrabold tabular-nums">
                              {graded.length}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                </div>

                {joinable && joinable.length > 0 && (
                  <div className="mt-10">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h2 className="text-lg font-extrabold">
                          Join another class
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Open a class to unlock its exams and track progress
                          separately.
                        </p>
                      </div>
                      <Badge className="clay-inset rounded-full text-[11px] font-bold text-foreground">
                        {joinable.length}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      {joinable.map((jc) => (
                        <div key={jc.id} className="clay p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="clay-inset flex size-10 shrink-0 items-center justify-center">
                                <LogIn className="size-4 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-bold">{jc.name}</p>
                                {jc.description && (
                                  <p className="mt-0.5 text-sm text-muted-foreground">
                                    {jc.description}
                                  </p>
                                )}
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Instructor: {jc.instructorName ?? "—"}
                                </p>
                              </div>
                            </div>
                            <Button
                              className="clay-press rounded-full"
                              disabled={busy === jc.id}
                              onClick={() => doJoin(jc.id)}
                            >
                              {busy === jc.id ? (
                                <Loader2 className="mr-1.5 size-4 animate-spin" />
                              ) : (
                                <LogIn className="mr-1.5 size-4" />
                              )}
                              Join class
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        <div className="h-16" />
      </section>
    </main>
  );
}

/** Student page wrapped in the mandatory identity image gate. */
export default function MyClass() {
  return (
    <IdentityImageGate>
      <MyClassContent />
    </IdentityImageGate>
  );
}

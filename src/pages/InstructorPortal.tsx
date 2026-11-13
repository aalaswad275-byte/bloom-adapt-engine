import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  ClipboardList,
  Flag,
  GraduationCap,
  Layers,
  LibraryBig,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type Viewer = {
  role: string | null;
  email: string | null;
  claimed: boolean;
  instructor: { id: string; name: string } | null;
};

type ClassCard = {
  id: string;
  name: string;
  description: string | null;
  subject: string | null;
  status: string;
  closedAt: number | null;
  finalExamId: string | null;
  studentCount: number;
  joinedCount: number;
  activeStudents: number;
  completedAssessments: number;
  avgScore: number | null;
  passRate: number | null;
  completionRate: number | null;
  trend: Array<{ month: string; avgScore: number | null }>;
  distribution: Array<{ name: string; value: number }>;
  students: Array<{
    id: string;
    name: string;
    email: string | null;
    status: string;
    joined: boolean;
    joinedAt: number | null;
    photoUrl: string | null;
    faceRegistered: boolean;
    faceImageCount: number;
    lastFaceCheckAt: number | null;
    lastFaceCheckStatus: string | null;
    assessments: number;
    avgScore: number | null;
    lastScore: number | null;
  }>;
};

type Dashboard = {
  instructor: {
    id: string;
    name: string;
    email: string | null;
    specialization: string | null;
  };
  classes: ClassCard[];
  totals: { classes: number; students: number; assessments: number };
};

type StudentMatch = {
  id: string;
  name: string;
  email: string | null;
  studentIdNumber: string | null;
  hasAccount: boolean;
  enrolled: boolean;
  onRoster: boolean;
  alreadyInClass: boolean;
};

type AddMode = "search" | "new";

type PendingAdd =
  | { kind: "existing"; id: string; name: string }
  | { kind: "new" };

const DIST_COLORS = [
  "oklch(0.72 0.14 145)",
  "oklch(0.8 0.11 145)",
  "oklch(0.85 0.09 85)",
  "oklch(0.78 0.12 25)",
];

export default function InstructorPortal() {
  const { isLoading, isAuthenticated, user, signOut } = useAuth();
  const viewer = useQuery(api.instructorPortal.getInstructorViewer, {}) as
    | Viewer
    | undefined;
  const dashboard = useQuery(
    api.instructorPortal.getInstructorDashboard,
    viewer?.claimed === true ? {} : "skip",
  ) as Dashboard | undefined;
  const claim = useMutation(api.instructorPortal.claimInstructor);
  const createClass = useMutation(api.instructorPortal.createMyClass);
  const createStudent = useMutation(api.instructorPortal.createMyStudent);
  const addStudent = useMutation(api.instructorPortal.addStudentToMyClass);
  const removeStudent = useMutation(
    api.instructorPortal.removeStudentFromMyClass,
  );

  const [claimEmail, setClaimEmail] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [newClassOpen, setNewClassOpen] = useState(false);
  const [className, setClassName] = useState("");
  const [classDesc, setClassDesc] = useState("");
  /** Taxonomy category id chosen for the new class. */
  const [classSubject, setClassSubject] = useState("");
  const taxonomy = useQuery(
    api.taxonomy.getTaxonomy,
    isAuthenticated ? {} : "skip",
  ) as
    | { categories: Array<{ id: string; name: string }> }
    | undefined;
  const [addOpen, setAddOpen] = useState<ClassCard | null>(null);
  const [addMode, setAddMode] = useState<AddMode>("search");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentPhone, setStudentPhone] = useState("");
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const matches = useQuery(
    api.instructorPortal.searchStudentsForClass,
    addOpen
      ? { classId: addOpen.id as Id<"classes">, search: studentSearch }
      : "skip",
  ) as StudentMatch[] | undefined;

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
          <ShieldCheck className="mx-auto size-8 text-primary" />
          <h1 className="mt-4 text-xl font-bold">Instructor portal</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your instructor account to manage classes and view
            student performance.
          </p>
          <Link to="/auth?returnTo=%2Finstructor" className="mt-6 inline-block">
            <Button className="rounded-full">Sign in as instructor</Button>
          </Link>
        </div>
      </main>
    );
  }

  const doClaim = async () => {
    setClaiming(true);
    try {
      await claim({ email: claimEmail || undefined });
      toast.success("Instructor role granted — welcome!");
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
              <GraduationCap className="size-5 text-primary" /> Instructor
              portal
            </div>
            <h1 className="mt-4 text-xl font-extrabold">
              Claim your instructor access
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="font-semibold text-foreground">
                {viewer?.email ?? user?.email}
              </span>
              . Enter the email your institution registered (if different) to
              link your account to your instructor profile.
            </p>
            <div className="mt-4 grid gap-1.5">
              <Label className="text-xs font-semibold">
                Instructor email (optional)
              </Label>
              <Input
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
                placeholder="you@institution.edu"
                className="clay-inset rounded-full px-4"
              />
            </div>
            <Button
              className="clay-press mt-4 w-full rounded-full"
              disabled={claiming}
              onClick={() => void doClaim()}
            >
              {claiming && <Loader2 className="mr-2 size-4 animate-spin" />}
              Claim instructor role
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

  const doCreateClass = async () => {
    if (!className.trim()) {
      toast.error("Class name is required");
      return;
    }
    setBusy("class");
    try {
      const category = taxonomy?.categories.find((c) => c.id === classSubject);
      if (!category) {
        toast.error("Choose the class subject");
        return;
      }
      await createClass({
        name: className.trim(),
        description: classDesc || undefined,
        subject: category.name,
        categoryId: category.id as Id<"questionCategories">,
      });
      toast.success("Class created");
      setNewClassOpen(false);
      setClassName("");
      setClassDesc("");
      setClassSubject("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(null);
    }
  };

  const resetAddForm = () => {
    setAddMode("search");
    setStudentSearch("");
    setStudentName("");
    setStudentEmail("");
    setStudentPhone("");
    setPendingAdd(null);
  };

  const closeAddDialog = () => {
    setAddOpen(null);
    resetAddForm();
  };

  const requestRegister = () => {
    if (!studentName.trim()) {
      toast.error("Student name is required");
      return;
    }
    setPendingAdd({ kind: "new" });
  };

  const doConfirmAdd = async () => {
    if (!addOpen || !pendingAdd) return;
    setBusy("student");
    const className = addOpen.name;
    try {
      if (pendingAdd.kind === "existing") {
        await addStudent({
          classId: addOpen.id as Id<"classes">,
          studentId: pendingAdd.id as Id<"students">,
        });
        toast.success(`${pendingAdd.name} added to ${className}`);
      } else {
        const name = studentName.trim();
        await createStudent({
          classId: addOpen.id as Id<"classes">,
          name,
          email: studentEmail.trim() || undefined,
          phone: studentPhone.trim() || undefined,
        });
        toast.success(`${name} registered and added to ${className}`);
      }
      closeAddDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(null);
    }
  };

  const pct = (v: number | null) =>
    v === null ? "—" : `${Math.round(v)}%`;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 pt-8">
        <div className="flex items-center gap-3">
          <div className="clay-sm flex size-10 items-center justify-center">
            <GraduationCap className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">
              {dashboard?.instructor.name ?? "Instructor"}
            </p>
            <p className="text-xs text-muted-foreground">
              {dashboard?.instructor.specialization ?? "Instructor portal"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {user?.role === "admin" && (
            <Link to="/admin">
              <Button variant="outline" className="clay-press rounded-full">
                <ShieldCheck className="mr-2 size-4" /> Admin console
              </Button>
            </Link>
          )}
          <Link to="/instructor/assessments">
            <Button variant="outline" className="clay-press rounded-full">
              <ClipboardList className="mr-2 size-4" /> Assessments
            </Button>
          </Link>
          <Link to="/instructor/reports">
            <Button variant="outline" className="clay-press rounded-full">
              <BarChart3 className="mr-2 size-4" /> Class report
            </Button>
          </Link>
          <Link to="/instructor/results-analysis">
            <Button variant="outline" className="clay-press rounded-full">
              <TrendingUp className="mr-2 size-4" /> Results analysis
            </Button>
          </Link>
          <Link to="/instructor/class-closure">
            <Button variant="outline" className="clay-press rounded-full">
              <Flag className="mr-2 size-4" /> Final exam
            </Button>
          </Link>
          <Link to="/instructor/shared-questions">
            <Button variant="outline" className="clay-press rounded-full">
              <LibraryBig className="mr-2 size-4" /> Shared questions
            </Button>
          </Link>
          <LanguageSwitcher />
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
        <div className="grid grid-cols-3 gap-4">
          <div className="clay p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              My classes
            </p>
            <p className="mt-2 text-2xl font-extrabold tabular-nums">
              {dashboard?.totals.classes ?? 0}
            </p>
          </div>
          <div className="clay p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              My students
            </p>
            <p className="mt-2 text-2xl font-extrabold tabular-nums">
              {dashboard?.totals.students ?? 0}
            </p>
          </div>
          <div className="clay p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assessments completed
            </p>
            <p className="mt-2 text-2xl font-extrabold tabular-nums">
              {dashboard?.totals.assessments ?? 0}
            </p>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">My classes</h2>
          <Button
            className="clay-press rounded-full"
            onClick={() => setNewClassOpen(true)}
          >
            <Plus className="mr-1.5 size-4" /> New class
          </Button>
        </div>

        <div className="mt-4 grid gap-6 xl:grid-cols-2">
          {(dashboard?.classes ?? []).map((c) => (
            <div key={c.id} className="clay p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-base font-bold">
                    <Layers className="size-4 text-primary" /> {c.name}
                    {c.subject && (
                      <span className="rounded-full bg-[oklch(0.92_0.05_240)] px-2 py-0.5 text-[10px] font-bold text-[oklch(0.4_0.06_240)]">
                        {c.subject}
                      </span>
                    )}
                    {c.closedAt !== null && (
                      <span className="rounded-full bg-[oklch(0.9_0.06_25)] px-2 py-0.5 text-[10px] font-bold uppercase text-[oklch(0.35_0.08_25)]">
                        Closed
                      </span>
                    )}
                  </p>
                  {c.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.description}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={c.closedAt !== null}
                  title={
                    c.closedAt !== null
                      ? "This class is closed — reopen it to change the roster"
                      : undefined
                  }
                  onClick={() => {
                    setAddOpen(c);
                    resetAddForm();
                  }}
                >
                  <Plus className="mr-1 size-3.5" /> Student
                </Button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="clay-inset rounded-2xl p-3">
                  <p className="text-lg font-extrabold tabular-nums">
                    {c.joinedCount}/{c.studentCount}
                  </p>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Joined / members
                  </p>
                </div>
                <div className="clay-inset rounded-2xl p-3">
                  <p className="text-lg font-extrabold tabular-nums">
                    {pct(c.avgScore)}
                  </p>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Avg score
                  </p>
                </div>
                <div className="clay-inset rounded-2xl p-3">
                  <p className="text-lg font-extrabold tabular-nums">
                    {pct(c.passRate)}
                  </p>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Pass rate
                  </p>
                </div>
              </div>

              {(c.trend.length > 0 || c.completedAssessments > 0) && (
                <div className="mt-4 h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={c.trend}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                      <RTooltip />
                      <Bar dataKey="avgScore" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {c.distribution.some((d) => d.value > 0) && (
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
                  {c.distribution.map((d, i) => (
                    <div
                      key={d.name}
                      className="h-full"
                      style={{
                        width: `${(d.value / Math.max(1, c.distribution.reduce((a, x) => a + x.value, 0))) * 100}%`,
                        background: DIST_COLORS[i],
                      }}
                      title={`${d.name}: ${d.value}`}
                    />
                  ))}
                </div>
              )}

              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="size-3.5" /> Roster
                </p>
                {c.students.length === 0 ? (
                  <p className="clay-inset rounded-2xl p-4 text-center text-xs text-muted-foreground">
                    No students yet — add your first student.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {c.students.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm hover:bg-[var(--accent)]/50"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          {s.photoUrl ? (
                            <img
                              src={s.photoUrl}
                              alt={s.name}
                              className="size-9 shrink-0 rounded-full border-2 border-white/70 object-cover shadow-sm"
                            />
                          ) : (
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {s.name
                                .split(" ")
                                .map((p) => p[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate font-medium">
                              {s.name}
                              {s.joined ? (
                                <span className="rounded-full bg-[oklch(0.72_0.14_145)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[oklch(0.45_0.12_145)]">
                                  Joined
                                </span>
                              ) : (
                                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
                                  Invited
                                </span>
                              )}
                              {s.faceRegistered ? (
                                <span
                                  className="rounded-full bg-[oklch(0.72_0.14_145)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[oklch(0.45_0.12_145)]"
                                  title={`Face: ${s.faceImageCount} poses registered · last check: ${s.lastFaceCheckStatus ?? "none"}`}
                                >
                                  Face ✓ {s.faceImageCount}
                                </span>
                              ) : (
                                <span
                                  className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600"
                                  title="Face registration incomplete — the student cannot start assessments yet"
                                >
                                  Face pending
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {s.email ?? ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                          <span>
                            {s.assessments} exam{s.assessments === 1 ? "" : "s"}
                          </span>
                          <span
                            className={
                              s.avgScore !== null && s.avgScore >= 50
                                ? "font-bold text-[oklch(0.45_0.12_145)]"
                                : "font-bold text-destructive"
                            }
                          >
                            {pct(s.avgScore)}
                          </span>
                          <button
                            className="rounded-full px-2 py-0.5 text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              removeStudent({
                                classId: c.id as Id<"classes">,
                                studentId: s.id as Id<"students">,
                              }).catch((err: unknown) =>
                                toast.error(
                                  err instanceof Error
                                    ? err.message
                                    : "Remove failed",
                                ),
                              );
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Link to={`/instructor/results-analysis/${c.id}`}>
                  <Button size="sm" className="clay-press rounded-full">
                    <TrendingUp className="mr-1.5 size-3.5" /> Results analysis
                  </Button>
                </Link>
                <Link to={`/instructor/reports/${c.id}`}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="clay-press rounded-full"
                  >
                    <BarChart3 className="mr-1.5 size-3.5" /> Class report
                  </Button>
                </Link>
                <Link to={`/instructor/class-closure/${c.id}`}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="clay-press rounded-full"
                  >
                    <Flag className="mr-1.5 size-3.5" />
                    {c.finalExamId ? "Final exam" : "Close class"}
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>

        {dashboard && dashboard.classes.length === 0 && (
          <div className="clay mt-4 p-10 text-center">
            <BookOpen className="mx-auto size-8 text-primary" />
            <p className="mt-3 font-bold">No classes yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first class, then add students to it.
            </p>
            <Button
              className="clay-press mt-4 rounded-full"
              onClick={() => setNewClassOpen(true)}
            >
              <Plus className="mr-1.5 size-4" /> New class
            </Button>
          </div>
        )}

        <div className="h-16" />
      </section>

      {/* New class dialog */}
      <Dialog open={newClassOpen} onOpenChange={setNewClassOpen}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create a class</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Class name</Label>
              <Input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="e.g. Data Structures — Fall"
                className="clay-inset rounded-full px-4"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Subject</Label>
              <Select value={classSubject} onValueChange={setClassSubject}>
                <SelectTrigger className="clay-inset rounded-full px-4">
                  <SelectValue placeholder="Choose a subject" />
                </SelectTrigger>
                <SelectContent>
                  {(taxonomy?.categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Shared questions are filtered to this subject.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Input
                value={classDesc}
                onChange={(e) => setClassDesc(e.target.value)}
                placeholder="Optional"
                className="clay-inset rounded-full px-4"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setNewClassOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-full" disabled={busy === "class"} onClick={() => void doCreateClass()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add student dialog */}
      <Dialog
        open={addOpen !== null}
        onOpenChange={(o) => {
          if (!o) closeAddDialog();
        }}
      >
        <DialogContent className="clay border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Add student to {addOpen?.name ?? "class"}
            </DialogTitle>
          </DialogHeader>

          <Tabs
            value={addMode}
            onValueChange={(v) => setAddMode(v as AddMode)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="search">Search existing</TabsTrigger>
              <TabsTrigger value="new">Register new</TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="mt-3 space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search by name or email"
                  className="clay-inset rounded-full pl-9 pr-4"
                  autoFocus
                />
              </div>

              {studentSearch.trim().length < 2 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  Type at least 2 characters to search the student directory.
                </p>
              ) : matches === undefined ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : matches.length === 0 ? (
                <div className="clay-inset rounded-2xl p-4 text-center">
                  <p className="text-sm font-semibold">No matching student</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Check the spelling, or register them as a new student.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 rounded-full"
                    onClick={() => {
                      if (!studentName.trim())
                        setStudentName(studentSearch.trim());
                      setAddMode("new");
                    }}
                  >
                    <Plus className="mr-1 size-3.5" /> Register new student
                  </Button>
                </div>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {matches.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-bold">{m.name}</p>
                          <span
                            className={
                              m.hasAccount
                                ? "rounded-full bg-[oklch(0.72_0.14_145)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[oklch(0.45_0.12_145)]"
                                : "rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600"
                            }
                          >
                            {m.hasAccount ? "Registered" : "Invite pending"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.email ?? "No email on file"}
                          {m.studentIdNumber ? ` · ${m.studentIdNumber}` : ""}
                        </p>
                        {m.alreadyInClass && (
                          <p className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-amber-600">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                            {m.enrolled
                              ? "Already enrolled in this class — duplicate enrollment blocked."
                              : "Already on this class roster — adding again is blocked."}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 rounded-full"
                        disabled={m.alreadyInClass || busy === "student"}
                        onClick={() =>
                          setPendingAdd({
                            kind: "existing",
                            id: m.id,
                            name: m.name,
                          })
                        }
                      >
                        {m.alreadyInClass ? "Added" : "Add"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="new" className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Register someone who isn't in the student directory yet. They
                will be enrolled in this class immediately.
              </p>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Full name</Label>
                <Input
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="clay-inset rounded-full px-4"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Email</Label>
                  <Input
                    value={studentEmail}
                    onChange={(e) => setStudentEmail(e.target.value)}
                    placeholder="Optional — needed to sign in"
                    className="clay-inset rounded-full px-4"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Phone</Label>
                  <Input
                    value={studentPhone}
                    onChange={(e) => setStudentPhone(e.target.value)}
                    className="clay-inset rounded-full px-4"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={closeAddDialog}
            >
              Cancel
            </Button>
            {addMode === "new" && (
              <Button
                className="rounded-full"
                disabled={busy === "student"}
                onClick={requestRegister}
              >
                Register & add
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adding a student is a two-step action: pick/enter, then confirm. */}
      <AlertDialog
        open={pendingAdd !== null}
        onOpenChange={(o) => {
          if (!o) setPendingAdd(null);
        }}
      >
        <AlertDialogContent className="clay border-0">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm adding student</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAdd?.kind === "existing"
                ? `Add ${pendingAdd.name} to ${addOpen?.name ?? "this class"}? They will be enrolled immediately and can access this class's assessments.`
                : `Register ${studentName.trim() || "this student"} and add them to ${addOpen?.name ?? "this class"}? ${
                    studentEmail.trim()
                      ? `They can claim the account with ${studentEmail.trim()}.`
                      : "No email was provided, so they cannot claim a sign-in account yet."
                  }`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="rounded-full"
              disabled={busy === "student"}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={busy === "student"}
              onClick={(e) => {
                e.preventDefault();
                void doConfirmAdd();
              }}
            >
              {busy === "student" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              {pendingAdd?.kind === "existing"
                ? "Confirm add"
                : "Confirm registration"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

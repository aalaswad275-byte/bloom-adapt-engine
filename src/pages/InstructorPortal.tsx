import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  GraduationCap,
  Layers,
  Loader2,
  Plus,
  ShieldCheck,
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
import { useAuth } from "@/hooks/use-auth";

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
  status: string;
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
  const [addOpen, setAddOpen] = useState<ClassCard | null>(null);
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentPhone, setStudentPhone] = useState("");
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
      await createClass({
        name: className.trim(),
        description: classDesc || undefined,
      });
      toast.success("Class created");
      setNewClassOpen(false);
      setClassName("");
      setClassDesc("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(null);
    }
  };

  const doCreateStudent = async () => {
    if (!addOpen || !studentName.trim()) {
      toast.error("Student name is required");
      return;
    }
    setBusy("student");
    try {
      await createStudent({
        classId: addOpen.id as Id<"classes">,
        name: studentName.trim(),
        email: studentEmail || undefined,
        phone: studentPhone || undefined,
      });
      toast.success("Student added");
      setAddOpen(null);
      setStudentName("");
      setStudentEmail("");
      setStudentPhone("");
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

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8">
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
        <div className="flex items-center gap-3">
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
                  onClick={() => {
                    setAddOpen(c);
                    setStudentName("");
                    setStudentEmail("");
                    setStudentPhone("");
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
      <Dialog open={addOpen !== null} onOpenChange={(o) => !o && setAddOpen(null)}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add student to {addOpen?.name ?? "class"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
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
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setAddOpen(null)}>
              Cancel
            </Button>
            <Button className="rounded-full" disabled={busy === "student"} onClick={() => void doCreateStudent()}>
              Add student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

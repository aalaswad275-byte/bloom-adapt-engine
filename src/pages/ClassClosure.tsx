import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  Flag,
  GraduationCap,
  Loader2,
  Lock,
  LockOpen,
  ShieldCheck,
  Shuffle,
  TrendingUp,
  Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FAIR_ADAPTIVE_LABEL } from "@/lib/assessmentType";

type BloomKey =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

const BLOOM_ORDER: BloomKey[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

const BLOOM_LABEL: Record<BloomKey, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};

type Overview = {
  class: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    closedAt: number | null;
    closureNote: string | null;
    rosterSize: number;
    joinedCount: number;
  };
  bank: {
    total: number;
    byLevel: Record<BloomKey, number>;
    suggestedCounts: Record<string, number>;
    canBuildFinal: boolean;
  };
  prior: { assessments: number; published: number };
  finalExam: null | {
    id: string;
    title: string;
    description: string | null;
    status: string;
    timeLimitMin: number;
    publishedAt: number | null;
    questionCount: number;
    totalMarks: number;
    questions: Array<{
      id: string;
      index: number;
      questionText: string;
      questionType: string;
      bloomLevel: BloomKey;
      marks: number;
      difficultyB: number | null;
      options: string[] | null;
    }>;
    submissions: { total: number; inProgress: number; submitted: number };
    avgPct: number | null;
    passRate: number | null;
    fairness: {
      distinctQuestionSets: number;
      distinctOrders: number;
      identicalSet: boolean;
      marksSpread: number;
      identicalMarks: boolean;
    };
  };
  tracking: Array<{
    studentId: string;
    name: string;
    email: string | null;
    joined: boolean;
    status: "not_started" | "in_progress" | "submitted";
    pct: number | null;
    submittedAt: number | null;
    violations: number;
  }>;
};

type Dashboard = {
  classes: Array<{ id: string; name: string }>;
};

const fmtDate = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const fmtPct = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)}%`;

function BloomBar({ overview }: { overview: Overview }) {
  const max = Math.max(1, ...BLOOM_ORDER.map((b) => overview.bank.byLevel[b]));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {BLOOM_ORDER.map((level) => {
        const count = overview.bank.byLevel[level];
        return (
          <div key={level} className="clay-inset rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {BLOOM_LABEL[level]}
            </p>
            <p className="mt-1 text-lg font-extrabold tabular-nums">{count}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClosureBoard({ overview }: { overview: Overview }) {
  const navigate = useNavigate();
  const closeClass = useMutation(api.classClosure.closeMyClass);
  const reopenClass = useMutation(api.classClosure.reopenMyClass);
  const createFinal = useMutation(api.classClosure.createFinalExam);

  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState(
    `${overview.class.name} — Final Exam`,
  );
  const [timeLimit, setTimeLimit] = useState("60");
  const [counts, setCounts] = useState<Record<BloomKey, string>>(() =>
    BLOOM_ORDER.reduce(
      (acc, level) => {
        acc[level] = String(overview.bank.suggestedCounts[level] ?? 0);
        return acc;
      },
      {} as Record<BloomKey, string>,
    ),
  );

  const closed = overview.class.closedAt !== null;
  const finalExam = overview.finalExam;
  const selectedTotal = BLOOM_ORDER.reduce(
    (sum, level) => sum + (Number.parseInt(counts[level], 10) || 0),
    0,
  );
  const invalidLevel = BLOOM_ORDER.find((level) => {
    const wanted = Number.parseInt(counts[level], 10) || 0;
    return wanted < 0 || wanted > overview.bank.byLevel[level];
  });

  const doClose = async () => {
    setBusy("close");
    try {
      const res = await closeClass({
        classId: overview.class.id as Id<"classes">,
        note: note.trim() || undefined,
      });
      toast.success(
        res?.alreadyClosed
          ? "This class was already closed"
          : "Class closed — the roster is now frozen",
      );
      setConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Close failed");
    } finally {
      setBusy(null);
    }
  };

  const doReopen = async () => {
    setBusy("reopen");
    try {
      await reopenClass({ classId: overview.class.id as Id<"classes"> });
      toast.success("Class reopened — regular assessments can start again");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reopen failed");
    } finally {
      setBusy(null);
    }
  };

  const doCreateFinal = async () => {
    if (invalidLevel) {
      toast.error(
        `${BLOOM_LABEL[invalidLevel]} asks for more questions than the bank holds (${overview.bank.byLevel[invalidLevel]}).`,
      );
      return;
    }
    if (selectedTotal < 1) {
      toast.error("Select at least one question for the final exam.");
      return;
    }
    setBusy("final");
    try {
      const res = await createFinal({
        classId: overview.class.id as Id<"classes">,
        title: title.trim() || undefined,
        timeLimitMin: Math.max(0, Number.parseInt(timeLimit, 10) || 0),
        counts: BLOOM_ORDER.reduce(
          (acc, level) => {
            acc[level] = Number.parseInt(counts[level], 10) || 0;
            return acc;
          },
          {} as Record<string, number>,
        ),
      });
      toast.success(
        `Final exam published — ${res?.questionCount ?? selectedTotal} questions, ${res?.totalMarks ?? 0} marks`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Final exam creation failed",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* ---------- Step 1: closure ---------- */}
      <section className="clay p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="clay-inset flex size-10 shrink-0 items-center justify-center rounded-2xl">
              {closed ? (
                <Lock className="size-5 text-primary" />
              ) : (
                <LockOpen className="size-5 text-primary" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                Step 1
              </p>
              <h2 className="text-lg font-extrabold">Close the class</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Closing freezes the roster and stops every regular assessment
                from being started. Work already in progress stays valid — only
                the final exam accepts new starts.
              </p>
            </div>
          </div>
          <Badge
            className={cn(
              "rounded-full",
              closed
                ? "bg-[oklch(0.9_0.06_25)] text-[oklch(0.35_0.08_25)]"
                : "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]",
            )}
          >
            {closed ? "Closed" : "Open"}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="clay-inset rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Roster
            </p>
            <p className="mt-1 text-lg font-extrabold tabular-nums">
              {overview.class.joinedCount}/{overview.class.rosterSize}
            </p>
            <p className="text-[10px] text-muted-foreground">joined / members</p>
          </div>
          <div className="clay-inset rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Assessments so far
            </p>
            <p className="mt-1 text-lg font-extrabold tabular-nums">
              {overview.prior.assessments}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {overview.prior.published} currently published
            </p>
          </div>
          <div className="clay-inset rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Question bank
            </p>
            <p className="mt-1 text-lg font-extrabold tabular-nums">
              {overview.bank.total}
            </p>
            <p className="text-[10px] text-muted-foreground">
              questions available to draw from
            </p>
          </div>
        </div>

        {closed ? (
          <div className="mt-4 rounded-2xl bg-[var(--accent)]/60 p-4">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-[oklch(0.45_0.12_145)]" />
              Closed on {fmtDate(overview.class.closedAt)}
            </p>
            {overview.class.closureNote && (
              <p className="mt-1 text-sm text-muted-foreground">
                “{overview.class.closureNote}”
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              The roster is frozen, regular assessments cannot start, and only
              the final exam is open to students.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="clay-press mt-3 rounded-full"
              disabled={busy !== null}
              onClick={() => void doReopen()}
            >
              {busy === "reopen" ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <LockOpen className="mr-1.5 size-3.5" />
              )}
              Reopen class
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="closure-note" className="text-xs font-semibold">
                Closure note (optional)
              </Label>
              <Textarea
                id="closure-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Semester complete — final exam covers the whole Bloom ladder."
                className="min-h-16 rounded-2xl"
              />
            </div>
            <Button
              className="clay-press rounded-full"
              disabled={busy !== null || overview.class.rosterSize === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Lock className="mr-1.5 size-4" /> Close class
            </Button>
            {overview.class.rosterSize === 0 && (
              <p className="text-xs text-amber-600">
                Add students before closing the class.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---------- Step 2: final exam ---------- */}
      {closed && !finalExam && (
        <section className="clay p-6">
          <div className="flex items-start gap-3">
            <div className="clay-inset flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <FileCheck2 className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                Step 2
              </p>
              <h2 className="text-lg font-extrabold">Create the final exam</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                One shared paper is drawn from the class bank using the adaptive
                model&apos;s difficulty spread. Every student answers exactly
                these questions, each in their own randomized order, and the
                marks are identical for the whole roster.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <BloomBar overview={overview} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="final-title" className="text-xs font-semibold">
                  Exam title
                </Label>
                <Input
                  id="final-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="rounded-full"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="final-time"
                  className="text-xs font-semibold"
                >
                  Time limit (minutes, 0 = untimed)
                </Label>
                <Input
                  id="final-time"
                  type="number"
                  min={0}
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(e.target.value)}
                  className="rounded-full"
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Questions per Bloom level
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {BLOOM_ORDER.map((level) => {
                  const available = overview.bank.byLevel[level];
                  const wanted = Number.parseInt(counts[level], 10) || 0;
                  const over = wanted > available;
                  return (
                    <div key={level} className="clay-inset rounded-2xl p-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {BLOOM_LABEL[level]}
                      </p>
                      <Input
                        type="number"
                        min={0}
                        max={available}
                        value={counts[level]}
                        onChange={(e) =>
                          setCounts((prev) => ({
                            ...prev,
                            [level]: e.target.value,
                          }))
                        }
                        className={cn(
                          "mt-1 h-8 rounded-full px-3 text-sm",
                          over && "border-destructive text-destructive",
                        )}
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        of {available} in bank
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--accent)]/50 p-3">
              <p className="text-sm font-semibold">
                {selectedTotal} question{selectedTotal === 1 ? "" : "s"} · same
                set for every student
              </p>
              <Badge className="clay-inset rounded-full text-[10px] uppercase text-foreground">
                <Shuffle className="mr-1 size-3" /> Order randomized per student
              </Badge>
            </div>

            {invalidLevel && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                {BLOOM_LABEL[invalidLevel]}: the bank only has{" "}
                {overview.bank.byLevel[invalidLevel]} question
                {overview.bank.byLevel[invalidLevel] === 1 ? "" : "s"}.
              </p>
            )}

            <Button
              className="clay-press rounded-full"
              disabled={
                busy !== null ||
                selectedTotal < 1 ||
                invalidLevel !== undefined ||
                !overview.bank.canBuildFinal
              }
              onClick={() => void doCreateFinal()}
            >
              {busy === "final" ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Flag className="mr-1.5 size-4" />
              )}
              Create &amp; publish final exam
            </Button>
            {!overview.bank.canBuildFinal && (
              <p className="text-xs text-amber-600">
                Add questions to the class bank first — the final is drawn from
                it.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ---------- Final exam summary + fairness audit ---------- */}
      {finalExam && (
        <>
          <section className="clay p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                  {FAIR_ADAPTIVE_LABEL}
                </p>
                <h2 className="text-lg font-extrabold">{finalExam.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Published {fmtDate(finalExam.publishedAt)} ·{" "}
                  {finalExam.timeLimitMin > 0
                    ? `${finalExam.timeLimitMin} minutes`
                    : "untimed"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="clay-inset rounded-full text-[10px] uppercase text-foreground">
                  {finalExam.status}
                </Badge>
                <Link
                  to={`/instructor/assessments/${overview.class.id}`}
                  className="inline-block"
                >
                  <Button variant="outline" size="sm" className="rounded-full">
                    <ClipboardList className="mr-1.5 size-3.5" /> Assessments
                  </Button>
                </Link>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="clay-inset rounded-2xl p-3 text-center">
                <p className="text-xl font-extrabold tabular-nums">
                  {finalExam.questionCount}
                </p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Questions
                </p>
              </div>
              <div className="clay-inset rounded-2xl p-3 text-center">
                <p className="text-xl font-extrabold tabular-nums">
                  {finalExam.totalMarks}
                </p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Marks (all students)
                </p>
              </div>
              <div className="clay-inset rounded-2xl p-3 text-center">
                <p className="text-xl font-extrabold tabular-nums">
                  {finalExam.submissions.submitted}/{overview.class.rosterSize}
                </p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Submitted
                </p>
              </div>
              <div className="clay-inset rounded-2xl p-3 text-center">
                <p className="text-xl font-extrabold tabular-nums">
                  {fmtPct(finalExam.avgPct)}
                </p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Class average
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-[var(--accent)]/60 p-4">
              <p className="flex items-center gap-2 text-sm font-bold">
                <ShieldCheck className="size-4 text-primary" /> Fairness audit
              </p>
              {finalExam.submissions.submitted === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Waiting for submissions. Once students start, this panel
                  verifies that every attempt faced the same question set.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-xs">
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 text-[oklch(0.45_0.12_145)]" />
                    Same question set for all{" "}
                    {finalExam.submissions.submitted} submitted attempt
                    {finalExam.submissions.submitted === 1 ? "" : "s"}
                    {finalExam.fairness.identicalSet ? "" : " — REVIEW"}
                    {!finalExam.fairness.identicalSet &&
                      ` (${finalExam.fairness.distinctQuestionSets} distinct sets found)`}
                  </li>
                  <li className="flex items-center gap-2">
                    <Shuffle className="size-3.5 text-primary" />
                    {finalExam.fairness.distinctOrders} distinct presentation
                    order
                    {finalExam.fairness.distinctOrders === 1 ? "" : "s"} — each
                    student answered in their own shuffle
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 text-[oklch(0.45_0.12_145)]" />
                    Max marks {finalExam.totalMarks} for every attempt
                    {finalExam.fairness.identicalMarks ? "" : " — REVIEW"}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 text-[oklch(0.45_0.12_145)]" />
                    Grading is correctness × question marks — order never
                    affects marks
                  </li>
                </ul>
              )}
            </div>
          </section>

          <section className="clay p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-extrabold">
                <Users className="size-4 text-primary" /> Student tracking
              </h3>
              <p className="text-xs text-muted-foreground">
                {finalExam.submissions.inProgress} in progress ·{" "}
                {finalExam.submissions.submitted} submitted
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-bold">Student</th>
                    <th className="pb-2 font-bold">Status</th>
                    <th className="pb-2 text-right font-bold">Score</th>
                    <th className="pb-2 text-right font-bold">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.tracking.map((row) => (
                    <tr key={row.studentId} className="border-b last:border-0">
                      <td className="py-2">
                        <p className="font-semibold">{row.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.email ?? "—"}
                        </p>
                      </td>
                      <td className="py-2">
                        <Badge
                          className={cn(
                            "rounded-full text-[10px]",
                            row.status === "submitted"
                              ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
                              : row.status === "in_progress"
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {row.status === "not_started"
                            ? "Not started"
                            : row.status === "in_progress"
                              ? "In progress"
                              : "Submitted"}
                        </Badge>
                      </td>
                      <td className="py-2 text-right font-bold tabular-nums">
                        {fmtPct(row.pct)}
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground">
                        {fmtDate(row.submittedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="clay p-6">
            <h3 className="text-base font-extrabold">
              Shared question set ({finalExam.questionCount})
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This is the canonical paper order. Every student receives these
              same questions in a shuffle of their own.
            </p>
            <ol className="mt-3 space-y-2">
              {finalExam.questions.map((q) => (
                <li
                  key={q.id}
                  className="clay-inset flex flex-wrap items-start justify-between gap-2 rounded-2xl p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {q.index + 1}. {q.questionText}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                        {BLOOM_LABEL[q.bloomLevel]}
                      </span>
                      <span>{q.marks} marks</span>
                      <span>
                        {q.questionType.replace("_", " ")}
                      </span>
                      {q.difficultyB !== null && (
                        <span>b {q.difficultyB.toFixed(2)}</span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {/* ---------- Next steps ---------- */}
      {closed && (
        <section className="clay p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            After the final
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="clay-press rounded-full"
              variant="outline"
              onClick={() => navigate(`/instructor/results-analysis/${overview.class.id}`)}
            >
              <TrendingUp className="mr-1.5 size-4" /> Results analysis
            </Button>
            <Button
              className="clay-press rounded-full"
              variant="outline"
              onClick={() => navigate(`/instructor/reports/${overview.class.id}`)}
            >
              <BarChart3 className="mr-1.5 size-4" /> Class report
            </Button>
          </div>
        </section>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Close {overview.class.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The roster freezes and no new regular assessments can start.
              Students keep any attempt already in progress, and you can generate
              the final exam right after closing. You can reopen the class
              later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                void doClose();
              }}
            >
              {busy === "close" && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              Close class
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Instructor view: close a class and build its one-paper final exam. */
export default function ClassClosure() {
  const params = useParams();
  const navigate = useNavigate();
  const dashboard = useQuery(api.instructorPortal.getInstructorDashboard) as
    | Dashboard
    | undefined;
  const classes = dashboard?.classes ?? [];
  const classId = params.classId ?? classes[0]?.id;

  const overview = useQuery(
    api.classClosure.getClassClosureOverview,
    classId ? { classId: classId as Id<"classes"> } : "skip",
  ) as unknown as Overview | undefined;

  if (dashboard === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.86_0.08_200)]" />
      <div className="clay-blob right-[-8%] bottom-[8%] size-[260px] bg-[oklch(0.85_0.09_320)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 pt-8">
        <div className="flex items-center gap-3">
          <Link to="/instructor">
            <Button variant="outline" size="sm" className="clay-press rounded-full">
              <ArrowLeft className="mr-1.5 size-4" /> Portal
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="clay-sm flex size-10 items-center justify-center">
              <Flag className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">
                Class closure &amp; final exam
              </p>
              <p className="text-xs text-muted-foreground">
                {overview?.class.name ?? "Finalize a class"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={classId ?? ""}
            onValueChange={(value) =>
              navigate(`/instructor/class-closure/${value}`)
            }
          >
            <SelectTrigger className="clay-inset w-48 rounded-full px-4">
              <SelectValue placeholder="Select a class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((cls) => (
                <SelectItem key={cls.id} value={cls.id}>
                  {cls.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {classId && (
            <Link to={`/instructor/assessments/${classId}`}>
              <Button variant="outline" className="clay-press rounded-full">
                <ClipboardList className="mr-1.5 size-4" /> Assessments
              </Button>
            </Link>
          )}
        </div>
      </header>

      {classes.length === 0 ? (
        <section className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-6">
          <div className="clay p-10 text-center">
            <GraduationCap className="mx-auto size-8 text-primary" />
            <p className="mt-3 font-bold">No classes yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a class, add your students, and publish assessments before
              closing it for the final exam.
            </p>
            <Link to="/instructor" className="mt-4 inline-block">
              <Button className="clay-press rounded-full">Open portal</Button>
            </Link>
          </div>
        </section>
      ) : overview === undefined ? (
        <section className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-6">
          <div className="clay flex items-center justify-center p-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </section>
      ) : (
        <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl space-y-5 px-6 pb-16">
          <div className="clay p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-extrabold">
                    {overview.class.name}
                  </h1>
                  <Badge className="clay-inset rounded-full text-[10px] uppercase text-foreground">
                    {overview.class.status}
                  </Badge>
                  {overview.class.closedAt !== null && (
                    <Badge className="rounded-full bg-[oklch(0.9_0.06_25)] text-[10px] font-bold uppercase text-[oklch(0.35_0.08_25)]">
                      <Lock className="mr-1 size-3" /> Closed
                    </Badge>
                  )}
                </div>
                {overview.class.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {overview.class.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {overview.class.rosterSize} students ·{" "}
                  {overview.bank.total} questions in the bank
                </p>
              </div>
            </div>
            <p className="mt-4 rounded-2xl bg-[var(--accent)]/60 p-3 text-sm leading-relaxed">
              Close the class at the end of the semester, then generate one final
              exam from the adaptive model. The paper is identical for everyone —
              same questions, same marks — while each student's question order is
              shuffled individually.
            </p>
          </div>

          <ClosureBoard key={classId} overview={overview} />
        </section>
      )}
    </main>
  );
}

/**
 * Shared Questions — a reusable bank that is not bound to any class.
 *
 * Instructors browse only the subjects they teach (the selected class's
 * subject narrows it further), import a question into their class pool by
 * reference, and manage the shared questions they created. Admins see the
 * whole bank and can add, edit, archive and delete every question.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import {
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Download,
  GraduationCap,
  LibraryBig,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ListData, Context } from "@/convex/_generated/api";
import { BLOOM_LABEL, type BloomLevel } from "@/lib/irt";
import {
  DIFFICULTY_LEVELS,
  DIFFICULTY_META,
  resolveDifficulty,
  type DifficultyLevel,
} from "@/lib/difficulty";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";

const BLOOM_BADGE: Record<string, string> = {
  remember: "bg-[oklch(0.9_0.05_320)] text-[oklch(0.4_0.09_320)]",
  understand: "bg-[oklch(0.85_0.12_145)] text-[oklch(0.32_0.09_145)]",
  apply: "bg-[oklch(0.85_0.14_85)] text-[oklch(0.32_0.1_85)]",
  analyze: "bg-[oklch(0.88_0.12_250)] text-[oklch(0.4_0.06_250)]",
  evaluate: "bg-[oklch(0.88_0.1_30)] text-[oklch(0.4_0.07_30)]",
  create: "bg-[oklch(0.86_0.14_320)] text-[oklch(0.42_0.08_320)]",
};

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  short_answer: "Short answer",
};

function fmtSec(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${sec}s`;
}

type ClassOption = {
  id: string;
  name: string;
  subject: string | null;
  closedAt: number | null;
};

type SharedQuestion = {
  _id: string;
  subject: string;
  topic?: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  marks: number;
  bloomLevel: BloomLevel;
  difficultyLevel?: DifficultyLevel;
  expectedTimeSec: number;
  ownerInstructorId?: string;
  ownerName: string;
  status: "active" | "archived";
  share: boolean;
  createdAt: number;
  updatedAt: number;
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  importedClassIds: string[];
};

type QuestionForm = {
  id: string | null;
  subject: string;
  topic: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options: string[];
  correctAnswer: string;
  explanation: string;
  marks: string;
  bloomLevel: BloomLevel;
  difficultyLevel: DifficultyLevel;
  timeSec: number;
  share: boolean;
};

/** Fields passed to `createSharedQuestion` / `updateSharedQuestion`. */
export interface SharedFields {
  subject: string;
  topic?: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  marks: number;
  bloomLevel: BloomLevel;
  difficultyLevel?: DifficultyLevel;
  expectedTimeSec: number;
  difficultyB?: number;
  discriminationA?: number;
  share: boolean;
}
function blankForm(subject = "", topic = ""): QuestionForm {
  return {
    id: null,
    subject,
    topic,
    questionText: "",
    questionType: "multiple_choice",
    options: ["", "", "", ""],
    correctAnswer: "",
    explanation: "",
    marks: "1",
    bloomLevel: "understand",
    difficultyLevel: "medium",
    timeSec: 60,
    share: true,
  };
}

function formFrom(q: SharedQuestion): QuestionForm {
  return {
    id: q._id,
    subject: q.subject,
    topic: q.topic ?? "",
    questionText: q.questionText,
    questionType: q.questionType,
    options:
      q.questionType === "multiple_choice"
        ? [...(q.options ?? []), "", "", "", ""].slice(0, 4)
        : ["", "", "", ""],
    correctAnswer: q.correctAnswer,
    explanation: q.explanation ?? "",
    marks: String(q.marks),
    bloomLevel: q.bloomLevel,
    difficultyLevel: resolveDifficulty(q),
    timeSec: q.expectedTimeSec,
    share: q.share,
  };
}

export default function SharedQuestions() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const allowed = user?.role === "instructor" || user?.role === "admin";

  const context = useQuery(
    api.sharedQuestions.getSharedQuestionsContext,
    allowed ? {} : "skip",
  ) as Context | undefined;

  const [classId, setClassId] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [subjectDraft, setSubjectDraft] = useState("");

  const classes = context?.classes ?? [];
  const effectiveClassId =
    context?.role === "instructor"
      ? classId ?? classes[0]?.id ?? null
      : null;
  const selectedClass =
    classes.find((c) => c.id === effectiveClassId) ?? null;

  const listArgs = context
    ? {
        ...(effectiveClassId
          ? { classId: effectiveClassId as Id<"classes"> }
          : {}),
        mineOnly,
        includeArchived: showArchived,
      }
    : "skip";
  // listSharedQuestions returns the full shared bank (list endpoint already
  // applies includeArchived + share scoping server-side). The context query
  // above is the canonical one for role/subjects/classes.
  const data = useQuery(
    api.sharedQuestions.getSharedQuestionsContext,
    allowed ? {} : "skip",
  ) as ListData | undefined;

  const createShared = useMutation(api.sharedQuestions.createSharedQuestion);
  const updateSharedQuestion = useMutation(api.sharedQuestions.updateSharedQuestion);
  const setShare = useMutation(api.sharedQuestions.setSharedQuestionShare);
  const updateShared = useMutation(api.sharedQuestions.updateSharedQuestion);
  const deleteShared = useMutation(api.sharedQuestions.deleteSharedQuestion);
  const archiveShared = useMutation(
    api.sharedQuestions.setSharedQuestionArchived,
  );
  const importShared = useMutation(api.sharedQuestions.importSharedQuestion);
  const setSubject = useMutation(api.sharedQuestions.setClassSubject);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<QuestionForm>(() => blankForm());

  const questions = data?.questions ?? [];
  // "My questions" ignores the class-subject scope so owners can always
  // manage every shared question they created.
  const forcedSubject = mineOnly
    ? null
    : data?.forcedSubject ?? selectedClass?.subject ?? null;

  const subjectOptions = useMemo(
    () =>
      [...new Set(questions.map((q) => q.subject))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [questions],
  );

  const topicOptions = useMemo(() => {
    const rows = questions.filter(
      (q) => !subjectFilter || q.subject === subjectFilter,
    );
    return [
      ...new Set(rows.map((q) => q.topic?.trim() ?? "General")),
    ].sort((a, b) => a.localeCompare(b));
  }, [questions, subjectFilter]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (!forcedSubject && subjectFilter && q.subject !== subjectFilter)
        return false;
      if (topicFilter && (q.topic?.trim() || "General") !== topicFilter)
        return false;
      if (mineOnly && !q.isOwner) return false;
      if (term) {
        const hay = `${q.questionText} ${q.topic ?? ""} ${q.explanation ?? ""} ${q.subject} ${q.ownerName}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [questions, forcedSubject, subjectFilter, topicFilter, mineOnly, search]);

  const groups = useMemo(() => {
    const bySubject = new Map<string, Map<string, SharedQuestion[]>>();
    for (const q of visible) {
      const subjects = bySubject.get(q.subject) ?? new Map();
      const topic = q.topic?.trim() || "General";
      const rows = subjects.get(topic) ?? [];
      rows.push(q);
      subjects.set(topic, rows);
      bySubject.set(q.subject, subjects);
    }
    return [...bySubject.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subject, topics]) => ({
        subject,
        topics: [...topics.entries()].sort(([a], [b]) => {
          if (a === "General") return 1;
          if (b === "General") return -1;
          return a.localeCompare(b);
        }),
      }));
  }, [visible]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated || !allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <LibraryBig className="mx-auto size-8 text-primary" />
          <h1 className="mt-4 text-xl font-bold">Shared Questions</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with an instructor or administrator account to browse the
            shared question bank.
          </p>
          <Link
            to="/auth?returnTo=%2Finstructor%2Fshared-questions"
            className="mt-6 inline-block"
          >
            <Button className="rounded-full">Sign in</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!context) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const isAdmin = context.role === "admin";
  const canImport = context.role === "instructor";
  const selectedClassClosed = selectedClass?.closedAt != null;

  const openCreate = () => {
    setForm(
      blankForm(
        forcedSubject ??
          selectedClass?.subject ??
          context.mySubjects[0] ??
          context.subjects[0] ??
          "",
        topicFilter === "General" ? "" : topicFilter,
      ),
    );
    setFormOpen(true);
  };

  const doSave = async () => {
    const subject = form.subject.trim();
    if (!subject) {
      toast.error("Subject is required");
      return;
    }
    if (!form.questionText.trim()) {
      toast.error("Question text is required");
      return;
    }
    if (!form.correctAnswer.trim()) {
      toast.error("Correct answer is required");
      return;
    }
    const options = form.options.map((o) => o.trim()).filter(Boolean);
    if (form.questionType === "multiple_choice") {
      if (options.length < 2) {
        toast.error("Multiple-choice questions need at least 2 options");
        return;
      }
      if (!options.includes(form.correctAnswer.trim())) {
        toast.error("Pick the correct answer from the options");
        return;
      }
    }
    setBusy("save");
    try {
      const common = {
        subject,
        // Empty strings are normalized to undefined server-side, which also
        // lets an edit clear a previously set topic/explanation.
        topic: form.topic.trim(),
        questionText: form.questionText.trim(),
        options:
          form.questionType === "multiple_choice" ? options : undefined,
        correctAnswer: form.correctAnswer.trim(),
        explanation: form.explanation.trim(),
        marks: Math.max(1, parseInt(form.marks || "1", 10) || 1),
        bloomLevel: form.bloomLevel,
        difficultyLevel: form.difficultyLevel,
        expectedTimeSec: Math.max(10, form.timeSec || 60),
        share: form.share ?? true,
      };
      if (form.id) {
        await updateShared({
          id: form.id as Id<"sharedQuestions">,
          fields: common,
        });
        toast.success("Shared question updated");
      } else {
        await createShared({ ...common, questionType: form.questionType, share: form.share ?? true });
        toast.success(
          form.share ? "Shared question added" : "Private question added (shared with no one)",
        );
      }
      setFormOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (q: SharedQuestion) => {
    if (!effectiveClassId) {
      toast.error("Select a class first");
      return;
    }
    setBusy(`import-${q._id}`);
    try {
      const res = await importShared({
        sharedQuestionId: q._id as Id<"sharedQuestions">,
        classId: effectiveClassId as Id<"classes">,
      });
      toast.success(
        res.alreadyImported
          ? "Already in this class question pool"
          : `Imported into ${selectedClass?.name ?? "the class"}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (q: SharedQuestion) => {
    if (
      !confirm(
        `Delete "${q.questionText.slice(0, 60)}…" from the shared bank? Classes that imported it keep their copy.`,
      )
    )
      return;
    setBusy(`del-${q._id}`);
    try {
      const res = await deleteShared({
        id: q._id as Id<"sharedQuestions">,
      });
      toast.success(
        res.detachedImports > 0
          ? `Deleted — ${res.detachedImports} class import(s) detached`
          : "Shared question deleted",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const doSetShare = async (q: SharedQuestion) => {
    if (busy) return;
    setBusy(`share-${q._id}`);
    try {
      await setShare({
        id: q._id as Id<"sharedQuestions">,
        share: !q.share,
      });
      toast.success(q.share ? "Question made private" : "Question shared with the bank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const doArchive = async (q: SharedQuestion) => {
    setBusy(`arc-${q._id}`);
    try {
      await archiveShared({
        id: q._id as Id<"sharedQuestions">,
        archived: q.status === "active",
      });
      toast.success(
        q.status === "active" ? "Question archived" : "Question restored",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const doSetSubject = async () => {
    if (!selectedClass) return;
    if (!subjectDraft.trim()) {
      toast.error("Enter a subject");
      return;
    }
    setBusy("subject");
    try {
      await setSubject({
        classId: selectedClass.id as Id<"classes">,
        subject: subjectDraft.trim(),
      });
      toast.success(`Class subject set to ${subjectDraft.trim()}`);
      setSubjectDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set subject");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[12%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="clay-sm flex size-10 items-center justify-center">
                <LibraryBig className="size-5 text-primary" />
              </span>
              <div>
                <h1 className="text-2xl font-extrabold">Shared Questions</h1>
                <p className="text-sm text-muted-foreground">
                  {isAdmin
                    ? "The platform-wide bank — add, edit, archive and manage every shared question."
                    : "Reuse questions across your classes. Imports link back to the shared original."}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Badge className="rounded-full bg-[oklch(0.9_0.05_240)] text-[10px] font-bold text-[oklch(0.4_0.06_240)]">
                <ShieldCheck className="mr-1 size-3" /> Admin access
              </Badge>
            )}
            <Button
              variant="outline"
              className="rounded-full"
              onClick={openCreate}
            >
              <Plus className="mr-1.5 size-4" /> New shared question
            </Button>
          </div>
        </header>

        {/* Class context — instructors only */}
        {canImport && (
          <section className="clay mt-6 p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-52 flex-1">
                <Label className="text-xs font-semibold">Class</Label>
                <Select
                  value={effectiveClassId ?? ""}
                  onValueChange={(v) => {
                    setClassId(v);
                    setSubjectFilter("");
                    setTopicFilter("");
                  }}
                >
                  <SelectTrigger className="clay-inset mt-1.5 rounded-full px-4">
                    <SelectValue placeholder="Select a class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.subject ? ` · ${c.subject}` : ""}
                        {c.closedAt != null ? " (closed)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-40 flex-1">
                <Label className="text-xs font-semibold">Subject scope</Label>
                <div className="clay-inset mt-1.5 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm">
                  <BookOpen className="size-4 text-primary" />
                  {forcedSubject ? (
                    <span className="font-semibold">{forcedSubject}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      All subjects you teach
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1 basis-64 text-xs text-muted-foreground">
                {selectedClass ? (
                  mineOnly ? (
                    <>
                      Showing every shared question you created, across all
                      subjects. Imports still target <strong>{selectedClass.name}</strong>.
                    </>
                  ) : forcedSubject ? (
                    <>
                      Showing only <strong>{forcedSubject}</strong> questions for
                      this class. Imported questions land directly in its question
                      pool.
                      {selectedClassClosed && (
                        <span className="ml-1 font-semibold text-destructive">
                          The class is closed — reopen it to import.
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      This class has no subject yet, so all subjects you teach
                      are shown. Set its subject to narrow the bank.
                    </>
                  )
                ) : (
                  "Create a class to import shared questions."
                )}
              </div>
            </div>

            {selectedClass && !selectedClass.subject && (
              <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
                <div className="min-w-52 flex-1">
                  <Label className="text-xs font-semibold">
                    Set this class&apos;s subject
                  </Label>
                  <Input
                    value={subjectDraft}
                    onChange={(e) => setSubjectDraft(e.target.value)}
                    placeholder="e.g. English, Physics"
                    className="clay-inset mt-1.5 rounded-full px-4"
                  />
                </div>
                <Button
                  className="rounded-full"
                  disabled={busy === "subject" || !subjectDraft.trim()}
                  onClick={() => void doSetSubject()}
                >
                  Save subject
                </Button>
              </div>
            )}
          </section>
        )}

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions, topics or authors"
              className="clay-inset rounded-full pl-9"
            />
          </div>
          {!forcedSubject && (
            <Select
              value={subjectFilter || "all"}
              onValueChange={(v) => {
                setSubjectFilter(v === "all" ? "" : v);
                setTopicFilter("");
              }}
            >
              <SelectTrigger className="w-44 rounded-full">
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjectOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={topicFilter || "all"}
            onValueChange={(v) => setTopicFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-44 rounded-full">
              <SelectValue placeholder="All topics" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All topics</SelectItem>
              {topicOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canImport && (
            <button
              type="button"
              onClick={() => {
                setMineOnly((v) => !v);
                setSubjectFilter("");
                setTopicFilter("");
              }}
              className={cn(
                "rounded-full px-3 py-2 text-xs font-bold transition-colors",
                mineOnly
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "clay-inset text-muted-foreground hover:text-foreground",
              )}
            >
              My questions
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "rounded-full px-3 py-2 text-xs font-bold transition-colors",
              showArchived
                ? "bg-primary text-primary-foreground shadow-sm"
                : "clay-inset text-muted-foreground hover:text-foreground",
            )}
          >
            Archived
          </button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {data === undefined
            ? "Loading shared questions…"
            : `${visible.length} question${visible.length === 1 ? "" : "s"}${
                forcedSubject ? ` in ${forcedSubject}` : ""
              } · organized by subject and topic`}
        </p>

        {data === undefined ? (
          <div className="clay mt-4 flex items-center justify-center p-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <div className="clay mt-4 p-10 text-center">
            <LibraryBig className="mx-auto size-7 text-primary" />
            <p className="mt-2 font-bold">No shared questions match</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? "Add the first question to the platform-wide bank."
                : "Try another subject, clear the filters, or add a new shared question."}
            </p>
            <Button className="mt-4 rounded-full" onClick={openCreate}>
              <Plus className="mr-1.5 size-4" /> New shared question
            </Button>
          </div>
        ) : (
          groups.map((group) => {
            const count = group.topics.reduce(
              (sum, [, rows]) => sum + rows.length,
              0,
            );
            return (
              <section key={group.subject} className="mt-7">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4 text-primary" />
                  <h2 className="text-base font-extrabold">{group.subject}</h2>
                  <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    {count}
                  </span>
                </div>

                {group.topics.map(([topic, rows]) => (
                  <div key={topic} className="mt-3">
                    <p className="ml-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {topic}
                    </p>
                    <div className="mt-2 grid gap-3">
                      {rows.map((q) => {
                        const imported = effectiveClassId
                          ? q.importedClassIds.includes(effectiveClassId)
                          : false;
                        const difficulty = resolveDifficulty(q);
                        return (
                          <div
                            key={q._id}
                            className={cn(
                              "clay p-5",
                              q.status === "archived" && "opacity-70",
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold">
                                  {q.questionText}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <Badge
                                    className={cn(
                                      "rounded-full",
                                      BLOOM_BADGE[q.bloomLevel] ??
                                        "bg-muted text-foreground",
                                    )}
                                  >
                                    {BLOOM_LABEL[q.bloomLevel] ?? q.bloomLevel}
                                  </Badge>
                                  <Badge
                                    className={cn(
                                      "rounded-full text-[10px] font-bold",
                                      DIFFICULTY_META[difficulty].badge,
                                    )}
                                  >
                                    {DIFFICULTY_META[difficulty].label}
                                  </Badge>
                                  <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                                    {TYPE_LABEL[q.questionType] ??
                                      q.questionType}
                                  </Badge>
                                  <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                                    {q.marks} mark{q.marks === 1 ? "" : "s"}
                                  </Badge>
                                  <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                                    <Clock className="mr-1 size-3" />{" "}
                                    {fmtSec(q.expectedTimeSec)}
                                  </Badge>
                                  {q.status === "archived" ? (
                                    <Badge className="rounded-full bg-[oklch(0.9_0.06_85)] text-[10px] font-bold text-[oklch(0.35_0.08_85)]">
                                      Archived
                                    </Badge>
                                  ) : q.share === false ? (
                                    <Badge className="rounded-full bg-[oklch(0.9_0.07_85)] text-[10px] font-bold text-[oklch(0.35_0.08_85)]">
                                      <ShieldCheck className="mr-1 size-3" /> Private
                                    </Badge>
                                  ) : (
                                    <Badge className="rounded-full bg-[oklch(0.9_0.07_145)] text-[10px] font-bold text-[oklch(0.32_0.09_145)]">
                                      <ShieldCheck className="mr-1 size-3" /> Shared
                                    </Badge>
                                  )}
                                  {q.status === "archived" && (
                                    <Badge className="rounded-full bg-[oklch(0.9_0.06_85)] text-[10px] font-bold text-[oklch(0.35_0.08_85)]">
                                      Archived
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                  Correct:{" "}
                                  <span className="font-semibold text-foreground">
                                    {q.correctAnswer}
                                  </span>
                                  {q.questionType === "multiple_choice" &&
                                    q.options && (
                                      <> · options: {q.options.join(" · ")}</>
                                    )}
                                </p>
                                {q.explanation && (
                                  <p className="mt-1 text-xs italic text-muted-foreground">
                                    {q.explanation}
                                  </p>
                                )}
                              </div>

                              <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
                                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  {q.ownerInstructorId ? (
                                    <GraduationCap className="size-3.5" />
                                  ) : (
                                    <ShieldCheck className="size-3.5" />
                                  )}
                                  {q.ownerName}
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {canImport &&
                                    (imported ? (
                                      <Badge className="rounded-full bg-[oklch(0.9_0.07_145)] px-3 py-1.5 text-[oklch(0.32_0.09_145)]">
                                        <Check className="mr-1 size-3" /> In
                                        class pool
                                      </Badge>
                                    ) : q.share === false ? (
                                      <Badge className="rounded-full bg-[oklch(0.9_0.07_85)] px-3 py-1.5 text-[oklch(0.35_0.08_85)]">
                                        <ShieldCheck className="mr-1 size-3" /> Private
                                      </Badge>
                                    ) : (
                                      <Button
                                        size="sm"
                                        className="clay-press rounded-full"
                                        disabled={
                                          !effectiveClassId ||
                                          selectedClassClosed ||
                                          busy === `import-${q._id}`
                                        }
                                        title={
                                          selectedClassClosed
                                            ? "Reopen the class to import"
                                            : undefined
                                        }
                                        onClick={() => void doImport(q)}
                                      >
                                        {busy === `import-${q._id}` ? (
                                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                                        ) : (
                                          <Download className="mr-1 size-3.5" />
                                        )}
                                        Import
                                      </Button>
                                    ))}                                      {q.canEdit && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="rounded-full"
                                      onClick={() => {
                                        setForm(formFrom(q));
                                        setFormOpen(true);
                                      }}
                                    >
                                      <Pencil className="size-3.5" />
                                    </Button>
                                  )}
                                  {q.canEdit && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="rounded-full"
                                      disabled={busy}
                                      title={q.share ? "Make private (visible to no one)" : "Make shared (available to instructors teaching the same subject or topic)"}
                                      onClick={() => void doSetShare(q)}
                                    >
                                      {q.share ? (
                                        <ShieldCheck className="size-3.5" />
                                      ) : (
                                        <ShieldCheck className="size-3.5" />
                                      )}
                                    </Button>
                                  )}
                                  {q.canEdit && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="rounded-full text-muted-foreground"
                                      disabled={busy === `arc-${q._id}`}
                                      title={
                                        q.status === "active"
                                          ? "Archive"
                                          : "Restore"
                                      }
                                      onClick={() => void doArchive(q)}
                                    >
                                      {q.status === "active" ? (
                                        <Archive className="size-3.5" />
                                      ) : (
                                        <RotateCcw className="size-3.5" />
                                      )}
                                    </Button>
                                  )}
                                  {q.canDelete && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="rounded-full text-destructive hover:bg-destructive/10"
                                      disabled={busy === `del-${q._id}`}
                                      onClick={() => void doDelete(q)}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            );
          })
        )}

        <div className="h-16" />
      </div>

      {/* Create / edit shared question */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="clay max-h-[88vh] overflow-y-auto border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Edit shared question" : "New shared question"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Subject</Label>
                <Input
                  value={form.subject}
                  onChange={(e) =>
                    setForm({ ...form, subject: e.target.value })
                  }
                  placeholder="e.g. English, Physics"
                  className="clay-inset rounded-full px-4"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Topic</Label>
                <Input
                  value={form.topic}
                  onChange={(e) => setForm({ ...form, topic: e.target.value })}
                  placeholder="e.g. Grammar"
                  className="clay-inset rounded-full px-4"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Question text</Label>
              <Textarea
                value={form.questionText}
                onChange={(e) =>
                  setForm({ ...form, questionText: e.target.value })
                }
                placeholder="What is…?"
                className="clay-inset min-h-20 rounded-2xl px-4 py-3"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Type</Label>
                <Select
                  value={form.questionType}
                  onValueChange={(v) => {
                    const t = v as QuestionForm["questionType"];
                    setForm({
                      ...form,
                      questionType: t,
                      correctAnswer: t === "true_false" ? "True" : "",
                    });
                  }}
                  disabled={!!form.id}
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple_choice">
                      Multiple choice
                    </SelectItem>
                    <SelectItem value="true_false">True / False</SelectItem>
                    <SelectItem value="short_answer">Short answer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Marks</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.marks}
                  onChange={(e) => setForm({ ...form, marks: e.target.value })}
                  className="clay-inset rounded-full px-4"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Bloom&apos;s level</Label>
                <Select
                  value={form.bloomLevel}
                  onValueChange={(v) =>
                    setForm({ ...form, bloomLevel: v as BloomLevel })
                  }
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(BLOOM_LABEL) as BloomLevel[]
                    ).map((b) => (
                      <SelectItem key={b} value={b}>
                        {BLOOM_LABEL[b]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">
                  Expected answer time
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={10}
                    value={form.timeSec}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        timeSec: Math.max(
                          10,
                          parseInt(e.target.value, 10) || 10,
                        ),
                      })
                    }
                    className="clay-inset rounded-full px-4"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtSec(form.timeSec)}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Difficulty level</Label>
              <div className="clay-inset grid grid-cols-4 gap-1 rounded-full p-1">
                {DIFFICULTY_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setForm({ ...form, difficultyLevel: level })}
                    className={cn(
                      "rounded-full px-2 py-1.5 text-xs font-bold transition-colors",
                      form.difficultyLevel === level
                        ? cn("shadow-sm", DIFFICULTY_META[level].badge)
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {DIFFICULTY_META[level].label}
                  </button>
                ))}
              </div>
            </div>

            {form.questionType === "multiple_choice" && (
              <div className="grid gap-2">
                <Label className="text-xs font-semibold">Options</Label>
                {form.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={(e) => {
                        const next = [...form.options];
                        next[i] = e.target.value;
                        setForm({ ...form, options: next });
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="clay-inset rounded-full px-4"
                    />
                    <button
                      type="button"
                      title="Mark as correct"
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                        form.correctAnswer &&
                          form.correctAnswer === opt.trim()
                          ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
                          : "clay-inset text-muted-foreground",
                      )}
                      onClick={() =>
                        opt.trim() &&
                        setForm({ ...form, correctAnswer: opt.trim() })
                      }
                    >
                      ✓
                    </button>
                  </div>
                ))}
              </div>
            )}
            {form.questionType === "true_false" && (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Correct answer</Label>
                <Select
                  value={form.correctAnswer || "True"}
                  onValueChange={(v) => setForm({ ...form, correctAnswer: v })}
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="True">True</SelectItem>
                    <SelectItem value="False">False</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.questionType === "short_answer" && (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Correct answer</Label>
                <Input
                  value={form.correctAnswer}
                  onChange={(e) =>
                    setForm({ ...form, correctAnswer: e.target.value })
                  }
                  placeholder="Accepted answer (case-insensitive)"
                  className="clay-inset rounded-full px-4"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">
                Explanation (optional)
              </Label>
              <Input
                value={form.explanation}
                onChange={(e) =>
                  setForm({ ...form, explanation: e.target.value })
                }
                placeholder="Shown in student results"
                className="clay-inset rounded-full px-4"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy === "save"}
              onClick={() => void doSave()}
            >
              {busy === "save" && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              {form.id ? "Save changes" : "Add question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share toggle */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="clay max-h-[88vh] overflow-y-auto border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit shared question" : "New shared question"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Subject</Label>
                <Input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="e.g. English, Physics"
                  className="clay-inset rounded-full px-4"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Topic</Label>
                <Input
                  value={form.topic}
                  onChange={(e) => setForm({ ...form, topic: e.target.value })}
                  placeholder="e.g. Grammar"
                  className="clay-inset rounded-full px-4"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Question text</Label>
              <Textarea
                value={form.questionText}
                onChange={(e) => setForm({ ...form, questionText: e.target.value })}
                placeholder="What is…?"
                className="clay-inset min-h-20 rounded-2xl px-4 py-3"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Type</Label>
                <Select
                  value={form.questionType}
                  onValueChange={(v) => {
                    const t = v as QuestionForm["questionType"];
                    setForm({
                      ...form,
                      questionType: t,
                      correctAnswer: t === "true_false" ? "True" : "",
                    });
                  }}
                  disabled={!!form.id}
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple_choice">Multiple choice</SelectItem>
                    <SelectItem value="true_false">True / False</SelectItem>
                    <SelectItem value="short_answer">Short answer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Marks</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.marks}
                  onChange={(e) => setForm({ ...form, marks: e.target.value })}
                  className="clay-inset rounded-full px-4"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Bloom&apos;s level</Label>
                <Select
                  value={form.bloomLevel}
                  onValueChange={(v) => setForm({ ...form, bloomLevel: v as BloomLevel })}
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(BLOOM_LABEL) as BloomLevel[]
                    ).map((b) => (
                      <SelectItem key={b} value={b}>
                        {BLOOM_LABEL[b]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">
                  Expected answer time
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={10}
                    value={form.timeSec}
                    onChange={(e) => setForm({ ...form, timeSec: Math.max(10, parseInt(e.target.value, 10) || 10) })}
                    className="clay-inset rounded-full px-4"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtSec(form.timeSec)}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Difficulty level</Label>
              <div className="clay-inset grid grid-cols-4 gap-1 rounded-full p-1">
                {DIFFICULTY_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setForm({ ...form, difficultyLevel: level })}
                    className={cn(
                      "rounded-full px-2 py-1.5 text-xs font-bold transition-colors",
                      form.difficultyLevel === level
                        ? cn("shadow-sm", DIFFICULTY_META[level].badge)
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {DIFFICULTY_META[level].label}
                  </button>
                ))}
              </div>
            </div>

            {form.questionType === "multiple_choice" && (
              <div className="grid gap-2">
                <Label className="text-xs font-semibold">Options</Label>
                {form.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={(e) => {
                        const next = [...form.options];
                        next[i] = e.target.value;
                        setForm({ ...form, options: next });
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="clay-inset rounded-full px-4"
                    />
                    <button
                      type="button"
                      title="Mark as correct"
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                        form.correctAnswer &&
                          form.correctAnswer === opt.trim()
                          ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
                          : "clay-inset text-muted-foreground",
                      )}
                      onClick={() =>
                        opt.trim() &&
                        setForm({ ...form, correctAnswer: opt.trim() })
                      }
                    >
                      ✓
                    </button>
                  </div>
                ))}
              </div>
            )}
            {form.questionType === "true_false" && (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Correct answer</Label>
                <Select
                  value={form.correctAnswer || "True"}
                  onValueChange={(v) => setForm({ ...form, correctAnswer: v })}
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="True">True</SelectItem>
                    <SelectItem value="False">False</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.questionType === "short_answer" && (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Correct answer</Label>
                <Input
                  value={form.correctAnswer}
                  onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}
                  placeholder="Accepted answer (case-insensitive)"
                  className="clay-inset rounded-full px-4"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">
                Explanation (optional)
              </Label>
              <Input
                value={form.explanation}
                onChange={(e) => setForm({ ...form, explanation: e.target.value })}
                placeholder="Shown in student results"
                className="clay-inset rounded-full px-4"
              />
            </div>
            <div className="rounded-xl border border-dashed p-4">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={form.share !== false}
                  onChange={(e) => setForm({ ...form, share: e.target.checked })}
                  className="size-4 rounded border-input accent-primary"
                />
                <span className="text-xs">
                  {form.share === false
                    ? "Make this question private (shared with no one)"
                    : "Share this question with other instructors (same subject or topic)"}
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy === "save"}
              onClick={() => void doSave()}
            >
              {busy === "save" && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              {form.id ? "Save changes" : "Add question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isAdmin && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-20 -translate-x-1/2">
          <div className="clay-sm flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-primary" />
            Admins can view, add, edit, delete and archive every shared question
          </div>
        </div>
      )}
    </main>
  );
}

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Eye,
  FilePlus2,
  HelpCircle,
  Loader2,
  Pencil,
  Plus,
  Send,
  Timer,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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

type ClassSummary = {
  id: string;
  name: string;
  studentCount: number;
};

type Question = {
  _id: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options: string[] | undefined;
  correctAnswer: string;
  explanation: string | undefined;
  marks: number;
};

type AssessmentRow = {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "closed";
  timeLimitMin: number;
  questionCount: number;
  totalMarks: number;
  submissions: number;
  rosterSize: number;
  avgPct: number | null;
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-[oklch(0.9_0.03_240)] text-[oklch(0.4_0.04_240)]",
  published: "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]",
  closed: "bg-[oklch(0.9_0.06_25)] text-[oklch(0.35_0.08_25)]",
};

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  short_answer: "Short answer",
};

/** Instructor assessment management for one class. */
export default function InstructorAssessments() {
  const { isLoading, isAuthenticated, user, signOut } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const classId = params.classId as Id<"classes"> | undefined;

  const dashboard = useQuery(
    api.instructorPortal.getInstructorDashboard,
    isAuthenticated ? {} : "skip",
  ) as
    | { instructor: { name: string }; classes: ClassSummary[] }
    | undefined;

  const activeClassId = classId ?? dashboard?.classes[0]?.id;
  const list = useQuery(
    api.instructorAssessments.listAssessments,
    activeClassId ? { classId: activeClassId as Id<"classes"> } : "skip",
  ) as { className: string; assessments: AssessmentRow[] } | undefined;
  const questions = useQuery(
    api.instructorAssessments.listQuestions,
    activeClassId ? { classId: activeClassId as Id<"classes"> } : "skip",
  ) as Question[] | undefined;

  const createAssessment = useMutation(api.instructorAssessments.createAssessment);
  const updateAssessment = useMutation(api.instructorAssessments.updateAssessment);
  const deleteAssessment = useMutation(api.instructorAssessments.deleteAssessment);
  const setStatus = useMutation(api.instructorAssessments.setAssessmentStatus);
  const createQuestion = useMutation(api.instructorAssessments.createQuestion);
  const updateQuestion = useMutation(api.instructorAssessments.updateQuestion);
  const deleteQuestion = useMutation(api.instructorAssessments.deleteQuestion);
  const addQ = useMutation(api.instructorAssessments.addQuestionToAssessment);
  const removeQ = useMutation(api.instructorAssessments.removeQuestionFromAssessment);

  const [classPicker, setClassPicker] = useState<string>("");
  const currentClassId = (classPicker || activeClassId) ?? undefined;
  const currentClass = dashboard?.classes.find((c) => c.id === currentClassId);

  // ---- assessment dialog state ----
  const [assessOpen, setAssessOpen] = useState(false);
  const [editAssess, setEditAssess] = useState<AssessmentRow | null>(null);
  const [aTitle, setATitle] = useState("");
  const [aDesc, setADesc] = useState("");
  const [aTime, setATime] = useState("0");
  const [busy, setBusy] = useState<string | null>(null);

  // ---- question dialog state ----
  const [qOpen, setQOpen] = useState(false);
  const [editQ, setEditQ] = useState<Question | null>(null);
  const [qText, setQText] = useState("");
  const [qType, setQType] = useState<"multiple_choice" | "true_false" | "short_answer">("multiple_choice");
  const [qOptions, setQOptions] = useState<string[]>(["", "", "", ""]);
  const [qCorrect, setQCorrect] = useState("");
  const [qExplanation, setQExplanation] = useState("");
  const [qMarks, setQMarks] = useState("1");

  // ---- composition dialog state ----
  const [composeAssess, setComposeAssess] = useState<AssessmentRow | null>(null);
  const [pickQuestion, setPickQuestion] = useState("");

  // ---- results dialog state ----
  const [resultsFor, setResultsFor] = useState<AssessmentRow | null>(null);
  const results = useQuery(
    api.instructorAssessments.getAssessmentResults,
    resultsFor ? { id: resultsFor.id as Id<"instructorAssessments"> } : "skip",
  ) as
    | {
        rows: Array<{
          studentId: string;
          studentName: string;
          status: string | null;
          score: number | null;
          maxScore: number | null;
          percentage: number | null;
        }>;
        stats: {
          rosterSize: number;
          submitted: number;
          avgPct: number | null;
          highest: number | null;
          lowest: number | null;
        };
      }
    | undefined;

  if (isLoading || !isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const resetQForm = () => {
    setEditQ(null);
    setQText("");
    setQType("multiple_choice");
    setQOptions(["", "", "", ""]);
    setQCorrect("");
    setQExplanation("");
    setQMarks("1");
  };

  const doSaveAssessment = async () => {
    if (!currentClassId) {
      toast.error("Create a class first");
      return;
    }
    if (!aTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    setBusy("assess");
    try {
      const time = Math.max(0, parseInt(aTime || "0", 10) || 0);
      if (editAssess) {
        await updateAssessment({
          id: editAssess.id as Id<"instructorAssessments">,
          fields: { title: aTitle.trim(), description: aDesc || undefined, timeLimitMin: time },
        });
        toast.success("Assessment updated");
      } else {
        await createAssessment({
          classId: currentClassId as Id<"classes">,
          title: aTitle.trim(),
          description: aDesc || undefined,
          timeLimitMin: time,
        });
        toast.success("Assessment created as draft");
      }
      setAssessOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const doDeleteAssessment = async (row: AssessmentRow) => {
    if (!confirm(`Delete "${row.title}"? Submissions will be removed too.`)) return;
    setBusy(`del-${row.id}`);
    try {
      await deleteAssessment({ id: row.id as Id<"instructorAssessments"> });
      toast.success("Assessment deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const doSetStatus = async (row: AssessmentRow, status: "draft" | "published" | "closed") => {
    setBusy(`st-${row.id}`);
    try {
      await setStatus({ id: row.id as Id<"instructorAssessments">, status });
      toast.success(
        status === "published"
          ? "Published — your class can now take it"
          : status === "closed"
            ? "Assessment closed"
            : "Moved back to draft",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const doSaveQuestion = async () => {
    if (!qText.trim()) {
      toast.error("Question text is required");
      return;
    }
    if (!qCorrect.trim()) {
      toast.error("Correct answer is required");
      return;
    }
    setBusy("q");
    try {
      if (editQ) {
        await updateQuestion({
          id: editQ._id as Id<"instructorQuestions">,
          fields: {
            questionText: qText.trim(),
            correctAnswer: qCorrect.trim(),
            explanation: qExplanation || undefined,
            marks: Math.max(1, parseInt(qMarks || "1", 10) || 1),
            ...(qType === "multiple_choice" ? { options: qOptions.map((o) => o.trim()).filter(Boolean) } : {}),
          },
        });
        toast.success("Question updated");
      } else {
        if (!currentClassId) {
          toast.error("Create a class first");
          return;
        }
        await createQuestion({
          classId: currentClassId as Id<"classes">,
          questionText: qText.trim(),
          questionType: qType,
          options: qType === "multiple_choice" ? qOptions.map((o) => o.trim()).filter(Boolean) : undefined,
          correctAnswer: qCorrect.trim(),
          explanation: qExplanation || undefined,
          marks: Math.max(1, parseInt(qMarks || "1", 10) || 1),
        });
        toast.success("Question added to the bank");
      }
      setQOpen(false);
      resetQForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const doDeleteQuestion = async (q: Question) => {
    if (!confirm("Delete this question? It will be detached from assessments.")) return;
    setBusy(`qdel-${q._id}`);
    try {
      await deleteQuestion({ id: q._id as Id<"instructorQuestions"> });
      toast.success("Question deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const openCompose = (row: AssessmentRow) => {
    setComposeAssess(row);
    setPickQuestion("");
  };

  const doAddQuestion = async () => {
    if (!composeAssess || !pickQuestion) return;
    setBusy("compose");
    try {
      await addQ({
        assessmentId: composeAssess.id as Id<"instructorAssessments">,
        questionId: pickQuestion as Id<"instructorQuestions">,
      });
      toast.success("Question added");
      setPickQuestion("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(null);
    }
  };

  const doRemoveQuestion = async (questionId: string) => {
    if (!composeAssess) return;
    setBusy("compose");
    try {
      await removeQ({
        assessmentId: composeAssess.id as Id<"instructorAssessments">,
        questionId: questionId as Id<"instructorQuestions">,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  };

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const notFound = !isLoading && dashboard !== undefined && dashboard.classes.length === 0;

  if (notFound) {
    return (
      <main className="relative min-h-screen overflow-hidden">
        <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
        <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center px-6">
          <div className="clay w-full p-8 text-center">
            <BookOpen className="mx-auto size-8 text-primary" />
            <h1 className="mt-3 text-lg font-extrabold">No classes yet</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a class in the portal first — assessments live inside classes.
            </p>
            <Link to="/instructor" className="mt-5 inline-block">
              <Button className="rounded-full">← Back to portal</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="clay-press rounded-full"
            onClick={() => navigate("/instructor")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="clay-sm flex size-10 items-center justify-center">
            <ClipboardList className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Assessment management</p>
            <p className="text-xs text-muted-foreground">
              {dashboard?.instructor.name ?? "Instructor"}
            </p>
          </div>
        </div>
        <Button variant="outline" className="clay-press rounded-full" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-6">
        {/* Class selector + new assessment */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Label className="text-xs font-semibold text-muted-foreground">Class</Label>
            <Select
              value={currentClassId ?? ""}
              onValueChange={setClassPicker}
            >
              <SelectTrigger className="clay-inset w-64 rounded-full px-4">
                <SelectValue placeholder="Select a class" />
              </SelectTrigger>
              <SelectContent>
                {(dashboard?.classes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.studentCount} students)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="clay-press rounded-full"
            onClick={() => {
              setEditAssess(null);
              setATitle("");
              setADesc("");
              setATime("0");
              setAssessOpen(true);
            }}
            disabled={!currentClassId}
          >
            <FilePlus2 className="mr-1.5 size-4" /> New assessment
          </Button>
        </div>

        {/* Assessments list */}
        <h2 className="mt-8 text-lg font-extrabold">Assessments</h2>
        {list === undefined ? (
          <div className="clay mt-3 p-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : list.assessments.length === 0 ? (
          <div className="clay mt-3 p-10 text-center">
            <ClipboardList className="mx-auto size-8 text-primary" />
            <p className="mt-3 font-bold">No assessments yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one, add questions, then publish it to your class.
            </p>
          </div>
        ) : (
          <div className="mt-3 grid gap-4">
            {list.assessments.map((a) => (
              <div key={a.id} className="clay p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-base font-bold">
                      {a.title}
                      <Badge className={`rounded-full ${STATUS_STYLES[a.status] ?? ""}`}>
                        {a.status}
                      </Badge>
                      {a.timeLimitMin > 0 && (
                        <Badge className="clay-inset rounded-full text-xs text-foreground">
                          <Timer className="mr-1 size-3" /> {a.timeLimitMin} min
                        </Badge>
                      )}
                    </p>
                    {a.description && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {a.questionCount} question{a.questionCount === 1 ? "" : "s"} ·{" "}
                      {a.totalMarks} marks · {a.submissions}/{a.rosterSize} submitted
                      {a.avgPct !== null && ` · avg ${pct(a.avgPct)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.status === "draft" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => openCompose(a)}
                        >
                          <Plus className="mr-1 size-3.5" /> Questions
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => {
                            setEditAssess(a);
                            setATitle(a.title);
                            setADesc(a.description ?? "");
                            setATime(String(a.timeLimitMin));
                            setAssessOpen(true);
                          }}
                        >
                          <Pencil className="mr-1 size-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={busy === `st-${a.id}`}
                          onClick={() => void doSetStatus(a, "published")}
                        >
                          <Send className="mr-1 size-3.5" /> Publish
                        </Button>
                      </>
                    )}
                    {a.status === "published" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setResultsFor(a)}
                        >
                          <Eye className="mr-1 size-3.5" /> Results
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          disabled={busy === `st-${a.id}`}
                          onClick={() => void doSetStatus(a, "closed")}
                        >
                          Close
                        </Button>
                      </>
                    )}
                    {a.status === "closed" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setResultsFor(a)}
                        >
                          <Eye className="mr-1 size-3.5" /> Results
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          disabled={busy === `st-${a.id}`}
                          onClick={() => void doSetStatus(a, "draft")}
                        >
                          Reopen as draft
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-destructive hover:bg-destructive/10"
                      disabled={busy === `del-${a.id}`}
                      onClick={() => void doDeleteAssessment(a)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Question bank */}
        <div className="mt-10 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <HelpCircle className="size-5 text-primary" /> Question bank
          </h2>
          <Button
            variant="outline"
            className="clay-press rounded-full"
            onClick={() => {
              resetQForm();
              setQOpen(true);
            }}
            disabled={!currentClassId}
          >
            <Plus className="mr-1.5 size-4" /> New question
          </Button>
        </div>
        {questions === undefined ? (
          <div className="clay mt-3 p-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : questions.length === 0 ? (
          <div className="clay mt-3 p-8 text-center text-sm text-muted-foreground">
            No questions yet — add questions here, then attach them to draft assessments.
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {questions.map((q) => (
              <div key={q._id} className="clay flex items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {q.questionText}
                    <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                      {TYPE_LABEL[q.questionType]}
                    </Badge>
                    <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                      {q.marks} mark{q.marks === 1 ? "" : "s"}
                    </Badge>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Correct: <span className="font-semibold text-foreground">{q.correctAnswer}</span>
                    {q.options && q.questionType === "multiple_choice" && (
                      <> · options: {q.options.join(" · ")}</>
                    )}
                  </p>
                  {q.explanation && (
                    <p className="mt-1 text-xs italic text-muted-foreground">{q.explanation}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setEditQ(q);
                      setQText(q.questionText);
                      setQType(q.questionType);
                      setQOptions(
                        q.questionType === "multiple_choice"
                          ? [...(q.options ?? ["", ""]), "", "", ""].slice(0, 4)
                          : ["", "", "", ""],
                      );
                      setQCorrect(q.correctAnswer);
                      setQExplanation(q.explanation ?? "");
                      setQMarks(String(q.marks));
                      setQOpen(true);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-destructive hover:bg-destructive/10"
                    disabled={busy === `qdel-${q._id}`}
                    onClick={() => void doDeleteQuestion(q)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="h-16" />
      </section>

      {/* Create/edit assessment dialog */}
      <Dialog open={assessOpen} onOpenChange={setAssessOpen}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editAssess ? "Edit assessment" : "New assessment"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Title</Label>
              <Input
                value={aTitle}
                onChange={(e) => setATitle(e.target.value)}
                placeholder="e.g. Midterm Quiz"
                className="clay-inset rounded-full px-4"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                value={aDesc}
                onChange={(e) => setADesc(e.target.value)}
                placeholder="Optional instructions for students"
                className="clay-inset min-h-20 rounded-2xl px-4 py-3"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Time limit (minutes, 0 = untimed)</Label>
              <Input
                type="number"
                min={0}
                value={aTime}
                onChange={(e) => setATime(e.target.value)}
                className="clay-inset rounded-full px-4"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setAssessOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-full" disabled={busy === "assess"} onClick={() => void doSaveAssessment()}>
              {editAssess ? "Save changes" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/edit question dialog */}
      <Dialog open={qOpen} onOpenChange={(o) => { if (!o) { setQOpen(false); resetQForm(); } }}>
        <DialogContent className="clay border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editQ ? "Edit question" : "New question"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Question text</Label>
              <Textarea
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="What is…?"
                className="clay-inset min-h-20 rounded-2xl px-4 py-3"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Type</Label>
                <Select
                  value={qType}
                  onValueChange={(v) => {
                    const t = v as typeof qType;
                    setQType(t);
                    if (t === "true_false") setQCorrect("True");
                    else setQCorrect("");
                  }}
                  disabled={!!editQ}
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
                  value={qMarks}
                  onChange={(e) => setQMarks(e.target.value)}
                  className="clay-inset rounded-full px-4"
                />
              </div>
            </div>
            {qType === "multiple_choice" && (
              <div className="grid gap-2">
                <Label className="text-xs font-semibold">Options</Label>
                {qOptions.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={(e) => {
                        const next = [...qOptions];
                        next[i] = e.target.value;
                        setQOptions(next);
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="clay-inset rounded-full px-4"
                    />
                    <button
                      type="button"
                      title="Mark as correct"
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                        qCorrect && qCorrect === opt.trim()
                          ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
                          : "clay-inset text-muted-foreground"
                      }`}
                      onClick={() => opt.trim() !== "" && setQCorrect(opt.trim())}
                    >
                      ✓
                    </button>
                  </div>
                ))}
              </div>
            )}
            {qType === "true_false" && (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Correct answer</Label>
                <Select value={qCorrect || "True"} onValueChange={setQCorrect}>
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
            {qType === "short_answer" && (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Correct answer</Label>
                <Input
                  value={qCorrect}
                  onChange={(e) => setQCorrect(e.target.value)}
                  placeholder="Accepted answer (case-insensitive)"
                  className="clay-inset rounded-full px-4"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Explanation (optional)</Label>
              <Input
                value={qExplanation}
                onChange={(e) => setQExplanation(e.target.value)}
                placeholder="Shown in student results"
                className="clay-inset rounded-full px-4"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => { setQOpen(false); resetQForm(); }}>
              Cancel
            </Button>
            <Button className="rounded-full" disabled={busy === "q"} onClick={() => void doSaveQuestion()}>
              {editQ ? "Save changes" : "Add question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compose assessment dialog */}
      <Dialog open={composeAssess !== null} onOpenChange={(o) => !o && setComposeAssess(null)}>
        <DialogContent className="clay max-h-[85vh] overflow-y-auto border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Questions in “{composeAssess?.title}”</DialogTitle>
          </DialogHeader>
          {composeAssess && (
            <AssessmentComposer
              assessmentId={composeAssess.id as Id<"instructorAssessments">}
              questions={(questions ?? []).filter((q) => q._id)}
              pickQuestion={pickQuestion}
              setPickQuestion={setPickQuestion}
              onAdd={() => void doAddQuestion()}
              onRemove={(qid) => void doRemoveQuestion(qid)}
              busy={busy === "compose"}
            />
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setComposeAssess(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Results dialog */}
      <Dialog open={resultsFor !== null} onOpenChange={(o) => !o && setResultsFor(null)}>
        <DialogContent className="clay max-h-[85vh] overflow-y-auto border-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Results — {resultsFor?.title}</DialogTitle>
          </DialogHeader>
          {results === undefined ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="clay-inset rounded-2xl p-3">
                  <p className="text-lg font-extrabold tabular-nums">{results.stats.rosterSize}</p>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Roster</p>
                </div>
                <div className="clay-inset rounded-2xl p-3">
                  <p className="text-lg font-extrabold tabular-nums">{results.stats.submitted}</p>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Submitted</p>
                </div>
                <div className="clay-inset rounded-2xl p-3">
                  <p className="text-lg font-extrabold tabular-nums">{pct(results.stats.avgPct)}</p>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Average</p>
                </div>
                <div className="clay-inset rounded-2xl p-3">
                  <p className="text-lg font-extrabold tabular-nums">
                    {results.stats.highest === null ? "—" : `${Math.round(results.stats.highest)}%`}
                  </p>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Highest</p>
                </div>
              </div>
              <div className="mt-4 space-y-1.5">
                {results.rows.map((r) => (
                  <div
                    key={r.studentId}
                    className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm hover:bg-[var(--accent)]/50"
                  >
                    <div>
                      <p className="font-medium">{r.studentName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.status === null
                          ? "Not started"
                          : r.status === "in_progress"
                            ? "In progress…"
                            : "Submitted"}
                      </p>
                    </div>
                    <span
                      className={`font-bold tabular-nums ${
                        r.percentage === null
                          ? "text-muted-foreground"
                          : r.percentage >= 50
                            ? "text-[oklch(0.45_0.12_145)]"
                            : "text-destructive"
                      }`}
                    >
                      {r.score !== null && r.maxScore !== null
                        ? `${r.score}/${r.maxScore}`
                        : "—"}
                      {r.percentage !== null && ` (${Math.round(r.percentage)}%)`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** Inline composer: current questions + picker from the class bank. */
function AssessmentComposer({
  assessmentId,
  questions,
  pickQuestion,
  setPickQuestion,
  onAdd,
  onRemove,
  busy,
}: {
  assessmentId: Id<"instructorAssessments">;
  questions: Question[];
  pickQuestion: string;
  setPickQuestion: (v: string) => void;
  onAdd: () => void;
  onRemove: (questionId: string) => void;
  busy: boolean;
}) {
  const assessment = useQuery(
    api.instructorAssessments.getAssessment,
    assessmentId ? { id: assessmentId } : "skip",
  ) as { assessment: { status: string }; questions: Question[] } | undefined;

  const attachedIds = new Set((assessment?.questions ?? []).map((q) => q._id));
  const available = questions.filter((q) => !attachedIds.has(q._id));

  return (
    <div className="grid gap-3">
      {assessment === undefined ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="space-y-1.5">
            {assessment.questions.length === 0 ? (
              <p className="clay-inset rounded-2xl p-4 text-center text-xs text-muted-foreground">
                No questions attached yet.
              </p>
            ) : (
              assessment.questions.map((q, i) => (
                <div
                  key={q._id}
                  className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm hover:bg-[var(--accent)]/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {i + 1}. {q.questionText}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {TYPE_LABEL[q.questionType]} · {q.marks} mark{q.marks === 1 ? "" : "s"} ·
                      correct: {q.correctAnswer}
                    </p>
                  </div>
                  <button
                    className="rounded-full p-1.5 text-destructive hover:bg-destructive/10"
                    onClick={() => onRemove(q._id)}
                    title="Remove"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs font-semibold">Add from question bank</Label>
              <Select value={pickQuestion} onValueChange={setPickQuestion}>
                <SelectTrigger className="clay-inset mt-1.5 rounded-full px-4">
                  <SelectValue placeholder="Choose a question…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((q) => (
                    <SelectItem key={q._id} value={q._id}>
                      {q.questionText.slice(0, 60)}
                      {q.questionText.length > 60 ? "…" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="rounded-full"
              disabled={!pickQuestion || busy}
              onClick={onAdd}
            >
              <Plus className="mr-1 size-4" /> Add
            </Button>
          </div>
          {available.length === 0 && (
            <p className="text-xs text-muted-foreground">
              All bank questions are attached. Create more in the question bank below.
            </p>
          )}
        </>
      )}
    </div>
  );
}

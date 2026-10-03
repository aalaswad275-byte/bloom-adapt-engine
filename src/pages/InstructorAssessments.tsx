import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  Clock,
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
import { BLOOM_LABEL } from "@/lib/irt";
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
import { Progress } from "@/components/ui/progress";
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
  bloomLevel: BloomKey;
  expectedTimeSec: number;
  source: "manual" | "ai" | undefined;
};

type AssessmentRow = {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "closed";
  timeLimitMin: number;
  poolSize: number | null;
  displayCount: number | null;
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

type ViolationLogEntry = {
  type: string;
  at: number;
  confidence: number;
  durationMs: number | null;
};

const VIOLATION_LABEL: Record<string, string> = {
  TAB_SWITCH: "Tab switch",
  WINDOW_BLUR: "Window blurred",
  BROWSER_MINIMIZED: "Browser minimized",
  LEFT_EXAM_PAGE: "Left the page",
  NO_PERSON: "No one visible",
  FACE_NOT_VISIBLE: "Face not visible",
  MULTIPLE_PERSONS: "Multiple people",
  IDENTITY_NOT_VERIFIED: "Face mismatch",
  PHONE_DETECTED: "Phone visible",
  PHONE_IN_USE: "Phone in use",
  LOOKING_AWAY: "Looking away",
  CAMERA_DISABLED: "Camera disabled",
  CAMERA_ERROR: "Camera error",
};

const ACTION_LABEL: Record<string, string> = {
  WARNING: "Flagged by policy",
  PAUSE_EXAM: "Pause-level policy",
  TERMINATE_EXAM: "Terminate-level policy",
};

/** Humanize a millisecond duration, e.g. 12m / 45s. */
function fmtMs(ms: number): string {
  if (ms >= 60_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${Math.round(ms / 1000)}s`;
}

type AiDraft = {
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  marks: number;
  expectedTimeSec: number;
  difficultyB: number;
};

const BLOOM_ORDER = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;
type BloomKey = (typeof BLOOM_ORDER)[number];

function fmtSec(s: number): string {
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

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
  const generate = useAction(api.aiGenerate.generateQuestions);

  const [classPicker, setClassPicker] = useState<string>("");
  const currentClassId = (classPicker || activeClassId) ?? undefined;
  const currentClass = dashboard?.classes.find((c) => c.id === currentClassId);

  // ---- assessment dialog state ----
  const [assessOpen, setAssessOpen] = useState(false);
  const [editAssess, setEditAssess] = useState<AssessmentRow | null>(null);
  const [aTitle, setATitle] = useState("");
  const [aDesc, setADesc] = useState("");
  const [aTime, setATime] = useState("0");
  const [aPool, setAPool] = useState("30");
  const [aDisplay, setADisplay] = useState("20");
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
  const [qBloom, setQBloom] = useState("understand");
  const [qTimeSec, setQTimeSec] = useState(60);
  const [qTopic, setQTopic] = useState("");

  // ---- composition dialog state ----
  const [composeAssess, setComposeAssess] = useState<AssessmentRow | null>(null);
  const [pickQuestion, setPickQuestion] = useState("");

  // ---- AI generation dialog state ----
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiCount, setAiCount] = useState("5");
  const [aiBloom, setAiBloom] = useState("understand");
  const [aiType, setAiType] = useState("multiple_choice");
  const [aiDifficulty, setAiDifficulty] = useState("medium");
  const [aiMarks, setAiMarks] = useState("1");
  const [aiTimeSec, setAiTimeSec] = useState("60");
  const [aiDrafts, setAiDrafts] = useState<AiDraft[] | null>(null);
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set());
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);

  // ---- results dialog state ----
  const [resultsFor, setResultsFor] = useState<AssessmentRow | null>(null);
  const [reviewOpenFor, setReviewOpenFor] = useState<string | null>(null);
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
          violationCount: number;
          terminatedByPolicy: boolean;
          policyAction: string | null;
          riskScore: number | null;
          violationLog: ViolationLogEntry[];
        }>;
        stats: {
          rosterSize: number;
          submitted: number;
          avgPct: number | null;
          highest: number | null;
          lowest: number | null;
        };
        bloomPerformance: Array<{
          bloom: string;
          students: number;
          pct: number | null;
        }>;
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
    setQBloom("understand");
    setQTimeSec(60);
    setQTopic("");
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
    const poolSize = Math.max(18, parseInt(aPool || "18", 10) || 18);
    const displayCount = Math.max(1, parseInt(aDisplay || "20", 10) || 20);
    if (displayCount > poolSize) {
      toast.error(
        `Displayed questions (${displayCount}) cannot exceed the pool (${poolSize}).`,
      );
      return;
    }
    setBusy("assess");
    try {
      const time = Math.max(0, parseInt(aTime || "0", 10) || 0);
      if (editAssess) {
        await updateAssessment({
          id: editAssess.id as Id<"instructorAssessments">,
          fields: {
            title: aTitle.trim(),
            description: aDesc || undefined,
            timeLimitMin: time,
            poolSize,
            displayCount,
          },
        });
        toast.success("Assessment updated");
      } else {
        await createAssessment({
          classId: currentClassId as Id<"classes">,
          title: aTitle.trim(),
          description: aDesc || undefined,
          timeLimitMin: time,
          poolSize,
          displayCount,
        });
        toast.success(
          `Assessment created — pool ${poolSize}, ${displayCount} displayed (draft)`,
        );
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
            bloomLevel: qBloom as BloomKey,
            expectedTimeSec: qTimeSec,
            topic: qTopic || undefined,
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
          bloomLevel: qBloom as BloomKey,
          expectedTimeSec: qTimeSec,
          topic: qTopic || undefined,
          source: "manual",
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

  // ---- AI generation ----
  const doGenerate = async () => {
    if (!currentClassId) {
      toast.error("Select a class first");
      return;
    }
    if (!aiTopic.trim()) {
      toast.error("Enter a topic to generate from");
      return;
    }
    setAiGenerating(true);
    setAiDrafts(null);
    try {
      const res = await generate({
        classId: currentClassId as Id<"classes">,
        topic: aiTopic.trim(),
        count: Math.max(1, Math.min(10, parseInt(aiCount || "5", 10) || 5)),
        bloomLevel: aiBloom as BloomKey,
        questionType: aiType as "multiple_choice" | "true_false" | "short_answer" | "mixed",
        difficulty: aiDifficulty as "easy" | "medium" | "hard",
        marks: Math.max(1, parseInt(aiMarks || "1", 10) || 1),
        expectedTimeSec: Math.max(10, parseInt(aiTimeSec || "60", 10) || 60),
      });
      setAiDrafts(res.drafts);
      setAiSelected(new Set(res.drafts.map((_, i) => i)));
      toast.success(`${res.drafts.length} questions generated — review and edit below`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const doSaveDrafts = async () => {
    if (!currentClassId || !aiDrafts) return;
    const chosen = aiDrafts.filter((_, i) => aiSelected.has(i));
    if (chosen.length === 0) {
      toast.error("Select at least one question to add");
      return;
    }
    setAiSaving(true);
    try {
      for (const d of chosen) {
        await createQuestion({
          classId: currentClassId as Id<"classes">,
          questionText: d.questionText,
          questionType: d.questionType,
          options: d.questionType === "multiple_choice" ? (d.options ?? undefined) : undefined,
          correctAnswer: d.correctAnswer,
          explanation: d.explanation || undefined,
          marks: d.marks,
          bloomLevel: aiBloom as BloomKey,
          expectedTimeSec: d.expectedTimeSec,
          difficultyB: d.difficultyB,
          topic: aiTopic.trim(),
          source: "ai",
        });
      }
      toast.success(`${chosen.length} question${chosen.length === 1 ? "" : "s"} added to the bank`);
      setAiOpen(false);
      setAiDrafts(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setAiSaving(false);
    }
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
  const poolPreview = Math.max(18, parseInt(aPool || "18", 10) || 18);
  const displayPreview = Math.max(1, parseInt(aDisplay || "20", 10) || 20);
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
              setAPool("30");
              setADisplay("20");
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
                      {a.displayCount !== null && a.poolSize !== null && (
                        <Badge className="rounded-full bg-[oklch(0.92_0.05_260)] text-[10px] font-bold text-[oklch(0.42_0.1_260)]">
                          <Sparkles className="mr-1 size-3" /> Adaptive: {a.displayCount}
                          of {a.poolSize} pool
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
                    {a.displayCount !== null && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {a.displayCount} question{a.displayCount === 1 ? "" : "s"} will be
                        displayed per student — selected by the adaptive model from the
                        {a.questionCount}-question pool.
                      </p>
                    )}
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
                            setAPool(String(a.poolSize ?? 30));
                            setADisplay(String(a.displayCount ?? 20));
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
                          onClick={() => {
                            setResultsFor(a);
                            setReviewOpenFor(null);
                          }}
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
                          onClick={() => {
                            setResultsFor(a);
                            setReviewOpenFor(null);
                          }}
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="clay-press rounded-full border-primary/40 text-primary"
              onClick={() => {
                setAiOpen(true);
                setAiDrafts(null);
              }}
              disabled={!currentClassId}
            >
              <Sparkles className="mr-1.5 size-4" /> Generate with AI
            </Button>
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
                    <Badge className="rounded-full bg-[oklch(0.9_0.05_320)] text-[oklch(0.4_0.09_320)]">
                      {BLOOM_LABEL[q.bloomLevel] ?? q.bloomLevel}
                    </Badge>
                    <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                      <Clock className="mr-1 size-3" /> {fmtSec(q.expectedTimeSec)}
                    </Badge>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">
                  Question pool size
                </Label>
                <Input
                  type="number"
                  min={18}
                  value={aPool}
                  onChange={(e) => setAPool(e.target.value)}
                  className="clay-inset rounded-full px-4"
                />
                <p className="text-[10px] text-muted-foreground">
                  Total prepared questions — min 18, ≥3 per Bloom level.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">
                  Questions displayed
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={aDisplay}
                  onChange={(e) => setADisplay(e.target.value)}
                  className="clay-inset rounded-full px-4"
                />
                <p className="text-[10px] text-muted-foreground">
                  What each student answers — cannot exceed the pool.
                </p>
              </div>
            </div>
            {/* Adaptive configuration summary (shown before publishing) */}
            <div className="clay-inset rounded-2xl p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" /> Assessment
                configuration
              </p>
              <div className="mt-2.5 grid gap-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Question Pool</span>
                  <span className="font-bold">{poolPreview}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Questions Displayed</span>
                  <span className="font-bold">{displayPreview}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Selection Method</span>
                  <span className="font-bold">Adaptive AI Model</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bloom's Taxonomy</span>
                  <span className="font-bold">All 6 levels</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Minimum Pool Coverage</span>
                  <span className="font-bold">3 questions per Bloom level</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Adaptive Ability Parameter</span>
                  <span className="font-bold">θ</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Difficulty Parameter</span>
                  <span className="font-bold">b</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discrimination Parameter</span>
                  <span className="font-bold">a</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time/Fluency Factor</span>
                  <span className="font-bold">T (γ = 0.50)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Validity/Mismatch Factor</span>
                  <span className="font-bold">V (δ = 0.50)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Random Selection</span>
                  <span className="font-bold text-destructive">OFF</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Adaptive Selection</span>
                  <span className="font-bold text-[oklch(0.45_0.12_145)]">ON</span>
                </div>
              </div>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Bloom's level</Label>
                <Select value={qBloom} onValueChange={setQBloom}>
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOOM_ORDER.map((b) => (
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
                    value={qTimeSec}
                    onChange={(e) => setQTimeSec(Math.max(10, parseInt(e.target.value, 10) || 10))}
                    className="clay-inset rounded-full px-4"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtSec(qTimeSec)}
                  </span>
                  {qTimeSec % 60 === 0 && qTimeSec >= 60 ? null : (
                    <button
                      type="button"
                      className="shrink-0 rounded-full clay-inset px-2 py-1 text-[10px] font-semibold"
                      onClick={() => setQTimeSec(Math.round(qTimeSec / 60) * 60 || 60)}
                    >
                      →min
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Topic (optional)</Label>
              <Input
                value={qTopic}
                onChange={(e) => setQTopic(e.target.value)}
                placeholder="e.g. Sorting algorithms — feeds AI generation context"
                className="clay-inset rounded-full px-4"
              />
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
              {results.bloomPerformance.length > 0 && (
                <div className="clay-inset mt-4 rounded-2xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Performance by Bloom's level
                  </p>
                  <div className="mt-3 space-y-2">
                    {results.bloomPerformance.map((b) => (
                      <div key={b.bloom} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
                          {BLOOM_LABEL[b.bloom as BloomKey] ?? b.bloom}
                        </span>
                        <Progress value={b.pct ?? 0} className="h-2 flex-1" />
                        <span className="w-12 text-right text-xs font-bold tabular-nums">
                          {b.pct === null ? "—" : `${Math.round(b.pct)}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 space-y-1.5">
                {results.rows.map((r) => {
                  const hasLog = r.violationLog.length > 0 || r.violationCount > 0;
                  const expanded = reviewOpenFor === r.studentId;
                  const agg = new Map<
                    string,
                    { count: number; durationMs: number }
                  >();
                  for (const e of r.violationLog) {
                    const cur = agg.get(e.type) ?? { count: 0, durationMs: 0 };
                    cur.count += 1;
                    cur.durationMs += e.durationMs ?? 0;
                    agg.set(e.type, cur);
                  }
                  return (
                    <div key={r.studentId}>
                      <div
                        className={`flex items-center justify-between rounded-2xl px-3 py-2 text-sm hover:bg-[var(--accent)]/50 ${
                          hasLog ? "cursor-pointer" : ""
                        }`}
                        onClick={() =>
                          hasLog && setReviewOpenFor(expanded ? null : r.studentId)
                        }
                      >
                        <div className="flex items-center gap-1.5">
                          {hasLog && (
                            <ChevronDown
                              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                                expanded ? "rotate-180" : ""
                              }`}
                            />
                          )}
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
                        </div>
                        <div className="flex items-center gap-2">
                          {r.violationCount > 0 && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                r.terminatedByPolicy
                                  ? "bg-destructive text-white"
                                  : "bg-amber-500/15 text-amber-600"
                              }`}
                              title="Proctoring violations — click to review"
                            >
                              ⚠ {r.violationCount}
                            </span>
                          )}
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
                      </div>
                      {hasLog && expanded && (
                        <div className="clay-inset mb-1.5 rounded-2xl p-4 text-xs">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                              Proctoring review
                            </p>
                            <span className="font-bold text-amber-600">
                              Risk{" "}
                              {r.riskScore === null
                                ? "—"
                                : `${Math.round(r.riskScore * 100)}%`}
                            </span>
                          </div>
                          <ul className="mt-2 space-y-1">
                            {agg.size === 0 ? (
                              <li className="text-muted-foreground">
                                No detailed log recorded.
                              </li>
                            ) : (
                              [...agg.entries()].map(([type, v]) => (
                                <li
                                  key={type}
                                  className="flex items-center justify-between"
                                >
                                  <span className="font-medium">
                                    {v.count}× {VIOLATION_LABEL[type] ?? type}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {v.durationMs > 0 ? fmtMs(v.durationMs) : ""}
                                  </span>
                                </li>
                              ))
                            )}
                          </ul>
                          {r.policyAction !== null && r.policyAction !== "NONE" && (
                            <p className="mt-2">
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                {ACTION_LABEL[r.policyAction] ?? r.policyAction}
                              </span>
                            </p>
                          )}
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Recorded silently — the student was not shown warnings
                            during the assessment.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* AI generation dialog */}
      <Dialog open={aiOpen} onOpenChange={(o) => { if (!o) { setAiOpen(false); setAiDrafts(null); } }}>
        <DialogContent className="clay max-h-[85vh] overflow-y-auto border-0 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" /> Generate questions with AI
            </DialogTitle>
          </DialogHeader>
          {aiDrafts === null ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Class / course topic</Label>
                <Input
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  placeholder="e.g. Quicksort and divide-and-conquer sorting"
                  className="clay-inset rounded-full px-4"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Number of questions</Label>
                  <Select value={aiCount} onValueChange={setAiCount}>
                    <SelectTrigger className="clay-inset rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[3, 5, 8, 10].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n} questions</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Bloom's level</Label>
                  <Select value={aiBloom} onValueChange={setAiBloom}>
                    <SelectTrigger className="clay-inset rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BLOOM_ORDER.map((b) => (
                        <SelectItem key={b} value={b}>{BLOOM_LABEL[b]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Question type</Label>
                  <Select value={aiType} onValueChange={setAiType}>
                    <SelectTrigger className="clay-inset rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiple_choice">Multiple choice</SelectItem>
                      <SelectItem value="true_false">True / False</SelectItem>
                      <SelectItem value="short_answer">Short answer</SelectItem>
                      <SelectItem value="mixed">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Difficulty</Label>
                  <Select value={aiDifficulty} onValueChange={setAiDifficulty}>
                    <SelectTrigger className="clay-inset rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Marks per question</Label>
                  <Input type="number" min={1} value={aiMarks} onChange={(e) => setAiMarks(e.target.value)} className="clay-inset rounded-full px-4" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Expected answer time</Label>
                  <div className="flex gap-2">
                    <Input type="number" min={10} value={aiTimeSec} onChange={(e) => setAiTimeSec(e.target.value)} className="clay-inset rounded-full px-4" />
                    <span className="flex items-center text-xs text-muted-foreground">{fmtSec(parseInt(aiTimeSec || "60", 10) || 60)}</span>
                  </div>
                </div>
              </div>
              <Button className="clay-press rounded-full" disabled={aiGenerating} onClick={() => void doGenerate()}>
                {aiGenerating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                {aiGenerating ? "Generating…" : "Generate questions"}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Uses OpenAI gpt-4o-mini. Drafts are not saved until you review and add them.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">Review drafts ({aiSelected.size}/{aiDrafts.length} selected)</p>
                <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setAiDrafts(null)}>
                  ← Regenerate
                </Button>
              </div>
              <div className="grid max-h-96 gap-3 overflow-y-auto pr-1">
                {aiDrafts.map((d, i) => (
                  <div key={i} className={`clay-inset rounded-2xl p-4 ${!aiSelected.has(i) ? "opacity-50" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold">{i + 1}. {d.questionText}</p>
                      <button
                        className="shrink-0"
                        onClick={() => {
                          const next = new Set(aiSelected);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          setAiSelected(next);
                        }}
                      >
                        {aiSelected.has(i) ? <CheckCircle2 className="size-5 text-[oklch(0.55_0.15_145)]" /> : <Circle className="size-5 text-muted-foreground" />}
                      </button>
                    </div>
                    {d.options && (
                      <p className="mt-1 text-xs text-muted-foreground">Options: {d.options.join(" · ")}</p>
                    )}
                    <p className="mt-1 text-xs">
                      Correct: <span className="font-semibold">{d.correctAnswer}</span> · {TYPE_LABEL[d.questionType]} · {d.marks} mark{d.marks === 1 ? "" : "s"} · {fmtSec(d.expectedTimeSec)}
                    </p>
                    {d.explanation && <p className="mt-1 text-xs italic text-muted-foreground">{d.explanation}</p>}
                    <div className="mt-2 grid gap-1.5">
                      <Input
                        value={d.questionText}
                        onChange={(e) => {
                          const next = [...aiDrafts];
                          next[i] = { ...d, questionText: e.target.value };
                          setAiDrafts(next);
                        }}
                        className="clay rounded-full px-4 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Input
                          value={d.correctAnswer}
                          onChange={(e) => {
                            const next = [...aiDrafts];
                            next[i] = { ...d, correctAnswer: e.target.value };
                            setAiDrafts(next);
                          }}
                          placeholder="Correct answer"
                          className="clay min-w-40 flex-1 rounded-full px-4 text-sm"
                        />
                        <Input
                          type="number"
                          min={1}
                          value={d.marks}
                          onChange={(e) => {
                            const next = [...aiDrafts];
                            next[i] = { ...d, marks: Math.max(1, parseInt(e.target.value, 10) || 1) };
                            setAiDrafts(next);
                          }}
                          className="clay w-20 rounded-full px-3 text-sm"
                          title="Marks"
                        />
                        <Input
                          type="number"
                          min={10}
                          value={d.expectedTimeSec}
                          onChange={(e) => {
                            const next = [...aiDrafts];
                            next[i] = { ...d, expectedTimeSec: Math.max(10, parseInt(e.target.value, 10) || 60) };
                            setAiDrafts(next);
                          }}
                          className="clay w-24 rounded-full px-3 text-sm"
                          title="Expected seconds"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button className="clay-press rounded-full" disabled={aiSaving || aiSelected.size === 0} onClick={() => void doSaveDrafts()}>
                {aiSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                Add {aiSelected.size} question{aiSelected.size === 1 ? "" : "s"} to bank
              </Button>
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

  // Bloom coverage of the pool (≥3 per level required to publish).
  const coverage = new Map<string, number>();
  for (const q of assessment?.questions ?? []) {
    coverage.set(q.bloomLevel, (coverage.get(q.bloomLevel) ?? 0) + 1);
  }
  const total = assessment?.questions.length ?? 0;

  return (
    <div className="grid gap-3">
      <div className="clay-inset rounded-2xl p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Pool coverage (min 3 per Bloom level, min 18 total)
          </p>
          <span
            className={`text-xs font-bold ${
              total >= 18 ? "text-[oklch(0.45_0.12_145)]" : "text-amber-600"
            }`}
          >
            {total} in pool
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {BLOOM_ORDER.map((b) => {
            const n = coverage.get(b) ?? 0;
            const okLevel = n >= 3;
            return (
              <div
                key={b}
                className={`flex items-center justify-between rounded-xl px-2.5 py-1.5 text-[11px] font-semibold ${
                  okLevel
                    ? "bg-[oklch(0.72_0.14_145)]/10 text-[oklch(0.45_0.12_145)]"
                    : "bg-amber-500/10 text-amber-600"
                }`}
              >
                <span className="truncate">{BLOOM_LABEL[b]}</span>
                <span
                  className={cn(!okLevel && "animate-pulse", "tabular-nums")}
                >
                  {n}/3
                </span>
              </div>
            );
          })}
        </div>
      </div>
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

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  Clock,
  Copy,
  Eye,
  FilePlus2,
  Flag,
  HelpCircle,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Share2,
  Timer,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BLOOM_LABEL, DEFAULT_BLOOM_LABELS, resolveBloomLabels } from "@/lib/irt";
import {
  DIFFICULTY_LEVELS,
  DIFFICULTY_META,
  resolveDifficulty,
} from "@/lib/difficulty";
import type { DifficultyLevel } from "@/lib/difficulty";
import { FAIR_ADAPTIVE_BLURB, FAIR_ADAPTIVE_LABEL } from "@/lib/assessmentType";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Type,
} from "lucide-react";
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
import {
  DragDropQuestionEditor,
  type DragDropEditorTarget,
} from "@/components/DragDropQuestionEditor";
import { OrderingQuestionEditor } from "@/components/OrderingQuestionEditor";
import { useAuth } from "@/hooks/use-auth";

type ClassSummary = {
  id: string;
  name: string;
  studentCount: number;
  subject: string | null;
  categoryId: string | null;
};

type TaxonomyType = {
  key: string;
  label: string;
  answerFormat:
    | "multiple_choice"
    | "true_false"
    | "text"
    | "drag_drop"
    | "ordering";
};

type TaxonomyCategory = {
  id: string;
  name: string;
  topics: Array<{ id: string; name: string }>;
};

type Question = {
  _id: string;
  questionText: string;
  questionType:
    | "multiple_choice"
    | "true_false"
    | "short_answer"
    | "drag_drop"
    | "ordering";
  options: string[] | undefined;
  correctAnswer: string;
  dragDropTargets?: Array<{ id: string; label: string; hint?: string }>;
  dragDropCorrect?: Array<{ targetId: string; item: string }>;
  orderingCorrect?: string[];
  partialCredit?: boolean;
  explanation: string | undefined;
  marks: number;
  bloomLevel: BloomKey;
  /** Authored difficulty band; absent on legacy rows (derive from b). */
  difficultyLevel?: DifficultyLevel;
  difficultyB?: number;
  expectedTimeSec: number;
  source: "manual" | "ai" | "shared" | undefined;
  topic?: string;
  categoryId?: string;
  topicId?: string;
  typeKey?: string;
  /** Set when this class-bank row is published to (or imported from) the
   *  shared question bank. */
  sharedQuestionId?: string;
};

/** Share state of one class-bank question, as returned by the backend. */
type BankShareState = {
  questionId: string;
  sharedQuestionId: string | null;
  share: boolean;
  canToggle: boolean;
  ownerName: string | null;
};

type AssessmentType = "static" | "adaptive";
type AssessmentMode = "adaptive" | "static" | "random" | "final";
/** Workspace tab: the AI model, fixed papers, or the Fair Adaptive final. */
type AssessmentPanel = AssessmentType | "final";

type ClassInfo = {
  id: string;
  name: string;
  subject: string | null;
  categoryId: string | null;
  academicYear: string;
  createdAt: number;
  closedAt: number | null;
  studentCount: number;
  instructorName: string;
  instructorEmail: string | null;
};

type AssessmentRow = {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "closed" | "archived";
  timeLimitMin: number;
  poolSize: number | null;
  displayCount: number | null;
  /** Which panel owns it: fixed paper (static) or AI model (adaptive). */
  assessmentType: AssessmentType;
  /** "adaptive" ladder, "static" fixed order, or "random" draw per level. */
  selectionMode: AssessmentMode;
  /** Per-level random draw counts (null for adaptive assessments). */
  randomCounts: Record<string, number> | null;
  /** Random mode with nothing attached: the class bank is the pool. */
  poolFromBank: boolean;
  /** Number of questions in the class bank (random draws come from here). */
  bankPool: number;
  /** Resolved Bloom level display names (custom or taxonomy defaults). */
  bloomLabels: Record<string, string>;
  questionCount: number;
  /** Count of questions per Bloom level, in taxonomy order. */
  bloomDistribution: Array<{ level: string; count: number }>;
  /** Count of questions per difficulty band, Easy → Expert. */
  difficultyDistribution: Array<{ level: DifficultyLevel; count: number }>;
  totalMarks: number;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  scheduledFor: number | null;
  archivedAt: number | null;
  /** Completed (submitted/graded) attempts. */
  submissions: number;
  /** Attempts being taken right now. */
  inProgress: number;
  passCount: number;
  failCount: number;
  rosterSize: number;
  avgPct: number | null;
};

/** Lifecycle label shown on the card (draft, scheduled, active, completed…). */
function lifecycleOf(a: AssessmentRow): {
  key: "draft" | "scheduled" | "active" | "completed" | "archived";
  label: string;
} {
  if (a.status === "archived") return { key: "archived", label: "Archived" };
  if (a.status === "draft") return { key: "draft", label: "Draft" };
  if (a.status === "closed") return { key: "completed", label: "Completed" };
  if (a.scheduledFor !== null && a.scheduledFor > Date.now())
    return { key: "scheduled", label: "Scheduled" };
  return { key: "active", label: "Active" };
}

const LIFECYCLE_STYLE: Record<string, string> = {
  draft: "bg-[oklch(0.9_0.03_240)] text-[oklch(0.4_0.04_240)]",
  scheduled: "bg-[oklch(0.93_0.06_85)] text-[oklch(0.4_0.09_85)]",
  active: "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]",
  completed: "bg-[oklch(0.9_0.06_25)] text-[oklch(0.35_0.08_25)]",
  archived: "bg-muted text-muted-foreground",
};

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `datetime-local` input value (local timezone) for an epoch timestamp. */
function toLocalInput(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  short_answer: "Short answer",
};

/** Per-level colors for Bloom badges. */
const BLOOM_BADGE_CLASSES: Record<string, string> = {
  remember: "bg-[oklch(0.9_0.05_320)] text-[oklch(0.4_0.09_320)]",
  understand: "bg-[oklch(0.85_0.12_145)] text-[oklch(0.32_0.09_145)]",
  apply: "bg-[oklch(0.85_0.14_85)] text-[oklch(0.32_0.1_85)]",
  analyze: "bg-[oklch(0.88_0.12_250)] text-[oklch(0.4_0.06_250)]",
  evaluate: "bg-[oklch(0.88_0.1_30)] text-[oklch(0.4_0.07_30)]",
  create: "bg-[oklch(0.86_0.14_320)] text-[oklch(0.42_0.08_320)]",
};

/**
 * Shared/private switch on a class-bank question. Sharing publishes the
 * question to the bank for instructors teaching the same subject or topic;
 * turning it off keeps the question in this class bank but removes it from
 * the shared bank.
 */
function BankSharePill({
  state,
  busy,
  onToggle,
}: {
  state: BankShareState;
  busy: boolean;
  onToggle: () => void;
}) {
  if (!state.canToggle) {
    return (
      <Badge className="clay-inset rounded-full text-[10px] font-semibold text-muted-foreground">
        <Share2 className="mr-1 size-3" />
        {state.ownerName ? `Shared by ${state.ownerName}` : "Shared"}
      </Badge>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={state.share}
      disabled={busy}
      title={
        state.share
          ? "Shared with instructors teaching this subject or topic — click to make private"
          : "Private — click to share with instructors teaching this subject or topic"
      }
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-60",
        state.share
          ? "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]"
          : "clay-inset text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
          state.share ? "bg-[oklch(0.62_0.13_145)]" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-all",
            state.share ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      {state.share ? "Shared" : "Private"}
    </button>
  );
}

/** Difficulty band pill shared by the bank, composer and pickers. */
function DifficultyBadge({ question }: { question: Question }) {
  const level = resolveDifficulty(question);
  return (
    <Badge
      className={cn(
        "rounded-full text-[10px] font-bold",
        DIFFICULTY_META[level].badge,
      )}
    >
      {DIFFICULTY_META[level].label}
    </Badge>
  );
}

/** Per-level accent bars on question cards. */
const BLOOM_ACCENT_BG: Record<string, string> = {
  remember: "bg-[oklch(0.72_0.14_320)]",
  understand: "bg-[oklch(0.62_0.16_145)]",
  apply: "bg-[oklch(0.72_0.15_85)]",
  analyze: "bg-[oklch(0.64_0.14_250)]",
  evaluate: "bg-[oklch(0.66_0.16_30)]",
  create: "bg-[oklch(0.62_0.18_320)]",
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

/** Random mode: questions each student answers (sum of the per-level draws). */
function randomDrawTotal(counts: Record<string, number> | null | undefined) {
  return BLOOM_ORDER.reduce((sum, b) => sum + Math.max(0, counts?.[b] ?? 0), 0);
}

function fmtSec(s: number): string {
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** Remembers the last class opened in this module across navigation. */
const LAST_CLASS_KEY = "instructor-assessments:last-class";

/**
 * The class currently opened in the module.
 *
 * Priority: the class in the URL (only when the instructor owns it), then the
 * last class opened in this module, then the first class on the dashboard.
 * Every query below is keyed by this single id, so switching class re-issues
 * every request instead of reusing another class's data.
 */
function rememberedClassId(classes: ClassSummary[] | undefined): string | undefined {
  if (!classes || typeof window === "undefined") return undefined;
  try {
    const saved = window.localStorage.getItem(LAST_CLASS_KEY);
    return saved && classes.some((c) => c.id === saved) ? saved : undefined;
  } catch {
    return undefined;
  }
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

  // Strict class scoping: a URL that points at a class this instructor does
  // not own is ignored, so another class's assessments can never be queried.
  const ownedClassId = dashboard?.classes.some((c) => c.id === classId)
    ? classId
    : undefined;
  const activeClassId =
    ownedClassId ??
    rememberedClassId(dashboard?.classes) ??
    dashboard?.classes[0]?.id;
  const list = useQuery(
    api.instructorAssessments.listAssessments,
    activeClassId ? { classId: activeClassId as Id<"classes"> } : "skip",
  ) as
    | { className: string; classInfo: ClassInfo; assessments: AssessmentRow[] }
    | undefined;
  const questions = useQuery(
    api.instructorAssessments.listQuestions,
    activeClassId ? { classId: activeClassId as Id<"classes"> } : "skip",
  ) as Question[] | undefined;

  const createAssessment = useMutation(api.instructorAssessments.createAssessment);
  const updateAssessment = useMutation(api.instructorAssessments.updateAssessment);
  const deleteAssessment = useMutation(api.instructorAssessments.deleteAssessment);
  const setStatus = useMutation(api.instructorAssessments.setAssessmentStatus);
  const scheduleAssessment = useMutation(
    api.instructorAssessments.scheduleAssessment,
  );
  const archiveAssessment = useMutation(
    api.instructorAssessments.archiveAssessment,
  );
  const restoreAssessment = useMutation(
    api.instructorAssessments.restoreAssessment,
  );
  const duplicateAssessment = useMutation(
    api.instructorAssessments.duplicateAssessment,
  );
  const createQuestion = useMutation(api.instructorAssessments.createQuestion);
  const updateQuestion = useMutation(api.instructorAssessments.updateQuestion);
  const deleteQuestion = useMutation(api.instructorAssessments.deleteQuestion);
  const addQ = useMutation(api.instructorAssessments.addQuestionToAssessment);
  const autoFillQ = useMutation(
    api.instructorAssessments.autoFillAssessmentQuestions,
  );
  const removeQ = useMutation(api.instructorAssessments.removeQuestionFromAssessment);
  const generate = useAction(api.aiGenerate.generateQuestions);

  const currentClassId = activeClassId;
  const currentClass = dashboard?.classes.find((c) => c.id === currentClassId);
  /** The class actually loaded from the server for this selection. */
  const classInfo = list?.classInfo;

  // ---- shared/private state of this class's question bank ----
  const setBankShare = useMutation(api.sharedQuestions.setBankQuestionShare);
  const shareStates = useQuery(
    api.sharedQuestions.getClassShareStates,
    currentClassId ? { classId: currentClassId as Id<"classes"> } : "skip",
  ) as BankShareState[] | undefined;
  // Admin-managed classification vocabulary for the question form.
  const taxonomy = useQuery(
    api.taxonomy.getTaxonomy,
    isAuthenticated ? {} : "skip",
  ) as { categories: TaxonomyCategory[]; types: TaxonomyType[] } | undefined;
  const categoryOf = (id: string) =>
    taxonomy?.categories.find((c) => c.id === id) ?? null;
  const typeLabelOf = (q: Question) =>
    taxonomy?.types.find((t) => t.key === q.typeKey)?.label ??
    TYPE_LABEL[q.questionType];
  const shareStateOf = (questionId: string): BankShareState | null =>
    shareStates?.find((s) => s.questionId === questionId) ?? null;

  // ---- assessment dialog state ----
  const [assessOpen, setAssessOpen] = useState(false);
  const [editAssess, setEditAssess] = useState<AssessmentRow | null>(null);
  const [aTitle, setATitle] = useState("");
  const [aDesc, setADesc] = useState("");
  const [aTime, setATime] = useState("0");
  const [aPool, setAPool] = useState("30");
  const [aDisplay, setADisplay] = useState("20");
  /** Which assessment tab the instructor is working in. */
  const [panel, setPanel] = useState<AssessmentPanel>("adaptive");
  /** Workspace search + lifecycle filter. */
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "draft" | "scheduled" | "active" | "completed" | "archived"
  >("all");
  /** Schedule dialog target. */
  const [scheduleFor, setScheduleFor] = useState<AssessmentRow | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  /** How each student's questions are chosen. */
  const [aMode, setAMode] = useState<AssessmentMode>("adaptive");
  /** Random mode: questions drawn per Bloom level (raw input strings). */
  const [aRandomCounts, setARandomCounts] = useState<Record<string, string>>(
    () => Object.fromEntries(BLOOM_ORDER.map((b) => [b, "3"])),
  );
  /** Editable display names for the six Bloom levels (defaults prefilled). */
  const [aBloomNames, setABloomNames] = useState<Record<string, string>>({
    ...DEFAULT_BLOOM_LABELS,
  });
  const [busy, setBusy] = useState<string | null>(null);

  // ---- question dialog state ----
  const [qOpen, setQOpen] = useState(false);
  const [editQ, setEditQ] = useState<Question | null>(null);
  const [qText, setQText] = useState("");
  const [qType, setQType] = useState<
    "multiple_choice" | "true_false" | "short_answer" | "drag_drop" | "ordering"
  >("multiple_choice");
  const [qOptions, setQOptions] = useState<string[]>(["", "", "", ""]);
  const [qCorrect, setQCorrect] = useState("");
  const [qDragTargets, setQDragTargets] = useState<DragDropEditorTarget[]>([
    { id: "target-1", label: "Target 1" },
    { id: "target-2", label: "Target 2" },
  ]);
  const [qDragCorrect, setQDragCorrect] = useState<Record<string, string>>({});
  const [qOrderingCorrect, setQOrderingCorrect] = useState<string[]>([]);
  const [qPartialCredit, setQPartialCredit] = useState(true);
  const [qExplanation, setQExplanation] = useState("");
  const [qMarks, setQMarks] = useState("1");
  const [qBloom, setQBloom] = useState("understand");
  const [qDifficulty, setQDifficulty] = useState<DifficultyLevel>("medium");
  /** Bank filter: "all" or one of the four difficulty bands. */
  const [qDiffFilter, setQDiffFilter] = useState<"all" | DifficultyLevel>(
    "all",
  );
  const [qTimeSec, setQTimeSec] = useState(60);
  const [qTopic, setQTopic] = useState("");
  /** Classification (admin-managed taxonomy). */
  const [qCategoryId, setQCategoryId] = useState("");
  const [qTopicId, setQTopicId] = useState("");
  const [qTypeKey, setQTypeKey] = useState("multiple_choice");

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
          inProgress: number;
          notStarted: number;
          completed: number;
          passed: number;
          failed: number;
          passRate: number | null;
        };
        bloomPerformance: Array<{
          bloom: string;
          students: number;
          pct: number | null;
        }>;
      }
    | undefined;

  // Strict class scoping: switching class closes every dialog that was opened
  // for the previous one, so a stale assessment or question can never be
  // viewed or edited from the wrong class.
  useEffect(() => {
    setAssessOpen(false);
    setComposeAssess(null);
    setEditAssess(null);
    setResultsFor(null);
    setReviewOpenFor(null);
    setPickQuestion("");
    setQOpen(false);
    setEditQ(null);
    setAiOpen(false);
    setAiDrafts(null);
    setAiTopic("");
    setScheduleFor(null);
    setSearch("");
    setStatusFilter("all");
    setQDiffFilter("all");
  }, [currentClassId]);

  // Preserve the selected class across navigation (report pages, portal).
  useEffect(() => {
    if (!currentClassId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAST_CLASS_KEY, currentClassId);
    } catch {
      // Storage unavailable — selection still works for this view.
    }
  }, [currentClassId]);

  // Keep the URL on the class actually being displayed: a missing id, or an
  // id this instructor does not own, is replaced with the resolved class.
  useEffect(() => {
    if (!dashboard || !currentClassId) return;
    if (classId !== currentClassId) {
      navigate(`/instructor/assessments/${currentClassId}`, { replace: true });
    }
  }, [dashboard, classId, currentClassId, navigate]);

  /** Selecting a class rewrites the URL, the single source of truth. */
  const selectClass = (id: string) => {
    navigate(`/instructor/assessments/${id}`, { replace: true });
  };

  if (isLoading || !isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  /** Bank questions visible under the current difficulty filter. */
  const bankQuestions =
    questions === undefined
      ? undefined
      : qDiffFilter === "all"
        ? questions
        : questions.filter((q) => resolveDifficulty(q) === qDiffFilter);
  const difficultyCount = (level: DifficultyLevel) =>
    (questions ?? []).filter((q) => resolveDifficulty(q) === level).length;

  const resetQForm = () => {
    setEditQ(null);
    setQText("");
    setQType("multiple_choice");
    setQOptions(["", "", "", ""]);
    setQCorrect("");
    setQDragTargets([
      { id: "target-1", label: "Target 1" },
      { id: "target-2", label: "Target 2" },
    ]);
    setQDragCorrect({});
    setQOrderingCorrect([]);
    setQPartialCredit(true);
    setQExplanation("");
    setQMarks("1");
    setQBloom("understand");
    setQDifficulty("medium");
    setQTimeSec(60);
    setQTopic("");
    setQCategoryId(currentClass?.categoryId ?? "");
    setQTopicId("");
    setQTypeKey("multiple_choice");
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
    if (aMode === "adaptive" && displayCount > poolSize) {
      toast.error(
        `Displayed questions (${displayCount}) cannot exceed the pool (${poolSize}).`,
      );
      return;
    }
    // Random mode: the drawn total replaces the adaptive display count.
    const counts = Object.fromEntries(
      BLOOM_ORDER.map((b) => [
        b,
        Math.max(0, parseInt(aRandomCounts[b] || "0", 10) || 0),
      ]),
    ) as Record<BloomKey, number>;
    const drawTotal = BLOOM_ORDER.reduce((sum, b) => sum + counts[b], 0);
    if (aMode === "random" && drawTotal < 1) {
      toast.error("Set at least one question to be drawn at random.");
      return;
    }
    setBusy("assess");
    try {
      const time = Math.max(0, parseInt(aTime || "0", 10) || 0);
      const modeFields =
        aMode === "random"
          ? ({ selectionMode: "random", randomCounts: counts } as const)
          : aMode === "final"
            ? ({ selectionMode: "final" } as const)
            : aMode === "static"
              ? ({ selectionMode: "static" } as const)
              : ({ selectionMode: "adaptive", poolSize, displayCount } as const);
      if (editAssess) {
        await updateAssessment({
          id: editAssess.id as Id<"instructorAssessments">,
          fields: {
            title: aTitle.trim(),
            description: aDesc || undefined,
            timeLimitMin: time,
            bloomLabels: aBloomNames,
            ...modeFields,
          },
        });
        toast.success("Assessment updated");
      } else {
        await createAssessment({
          classId: currentClassId as Id<"classes">,
          title: aTitle.trim(),
          description: aDesc || undefined,
          timeLimitMin: time,
          bloomLabels: aBloomNames,
          ...modeFields,
        });
        toast.success(
          aMode === "final"
            ? `${FAIR_ADAPTIVE_LABEL} final created — attach the shared question set (draft)`
            : aMode === "static"
              ? "Static assessment created — attach the questions it should contain (draft)"
              : aMode === "random"
                ? `Static assessment created — ${drawTotal} random questions per student (draft)`
                : `Adaptive assessment created — pool ${poolSize}, ${displayCount} displayed (draft)`,
        );
      }
      setAssessOpen(false);
      // Follow the assessment to its tab when its type was switched.
      setPanel(
        aMode === "adaptive" ? "adaptive" : aMode === "final" ? "final" : "static",
      );
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

  const doDuplicate = async (row: AssessmentRow) => {
    setBusy(`dup-${row.id}`);
    try {
      await duplicateAssessment({
        id: row.id as Id<"instructorAssessments">,
      });
      toast.success("Assessment duplicated as a draft");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Duplicate failed");
    } finally {
      setBusy(null);
    }
  };

  const doArchive = async (row: AssessmentRow) => {
    if (
      !confirm(
        "Archive this assessment? Its questions and results are kept, and it leaves the active list.",
      )
    )
      return;
    setBusy(`arch-${row.id}`);
    try {
      await archiveAssessment({ id: row.id as Id<"instructorAssessments"> });
      toast.success("Assessment archived");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async (row: AssessmentRow) => {
    setBusy(`arch-${row.id}`);
    try {
      await restoreAssessment({ id: row.id as Id<"instructorAssessments"> });
      toast.success("Assessment restored as a draft");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  };

  const doSchedule = async () => {
    if (!scheduleFor) return;
    if (!scheduleAt) {
      toast.error("Pick a date and time");
      return;
    }
    const ts = new Date(scheduleAt).getTime();
    setBusy(`sch-${scheduleFor.id}`);
    try {
      await scheduleAssessment({
        id: scheduleFor.id as Id<"instructorAssessments">,
        scheduledFor: ts,
      });
      toast.success("Assessment scheduled — students can start when it opens");
      setScheduleFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Schedule failed");
    } finally {
      setBusy(null);
    }
  };

  const doClearSchedule = async (row: AssessmentRow) => {
    setBusy(`sch-${row.id}`);
    try {
      await scheduleAssessment({
        id: row.id as Id<"instructorAssessments">,
        scheduledFor: null,
      });
      toast.success("Schedule cleared — the assessment is open now");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Schedule update failed");
    } finally {
      setBusy(null);
    }
  };

  const doSaveQuestion = async () => {
    if (!qText.trim()) {
      toast.error("Question text is required");
      return;
    }
    const isDrag = qType === "drag_drop";
    const isOrdering = qType === "ordering";
    const dragItems = qOptions.map((item) => item.trim()).filter(Boolean);
    const dragTargets = qDragTargets
      .map((target) => ({ ...target, label: target.label.trim() }))
      .filter((target) => target.label);
    const dragCorrect = dragItems
      .map((item) => ({ item, targetId: qDragCorrect[item] ?? "" }))
      .filter((placement) => placement.targetId);
    const dragAnswer = dragTargets
      .map((target) => {
        const items = dragCorrect
          .filter((placement) => placement.targetId === target.id)
          .map((placement) => placement.item);
        return items.length > 0 ? `${target.label}: ${items.join(", ")}` : null;
      })
      .filter((line): line is string => line !== null)
      .join(" · ");
    const orderingCorrect = qOrderingCorrect
      .map((item) => item.trim())
      .filter((item) => dragItems.includes(item));
    const orderingAnswer = orderingCorrect
      .map((item, index) => `${index + 1}. ${item}`)
      .join(" · ");
    if (!isDrag && !isOrdering && !qCorrect.trim()) {
      toast.error("Correct answer is required");
      return;
    }
    if (isDrag) {
      if (dragItems.length < 2) {
        toast.error("Add at least 2 draggable items");
        return;
      }
      if (dragTargets.length < 2) {
        toast.error("Add at least 2 drop targets");
        return;
      }
      if (dragItems.some((item) => !qDragCorrect[item])) {
        toast.error("Assign every draggable item to a target");
        return;
      }
    }
    if (isOrdering) {
      if (dragItems.length < 2) {
        toast.error("Add at least 2 items to order");
        return;
      }
      if (
        orderingCorrect.length !== dragItems.length ||
        dragItems.some((item) => !orderingCorrect.includes(item))
      ) {
        toast.error("Set a complete correct sequence for every item");
        return;
      }
    }
    setBusy("q");
    try {
      if (editQ) {
        await updateQuestion({
          id: editQ._id as Id<"instructorQuestions">,
          fields: {
            questionText: qText.trim(),
            correctAnswer: isDrag
              ? dragAnswer
              : isOrdering
                ? orderingAnswer
                : qCorrect.trim(),
            dragDropTargets: isDrag ? dragTargets : undefined,
            dragDropCorrect: isDrag ? dragCorrect : undefined,
            orderingCorrect: isOrdering ? orderingCorrect : undefined,
            partialCredit: isDrag || isOrdering ? qPartialCredit : undefined,
            explanation: qExplanation || undefined,
            marks: Math.max(1, parseInt(qMarks || "1", 10) || 1),
            bloomLevel: qBloom as BloomKey,
            difficultyLevel: qDifficulty,
            expectedTimeSec: qTimeSec,
            topic: qTopic || undefined,
            categoryId: (qCategoryId || currentClass?.categoryId) as
              | Id<"questionCategories">
              | undefined,
            topicId: qTopicId ? (qTopicId as Id<"questionTopics">) : undefined,
            typeKey: qTypeKey,
            ...(qType === "multiple_choice" || isDrag || isOrdering
              ? { options: dragItems }
              : {}),
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
          options:
            qType === "multiple_choice" || isDrag || isOrdering
              ? dragItems
              : undefined,
          correctAnswer: isDrag
            ? dragAnswer
            : isOrdering
              ? orderingAnswer
              : qCorrect.trim(),
          dragDropTargets: isDrag ? dragTargets : undefined,
          dragDropCorrect: isDrag ? dragCorrect : undefined,
          orderingCorrect: isOrdering ? orderingCorrect : undefined,
          partialCredit: isDrag || isOrdering ? qPartialCredit : undefined,
          explanation: qExplanation || undefined,
          marks: Math.max(1, parseInt(qMarks || "1", 10) || 1),
          bloomLevel: qBloom as BloomKey,
          difficultyLevel: qDifficulty,
          expectedTimeSec: qTimeSec,
          topic: qTopic || undefined,
          categoryId: (qCategoryId || currentClass?.categoryId) as
            | Id<"questionCategories">
            | undefined,
          topicId: qTopicId ? (qTopicId as Id<"questionTopics">) : undefined,
          typeKey: qTypeKey,
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

  const doSetBankShare = async (q: Question) => {
    const state = shareStateOf(q._id);
    if (!state) return;
    setBusy(`share-${q._id}`);
    try {
      const res = await setBankShare({
        questionId: q._id as Id<"instructorQuestions">,
        share: !state.share,
      });
      toast.success(
        res.share
          ? "Question shared with instructors teaching this subject or topic"
          : "Question made private — removed from the shared bank",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update sharing");
    } finally {
      setBusy(null);
    }
  };

  const openCompose = (row: AssessmentRow) => {
    setComposeAssess(row);
    setPickQuestion("");
  };

  /** Open the create dialog preset to the selected tab. */
  const openNewAssessment = (type: AssessmentPanel) => {
    setEditAssess(null);
    setATitle("");
    setADesc("");
    setATime("0");
    setAPool("30");
    setADisplay("20");
    setAMode(type === "adaptive" ? "adaptive" : type === "final" ? "final" : "static");
    setARandomCounts(
      Object.fromEntries(BLOOM_ORDER.map((b) => [b, "3"])),
    );
    setABloomNames({ ...DEFAULT_BLOOM_LABELS });
    setAssessOpen(true);
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
        difficulty: aiDifficulty as DifficultyLevel,
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
          difficultyLevel: resolveDifficulty({ difficultyB: d.difficultyB }),
          difficultyB: d.difficultyB,
          // Only link a topic that exists in this class's taxonomy; the AI
          // topic still shaped the generated text above.
          topic:
            categoryOf(currentClass?.categoryId ?? "")?.topics.find(
              (t) => t.name.toLowerCase() === aiTopic.trim().toLowerCase(),
            )?.name ?? undefined,
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

  const doAutoFillQuestions = async () => {
    if (!composeAssess) return;
    setBusy("compose");
    try {
      const res = await autoFillQ({
        assessmentId: composeAssess.id as Id<"instructorAssessments">,
      });
      if (res.added === 0) {
        toast.message(
          res.total >= res.target
            ? "Pool already matches the target size."
            : "No matching bank questions are left to add.",
        );
      } else {
        toast.success(
          `Added ${res.added} question${res.added === 1 ? "" : "s"} — pool is now ${res.total}/${res.target}.`,
        );
      }
      const short = Object.entries(res.missing).filter(([, n]) => n > 0);
      if (short.length > 0) {
        toast.warning(
          `Still short: ${short
            .map(
              ([level, n]) =>
                `${BLOOM_LABEL[level as BloomKey] ?? level} (${n})`,
            )
            .join(", ")}.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-fill failed");
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
  /** Random mode: questions each student answers (sum of the per-level draws). */
  const randomTotalPreview = BLOOM_ORDER.reduce(
    (sum, b) => sum + Math.max(0, parseInt(aRandomCounts[b] || "0", 10) || 0),
    0,
  );
  const notFound = !isLoading && dashboard !== undefined && dashboard.classes.length === 0;
  const allRows = list?.assessments ?? [];
  const isFinal = (a: AssessmentRow) => a.selectionMode === "final";
  const countFor = (p: AssessmentPanel) =>
    allRows.filter((a) =>
      p === "final"
        ? isFinal(a)
        : p === "static"
          ? a.assessmentType === "static" && !isFinal(a)
          : a.assessmentType === "adaptive",
    ).length;
  const adaptiveCount = countFor("adaptive");
  const staticCount = countFor("static");
  const finalCount = countFor("final");
  const activeCount = allRows.filter((a) => lifecycleOf(a).key === "active").length;
  /** Every attempt recorded for this class, in progress or finished. */
  const totalAttempts = allRows.reduce(
    (sum, a) => sum + a.submissions + a.inProgress,
    0,
  );
  const term = search.trim().toLowerCase();

  /** Rows in the selected tab, narrowed by search + lifecycle filter. */
  const panelRows = allRows
    .filter((a) =>
      panel === "final"
        ? isFinal(a)
        : panel === "static"
          ? a.assessmentType === "static" && !isFinal(a)
          : a.assessmentType === "adaptive",
    )
    .filter((a) => {
      if (statusFilter !== "all" && lifecycleOf(a).key !== statusFilter)
        return false;
      if (!term) return true;
      return [a.title, a.description ?? "", String(a.totalMarks)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
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
        <div className="flex items-center gap-2">
          {currentClassId && (
            <Link to={`/instructor/reports/${currentClassId}`}>
              <Button variant="outline" className="clay-press rounded-full">
                <BarChart3 className="mr-1.5 size-4" /> Class report
              </Button>
            </Link>
          )}
          <Button variant="outline" className="clay-press rounded-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-6">
        {/* Class selector + class context */}
        <div className="clay p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Label className="text-xs font-semibold text-muted-foreground">Class</Label>
              <Select value={currentClassId ?? ""} onValueChange={selectClass}>
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
            <p className="max-w-md text-[11px] text-muted-foreground">
              Everything below belongs to this class only — assessments, questions,
              students and results from other classes are never shown.
            </p>
          </div>

          {(currentClass || classInfo) && (
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t pt-4">
              <div className="min-w-0">
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
                  {classInfo?.name ?? currentClass?.name}
                  {currentClassId && list === undefined && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Loading
                    </span>
                  )}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {[
                    classInfo?.subject ?? currentClass?.subject,
                    classInfo ? `Academic year ${classInfo.academicYear}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") ||
                    (classInfo ? "No subject set" : "Loading class details…")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {classInfo?.instructorName ?? dashboard?.instructor.name}
                  {classInfo?.instructorEmail ? ` · ${classInfo.instructorEmail}` : ""}
                  {" · "}
                  {classInfo?.studentCount ?? currentClass?.studentCount ?? "—"} enrolled
                  student
                  {(classInfo?.studentCount ?? currentClass?.studentCount ?? 0) === 1
                    ? ""
                    : "s"}
                </p>
                {classInfo && classInfo.closedAt !== null && (
                  <Badge className="mt-2 rounded-full bg-[oklch(0.9_0.06_25)] text-[10px] font-bold text-[oklch(0.35_0.08_25)]">
                    Class closed — only the final exam is open
                  </Badge>
                )}
              </div>
              <div className="grid w-full max-w-md grid-cols-3 gap-2 sm:grid-cols-6">
                {[
                  { label: "Assessments", value: list ? allRows.length : "—" },
                  { label: "Active", value: list ? activeCount : "—" },
                  {
                    label: "Completed",
                    value: list
                      ? allRows.filter((a) => lifecycleOf(a).key === "completed")
                          .length
                      : "—",
                  },
                  {
                    label: "Questions",
                    value: questions === undefined ? "—" : questions.length,
                  },
                  { label: "Attempts", value: list ? totalAttempts : "—" },
                  {
                    label: "Enrolled",
                    value: classInfo?.studentCount ?? currentClass?.studentCount ?? "—",
                  },
                ].map((s) => (
                  <div key={s.label} className="clay-inset rounded-2xl px-2 py-2 text-center">
                    <p className="text-base font-extrabold tabular-nums">{s.value}</p>
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Assessment tabs: Adaptive / Static / Fair Adaptive */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {(
            [
              {
                id: "adaptive",
                title: "Adaptive",
                blurb: "AI model — each student follows their own Bloom ladder.",
                count: adaptiveCount,
                Icon: Sparkles,
                tone: "bg-[oklch(0.92_0.05_260)] text-[oklch(0.42_0.1_260)]",
              },
              {
                id: "static",
                title: "Static",
                blurb: "Fixed papers, manually picked or drawn at random.",
                count: staticCount,
                Icon: ClipboardList,
                tone: "bg-[oklch(0.9_0.05_320)] text-[oklch(0.4_0.09_320)]",
              },
              {
                id: "final",
                title: FAIR_ADAPTIVE_LABEL,
                blurb: FAIR_ADAPTIVE_BLURB,
                count: finalCount,
                Icon: Flag,
                tone: "bg-[oklch(0.9_0.06_25)] text-[oklch(0.35_0.08_25)]",
              },
            ] as const
          ).map((p) => {
            const active = panel === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPanel(p.id)}
                className={cn(
                  "clay p-4 text-left transition-all",
                  active
                    ? "ring-2 ring-primary"
                    : "opacity-75 hover:opacity-100 hover:shadow-md",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-extrabold">
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full",
                        p.tone,
                      )}
                    >
                      <p.Icon className="size-4" />
                    </span>
                    {p.title}
                  </span>
                  <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                    {list ? p.count : "—"}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{p.blurb}</p>
              </button>
            );
          })}
        </div>

        {/* Selected tab: search, filter, create */}
        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              {panel === "adaptive"
                ? "Adaptive assessments"
                : panel === "static"
                  ? "Static assessments"
                  : `${FAIR_ADAPTIVE_LABEL} finals`}
              <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                {list ? panelRows.length : "—"}
              </Badge>
            </h2>
            <p className="text-xs text-muted-foreground">
              {panel === "adaptive"
                ? "An 18+ question pool, 3 per Bloom level, served one question at a time."
                : panel === "static"
                  ? "Pick the questions yourself or draw them at random once per Bloom level."
                  : "One shared question set, delivered in a different random order to each student."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assessments…"
                className="clay-inset h-9 w-52 rounded-full pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="clay-inset h-9 w-40 rounded-full px-4">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="clay-press rounded-full"
              onClick={() => openNewAssessment(panel)}
              disabled={!currentClassId || classInfo?.closedAt !== null}
              title={
                classInfo?.closedAt !== null
                  ? "This class is closed — reopen it to add new assessments"
                  : undefined
              }
            >
              <FilePlus2 className="mr-1.5 size-4" /> New {panel === "final" ? "final" : panel}
            </Button>
          </div>
        </div>
        {list === undefined ? (
          <div className="clay mt-3 p-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : panelRows.length === 0 ? (
          <div className="clay mt-3 p-10 text-center">
            {panel === "static" ? (
              <ClipboardList className="mx-auto size-8 text-primary" />
            ) : (
              <Sparkles className="mx-auto size-8 text-primary" />
            )}
            <p className="mt-3 font-bold">
              {panel === "adaptive"
                ? "No adaptive assessments yet"
                : panel === "static"
                  ? "No static assessments yet"
                  : `No ${FAIR_ADAPTIVE_LABEL} final yet`}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {panel === "adaptive"
                ? "Create an adaptive exam with a pool of at least 18 questions (3 per Bloom level). The model serves each student a different path."
                : panel === "static"
                  ? "Create a traditional exam, attach the questions it should contain, then publish it. Nothing here uses the adaptive model."
                  : "Close the class to generate its final, or create a final paper and attach the shared question set here."}
            </p>
          </div>
        ) : (
          <div className="mt-3 grid gap-4">
            {panelRows.map((a) => {
              const lc = lifecycleOf(a);
              const scheduled = a.scheduledFor !== null && a.scheduledFor > Date.now();
              return (
                <div key={a.id} className={cn("clay p-5", lc.key === "archived" && "opacity-80")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-base font-bold">
                        {a.title}
                        <Badge className={cn("rounded-full", LIFECYCLE_STYLE[lc.key])}>
                          {lc.label}
                        </Badge>
                        {a.selectionMode === "final" ? (
                          <Badge className="rounded-full bg-[oklch(0.9_0.06_25)] text-[10px] font-bold text-[oklch(0.35_0.08_25)]">
                            <Flag className="mr-1 size-3" /> {FAIR_ADAPTIVE_LABEL}
                          </Badge>
                        ) : a.assessmentType === "static" ? (
                          <Badge className="rounded-full bg-[oklch(0.9_0.05_320)] text-[10px] font-bold text-[oklch(0.4_0.09_320)]">
                            <ClipboardList className="mr-1 size-3" /> Static
                            {a.selectionMode === "random" && (
                              <span className="ml-1">· random {randomDrawTotal(a.randomCounts)}</span>
                            )}
                          </Badge>
                        ) : (
                          <Badge className="rounded-full bg-[oklch(0.92_0.05_260)] text-[10px] font-bold text-[oklch(0.42_0.1_260)]">
                            <Sparkles className="mr-1 size-3" /> Adaptive
                          </Badge>
                        )}
                        {scheduled && (
                          <Badge className="rounded-full bg-[oklch(0.93_0.06_85)] text-[10px] font-bold text-[oklch(0.4_0.09_85)]">
                            <CalendarClock className="mr-1 size-3" /> Opens{" "}
                            {fmtDateTime(a.scheduledFor)}
                          </Badge>
                        )}
                      </div>
                      {a.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
                      )}
                      <div className="mt-2 grid gap-x-6 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3" /> Created {fmtDate(a.createdAt)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" /> Exam{" "}
                          {a.scheduledFor ? fmtDateTime(a.scheduledFor) : "not scheduled"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Timer className="size-3" />{" "}
                          {a.timeLimitMin > 0 ? `${a.timeLimitMin} min` : "Untimed"} ·{" "}
                          {a.totalMarks}{" "}
                          {a.selectionMode === "adaptive" ? "pool marks" : "marks"}
                        </span>
                        <span>
                          {a.selectionMode === "adaptive"
                            ? `${a.questionCount} in pool${
                                a.displayCount !== null
                                  ? ` · ${a.displayCount} per student`
                                  : ""
                              }`
                            : a.selectionMode === "random"
                              ? `${randomDrawTotal(a.randomCounts)} per student · pool ${a.questionCount}`
                              : `${a.questionCount} on the paper`}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" /> {a.submissions}/{a.rosterSize} completed
                          {a.inProgress > 0 ? ` · ${a.inProgress} in progress` : ""}
                        </span>
                        <span>
                          Pass {a.passCount} · Fail {a.failCount}
                          {a.avgPct !== null ? ` · avg ${pct(a.avgPct)}` : ""}
                        </span>
                      </div>
                      {a.bloomDistribution.some((b) => b.count > 0) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            Bloom
                          </span>
                          {a.bloomDistribution
                            .filter((b) => b.count > 0)
                            .map((b) => (
                              <span
                                key={b.level}
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                  BLOOM_BADGE_CLASSES[b.level] ??
                                    "bg-[var(--accent)] text-muted-foreground",
                                )}
                              >
                                {BLOOM_LABEL[b.level as BloomKey] ?? b.level} {b.count}
                              </span>
                            ))}
                        </div>
                      )}
                      {a.difficultyDistribution.some((d) => d.count > 0) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            Difficulty
                          </span>
                          {a.difficultyDistribution
                            .filter((d) => d.count > 0)
                            .map((d) => (
                              <span
                                key={d.level}
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                  DIFFICULTY_META[d.level].badge,
                                )}
                              >
                                {DIFFICULTY_META[d.level].label} {d.count}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() =>
                          navigate(`/instructor/assessments/${currentClassId}/${a.id}`)
                        }
                      >
                        <Eye className="mr-1 size-3.5" /> Details
                      </Button>
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
                              setAMode(a.selectionMode ?? "adaptive");
                              setARandomCounts(
                                Object.fromEntries(
                                  BLOOM_ORDER.map((b) => [
                                    b,
                                    String(a.randomCounts?.[b] ?? 3),
                                  ]),
                                ),
                              );
                              setABloomNames(resolveBloomLabels(a.bloomLabels));
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
                            <Users className="mr-1 size-3.5" /> Results
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
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() => {
                              setScheduleFor(a);
                              setScheduleAt(toLocalInput(a.scheduledFor));
                            }}
                          >
                            <CalendarClock className="mr-1 size-3.5" />
                            {scheduled ? "Reschedule" : "Schedule"}
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
                            <Users className="mr-1 size-3.5" /> Results
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            disabled={busy === `st-${a.id}`}
                            onClick={() => void doSetStatus(a, "draft")}
                          >
                            <RotateCcw className="mr-1 size-3.5" /> Reopen
                          </Button>
                        </>
                      )}
                      {a.status === "archived" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          disabled={busy === `arch-${a.id}`}
                          onClick={() => void doRestore(a)}
                        >
                          <ArchiveRestore className="mr-1 size-3.5" /> Restore
                        </Button>
                      )}
                      {a.status !== "archived" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          title="Duplicate as a new draft"
                          disabled={busy === `dup-${a.id}`}
                          onClick={() => void doDuplicate(a)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      )}
                      {(a.status === "draft" || a.status === "closed") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          title="Archive — keeps questions and results"
                          disabled={busy === `arch-${a.id}`}
                          onClick={() => void doArchive(a)}
                        >
                          <Archive className="size-3.5" />
                        </Button>
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
              );
            })}
          </div>
        )}

        {/* Question bank — scoped to the selected class */}
        <div className="mt-10 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <HelpCircle className="size-5 text-primary" /> Question bank
              {questions !== undefined && (
                <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                  {questions.length}
                </Badge>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              {currentClass
                ? `Only questions in ${currentClass.name}'s bank are listed and attachable.`
                : "Select a class to see its questions."}
            </p>
          </div>
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
        {/* Class bank distribution — recalculated for the selected class. */}
        {questions !== undefined && questions.length > 0 && (
          <div className="clay-inset mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-[11px]">
            <span className="font-bold uppercase tracking-wide text-muted-foreground">
              Bloom
            </span>
            {BLOOM_ORDER.map((level) => {
              const n = questions.filter((q) => q.bloomLevel === level).length;
              if (n === 0) return null;
              return (
                <span
                  key={level}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-bold",
                    BLOOM_BADGE_CLASSES[level] ??
                      "bg-[var(--accent)] text-muted-foreground",
                  )}
                >
                  {BLOOM_LABEL[level]} {n}
                </span>
              );
            })}
            <span className="ml-2 font-bold uppercase tracking-wide text-muted-foreground">
              Difficulty
            </span>
            {DIFFICULTY_LEVELS.map((level) => {
              const n = questions.filter(
                (q) => resolveDifficulty(q) === level,
              ).length;
              if (n === 0) return null;
              return (
                <span
                  key={level}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-bold",
                    DIFFICULTY_META[level].badge,
                  )}
                >
                  {DIFFICULTY_META[level].label} {n}
                </span>
              );
            })}
          </div>
        )}
        {questions !== undefined && questions.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(["all", ...DIFFICULTY_LEVELS] as const).map((level) => {
              const active = qDiffFilter === level;
              const count =
                level === "all" ? questions.length : difficultyCount(level);
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setQDiffFilter(level)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "clay-inset text-muted-foreground hover:text-foreground",
                  )}
                >
                  {level === "all"
                    ? "All difficulties"
                    : DIFFICULTY_META[level].label}
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {questions === undefined ? (
          <div className="clay mt-3 p-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : questions.length === 0 ? (
          <div className="clay mt-3 p-8 text-center text-sm text-muted-foreground">
            No questions yet — add questions here, then attach them to draft assessments.
          </div>
        ) : bankQuestions !== undefined && bankQuestions.length === 0 ? (
          <div className="clay mt-3 p-8 text-center text-sm text-muted-foreground">
            No{" "}
            {qDiffFilter === "all"
              ? ""
              : `${DIFFICULTY_META[qDiffFilter].label.toLowerCase()} `}
            questions in this bank yet.{" "}
            <button
              type="button"
              className="font-semibold text-primary underline"
              onClick={() => setQDiffFilter("all")}
            >
              Show all {questions.length}
            </button>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {bankQuestions?.map((q) => (
              <div key={q._id} className="clay flex items-start justify-between gap-4 p-5">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 h-10 w-1.5 shrink-0 rounded-full",
                      BLOOM_ACCENT_BG[q.bloomLevel] ?? "bg-muted-foreground/30",
                    )}
                  />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {q.questionText}
                      <Badge
                        className={cn(
                          "rounded-full",
                          BLOOM_BADGE_CLASSES[q.bloomLevel] ??
                            "bg-muted text-foreground",
                        )}
                      >
                        {BLOOM_LABEL[q.bloomLevel] ?? q.bloomLevel}
                      </Badge>
                      <DifficultyBadge question={q} />
                      <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                        <Clock className="mr-1 size-3" /> {fmtSec(q.expectedTimeSec)}
                      </Badge>
                      <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                        {typeLabelOf(q)}
                      </Badge>
                      {q.topic && (
                        <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                          {q.topic}
                        </Badge>
                      )}
                      {q.categoryId && categoryOf(q.categoryId) && (
                        <Badge className="rounded-full bg-[var(--accent)] text-[10px] font-bold text-muted-foreground">
                          {categoryOf(q.categoryId)?.name}
                        </Badge>
                      )}
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
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {shareStateOf(q._id) && (
                    <BankSharePill
                      state={shareStateOf(q._id) as BankShareState}
                      busy={busy === `share-${q._id}`}
                      onToggle={() => void doSetBankShare(q)}
                    />
                  )}
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
                          : q.questionType === "drag_drop" ||
                              q.questionType === "ordering"
                            ? [...(q.options ?? ["", ""])]
                            : ["", "", "", ""],
                      );
                      setQDragTargets(
                        q.dragDropTargets?.length
                          ? q.dragDropTargets.map((target) => ({
                              id: target.id,
                              label: target.label,
                            }))
                          : [
                              { id: "target-1", label: "Target 1" },
                              { id: "target-2", label: "Target 2" },
                            ],
                      );
                      setQDragCorrect(
                        Object.fromEntries(
                          (q.dragDropCorrect ?? []).map((placement) => [
                            placement.item,
                            placement.targetId,
                          ]),
                        ),
                      );
                      setQOrderingCorrect(
                        q.orderingCorrect?.length
                          ? [...q.orderingCorrect]
                          : [...(q.options ?? [])],
                      );
                      setQPartialCredit(q.partialCredit !== false);
                      setQCorrect(q.correctAnswer);
                      setQExplanation(q.explanation ?? "");
                      setQMarks(String(q.marks));
                      setQDifficulty(resolveDifficulty(q));
                      setQBloom(q.bloomLevel);
                      setQTopic(q.topic ?? "");
                      setQCategoryId(q.categoryId ?? currentClass?.categoryId ?? "");
                      setQTopicId(q.topicId ?? "");
                      setQTypeKey(
                        q.typeKey ??
                          (q.questionType === "multiple_choice"
                            ? "multiple_choice"
                            : q.questionType === "true_false"
                              ? "true_false"
                              : q.questionType === "drag_drop"
                                ? "drag_drop"
                                : q.questionType === "ordering"
                                  ? "ordering"
                                  : "short_answer"),
                      );
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
        <DialogContent className="clay max-h-[85vh] overflow-y-auto border-0 sm:max-w-md">
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
            {/* Assessment type — the static or the adaptive panel */}
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Assessment type</Label>
              <div className="clay-inset grid grid-cols-2 gap-1 rounded-full p-1">
                {(
                  [
                    { id: "static", label: "Static exam" },
                    { id: "adaptive", label: "Adaptive (AI)" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setAMode((prev) =>
                        opt.id === "adaptive"
                          ? "adaptive"
                          : prev === "adaptive"
                            ? "static"
                            : prev,
                      )
                    }
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                      (opt.id === "adaptive" ? aMode === "adaptive" : aMode !== "adaptive")
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {aMode === "adaptive"
                  ? "Uses the proposed model: the IRT Bloom ladder picks each question from the pool, one at a time."
                  : "Traditional exam without the model: every student receives the same fixed paper."}
              </p>
            </div>

            {/* Static exams: how the fixed paper is assembled */}
            {aMode !== "adaptive" && (
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Question selection</Label>
                <div className="clay-inset grid grid-cols-3 gap-1 rounded-full p-1">
                  {(
                    [
                      { id: "static", label: "My order" },
                      { id: "random", label: "Random per level" },
                      { id: "final", label: FAIR_ADAPTIVE_LABEL },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAMode(opt.id)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                        aMode === opt.id
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {aMode === "random"
                    ? "Every student gets a different random draw from the question bank, level by level."
                    : aMode === "final"
                      ? FAIR_ADAPTIVE_BLURB
                      : "Serve exactly the questions you attach, in the order you add them."}
                </p>
              </div>
            )}

            {aMode === "random" ? (
              <div className="clay-inset rounded-2xl p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Random questions per Bloom level
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  How many questions to draw at random from each level. Questions
                  are picked automatically from this class's question bank — no
                  manual selection needed. Each student answers exactly this many,
                  in Remember → Create order.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {BLOOM_ORDER.map((b) => (
                    <div key={b} className="grid gap-1">
                      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {aBloomNames[b] ?? DEFAULT_BLOOM_LABELS[b]}
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={aRandomCounts[b] ?? "0"}
                        onChange={(e) =>
                          setARandomCounts((prev) => ({
                            ...prev,
                            [b]: e.target.value,
                          }))
                        }
                        className="clay-inset h-9 rounded-full px-3 text-sm"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs">
                  <span className="text-muted-foreground">
                    Questions per student
                  </span>
                  <span className="font-bold tabular-nums">{randomTotalPreview}</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  The pool needs at least this many questions at every level with
                  a draw above 0 before the assessment can be published.
                </p>
              </div>
            ) : aMode === "adaptive" ? (
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
            ) : (
              <div className="clay-inset rounded-2xl p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Fixed paper
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Save this draft, then attach the questions it should contain —
                  they are served in the order you add them, to every student.
                  There is no pool minimum and no Bloom coverage requirement.
                </p>
              </div>
            )}
            {/* Bloom level names — rename the six levels or keep the defaults */}
            <div className="clay-inset rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Bloom level names
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-2 text-[11px]"
                  onClick={() => setABloomNames({ ...DEFAULT_BLOOM_LABELS })}
                >
                  <RotateCcw className="mr-1 size-3" /> Reset
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Rename the six levels for this assessment, or leave the default
                taxonomy names. Questions keep their level — only the wording
                students see changes.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {BLOOM_ORDER.map((b) => (
                  <div key={b} className="grid gap-1">
                    <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {DEFAULT_BLOOM_LABELS[b]}
                    </Label>
                    <Input
                      value={aBloomNames[b] ?? DEFAULT_BLOOM_LABELS[b]}
                      maxLength={40}
                      placeholder={DEFAULT_BLOOM_LABELS[b]}
                      onChange={(e) =>
                        setABloomNames((prev) => ({
                          ...prev,
                          [b]: e.target.value,
                        }))
                      }
                      className="clay-inset h-9 rounded-full px-3 text-sm"
                    />
                  </div>
                ))}
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
                  <span className="font-bold">
                    {aMode === "adaptive"
                      ? poolPreview
                      : aMode === "random"
                        ? "The class question bank"
                        : "Your attached questions"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Questions Displayed</span>
                  <span className="font-bold">
                    {aMode === "adaptive"
                      ? displayPreview
                      : aMode === "random"
                        ? randomTotalPreview
                        : "All attached"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Selection Method</span>
                  <span className="font-bold">
                    {aMode === "adaptive"
                      ? "Adaptive AI Model"
                      : aMode === "random"
                        ? "Random per Bloom level"
                        : "Fixed order (no model)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bloom's Taxonomy</span>
                  <span className="font-bold">All 6 levels</span>
                </div>
                {aMode === "adaptive" && (
                  <>
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
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Random Selection</span>
                  <span
                    className={
                      aMode === "random"
                        ? "font-bold text-[oklch(0.45_0.12_145)]"
                        : "font-bold text-destructive"
                    }
                  >
                    {aMode === "random" ? "ON" : "OFF"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Adaptive Selection</span>
                  <span
                    className={
                      aMode === "adaptive"
                        ? "font-bold text-[oklch(0.45_0.12_145)]"
                        : "font-bold text-destructive"
                    }
                  >
                    {aMode === "adaptive" ? "ON" : "OFF"}
                  </span>
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
                <Label className="text-xs font-semibold">Question type</Label>
                <Select
                  value={qTypeKey}
                  onValueChange={(v) => {
                    const type = (taxonomy?.types ?? []).find((t) => t.key === v);
                    if (!type) return;
                    const t =
                      type.answerFormat === "multiple_choice"
                        ? "multiple_choice"
                        : type.answerFormat === "true_false"
                          ? "true_false"
                          : type.answerFormat === "drag_drop"
                            ? "drag_drop"
                            : type.answerFormat === "ordering"
                              ? "ordering"
                              : "short_answer";
                    setQTypeKey(type.key);
                    setQType(t);
                    if (t === "true_false") setQCorrect("True");
                    else setQCorrect("");
                  }}
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(taxonomy?.types ?? [])
                      .filter(
                        (t) =>
                          !editQ ||
                          t.answerFormat ===
                            (qType === "short_answer" ? "text" : qType),
                      )
                      .map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.label}
                        </SelectItem>
                      ))}
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
              <Label className="text-xs font-semibold">Difficulty level</Label>
              <div className="clay-inset grid grid-cols-4 gap-1 rounded-full p-1">
                {DIFFICULTY_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setQDifficulty(level)}
                    className={cn(
                      "rounded-full px-2 py-1.5 text-xs font-bold transition-colors",
                      qDifficulty === level
                        ? cn(
                            "shadow-sm",
                            DIFFICULTY_META[level].badge,
                          )
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {DIFFICULTY_META[level].label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                How hard this question should feel — used to filter the bank and
                to seed the adaptive difficulty when no item parameter is set.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Subject / category</Label>
                <Select
                  value={qCategoryId || currentClass?.categoryId || ""}
                  onValueChange={(value) => {
                    setQCategoryId(value);
                    setQTopicId("");
                    setQTopic("");
                  }}
                >
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
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Topic</Label>
                <Select
                  value={qTopicId || "none"}
                  onValueChange={(value) => {
                    const topic =
                      categoryOf(qCategoryId || currentClass?.categoryId || "")?.topics.find(
                        (t) => t.id === value,
                      ) ?? null;
                    setQTopicId(value === "none" ? "" : value);
                    setQTopic(topic?.name ?? "");
                  }}
                >
                  <SelectTrigger className="clay-inset rounded-full px-4">
                    <SelectValue placeholder="General" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General / no topic</SelectItem>
                    {(
                      categoryOf(qCategoryId || currentClass?.categoryId || "")?.topics ?? []
                    ).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            {qType === "drag_drop" && (
              <DragDropQuestionEditor
                items={qOptions}
                onItemsChange={setQOptions}
                targets={qDragTargets}
                onTargetsChange={setQDragTargets}
                correct={qDragCorrect}
                onCorrectChange={setQDragCorrect}
                partialCredit={qPartialCredit}
                onPartialCreditChange={setQPartialCredit}
              />
            )}
            {qType === "ordering" && (
              <OrderingQuestionEditor
                items={qOptions}
                onItemsChange={setQOptions}
                correctOrder={qOrderingCorrect}
                onCorrectOrderChange={setQOrderingCorrect}
                partialCredit={qPartialCredit}
                onPartialCreditChange={setQPartialCredit}
              />
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
              onAutoFill={() => void doAutoFillQuestions()}
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

      {/* Schedule dialog */}
      <Dialog
        open={scheduleFor !== null}
        onOpenChange={(o) => !o && setScheduleFor(null)}
      >
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule “{scheduleFor?.title}”</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Students see the assessment on their list, but cannot start it until
            this moment.
          </p>
          <div className="mt-2 grid gap-1.5">
            <Label className="text-xs font-semibold">Opens at</Label>
            <Input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={busy === `sch-${scheduleFor?.id}`}
              onClick={() => {
                if (!scheduleFor) return;
                void doClearSchedule(scheduleFor).then(() => setScheduleFor(null));
              }}
            >
              Open immediately
            </Button>
            <Button
              className="rounded-full"
              disabled={busy === `sch-${scheduleFor?.id}`}
              onClick={() => void doSchedule()}
            >
              Save schedule
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
          ) : results === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Results are unavailable for this assessment.
            </p>
          ) : (
            <div>
              <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                {[
                  { label: "Enrolled", value: results.stats.rosterSize },
                  { label: "Not started", value: results.stats.notStarted },
                  { label: "In progress", value: results.stats.inProgress },
                  { label: "Completed", value: results.stats.completed },
                  { label: "Passed", value: results.stats.passed },
                  { label: "Failed", value: results.stats.failed },
                ].map((s) => (
                  <div key={s.label} className="clay-inset rounded-2xl p-3">
                    <p className="text-lg font-extrabold tabular-nums">{s.value}</p>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Average {pct(results.stats.avgPct)} · Highest{" "}
                {results.stats.highest === null
                  ? "—"
                  : `${Math.round(results.stats.highest)}%`}
                {results.stats.passRate !== null
                  ? ` · Pass rate ${Math.round(results.stats.passRate)}%`
                  : ""}
              </p>
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
                {results.rows.length === 0 && (
                  <p className="clay-inset rounded-2xl p-4 text-center text-xs text-muted-foreground">
                    No students are enrolled in this class yet.
                  </p>
                )}
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
                      {DIFFICULTY_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {DIFFICULTY_META[level].label}
                        </SelectItem>
                      ))}
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
const SUMMARY_TYPE_LABEL: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  short_answer: "Short answer",
};
function AssessmentComposer({
  assessmentId,
  questions,
  pickQuestion,
  setPickQuestion,
  onAdd,
  onRemove,
  onAutoFill,
  busy,
}: {
  assessmentId: Id<"instructorAssessments">;
  questions: Question[];
  pickQuestion: string;
  setPickQuestion: (v: string) => void;
  onAdd: () => void;
  onRemove: (questionId: string) => void;
  onAutoFill: () => void;
  busy: boolean;
}) {
  const data = useQuery(
    api.instructorAssessments.getAssessment,
    assessmentId ? { id: assessmentId } : "skip",
  ) as
    | {
        assessment: {
          status: string;
          selectionMode?: AssessmentMode;
          randomCounts?: Record<string, number>;
          bloomLabels?: Record<string, string>;
          poolSize?: number;
        };
        assessmentType?: AssessmentType;
        selectionMode?: AssessmentMode;
        /** Pool the assessment selects from (class bank for random, empty). */
        questions: Question[];
        /** Curated subset; empty means the whole class bank is the pool. */
        attached: Question[];
        poolFromBank: boolean;
      }
    | undefined;

  const mode =
    data?.selectionMode ?? data?.assessment.selectionMode ?? "adaptive";
  const randomMode = mode === "random";
  const staticMode = mode === "static";
  const adaptiveMode = mode === "adaptive";
  /** Class final: one shared question set, randomized order per student. */
  const fairMode = mode === "final";
  const labels = resolveBloomLabels(data?.assessment.bloomLabels);
  const counts = data?.assessment.randomCounts ?? {};
  const attachedQuestions = data?.attached ?? [];
  const poolQuestions = data?.questions ?? [];
  const targetPool = Math.max(18, data?.assessment.poolSize ?? 18);
  const attachedIds = new Set(attachedQuestions.map((q) => q._id));
  const available = questions.filter((q) => !attachedIds.has(q._id));
  /** Difficulty filter for the "add from bank" picker. */
  const [pickDifficulty, setPickDifficulty] = useState<
    "all" | DifficultyLevel
  >("all");
  const filteredAvailable =
    pickDifficulty === "all"
      ? available
      : available.filter((q) => resolveDifficulty(q) === pickDifficulty);

  // Per-level availability in whichever pool the draw will use.
  const poolCounts = new Map<string, number>();
  for (const q of poolQuestions)
    poolCounts.set(q.bloomLevel, (poolCounts.get(q.bloomLevel) ?? 0) + 1);

  // Bloom coverage of the pool (≥3 per level required to publish).
  const coverage = new Map<string, number>();
  for (const q of attachedQuestions) {
    coverage.set(q.bloomLevel, (coverage.get(q.bloomLevel) ?? 0) + 1);
  }
  const total = attachedQuestions.length;
  const selectedBloomCounts = BLOOM_ORDER.reduce<Record<string, number>>(
    (acc, b) => { acc[b] = coverage.get(b) ?? 0; return acc; },
    {},
  );
  const selectedTotalMarks = attachedQuestions.reduce((sum, q) => sum + q.marks, 0);

  return (
    <div className="grid gap-3">
      {/* Fair Adaptive final: one shared set, shuffled per student. */}
      {fairMode && (
        <div className="clay-inset rounded-2xl p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {FAIR_ADAPTIVE_LABEL}
            </p>
            <span className="text-xs font-bold tabular-nums">
              {attachedQuestions.length} question
              {attachedQuestions.length === 1 ? "" : "s"} · {selectedTotalMarks}{" "}
              marks
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {FAIR_ADAPTIVE_BLURB} Attach the shared set the whole class sits —
            the order is shuffled per student at delivery.
          </p>
        </div>
      )}

      {/* Static exam: the attached questions ARE the paper, in this order. */}
      {staticMode && (
        <div className="clay-inset rounded-2xl p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Fixed paper
            </p>
            <span className="text-xs font-bold tabular-nums">
              {attachedQuestions.length} question
              {attachedQuestions.length === 1 ? "" : "s"} · {selectedTotalMarks}{" "}
              marks
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Every student receives exactly these questions, in the order shown.
            No adaptive selection, no pool minimum — attach the questions below.
          </p>
        </div>
      )}
      {/* Random mode: no manual selection — the draw is automatic. */}
      {randomMode && (
        <div className="clay-inset rounded-2xl p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Random draw per Bloom level
            </p>
            <span className="text-xs font-bold tabular-nums">
              {randomDrawTotal(counts)} per student
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Questions are picked automatically from{" "}
            {data?.poolFromBank
              ? `the class question bank (${poolQuestions.length} available)`
              : `your ${poolQuestions.length}-question curated pool`}{" "}
            the moment each student starts — no manual selection needed.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {BLOOM_ORDER.map((b) => {
              const need = Math.max(0, counts[b] ?? 0);
              const have = poolCounts.get(b) ?? 0;
              const ok = have >= need;
              return (
                <div
                  key={b}
                  className={`flex items-center justify-between rounded-xl px-2.5 py-1.5 text-[11px] font-semibold ${
                    ok
                      ? "bg-[oklch(0.72_0.14_145)]/10 text-[oklch(0.45_0.12_145)]"
                      : "bg-amber-500/10 text-amber-600"
                  }`}
                  title={`${need} drawn from ${have} available`}
                >
                  <span className="truncate">{labels[b] ?? BLOOM_LABEL[b]}</span>
                  <span className={cn(!ok && "animate-pulse", "tabular-nums")}>
                    {need}/{have}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {attachedQuestions.length === 0
              ? "Pool: the whole class bank. Attach questions below only to narrow the draw."
              : `Pool: your ${attachedQuestions.length} attached questions. Remove them all to draw from the whole bank again.`}
          </p>
        </div>
      )}
      {adaptiveMode && (
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
        {total > 0 && (
          <div className="mt-2">
            <div className="clay-inset rounded-xl p-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Bloom summary — selected questions
            </div>
            <div className="mt-1.5 rounded-xl border border-primary/20 bg-[oklch(0.98_0.01_240)] px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Bloom summary — selected questions</span>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-semibold text-[13px] text-foreground">
                <span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[oklch(0.9_0.05_320)]" />Remember: {selectedBloomCounts.remember}</span>
                <span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[oklch(0.85_0.12_145)]" />Understand: {selectedBloomCounts.understand}</span>
                <span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[oklch(0.85_0.14_85)]" />Apply: {selectedBloomCounts.apply}</span>
                <span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[oklch(0.88_0.12_250)]" />Analyze: {selectedBloomCounts.analyze}</span>
                <span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[oklch(0.88_0.10_30)]" />Evaluate: {selectedBloomCounts.evaluate}</span>
                <span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[oklch(0.86_0.14_320)]" />Create: {selectedBloomCounts.create}</span>
              </div>
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
            <div className="mt-2 flex items-center justify-between rounded-xl bg-[oklch(0.97_0.01_240)] px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <span>Total marks in pool</span>
              <span className="font-bold text-foreground">{selectedTotalMarks}</span>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <p className="text-[11px] text-muted-foreground">
            Adds bank questions until the pool reaches {targetPool}, balanced
            across all six levels.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-primary/40 text-primary"
            disabled={busy}
            onClick={onAutoFill}
          >
            <Sparkles className="mr-1 size-3.5" /> Fill Automatically
          </Button>
        </div>
      </div>
      )}
      {data === undefined ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="space-y-1.5">
            {attachedQuestions.length === 0 ? (
              <p className="clay-inset rounded-2xl p-4 text-center text-xs text-muted-foreground">
                {randomMode
                  ? `Nothing attached — each paper is drawn from all ${poolQuestions.length} questions in the class bank.`
                  : staticMode
                    ? "No questions attached yet — a static exam needs at least one before it can be published."
                    : fairMode
                      ? "No questions attached yet — a Fair Adaptive final needs at least one shared question."
                      : "No questions attached yet."}
              </p>
            ) : (
              attachedQuestions.map((q, i) => (
                <div
                  key={q._id}
                  className={`rounded-2xl border ${attachedIds.has(q._id) ? "border-transparent" : "border-dashed border-muted"} p-3 ${attachedIds.has(q._id) ? "bg-[var(--accent)]/50 hover:bg-[var(--accent)]/70" : "bg-[var(--panel)]/40"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 h-8 w-1 shrink-0 rounded-full",
                        BLOOM_ACCENT_BG[q.bloomLevel] ??
                          "bg-muted-foreground/30",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {i + 1}. {q.questionText}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${attachedIds.has(q._id) ? "bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.45_0.12_145)]" : "bg-muted text-muted-foreground"}`}>
                          {SUMMARY_TYPE_LABEL[q.questionType] ?? q.questionType}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-semibold text-[11px] ${attachedIds.has(q._id) ? BLOOM_BADGE_CLASSES[q.bloomLevel] ?? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}>
                          {BLOOM_LABEL[q.bloomLevel] ?? q.bloomLevel}
                        </span>
                        <DifficultyBadge question={q} />
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${attachedIds.has(q._id) ? "bg-primary/10 text-[oklch(0.45_0.12_145)]" : "bg-muted text-muted-foreground"}`}>
                          {q.marks} mark{q.marks === 1 ? "" : "s"}
                        </span>
                      </p>
                    </div>
                    {attachedIds.has(q._id) && (
                      <button
                        className="rounded-full p-1.5 text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={() => onRemove(q._id)}
                        title="Remove from assessment"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex items-end gap-2">
            <div className="w-28 shrink-0">
              <Label className="text-xs font-semibold">Difficulty</Label>
              <Select
                value={pickDifficulty}
                onValueChange={(v) => {
                  setPickDifficulty(v as "all" | DifficultyLevel);
                  setPickQuestion("");
                }}
              >
                <SelectTrigger className="clay-inset mt-1.5 rounded-full px-4">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  {DIFFICULTY_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {DIFFICULTY_META[level].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 flex-1">
              <Label className="text-xs font-semibold">
                {randomMode
                  ? "Attach a specific question (optional)"
                  : staticMode
                    ? "Add a question to the paper"
                    : fairMode
                      ? "Add a question to the shared set"
                      : "Add from question bank"}
              </Label>
              <Select value={pickQuestion} onValueChange={setPickQuestion}>
                <SelectTrigger className="clay-inset mt-1.5 rounded-full px-4">
                  <SelectValue
                    placeholder={
                      filteredAvailable.length === 0
                        ? "No bank questions match"
                        : "Choose a question…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {filteredAvailable.map((q) => (
                    <SelectItem key={q._id} value={q._id}>
                      {DIFFICULTY_META[resolveDifficulty(q)].label} ·{" "}
                      {q.questionText.slice(0, 54)}
                      {q.questionText.length > 54 ? "…" : ""}
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
          {available.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              All bank questions are attached. Create more in the question bank below.
            </p>
          ) : filteredAvailable.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No {pickDifficulty === "all" ? "" : `${DIFFICULTY_META[pickDifficulty].label.toLowerCase()} `}
              questions left to attach.{" "}
              <button
                type="button"
                className="font-semibold text-primary underline"
                onClick={() => setPickDifficulty("all")}
              >
                Show all
              </button>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  Flag,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Timer,
  Users,
  X,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BLOOM_LABEL, resolveBloomLabels } from "@/lib/irt";
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

const BLOOM_BADGE: Record<string, string> = {
  remember: "bg-[oklch(0.9_0.05_320)] text-[oklch(0.4_0.09_320)]",
  understand: "bg-[oklch(0.85_0.12_145)] text-[oklch(0.32_0.09_145)]",
  apply: "bg-[oklch(0.85_0.14_85)] text-[oklch(0.32_0.1_85)]",
  analyze: "bg-[oklch(0.88_0.12_250)] text-[oklch(0.4_0.06_250)]",
  evaluate: "bg-[oklch(0.88_0.1_30)] text-[oklch(0.4_0.07_30)]",
  create: "bg-[oklch(0.86_0.14_320)] text-[oklch(0.42_0.08_320)]",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Active",
  closed: "Completed",
  archived: "Archived",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-[oklch(0.9_0.03_240)] text-[oklch(0.4_0.04_240)]",
  published: "bg-[oklch(0.9_0.07_145)] text-[oklch(0.32_0.09_145)]",
  closed: "bg-[oklch(0.9_0.06_25)] text-[oklch(0.35_0.08_25)]",
  archived: "bg-muted text-muted-foreground",
};

const ANSWER_FORMAT_LABEL: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  short_answer: "Written answer",
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
  difficultyLevel?: DifficultyLevel;
  difficultyB?: number;
  expectedTimeSec: number;
  topic?: string;
  categoryId?: string;
  topicId?: string;
  typeKey?: string;
  sharedQuestionId?: string;
};

type AssessmentDetail = {
  assessment: {
    classId: string;
    title: string;
    description?: string;
    timeLimitMin: number;
    poolSize?: number;
    displayCount?: number;
    bloomLabels?: Record<string, string>;
    assessmentType?: "static" | "adaptive";
    selectionMode?: "adaptive" | "static" | "random" | "final";
    randomCounts?: Record<string, number>;
    status: "draft" | "published" | "closed" | "archived";
    scheduledFor?: number;
    publishedAt?: number;
    archivedAt?: number;
    createdAt: number;
    updatedAt: number;
  };
  assessmentType: "static" | "adaptive";
  selectionMode: "adaptive" | "static" | "random" | "final";
  questions: Question[];
  attached: Question[];
  poolFromBank: boolean;
  bloomDistribution: Array<{ level: BloomKey; count: number }>;
  difficultyDistribution: Array<{ level: DifficultyLevel; count: number }>;
  totalMarks: number;
  classInfo: {
    id: string;
    name: string;
    subject: string | null;
    categoryId: string | null;
    academicYear: string;
    studentCount: number;
    instructorName: string;
    closedAt: number | null;
  };
  participation: {
    enrolled: number;
    inProgress: number;
    completed: number;
    notStarted: number;
    passed: number;
    failed: number;
  };
};

type ResultsPayload = {
  rows: Array<{
    studentId: string;
    studentName: string;
    status: string | null;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    passed: boolean | null;
    grade: string | null;
    violationCount: number;
  }>;
  stats: {
    rosterSize: number;
    submitted: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    passed: number;
    failed: number;
    passRate: number | null;
    avgPct: number | null;
    highest: number | null;
    lowest: number | null;
  };
};

type SharedCard = {
  _id: string;
  subject: string;
  questionText: string;
  options: string[] | null;
  correctAnswer: string;
  explanation: string | null;
  marks: number;
  bloomLevel: BloomKey;
  difficultyLevel: DifficultyLevel | null;
  categoryId: string | null;
  topicId: string | null;
  typeKey: string;
  typeLabel: string;
  topic: string | null;
  ownerName: string;
  share: boolean;
};

type SharedContext = {
  categories: Array<{
    id: string;
    name: string;
    topics: Array<{ id: string; name: string }>;
  }>;
  types: Array<{ key: string; label: string; answerFormat: string }>;
  questions: SharedCard[];
};

type Taxonomy = {
  categories: Array<{
    id: string;
    name: string;
    topics: Array<{ id: string; name: string }>;
  }>;
  types: Array<{ key: string; label: string }>;
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
function toLocalInput(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function AssessmentDetails() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const assessmentId = params.assessmentId as
    | Id<"instructorAssessments">
    | undefined;

  const data = useQuery(
    api.instructorAssessments.getAssessment,
    assessmentId ? { id: assessmentId } : "skip",
  ) as AssessmentDetail | null | undefined;
  const results = useQuery(
    api.instructorAssessments.getAssessmentResults,
    assessmentId ? { id: assessmentId } : "skip",
  ) as ResultsPayload | null | undefined;
  const taxonomy = useQuery(
    api.taxonomy.getTaxonomy,
    isAuthenticated ? {} : "skip",
  ) as Taxonomy | undefined;

  const classId = data?.classInfo.id as Id<"classes"> | undefined;
  const bank = useQuery(
    api.instructorAssessments.listQuestions,
    classId ? { classId } : "skip",
  ) as Question[] | undefined;

  const updateAssessment = useMutation(api.instructorAssessments.updateAssessment);
  const addQuestion = useMutation(api.instructorAssessments.addQuestionToAssessment);
  const removeQuestion = useMutation(
    api.instructorAssessments.removeQuestionFromAssessment,
  );
  const autoFill = useMutation(
    api.instructorAssessments.autoFillAssessmentQuestions,
  );
  const setStatus = useMutation(api.instructorAssessments.setAssessmentStatus);
  const schedule = useMutation(api.instructorAssessments.scheduleAssessment);
  const archive = useMutation(api.instructorAssessments.archiveAssessment);
  const restore = useMutation(api.instructorAssessments.restoreAssessment);
  const duplicate = useMutation(api.instructorAssessments.duplicateAssessment);
  const importShared = useMutation(api.sharedQuestions.importSharedQuestions);

  // ---- settings dialog ----
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sTitle, setSTitle] = useState("");
  const [sDesc, setSDesc] = useState("");
  const [sTime, setSTime] = useState("0");
  const [sPool, setSPool] = useState("18");
  const [sDisplay, setSDisplay] = useState("18");

  // ---- schedule dialog ----
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");

  // ---- fill dialog ----
  const [fillOpen, setFillOpen] = useState(false);
  const [fillCount, setFillCount] = useState("10");
  const [fillBloom, setFillBloom] = useState<Record<string, string>>(() =>
    Object.fromEntries(BLOOM_ORDER.map((b) => [b, ""])),
  );
  const [fillDiff, setFillDiff] = useState<Record<string, string>>(() =>
    Object.fromEntries(DIFFICULTY_LEVELS.map((d) => [d, ""])),
  );

  // ---- question filters ----
  const [qSearch, setQSearch] = useState("");
  const [qBloom, setQBloom] = useState("all");
  const [qDiff, setQDiff] = useState("all");
  const [qType, setQType] = useState("all");

  // ---- bank / shared picker ----
  const [pickerTab, setPickerTab] = useState<"class" | "shared">("class");
  const [bankSearch, setBankSearch] = useState("");
  const [bankBloom, setBankBloom] = useState("all");
  const [bankDiff, setBankDiff] = useState("all");
  const [bankCategory, setBankCategory] = useState("all");
  const [bankTopic, setBankTopic] = useState("all");
  const [bankType, setBankType] = useState("all");
  const [bankShare, setBankShare] = useState<"all" | "private" | "shared">("all");

  const [sharedSearch, setSharedSearch] = useState("");
  const [sharedBloom, setSharedBloom] = useState("all");
  const [sharedDiff, setSharedDiff] = useState("all");
  const [sharedCategory, setSharedCategory] = useState("all");
  const [sharedTopic, setSharedTopic] = useState("all");
  const [sharedType, setSharedType] = useState("all");

  const shared = useQuery(
    api.sharedQuestions.getSharedQuestionsContext,
    classId
      ? {
          classId,
          ...(sharedCategory !== "all"
            ? { categoryId: sharedCategory as Id<"questionCategories"> }
            : {}),
          ...(sharedTopic !== "all"
            ? { topicId: sharedTopic as Id<"questionTopics"> }
            : {}),
          ...(sharedType !== "all" ? { typeKey: sharedType } : {}),
          ...(sharedBloom !== "all"
            ? { bloomLevel: sharedBloom as BloomKey }
            : {}),
          ...(sharedDiff !== "all"
            ? { difficultyLevel: sharedDiff as DifficultyLevel }
            : {}),
          ...(sharedSearch.trim() ? { search: sharedSearch.trim() } : {}),
        }
      : "skip",
  ) as SharedContext | null | undefined;

  const [busy, setBusy] = useState<string | null>(null);

  const attachedIds = useMemo(
    () => new Set((data?.attached ?? []).map((q) => q._id)),
    [data?.attached],
  );

  const typeLabelOf = (q: Question) =>
    taxonomy?.types.find((t) => t.key === q.typeKey)?.label ??
    ANSWER_FORMAT_LABEL[q.questionType] ??
    q.questionType;

  const categoryNameOf = (id: string | null | undefined) =>
    id ? taxonomy?.categories.find((c) => c.id === id)?.name ?? null : null;

  const topicNameOf = (q: Question) =>
    q.topicId
      ? taxonomy?.categories
          .flatMap((c) => c.topics)
          .find((t) => t.id === q.topicId)?.name ?? q.topic ?? null
      : q.topic ?? null;

  const filteredQuestions = useMemo(() => {
    const list = data?.attached ?? [];
    const term = qSearch.trim().toLowerCase();
    return list.filter((q) => {
      if (qBloom !== "all" && q.bloomLevel !== qBloom) return false;
      if (qDiff !== "all" && resolveDifficulty(q) !== qDiff) return false;
      if (qType !== "all" && (q.typeKey ?? q.questionType) !== qType) return false;
      if (term) {
        const hay = [
          q.questionText,
          q.explanation ?? "",
          q.correctAnswer,
          q.topic ?? "",
          typeLabelOf(q),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [data?.attached, qSearch, qBloom, qDiff, qType, taxonomy]);

  const filteredBank = useMemo(() => {
    const term = bankSearch.trim().toLowerCase();
    return (bank ?? []).filter((q) => {
      if (attachedIds.has(q._id)) return false;
      if (bankBloom !== "all" && q.bloomLevel !== bankBloom) return false;
      if (bankDiff !== "all" && resolveDifficulty(q) !== bankDiff) return false;
      if (bankCategory !== "all" && q.categoryId !== bankCategory) return false;
      if (bankTopic !== "all" && q.topicId !== bankTopic) return false;
      if (
        bankType !== "all" &&
        (q.typeKey ?? q.questionType) !== bankType
      )
        return false;
      if (bankShare !== "all") {
        const isShared = !!q.sharedQuestionId;
        if (bankShare === "shared" && !isShared) return false;
        if (bankShare === "private" && isShared) return false;
      }
      if (term) {
        const hay = [q.questionText, q.topic ?? "", q.explanation ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [
    bank,
    attachedIds,
    bankSearch,
    bankBloom,
    bankDiff,
    bankCategory,
    bankTopic,
    bankType,
    bankShare,
  ]);

  const bankTopics = useMemo(() => {
    if (!taxonomy) return [];
    return taxonomy.categories
      .filter((c) => bankCategory === "all" || c.id === bankCategory)
      .flatMap((c) => c.topics);
  }, [taxonomy, bankCategory]);

  const sharedTopics = useMemo(() => {
    if (!shared) return [];
    return shared.categories
      .filter((c) => sharedCategory === "all" || c.id === sharedCategory)
      .flatMap((c) => c.topics);
  }, [shared, sharedCategory]);

  const bloomLabels = resolveBloomLabels(data?.assessment.bloomLabels);
  const labels = (level: string) =>
    (bloomLabels as Record<string, string>)[level] ??
    BLOOM_LABEL[level as BloomKey] ??
    level;

  // The class in the URL must match the assessment's real class: a mismatched
  // link is corrected instead of leaving the module on a stale class.
  useEffect(() => {
    if (!data || !assessmentId) return;
    if (params.classId !== data.classInfo.id) {
      navigate(
        `/instructor/assessments/${data.classInfo.id}/${assessmentId}`,
        { replace: true },
      );
    }
  }, [data, params.classId, assessmentId, navigate]);

  if (isLoading || !isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
        <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
        <div className="clay relative z-10 w-full max-w-md p-8 text-center">
          <Lock className="mx-auto size-8 text-primary" />
          <p className="mt-3 font-bold">Assessment unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This assessment does not belong to one of your classes, so its
            questions and results cannot be opened.
          </p>
          <Link to="/instructor/assessments" className="mt-5 inline-block">
            <Button className="rounded-full">Back to assessment management</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
        <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
        <div className="clay relative z-10 w-full max-w-md p-8 text-center">
          <ClipboardList className="mx-auto size-8 text-primary" />
          <p className="mt-3 font-bold">Loading assessment…</p>
          <Loader2 className="mx-auto mt-3 size-5 animate-spin text-muted-foreground" />
        </div>
      </main>
    );
  }

  const a = data.assessment;
  const draft = a.status === "draft";
  const archived = a.status === "archived";
  const fair = data.selectionMode === "final";
  const panel = data.selectionMode === "adaptive" ? "Adaptive" : fair ? FAIR_ADAPTIVE_LABEL : "Static";
  const scheduled = a.scheduledFor !== undefined && a.scheduledFor > Date.now();

  const run = async <T,>(
    key: string,
    fn: () => Promise<T>,
    success?: string,
  ): Promise<T | undefined> => {
    setBusy(key);
    try {
      const result = await fn();
      if (success) toast.success(success);
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const openSettings = () => {
    setSTitle(a.title);
    setSDesc(a.description ?? "");
    setSTime(String(a.timeLimitMin));
    setSPool(String(a.poolSize ?? 18));
    setSDisplay(String(a.displayCount ?? 18));
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    const fields = {
      title: sTitle.trim(),
      description: sDesc.trim() || undefined,
      timeLimitMin: Math.max(0, parseInt(sTime || "0", 10) || 0),
      ...(data.selectionMode === "adaptive"
        ? {
            poolSize: parseInt(sPool || "18", 10) || 18,
            displayCount: parseInt(sDisplay || "18", 10) || 18,
          }
        : {}),
    };
    const saved = await run(
      "settings",
      () =>
        updateAssessment({
          id: assessmentId as Id<"instructorAssessments">,
          fields,
        }),
      "Settings saved",
    );
    if (saved !== undefined) setSettingsOpen(false);
  };

  const openSchedule = () => {
    setScheduleAt(toLocalInput(a.scheduledFor));
    setScheduleOpen(true);
  };

  const saveSchedule = async () => {
    if (!scheduleAt) {
      toast.error("Pick a date and time");
      return;
    }
    const ts = new Date(scheduleAt).getTime();
    const saved = await run(
      "schedule",
      () =>
        schedule({
          id: assessmentId as Id<"instructorAssessments">,
          scheduledFor: ts,
        }),
      "Assessment scheduled",
    );
    if (saved !== undefined) setScheduleOpen(false);
  };

  const openFill = () => {
    setFillCount(String(Math.max(1, data.attached.length + 10)));
    setFillBloom(Object.fromEntries(BLOOM_ORDER.map((b) => [b, ""])));
    setFillDiff(Object.fromEntries(DIFFICULTY_LEVELS.map((d) => [d, ""])));
    setFillOpen(true);
  };

  const doFill = async () => {
    const bloomCounts: Record<string, number> = {};
    let anyBloom = false;
    for (const level of BLOOM_ORDER) {
      const raw = fillBloom[level];
      if (raw === "" || raw === undefined) continue;
      const n = Math.max(0, parseInt(raw, 10) || 0);
      bloomCounts[level] = n;
      if (n > 0) anyBloom = true;
    }
    const difficultyMix: Record<string, number> = {};
    let anyDiff = false;
    for (const level of DIFFICULTY_LEVELS) {
      const raw = fillDiff[level];
      if (raw === "" || raw === undefined) continue;
      const n = Math.max(0, parseInt(raw, 10) || 0);
      difficultyMix[level] = n;
      if (n > 0) anyDiff = true;
    }
    const result = await run("fill", () =>
      autoFill({
        assessmentId: assessmentId as Id<"instructorAssessments">,
        ...(anyBloom ? { bloomCounts } : { count: Math.max(1, parseInt(fillCount, 10) || 1) }),
        ...(anyDiff ? { difficultyMix } : {}),
      }),
    );
    if (result) {
      const r = result as {
        added: number;
        total: number;
        target: number;
        missing: Record<string, number>;
      };
      const short = Object.entries(r.missing ?? {});
      toast.success(
        `Added ${r.added} question${r.added === 1 ? "" : "s"} — ${r.total}/${r.target} on the paper`,
      );
      if (short.length > 0) {
        toast.warning(
          `Short on ${short
            .map(([level, n]) => `${labels(level)} (${n})`)
            .join(", ")} — add questions to the class bank.`,
        );
      }
      setFillOpen(false);
    }
  };

  const addFromBank = (q: Question) =>
    run(
      `add-${q._id}`,
      () =>
        addQuestion({
          assessmentId: assessmentId as Id<"instructorAssessments">,
          questionId: q._id as Id<"instructorQuestions">,
        }),
      "Question added",
    );

  const importAndAdd = async (card: SharedCard) => {
    if (!classId) return;
    setBusy(`import-${card._id}`);
    try {
      const res = await importShared({
        classId,
        sharedQuestionIds: [card._id as Id<"sharedQuestions">],
      });
      const qid = res.questionIds?.[0];
      if (!qid) {
        toast.error(
          res.skipped?.[0]?.reason ?? "That shared question could not be imported.",
        );
        return;
      }
      try {
        await addQuestion({
          assessmentId: assessmentId as Id<"instructorAssessments">,
          questionId: qid as Id<"instructorQuestions">,
        });
        toast.success("Imported into the class bank and added");
      } catch {
        toast.success("Imported into the class bank — attach it from the class tab");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

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
            onClick={() =>
              navigate(
                data.classInfo.id ? `/instructor/assessments/${data.classInfo.id}` : "/instructor",
              )
            }
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-sm font-bold leading-tight">Assessment details</p>
            <p className="text-xs text-muted-foreground">
              {data.classInfo.name}
              {data.classInfo.subject ? ` · ${data.classInfo.subject}` : ""} ·{" "}
              {data.classInfo.academicYear}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/instructor/reports/${data.classInfo.id}`}>
            <Button variant="outline" className="clay-press rounded-full">
              <BarChart3 className="mr-1.5 size-4" /> Class report
            </Button>
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-7 w-full max-w-6xl px-6 pb-20">
        {/* Title + status */}
        <div className="clay p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold">{a.title}</h1>
                <Badge className={cn("rounded-full", STATUS_STYLE[a.status])}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </Badge>
                <Badge className="rounded-full bg-[oklch(0.92_0.05_260)] text-[10px] font-bold text-[oklch(0.42_0.1_260)]">
                  <Sparkles className="mr-1 size-3" /> {panel}
                </Badge>
                {scheduled && (
                  <Badge className="rounded-full bg-[oklch(0.93_0.06_85)] text-[10px] font-bold text-[oklch(0.4_0.09_85)]">
                    <CalendarClock className="mr-1 size-3" /> Opens{" "}
                    {fmtDateTime(a.scheduledFor)}
                  </Badge>
                )}
              </div>
              {a.description && (
                <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                  {a.description}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {data.classInfo.instructorName} · {data.classInfo.studentCount}{" "}
                enrolled · created {fmtDate(a.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!archived && draft && (
                <Button variant="outline" size="sm" className="rounded-full" onClick={openSettings}>
                  <Pencil className="mr-1 size-3.5" /> Edit settings
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "duplicate",
                    async () => {
                      const newId = await duplicate({
                        id: assessmentId as Id<"instructorAssessments">,
                      });
                      navigate(`/instructor/assessments/${data.classInfo.id}/${newId}`);
                    },
                  )
                }
              >
                <Copy className="mr-1 size-3.5" /> Duplicate
              </Button>
              {!archived && a.status !== "closed" && (
                <Button variant="outline" size="sm" className="rounded-full" onClick={openSchedule}>
                  <CalendarClock className="mr-1 size-3.5" /> Schedule
                </Button>
              )}
              {!archived && draft && (
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={busy === "publish"}
                  onClick={() =>
                    void run(
                      "publish",
                      () =>
                        setStatus({
                          id: assessmentId as Id<"instructorAssessments">,
                          status: "published",
                        }),
                      "Published to the class",
                    )
                  }
                >
                  <Send className="mr-1 size-3.5" /> Publish
                </Button>
              )}
              {a.status === "published" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={busy === "close"}
                  onClick={() =>
                    void run(
                      "close",
                      () =>
                        setStatus({
                          id: assessmentId as Id<"instructorAssessments">,
                          status: "closed",
                        }),
                      "Assessment completed",
                    )
                  }
                >
                  <Lock className="mr-1 size-3.5" /> Close
                </Button>
              )}
              {a.status === "closed" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={busy === "reopen"}
                  onClick={() =>
                    void run(
                      "reopen",
                      () =>
                        setStatus({
                          id: assessmentId as Id<"instructorAssessments">,
                          status: "draft",
                        }),
                      "Reopened as draft",
                    )
                  }
                >
                  <RotateCcw className="mr-1 size-3.5" /> Reopen
                </Button>
              )}
              {!archived ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={busy === "archive"}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Archive this assessment? Its questions and results are kept, and it leaves the active list.",
                      )
                    )
                      return;
                    void run(
                      "archive",
                      () =>
                        archive({ id: assessmentId as Id<"instructorAssessments"> }),
                      "Assessment archived",
                    );
                  }}
                >
                  <Archive className="mr-1 size-3.5" /> Archive
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={busy === "restore"}
                  onClick={() =>
                    void run(
                      "restore",
                      () =>
                        restore({ id: assessmentId as Id<"instructorAssessments"> }),
                      "Restored as draft",
                    )
                  }
                >
                  <ArchiveRestore className="mr-1 size-3.5" /> Restore
                </Button>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              {
                label: data.selectionMode === "random" ? "Per student" : "Questions",
                value:
                  data.selectionMode === "random"
                    ? String(randomDrawTotal(a.randomCounts))
                    : String(data.attached.length),
                icon: ClipboardList,
              },
              {
                label: data.selectionMode === "adaptive" ? "Pool marks" : "Total marks",
                value:
                  data.selectionMode === "random"
                    ? "Draw-based"
                    : String(data.totalMarks),
                icon: CheckCircle2,
              },
              {
                label: "Duration",
                value: a.timeLimitMin > 0 ? `${a.timeLimitMin} min` : "Untimed",
                icon: Timer,
              },
              {
                label: "Exam date",
                value: a.scheduledFor ? fmtDateTime(a.scheduledFor) : "Not scheduled",
                icon: CalendarClock,
              },
              { label: "Enrolled", value: String(data.participation.enrolled), icon: Users },
              {
                label: "Completed",
                value: `${data.participation.completed}/${data.participation.enrolled}`,
                icon: CheckCircle2,
              },
            ].map((m) => (
              <div key={m.label} className="clay-inset rounded-2xl p-3">
                <m.icon className="size-3.5 text-muted-foreground" />
                <p className="mt-1.5 truncate text-sm font-extrabold tabular-nums">
                  {m.value}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {m.label}
                </p>
              </div>
            ))}
          </div>

          {/* Distributions */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="clay-inset rounded-2xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Bloom's taxonomy distribution
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.bloomDistribution.map((b) => (
                  <span
                    key={b.level}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-bold",
                      BLOOM_BADGE[b.level] ?? "bg-muted text-foreground",
                    )}
                  >
                    {labels(b.level)} {b.count}
                  </span>
                ))}
              </div>
            </div>
            <div className="clay-inset rounded-2xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Difficulty distribution
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.difficultyDistribution.map((d) => (
                  <span
                    key={d.level}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-bold",
                      DIFFICULTY_META[d.level].badge,
                    )}
                  >
                    {DIFFICULTY_META[d.level].label} {d.count}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Mode explainer */}
        <div className="clay-inset mt-4 rounded-2xl p-4 text-xs text-muted-foreground">
          {data.selectionMode === "adaptive" && (
            <>
              Adaptive paper: the pool holds {data.questions.length} questions
              {a.poolSize ? ` (configured pool ${a.poolSize})` : ""}. Each student
              answers {a.displayCount ?? a.poolSize ?? data.questions.length} of them,
              chosen one at a time by the Bloom ladder.
            </>
          )}
          {data.selectionMode === "static" && (
            <>
              Static paper: every student answers the same {data.attached.length}{" "}
              question{data.attached.length === 1 ? "" : "s"} in your order.
            </>
          )}
          {data.selectionMode === "random" && (
            <>
              Random paper: each student receives a fresh draw of{" "}
              {randomDrawTotal(a.randomCounts)} questions from the{" "}
              {data.poolFromBank
                ? `whole class bank (${data.questions.length} available)`
                : `${data.questions.length}-question curated pool`}
              , distributed per Bloom level.
            </>
          )}
          {data.selectionMode === "final" && (
            <>
              {FAIR_ADAPTIVE_LABEL} final: {FAIR_ADAPTIVE_BLURB} The shared set holds{" "}
              {data.attached.length} question{data.attached.length === 1 ? "" : "s"}.
            </>
          )}
        </div>

        {/* Questions */}
        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              Questions
              <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                {data.attached.length}
              </Badge>
            </h2>
            <p className="text-xs text-muted-foreground">
              {draft
                ? "Add questions from this class's bank or the shared bank, or fill automatically."
                : "This paper is live — questions are locked to protect student results."}
            </p>
          </div>
          {draft && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="clay-press rounded-full border-primary/40 text-primary"
                onClick={openFill}
              >
                <Sparkles className="mr-1.5 size-4" /> Fill automatically
              </Button>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qSearch}
              onChange={(e) => setQSearch(e.target.value)}
              placeholder="Search questions, answers, explanations…"
              className="clay-inset h-9 rounded-full pl-9"
            />
          </div>
          <Select value={qBloom} onValueChange={setQBloom}>
            <SelectTrigger className="clay-inset h-9 w-40 rounded-full px-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Bloom levels</SelectItem>
              {BLOOM_ORDER.map((b) => (
                <SelectItem key={b} value={b}>
                  {labels(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={qDiff} onValueChange={setQDiff}>
            <SelectTrigger className="clay-inset h-9 w-36 rounded-full px-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All difficulties</SelectItem>
              {DIFFICULTY_LEVELS.map((d) => (
                <SelectItem key={d} value={d}>
                  {DIFFICULTY_META[d].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={qType} onValueChange={setQType}>
            <SelectTrigger className="clay-inset h-9 w-44 rounded-full px-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All question types</SelectItem>
              {(taxonomy?.types ?? []).map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 space-y-2.5">
          {data.attached.length === 0 ? (
            <div className="clay p-8 text-center text-sm text-muted-foreground">
              No questions on this paper yet.
              {draft ? " Add some from the bank below." : ""}
            </div>
          ) : filteredQuestions.length === 0 ? (
            <div className="clay p-6 text-center text-sm text-muted-foreground">
              No questions match these filters.
            </div>
          ) : (
            filteredQuestions.map((q, i) => (
              <div key={q._id} className="clay p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="clay-inset flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{q.questionText}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                          {typeLabelOf(q)}
                        </Badge>
                        {data.classInfo.subject && (
                          <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                            {data.classInfo.subject}
                          </Badge>
                        )}
                        <Badge
                          className={cn(
                            "rounded-full text-[10px]",
                            BLOOM_BADGE[q.bloomLevel] ?? "bg-muted",
                          )}
                        >
                          {labels(q.bloomLevel)}
                        </Badge>
                        <Badge
                          className={cn(
                            "rounded-full text-[10px]",
                            DIFFICULTY_META[resolveDifficulty(q)].badge,
                          )}
                        >
                          {DIFFICULTY_META[resolveDifficulty(q)].label}
                        </Badge>
                        {categoryNameOf(q.categoryId) && (
                          <Badge className="rounded-full bg-[var(--accent)] text-[10px] font-bold text-muted-foreground">
                            {categoryNameOf(q.categoryId)}
                          </Badge>
                        )}
                        {topicNameOf(q) && (
                          <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                            {topicNameOf(q)}
                          </Badge>
                        )}
                        <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                          {q.marks} mark{q.marks === 1 ? "" : "s"}
                        </Badge>
                        <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                          <Clock className="mr-1 size-3" /> {q.expectedTimeSec}s
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {draft && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 rounded-full text-destructive hover:bg-destructive/10"
                      disabled={busy === `rm-${q._id}`}
                      onClick={() =>
                        void run(
                          `rm-${q._id}`,
                          () =>
                            removeQuestion({
                              assessmentId: assessmentId as Id<"instructorAssessments">,
                              questionId: q._id as Id<"instructorQuestions">,
                            }),
                          "Removed from the paper",
                        )
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                {q.options && q.options.length > 0 && (
                  <div className="mt-2.5 grid gap-1 sm:grid-cols-2">
                    {q.options.map((opt, oi) => {
                      const correct = opt.trim() === q.correctAnswer.trim();
                      return (
                        <div
                          key={oi}
                          className={cn(
                            "rounded-xl px-3 py-1.5 text-xs",
                            correct
                              ? "bg-[oklch(0.72_0.14_145)]/15 font-semibold text-[oklch(0.38_0.1_145)]"
                              : "clay-inset text-muted-foreground",
                          )}
                        >
                          <span className="mr-1.5 font-bold uppercase opacity-60">
                            {String.fromCharCode(65 + oi)}.
                          </span>
                          {opt}
                          {correct && <CheckCircle2 className="ml-1.5 inline size-3" />}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2 text-xs">
                  <span className="font-semibold text-muted-foreground">Answer: </span>
                  <span className="font-semibold">{q.correctAnswer}</span>
                </p>
                {q.explanation && (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    {q.explanation}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add questions */}
        {draft && (
          <div className="mt-9">
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <Plus className="size-5 text-primary" /> Add questions
            </h2>
            <p className="text-xs text-muted-foreground">
              Only this class's bank and shared questions matching this class's
              subject are available.
            </p>

            <div className="mt-3 flex gap-1.5">
              {(
                [
                  { id: "class", label: `Class bank (${bank?.length ?? 0})` },
                  { id: "shared", label: "Shared bank" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPickerTab(t.id)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-bold transition-colors",
                    pickerTab === t.id
                      ? "bg-primary text-primary-foreground"
                      : "clay-inset text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {pickerTab === "class" ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-48 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      placeholder="Search the class bank…"
                      className="clay-inset h-9 rounded-full pl-9"
                    />
                  </div>
                  <Select
                    value={bankCategory}
                    onValueChange={(v) => {
                      setBankCategory(v);
                      setBankTopic("all");
                    }}
                  >
                    <SelectTrigger className="clay-inset h-9 w-40 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {(taxonomy?.categories ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={bankTopic} onValueChange={setBankTopic}>
                    <SelectTrigger className="clay-inset h-9 w-36 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All topics</SelectItem>
                      {bankTopics.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={bankType} onValueChange={setBankType}>
                    <SelectTrigger className="clay-inset h-9 w-40 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {(taxonomy?.types ?? []).map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={bankBloom} onValueChange={setBankBloom}>
                    <SelectTrigger className="clay-inset h-9 w-36 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Bloom</SelectItem>
                      {BLOOM_ORDER.map((b) => (
                        <SelectItem key={b} value={b}>
                          {labels(b)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={bankDiff} onValueChange={setBankDiff}>
                    <SelectTrigger className="clay-inset h-9 w-32 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All levels</SelectItem>
                      {DIFFICULTY_LEVELS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {DIFFICULTY_META[d].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={bankShare}
                    onValueChange={(v) => setBankShare(v as "all" | "private" | "shared")}
                  >
                    <SelectTrigger className="clay-inset h-9 w-36 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any status</SelectItem>
                      <SelectItem value="shared">Shared</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {bank === undefined ? (
                  <div className="clay mt-3 p-6 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredBank.length === 0 ? (
                  <div className="clay mt-3 p-6 text-center text-sm text-muted-foreground">
                    {bank.length === 0
                      ? "This class's bank is empty — create questions in the workspace first."
                      : "No unattached questions match these filters."}
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2">
                    {filteredBank.map((q) => (
                      <div
                        key={q._id}
                        className="clay flex items-start justify-between gap-3 p-4"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{q.questionText}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                              {typeLabelOf(q)}
                            </Badge>
                            <Badge
                              className={cn(
                                "rounded-full text-[10px]",
                                BLOOM_BADGE[q.bloomLevel] ?? "bg-muted",
                              )}
                            >
                              {labels(q.bloomLevel)}
                            </Badge>
                            <Badge
                              className={cn(
                                "rounded-full text-[10px]",
                                DIFFICULTY_META[resolveDifficulty(q)].badge,
                              )}
                            >
                              {DIFFICULTY_META[resolveDifficulty(q)].label}
                            </Badge>
                            <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                              {q.marks} mark{q.marks === 1 ? "" : "s"}
                            </Badge>
                            {q.sharedQuestionId && (
                              <Badge className="rounded-full bg-[oklch(0.9_0.06_25)] text-[10px] font-bold text-[oklch(0.35_0.08_25)]">
                                Shared import
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="shrink-0 rounded-full"
                          disabled={busy === `add-${q._id}`}
                          onClick={() => void addFromBank(q)}
                        >
                          <Plus className="mr-1 size-3.5" /> Add
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-48 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={sharedSearch}
                      onChange={(e) => setSharedSearch(e.target.value)}
                      placeholder="Search the shared bank…"
                      className="clay-inset h-9 rounded-full pl-9"
                    />
                  </div>
                  <Select
                    value={sharedCategory}
                    onValueChange={(v) => {
                      setSharedCategory(v);
                      setSharedTopic("all");
                    }}
                  >
                    <SelectTrigger className="clay-inset h-9 w-40 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {(shared?.categories ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sharedTopic} onValueChange={setSharedTopic}>
                    <SelectTrigger className="clay-inset h-9 w-36 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All topics</SelectItem>
                      {sharedTopics.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sharedType} onValueChange={setSharedType}>
                    <SelectTrigger className="clay-inset h-9 w-40 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {(shared?.types ?? []).map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sharedBloom} onValueChange={setSharedBloom}>
                    <SelectTrigger className="clay-inset h-9 w-36 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Bloom</SelectItem>
                      {BLOOM_ORDER.map((b) => (
                        <SelectItem key={b} value={b}>
                          {labels(b)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sharedDiff} onValueChange={setSharedDiff}>
                    <SelectTrigger className="clay-inset h-9 w-32 rounded-full px-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All levels</SelectItem>
                      {DIFFICULTY_LEVELS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {DIFFICULTY_META[d].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {shared === undefined ? (
                  <div className="clay mt-3 p-6 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !shared || shared.questions.length === 0 ? (
                  <div className="clay mt-3 p-6 text-center text-sm text-muted-foreground">
                    No shared questions match this class's subject and filters.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2">
                    {shared.questions.map((card) => {
                      const alreadyAttached = (data.attached ?? []).some(
                        (q) => q.sharedQuestionId === card._id,
                      );
                      return (
                        <div
                          key={card._id}
                          className="clay flex items-start justify-between gap-3 p-4"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{card.questionText}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                                {card.typeLabel}
                              </Badge>
                              <Badge
                                className={cn(
                                  "rounded-full text-[10px]",
                                  BLOOM_BADGE[card.bloomLevel] ?? "bg-muted",
                                )}
                              >
                                {labels(card.bloomLevel)}
                              </Badge>
                              {card.difficultyLevel && (
                                <Badge
                                  className={cn(
                                    "rounded-full text-[10px]",
                                    DIFFICULTY_META[card.difficultyLevel].badge,
                                  )}
                                >
                                  {DIFFICULTY_META[card.difficultyLevel].label}
                                </Badge>
                              )}
                              <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                                {card.subject}
                                {card.topic ? ` · ${card.topic}` : ""}
                              </Badge>
                              <Badge className="clay-inset rounded-full text-[10px] text-muted-foreground">
                                by {card.ownerName}
                              </Badge>
                              <Badge className="clay-inset rounded-full text-[10px] text-foreground">
                                {card.marks} mark{card.marks === 1 ? "" : "s"}
                              </Badge>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={alreadyAttached ? "outline" : "default"}
                            className="shrink-0 rounded-full"
                            disabled={busy === `import-${card._id}` || alreadyAttached}
                            onClick={() => void importAndAdd(card)}
                          >
                            {alreadyAttached ? (
                              <>
                                <CheckCircle2 className="mr-1 size-3.5" /> Added
                              </>
                            ) : (
                              <>
                                <Plus className="mr-1 size-3.5" /> Import & add
                              </>
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Participation */}
        <div className="mt-9">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Users className="size-5 text-primary" /> Student participation
          </h2>
          <p className="text-xs text-muted-foreground">
            Everyone enrolled in {data.classInfo.name}. Grades come from the
            assessment's submitted attempts.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Enrolled", value: results?.stats.rosterSize ?? data.participation.enrolled },
              { label: "Not started", value: results?.stats.notStarted ?? data.participation.notStarted },
              { label: "In progress", value: results?.stats.inProgress ?? data.participation.inProgress },
              { label: "Completed", value: results?.stats.completed ?? data.participation.completed },
              { label: "Passed", value: results?.stats.passed ?? data.participation.passed },
              { label: "Failed", value: results?.stats.failed ?? data.participation.failed },
            ].map((s) => (
              <div key={s.label} className="clay p-3 text-center">
                <p className="text-lg font-extrabold tabular-nums">{s.value}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          <div className="clay mt-3 overflow-hidden p-2">
            {results === undefined ? (
              <div className="p-8 text-center">
                <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
              </div>
            ) : results === null ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Participation data is unavailable.
              </p>
            ) : results.rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No students are enrolled yet.
              </p>
            ) : (
              <div className="divide-y">
                {results.rows.map((r) => (
                  <div
                    key={r.studentId}
                    className="flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.studentName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.status === null
                          ? "Not started"
                          : r.status === "in_progress"
                            ? "Taking the assessment now"
                            : "Submitted"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.grade && (
                        <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {r.grade}
                        </span>
                      )}
                      {r.passed !== null && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            r.passed
                              ? "bg-[oklch(0.72_0.14_145)]/15 text-[oklch(0.38_0.1_145)]"
                              : "bg-destructive/10 text-destructive",
                          )}
                        >
                          {r.passed ? "Pass" : "Fail"}
                        </span>
                      )}
                      <span className="w-24 text-right font-bold tabular-nums">
                        {r.score !== null && r.maxScore !== null
                          ? `${r.score}/${r.maxScore}`
                          : "—"}
                      </span>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                        {r.percentage === null ? "" : `${Math.round(r.percentage)}%`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/instructor/results-analysis/${data.classInfo.id}`}>
              <Button variant="outline" className="rounded-full">
                <BarChart3 className="mr-1.5 size-4" /> Detailed results analysis
              </Button>
            </Link>
            <Link to={`/instructor/reports/${data.classInfo.id}`}>
              <Button variant="outline" className="rounded-full">
                <Flag className="mr-1.5 size-4" /> Class performance report
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assessment settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Title</Label>
              <Input value={sTitle} onChange={(e) => setSTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                value={sDesc}
                onChange={(e) => setSDesc(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Duration (minutes, 0 = untimed)</Label>
              <Input
                type="number"
                min={0}
                value={sTime}
                onChange={(e) => setSTime(e.target.value)}
              />
            </div>
            {data.selectionMode === "adaptive" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Pool size</Label>
                  <Input
                    type="number"
                    min={18}
                    value={sPool}
                    onChange={(e) => setSPool(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold">Displayed</Label>
                  <Input
                    type="number"
                    min={1}
                    value={sDisplay}
                    onChange={(e) => setSDisplay(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy === "settings"}
              onClick={() => void saveSettings()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="clay border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule this assessment</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Students see it on their list, but cannot start until the window opens.
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
              disabled={busy === "clear-schedule"}
              onClick={() =>
                void run(
                  "clear-schedule",
                  async () => {
                    await schedule({
                      id: assessmentId as Id<"instructorAssessments">,
                      scheduledFor: null,
                    });
                  },
                  "Schedule cleared — opens immediately",
                ).then(() => setScheduleOpen(false))
              }
            >
              Clear schedule
            </Button>
            <Button
              className="rounded-full"
              disabled={busy === "schedule"}
              onClick={() => void saveSchedule()}
            >
              Save schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fill automatically dialog */}
      <Dialog open={fillOpen} onOpenChange={setFillOpen}>
        <DialogContent className="clay max-h-[85vh] overflow-y-auto border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Fill automatically</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Picks unattached questions from this class's bank. Existing questions stay,
            and nothing is added twice.
          </p>
          <div className="mt-2 grid gap-1.5">
            <Label className="text-xs font-semibold">
              Total questions on the paper
            </Label>
            <Input
              type="number"
              min={1}
              value={fillCount}
              onChange={(e) => setFillCount(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Used when no per-level counts are set below.
            </p>
          </div>
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Per Bloom level (optional)
            </p>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {BLOOM_ORDER.map((b) => (
                <div key={b} className="grid gap-1">
                  <Label className="text-[11px] font-medium">{labels(b)}</Label>
                  <Input
                    className="h-8"
                    type="number"
                    min={0}
                    placeholder="—"
                    value={fillBloom[b] ?? ""}
                    onChange={(e) =>
                      setFillBloom((prev) => ({ ...prev, [b]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Difficulty mix (optional weights)
            </p>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {DIFFICULTY_LEVELS.map((d) => (
                <div key={d} className="grid gap-1">
                  <Label className="text-[11px] font-medium">
                    {DIFFICULTY_META[d].label}
                  </Label>
                  <Input
                    className="h-8"
                    type="number"
                    min={0}
                    placeholder="—"
                    value={fillDiff[d] ?? ""}
                    onChange={(e) =>
                      setFillDiff((prev) => ({ ...prev, [d]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setFillOpen(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy === "fill"}
              onClick={() => void doFill()}
            >
              <Sparkles className="mr-1 size-4" /> Fill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** Total questions drawn per student for a random paper. */
function randomDrawTotal(counts: Record<string, number> | undefined): number {
  if (!counts) return 0;
  return Object.values(counts).reduce((sum, n) => sum + Math.max(0, n), 0);
}

import { Fragment, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "convex/react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Brain,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Lightbulb,
  Loader2,
  Minus,
  Printer,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Mode = "static" | "adaptive";
type Risk = "at_risk" | "watch" | "on_track" | "no_data";

type GroupStats = {
  assessments: number;
  submissions: number;
  participants: number;
  participationRate: number | null;
  completionRate: number | null;
  avgPct: number | null;
  medianPct: number | null;
  passRate: number | null;
  highest: number | null;
  lowest: number | null;
  avgDurationMin: number | null;
  passed: number;
  failed: number;
  gradeMix: Record<string, number>;
};

type BloomRow = {
  bloom: string;
  label: string;
  pct: number | null;
  answers: number;
  students: number;
};

type Report = {
  generatedAt: number;
  class: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    instructor: string;
    rosterSize: number;
  };
  totals: GroupStats & {
    assessments: number;
    staticAssessments: number;
    adaptiveAssessments: number;
    drafts: number;
    activeStudents: number;
    atRisk: number;
    watch: number;
    noData: number;
    proctoringFlags: number;
    classImprovement: number | null;
  };
  static: GroupStats;
  adaptive: GroupStats;
  comparison: {
    avgDelta: number | null;
    passDelta: number | null;
    participationDelta: number | null;
    bloom: Array<{
      bloom: string;
      label: string;
      staticPct: number | null;
      adaptivePct: number | null;
      delta: number | null;
    }>;
    gradeMix: Array<{ grade: string; static: number; adaptive: number }>;
  };
  bloom: { combined: BloomRow[]; static: BloomRow[]; adaptive: BloomRow[] };
  assessments: Array<{
    id: string;
    title: string;
    type: Mode;
    selectionMode: string;
    status: string;
    questionCount: number;
    maxMarks: number;
    participants: number;
    submitted: number;
    expected: number;
    avgPct: number | null;
    passRate: number | null;
    highest: number | null;
    lowest: number | null;
    avgDurationMin: number | null;
    at: number;
  }>;
  students: Array<{
    id: string;
    name: string;
    email: string | null;
    attempts: number;
    staticAttempts: number;
    adaptiveAttempts: number;
    staticAvg: number | null;
    adaptiveAvg: number | null;
    overallAvg: number | null;
    delta: number | null;
    passRate: number | null;
    bestPct: number | null;
    lastPct: number | null;
    improvement: number | null;
    grade: string | null;
    risk: Risk;
    missingCount: number;
    missingAssessments: string[];
    violations: number;
    terminated: boolean;
    bloom: Array<{ bloom: string; label: string; pct: number | null }>;
    trend: Array<{ title: string; at: number; pct: number; type: Mode }>;
  }>;
  progress: Array<{
    label: string;
    at: number;
    type: Mode;
    avgPct: number | null;
    passRate: number | null;
    participants: number;
  }>;
  analysis: {
    headline: string;
    narrative: string;
    status: "on_track" | "watch" | "critical" | "no_data";
    strengths: Array<{ title: string; detail: string }>;
    weaknesses: Array<{ title: string; detail: string }>;
    gaps: Array<{ title: string; detail: string; severity: string }>;
    recommendations: Array<{ title: string; detail: string }>;
  };
};

const STATIC_COLOR = "var(--color-chart-2)";
const ADAPTIVE_COLOR = "var(--primary)";

const fmt = (v: number | null, suffix = "%") =>
  v === null ? "—" : `${v}${suffix}`;

const MODE_META: Record<Mode, { label: string; color: string; blurb: string }> = {
  static: {
    label: "Static",
    color: STATIC_COLOR,
    blurb: "Traditional fixed papers — no adaptive model",
  },
  adaptive: {
    label: "Adaptive",
    color: ADAPTIVE_COLOR,
    blurb: "AI/IRT model — personalised Bloom ladder",
  },
};

const RISK_META: Record<
  Risk,
  { label: string; className: string }
> = {
  at_risk: {
    label: "At risk",
    className: "bg-[oklch(0.93_0.05_25)] text-[oklch(0.45_0.16_25)]",
  },
  watch: {
    label: "Watch",
    className: "bg-[oklch(0.94_0.07_85)] text-[oklch(0.45_0.09_85)]",
  },
  on_track: {
    label: "On track",
    className: "bg-[oklch(0.93_0.06_150)] text-[oklch(0.42_0.1_150)]",
  },
  no_data: {
    label: "No data",
    className: "bg-[var(--accent)] text-muted-foreground",
  },
};

function Delta({
  value,
  suffix = " pp",
  invert = false,
}: {
  value: number | null;
  suffix?: string;
  /** When true, a positive value is a negative signal (e.g. risk counts). */
  invert?: boolean;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const good = invert ? value < 0 : value > 0;
  const bad = invert ? value > 0 : value < 0;
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-bold tabular-nums",
        good && "text-[oklch(0.45_0.13_150)]",
        bad && "text-destructive",
        value === 0 && "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {value > 0 ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="clay p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon && <Icon className="size-4 text-primary" />}
      </div>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function GroupCard({
  mode,
  stats,
}: {
  mode: Mode;
  stats: GroupStats;
}) {
  const meta = MODE_META[mode];
  const Icon = mode === "static" ? ClipboardList : Sparkles;
  const hasData = stats.submissions > 0;
  return (
    <div className="clay p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-extrabold">
            <span
              className="flex size-8 items-center justify-center rounded-full"
              style={{
                background: `color-mix(in oklch, ${meta.color} 16%, transparent)`,
              }}
            >
              <Icon className="size-4" style={{ color: meta.color }} />
            </span>
            {meta.label} assessments
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.blurb}</p>
        </div>
        <Badge className="clay-inset rounded-full text-[10px] text-foreground">
          {stats.assessments} exam{stats.assessments === 1 ? "" : "s"}
        </Badge>
      </div>

      {!hasData ? (
        <p className="clay-inset mt-4 rounded-2xl p-4 text-center text-xs text-muted-foreground">
          No graded {meta.label.toLowerCase()} submissions yet.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            <div className="clay-inset rounded-2xl p-2.5">
              <p className="text-lg font-extrabold tabular-nums">
                {fmt(stats.avgPct)}
              </p>
              <p className="text-[9px] font-semibold uppercase text-muted-foreground">
                Average
              </p>
            </div>
            <div className="clay-inset rounded-2xl p-2.5">
              <p className="text-lg font-extrabold tabular-nums">
                {fmt(stats.passRate)}
              </p>
              <p className="text-[9px] font-semibold uppercase text-muted-foreground">
                Pass rate
              </p>
            </div>
            <div className="clay-inset rounded-2xl p-2.5">
              <p className="text-lg font-extrabold tabular-nums">
                {stats.submissions}
              </p>
              <p className="text-[9px] font-semibold uppercase text-muted-foreground">
                Submissions
              </p>
            </div>
            <div className="clay-inset rounded-2xl p-2.5">
              <p className="text-lg font-extrabold tabular-nums">
                {stats.participants}
              </p>
              <p className="text-[9px] font-semibold uppercase text-muted-foreground">
                Students
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            <p className="flex justify-between">
              <span>Highest / lowest</span>
              <span className="font-bold text-foreground">
                {fmt(stats.highest)} / {fmt(stats.lowest)}
              </span>
            </p>
            <p className="flex justify-between">
              <span>Participation</span>
              <span className="font-bold text-foreground">
                {fmt(stats.participationRate)}
              </span>
            </p>
            <p className="flex justify-between">
              <span>Average time on paper</span>
              <span className="font-bold text-foreground">
                {fmt(stats.avgDurationMin, " min")}
              </span>
            </p>
            <p className="flex justify-between">
              <span>Passed / failed</span>
              <span className="font-bold text-foreground">
                {stats.passed} / {stats.failed}
              </span>
            </p>
          </div>

          <div className="mt-3 flex h-2 overflow-hidden rounded-full">
            {["A", "B", "C", "D", "F"].map((letter) => {
              const count = stats.gradeMix[letter] ?? 0;
              const total = Math.max(1, stats.submissions);
              const colors: Record<string, string> = {
                A: "oklch(0.62 0.12 150)",
                B: "oklch(0.66 0.11 180)",
                C: "oklch(0.72 0.1 250)",
                D: "oklch(0.76 0.11 85)",
                F: "oklch(0.62 0.16 25)",
              };
              return (
                <div
                  key={letter}
                  style={{
                    width: `${(count / total) * 100}%`,
                    background: colors[letter],
                  }}
                  title={`${letter}: ${count}`}
                />
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Grade mix A–F across {stats.submissions} submission
            {stats.submissions === 1 ? "" : "s"}
          </p>
        </>
      )}
    </div>
  );
}

export default function ClassPerformanceReport() {
  const params = useParams();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);

  const dashboard = useQuery(api.instructorPortal.getInstructorDashboard);
  const classes = dashboard?.classes ?? [];
  const classId = params.classId ?? classes[0]?.id;

  const report = useQuery(
    api.classReport.getClassPerformanceReport,
    classId ? { classId: classId as Id<"classes"> } : "skip",
  ) as unknown as Report | undefined;

  const bloomChartData = useMemo(
    () =>
      (report?.comparison.bloom ?? []).map((row) => ({
        label: row.label,
        staticPct: row.staticPct ?? undefined,
        adaptivePct: row.adaptivePct ?? undefined,
      })),
    [report],
  );

  const progressData = useMemo(
    () =>
      (report?.progress ?? []).map((p, i) => ({
        name: `#${i + 1} ${p.label.length > 16 ? `${p.label.slice(0, 15)}…` : p.label}`,
        avgPct: p.avgPct ?? 0,
        type: p.type,
        participants: p.participants,
      })),
    [report],
  );

  if (dashboard === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[8%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 pt-8">
        <div className="flex items-center gap-3">
          <Link to="/instructor">
            <Button variant="outline" size="sm" className="clay-press rounded-full">
              <ArrowLeft className="mr-1.5 size-4" /> Portal
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="clay-sm flex size-10 items-center justify-center">
              <BarChart3 className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">Class performance report</p>
              <p className="text-xs text-muted-foreground">
                Static vs adaptive results, side by side
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={classId ?? ""}
            onValueChange={(v) => navigate(`/instructor/reports/${v}`)}
          >
            <SelectTrigger className="clay-inset w-52 rounded-full px-4">
              <SelectValue placeholder="Select a class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
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
          <Button
            variant="outline"
            className="clay-press rounded-full"
            onClick={() => window.print()}
          >
            <Printer className="mr-1.5 size-4" /> Print / PDF
          </Button>
        </div>
      </header>

      {classes.length === 0 ? (
        <section className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-6">
          <div className="clay p-10 text-center">
            <GraduationCap className="mx-auto size-8 text-primary" />
            <p className="mt-3 font-bold">No classes yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a class in the instructor portal, add students, and publish
              assessments to populate this report.
            </p>
            <Link to="/instructor" className="mt-4 inline-block">
              <Button className="clay-press rounded-full">Open portal</Button>
            </Link>
          </div>
        </section>
      ) : report === undefined ? (
        <section className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-6">
          <div className="clay flex items-center justify-center p-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </section>
      ) : (
        <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl space-y-6 px-6 pb-16">
          {/* Report hero */}
          <div className="clay p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-extrabold">{report.class.name}</h1>
                  <Badge className="clay-inset rounded-full text-[10px] uppercase text-foreground">
                    {report.class.status}
                  </Badge>
                  <Badge
                    className={cn(
                      "rounded-full text-[10px] font-bold uppercase",
                      report.analysis.status === "critical" &&
                        "bg-[oklch(0.93_0.05_25)] text-[oklch(0.45_0.16_25)]",
                      report.analysis.status === "watch" &&
                        "bg-[oklch(0.94_0.07_85)] text-[oklch(0.45_0.09_85)]",
                      report.analysis.status === "on_track" &&
                        "bg-[oklch(0.93_0.06_150)] text-[oklch(0.42_0.1_150)]",
                      report.analysis.status === "no_data" &&
                        "bg-[var(--accent)] text-muted-foreground",
                    )}
                  >
                    {report.analysis.status.replace("_", " ")}
                  </Badge>
                </div>
                {report.class.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {report.class.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.class.rosterSize} students · {report.totals.assessments}{" "}
                  published assessments ({report.totals.staticAssessments} static,{" "}
                  {report.totals.adaptiveAssessments} adaptive) · generated{" "}
                  {new Date(report.generatedAt).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-extrabold tabular-nums">
                  {fmt(report.totals.avgPct)}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Class average
                </p>
              </div>
            </div>
            <p className="mt-4 rounded-2xl bg-[var(--accent)]/60 p-3 text-sm leading-relaxed">
              {report.analysis.narrative}
            </p>
          </div>

          {/* Key analytics */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat
              label="Class average"
              value={fmt(report.totals.avgPct)}
              hint={`median ${fmt(report.totals.medianPct)}`}
              icon={TrendingUp}
            />
            <Stat
              label="Pass rate"
              value={fmt(report.totals.passRate)}
              hint={`${report.totals.passed} passed · ${report.totals.failed} failed`}
              icon={CheckCircle2}
            />
            <Stat
              label="Graded submissions"
              value={String(report.totals.submissions)}
              hint={`${report.totals.participants}/${report.class.rosterSize} students`}
              icon={ClipboardList}
            />
            <Stat
              label="Participation"
              value={fmt(report.totals.participationRate)}
              hint={`${report.totals.noData} with no submission`}
              icon={Users}
            />
            <Stat
              label="At risk"
              value={String(report.totals.atRisk)}
              hint={`${report.totals.watch} borderline`}
              icon={TriangleAlert}
            />
            <Stat
              label="Avg improvement"
              value={fmt(report.totals.classImprovement, " pp")}
              hint="first → latest paper"
              icon={ArrowUpRight}
            />
          </div>

          {report.totals.submissions === 0 && (
            <div className="clay flex flex-col items-center gap-1 p-8 text-center">
              <Brain className="size-7 text-primary" />
              <p className="mt-2 font-bold">No graded submissions yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Publish a static paper and an adaptive set, then have students
                complete them. Every section of this report fills in from the
                stored submissions.
              </p>
            </div>
          )}

          {/* Static vs adaptive */}
          <div>
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-lg font-extrabold">Static vs adaptive</h2>
                <p className="text-xs text-muted-foreground">
                  The two assessment types are scored separately, on the same page.
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <GroupCard mode="static" stats={report.static} />
              <GroupCard mode="adaptive" stats={report.adaptive} />
            </div>

            <div className="clay mt-3 grid gap-3 p-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Average difference
                </p>
                <p className="mt-1 text-sm font-bold">
                  <Delta value={report.comparison.avgDelta} />{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    adaptive vs static
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Pass-rate difference
                </p>
                <p className="mt-1 text-sm font-bold">
                  <Delta value={report.comparison.passDelta} suffix=" pts" />{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    adaptive vs static
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Participation difference
                </p>
                <p className="mt-1 text-sm font-bold">
                  <Delta value={report.comparison.participationDelta} />{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    adaptive vs static
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="clay p-5 lg:col-span-3">
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
                <Brain className="size-4 text-primary" /> Bloom mastery by
                assessment type
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Share of marks earned per Bloom level, re-derived from each
                submission's own question sequence. A bar is omitted when that
                type has no tested items at the level.
              </p>
              <div className="mt-3 flex items-center gap-4 text-[10px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: STATIC_COLOR }}
                  />
                  Static
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: ADAPTIVE_COLOR }}
                  />
                  Adaptive
                </span>
              </div>
              <div className="mt-2 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bloomChartData} barGap={2}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      domain={[0, 100]}
                      unit="%"
                      width={38}
                    />
                    <RTooltip
                      formatter={(value) => `${value}%`}
                      contentStyle={{
                        borderRadius: 12,
                        fontSize: 11,
                        border: "1px solid var(--border)",
                      }}
                    />
                    <Bar dataKey="staticPct" fill={STATIC_COLOR} radius={[6, 6, 0, 0]} />
                    <Bar
                      dataKey="adaptivePct"
                      fill={ADAPTIVE_COLOR}
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="clay p-5 lg:col-span-2">
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
                <GraduationCap className="size-4 text-primary" /> Grade
                distribution
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Letter grades recorded at submission time.
              </p>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.comparison.gradeMix} barGap={2}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="grade" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      allowDecimals={false}
                      width={28}
                    />
                    <RTooltip
                      contentStyle={{
                        borderRadius: 12,
                        fontSize: 11,
                        border: "1px solid var(--border)",
                      }}
                    />
                    <Bar
                      dataKey="static"
                      fill={STATIC_COLOR}
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="adaptive"
                      fill={ADAPTIVE_COLOR}
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex items-center gap-4 text-[10px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: STATIC_COLOR }}
                  />
                  Static
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: ADAPTIVE_COLOR }}
                  />
                  Adaptive
                </span>
              </div>
            </div>
          </div>

          {/* Bloom table */}
          <div className="clay p-5">
            <h2 className="text-sm font-extrabold">Bloom level comparison</h2>
            <p className="text-[11px] text-muted-foreground">
              Class-wide mastery with the static→adaptive difference per level.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-bold">Bloom level</th>
                    <th className="pb-2 text-right font-bold">Class</th>
                    <th className="pb-2 text-right font-bold">Static</th>
                    <th className="pb-2 text-right font-bold">Adaptive</th>
                    <th className="pb-2 text-right font-bold">Difference</th>
                    <th className="pb-2 pl-4 font-bold">Mastery</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bloom.combined.map((row) => {
                    const cmp = report.comparison.bloom.find(
                      (b) => b.bloom === row.bloom,
                    );
                    return (
                      <tr key={row.bloom} className="border-t border-border/60">
                        <td className="py-2 font-semibold">{row.label}</td>
                        <td className="py-2 text-right font-bold tabular-nums">
                          {fmt(row.pct)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {fmt(cmp?.staticPct ?? null)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {fmt(cmp?.adaptivePct ?? null)}
                        </td>
                        <td className="py-2 text-right">
                          <Delta value={cmp?.delta ?? null} />
                        </td>
                        <td className="py-2 pl-4">
                          <div className="h-2 w-full min-w-24 overflow-hidden rounded-full bg-[var(--accent)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${row.pct ?? 0}%`,
                                background:
                                  (row.pct ?? 0) < 50
                                    ? "oklch(0.62 0.16 25)"
                                    : (row.pct ?? 0) < 70
                                      ? "oklch(0.76 0.12 85)"
                                      : "oklch(0.62 0.12 150)",
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Progress */}
          <div className="clay p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
              <TrendingUp className="size-4 text-primary" /> Progress over time
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Class average per assessment, in publication order. Bars are
              coloured by assessment type.
            </p>
            {progressData.length === 0 ? (
              <p className="clay-inset mt-3 rounded-2xl p-6 text-center text-xs text-muted-foreground">
                No published assessments yet.
              </p>
            ) : (
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={progressData}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9 }}
                      interval={0}
                      angle={-18}
                      textAnchor="end"
                      height={58}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      domain={[0, 100]}
                      unit="%"
                      width={38}
                    />
                    <RTooltip
                      formatter={(value) => `${value}%`}
                      contentStyle={{
                        borderRadius: 12,
                        fontSize: 11,
                        border: "1px solid var(--border)",
                      }}
                    />
                    <Bar dataKey="avgPct" radius={[6, 6, 0, 0]}>
                      {progressData.map((p, i) => (
                        <Cell
                          key={i}
                          fill={
                            p.type === "adaptive" ? ADAPTIVE_COLOR : STATIC_COLOR
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-bold">Assessment</th>
                    <th className="pb-2 font-bold">Type</th>
                    <th className="pb-2 text-right font-bold">Submitted</th>
                    <th className="pb-2 text-right font-bold">Average</th>
                    <th className="pb-2 text-right font-bold">Pass rate</th>
                    <th className="pb-2 text-right font-bold">High</th>
                    <th className="pb-2 text-right font-bold">Low</th>
                    <th className="pb-2 text-right font-bold">Time</th>
                    <th className="pb-2 text-right font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.assessments.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-6 text-center text-muted-foreground"
                      >
                        No published or closed assessments.
                      </td>
                    </tr>
                  )}
                  {[...report.assessments].reverse().map((a) => (
                    <tr key={a.id} className="border-t border-border/60">
                      <td className="max-w-[220px] truncate py-2 font-semibold">
                        {a.title}
                      </td>
                      <td className="py-2">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{
                            background: `color-mix(in oklch, ${MODE_META[a.type].color} 15%, transparent)`,
                            color: MODE_META[a.type].color,
                          }}
                        >
                          {a.type === "adaptive" ? (
                            <Sparkles className="size-3" />
                          ) : (
                            <ClipboardList className="size-3" />
                          )}
                          {MODE_META[a.type].label}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {a.submitted}/{a.expected}
                      </td>
                      <td className="py-2 text-right font-bold tabular-nums">
                        {fmt(a.avgPct)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {fmt(a.passRate)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {fmt(a.highest)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {fmt(a.lowest)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {fmt(a.avgDurationMin, "m")}
                      </td>
                      <td className="py-2 text-right capitalize text-muted-foreground">
                        {a.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Students */}
          <div className="clay p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
                  <Users className="size-4 text-primary" /> Student performance
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Static and adaptive averages are kept apart; expand a student
                  for their Bloom profile and paper history.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-semibold text-muted-foreground">
                {(["at_risk", "watch", "on_track", "no_data"] as Risk[]).map(
                  (r) => (
                    <span key={r} className="flex items-center gap-1">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          r === "at_risk" && "bg-[oklch(0.62_0.16_25)]",
                          r === "watch" && "bg-[oklch(0.76_0.12_85)]",
                          r === "on_track" && "bg-[oklch(0.62_0.12_150)]",
                          r === "no_data" && "bg-muted-foreground/40",
                        )}
                      />
                      {RISK_META[r].label}
                    </span>
                  ),
                )}
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-bold">Student</th>
                    <th className="pb-2 text-right font-bold">Static</th>
                    <th className="pb-2 text-right font-bold">Adaptive</th>
                    <th className="pb-2 text-right font-bold">Overall</th>
                    <th className="pb-2 text-right font-bold">A−S</th>
                    <th className="pb-2 text-right font-bold">Pass rate</th>
                    <th className="pb-2 text-right font-bold">Latest</th>
                    <th className="pb-2 text-right font-bold">Grade</th>
                    <th className="pb-2 text-right font-bold">Missing</th>
                    <th className="pb-2 pl-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.students.length === 0 && (
                    <tr>
                      <td
                        colSpan={10}
                        className="py-6 text-center text-muted-foreground"
                      >
                        No students enrolled yet.
                      </td>
                    </tr>
                  )}
                  {report.students.map((s) => {
                    const open = expanded === s.id;
                    return (
                      <Fragment key={s.id}>
                        <tr
                          className={cn(
                            "cursor-pointer border-t border-border/60 transition-colors hover:bg-[var(--accent)]/40",
                            s.risk === "at_risk" && "bg-destructive/5",
                          )}
                          onClick={() => setExpanded(open ? null : s.id)}
                        >
                          <td className="py-2">
                            <p className="flex items-center gap-1.5 font-semibold">
                              {s.name}
                              {s.terminated && (
                                <TriangleAlert className="size-3 text-destructive" />
                              )}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {s.attempts} submission{s.attempts === 1 ? "" : "s"}
                              {s.staticAttempts > 0 &&
                                ` · ${s.staticAttempts} static`}
                              {s.adaptiveAttempts > 0 &&
                                ` · ${s.adaptiveAttempts} adaptive`}
                              {s.violations > 0 &&
                                ` · ${s.violations} proctor flag${s.violations === 1 ? "" : "s"}`}
                            </p>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {fmt(s.staticAvg)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {fmt(s.adaptiveAvg)}
                          </td>
                          <td className="py-2 text-right font-bold tabular-nums">
                            {fmt(s.overallAvg)}
                          </td>
                          <td className="py-2 text-right">
                            <Delta value={s.delta} suffix="" />
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {fmt(s.passRate)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {fmt(s.lastPct)}
                          </td>
                          <td className="py-2 text-right font-bold">
                            {s.grade ?? "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {s.missingCount > 0 ? s.missingCount : "—"}
                          </td>
                          <td className="py-2 pl-3">
                            <span
                              className={cn(
                                "inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                                RISK_META[s.risk].className,
                              )}
                            >
                              {RISK_META[s.risk].label}
                            </span>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-t border-border/40">
                            <td colSpan={10} className="bg-[var(--accent)]/25 px-3 py-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                    Bloom mastery
                                  </p>
                                  <div className="mt-2 space-y-1.5">
                                    {s.bloom.map((b) => (
                                      <div
                                        key={b.bloom}
                                        className="flex items-center gap-2"
                                      >
                                        <span className="w-20 text-[11px] text-muted-foreground">
                                          {b.label}
                                        </span>
                                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-background/60">
                                          <div
                                            className="h-full rounded-full"
                                            style={{
                                              width: `${b.pct ?? 0}%`,
                                              background:
                                                (b.pct ?? 0) < 50
                                                  ? "oklch(0.62 0.16 25)"
                                                  : (b.pct ?? 0) < 70
                                                    ? "oklch(0.76 0.12 85)"
                                                    : "oklch(0.62 0.12 150)",
                                            }}
                                          />
                                        </div>
                                        <span className="w-10 text-right text-[11px] font-bold tabular-nums">
                                          {fmt(b.pct)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                    Paper history
                                  </p>
                                  {s.trend.length === 0 ? (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      No submissions yet
                                      {s.missingAssessments.length > 0 &&
                                        ` — missing ${s.missingAssessments.slice(0, 3).join(", ")}`}
                                      .
                                    </p>
                                  ) : (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {s.trend.map((t, i) => (
                                        <span
                                          key={`${t.at}-${i}`}
                                          className="inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold"
                                          title={`${t.title} · ${new Date(t.at).toLocaleDateString()}`}
                                        >
                                          {t.type === "adaptive" ? (
                                            <Sparkles className="size-3 text-primary" />
                                          ) : (
                                            <ClipboardList className="size-3 text-muted-foreground" />
                                          )}
                                          {t.title.length > 16
                                            ? `${t.title.slice(0, 15)}…`
                                            : t.title}
                                          <span className="font-bold tabular-nums">
                                            {t.pct}%
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {s.missingAssessments.length > 0 && (
                                    <p className="mt-2 text-[10px] text-muted-foreground">
                                      Missing: {s.missingAssessments.join(", ")}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Analysis */}
          <div className="clay p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
                  <Target className="size-4 text-primary" /> Overall analysis
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Derived from this class's stored static and adaptive results.
                </p>
              </div>
              <p className="text-xs font-semibold text-muted-foreground">
                {report.analysis.headline}
              </p>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="clay-inset rounded-2xl p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[oklch(0.42_0.1_150)]">
                  <CheckCircle2 className="size-3.5" /> Strengths
                </p>
                {report.analysis.strengths.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No clear strengths above the 70% threshold yet.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {report.analysis.strengths.map((s) => (
                      <li key={s.title}>
                        <p className="text-xs font-bold">{s.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="clay-inset rounded-2xl p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[oklch(0.48_0.14_25)]">
                  <TriangleAlert className="size-3.5" /> Weaknesses
                </p>
                {report.analysis.weaknesses.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No weaknesses flagged against the 60% target band.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {report.analysis.weaknesses.map((w) => (
                      <li key={w.title}>
                        <p className="text-xs font-bold">{w.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {w.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="clay-inset rounded-2xl p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[oklch(0.45_0.1_85)]">
                  <Brain className="size-3.5" /> Learning gaps
                </p>
                {report.analysis.gaps.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No learning gaps detected — every tested Bloom level is above
                    50%.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {report.analysis.gaps.map((g) => (
                      <li key={g.title} className="flex gap-2">
                        <span
                          className="mt-1 size-2 shrink-0 rounded-full"
                          style={{
                            background:
                              g.severity === "high"
                                ? "oklch(0.62 0.16 25)"
                                : "oklch(0.76 0.12 85)",
                          }}
                        />
                        <div>
                          <p className="text-xs font-bold">{g.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {g.detail}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="clay-inset rounded-2xl p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[oklch(0.42_0.1_260)]">
                  <Lightbulb className="size-3.5" /> Recommendations
                </p>
                <ol className="mt-2 space-y-2">
                  {report.analysis.recommendations.map((r, i) => (
                    <li key={r.title} className="flex gap-2">
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-xs font-bold">{r.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          <p className="pb-4 text-center text-[10px] text-muted-foreground">
            Generated {new Date(report.generatedAt).toLocaleString()} ·{" "}
            {report.class.instructor} · {report.class.name}
          </p>
        </section>
      )}
    </main>
  );
}

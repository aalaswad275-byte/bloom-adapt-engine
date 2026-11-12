/**
 * Admin Performance Dashboard — assessment-engine results.
 *
 * Every number, chart and ranking on this page comes from the
 * `adminPerformance.getPerformanceDashboard` query, which aggregates stored
 * `assessmentSubmissions` against their assessment, class, student and
 * instructor. Nothing is hard-coded or computed from UI-only mock data.
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Award,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Loader2,
  Minus,
  Percent,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AdminPageHeader,
  DataTable,
  ScoreBadge,
  StatCard,
  TableCell,
  TableRow,
} from "@/components/admin/kit";
import { Input } from "@/components/ui/input";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type StudentRow = {
  id: string;
  rank: number;
  name: string;
  email: string | null;
  classes: string[];
  subjects: string[];
  attempts: number;
  passed: number;
  failed: number;
  avgPct: number | null;
  bestPct: number | null;
  worstPct: number | null;
  avgMarks: number | null;
  avgOutOf: number | null;
  staticAttempts: number;
  staticPct: number | null;
  staticAvgMarks: number | null;
  staticAvgOutOf: number | null;
  adaptiveAttempts: number;
  adaptivePct: number | null;
  adaptiveAvgMarks: number | null;
  adaptiveAvgOutOf: number | null;
  deltaPct: number | null;
  marksDelta: number | null;
  percentageIncrease: number | null;
  trend: "improved" | "declined" | "stable" | "no_adaptive";
};

type Dashboard = {
  generatedAt: number;
  overview: {
    subjects: number;
    classes: number;
    instructors: number;
    enrolledStudents: number;
    assessments: number;
    assessmentsWithResults: number;
    startedAttempts: number;
    completedAttempts: number;
    completionRate: number | null;
    participants: number;
    passed: number;
    failed: number;
    passRate: number | null;
    avgPct: number | null;
    medianPct: number | null;
    highestPct: number | null;
    lowestPct: number | null;
    totalMarks: number;
    earnedMarks: number;
    answers: number;
    staticCombined: { attempts: number; avgPct: number | null; passRate: number | null };
    adaptive: { attempts: number; avgPct: number | null; passRate: number | null };
    matchedStudents: number;
    avgDeltaPct: number | null;
    avgPercentageIncrease: number | null;
    improved: number;
    declined: number;
    stable: number;
  };
  gradeDistribution: Array<{ grade: string; count: number }>;
  scoreDistribution: Array<{ band: string; count: number }>;
  subjects: Array<{
    rank: number;
    subject: string;
    classes: number;
    participants: number;
    attempts: number;
    passed: number;
    failed: number;
    avgPct: number | null;
    passRate: number | null;
    avgMarks: number;
    avgOutOf: number;
  }>;
  classes: Array<{
    rank: number;
    id: string;
    name: string;
    subject: string;
    instructor: string;
    roster: number;
    participants: number;
    attempts: number;
    passed: number;
    failed: number;
    avgPct: number | null;
    passRate: number | null;
    bestPct: number | null;
    worstPct: number | null;
    avgMarks: number;
    avgOutOf: number;
  }>;
  modes: Array<{
    mode: "static" | "random" | "adaptive" | "final";
    attempts: number;
    avgPct: number | null;
    passRate: number | null;
    avgMarks: number | null;
    avgOutOf: number | null;
  }>;
  students: StudentRow[];
  improvement: Array<{
    id: string;
    name: string;
    classes: string[];
    staticAttempts: number;
    adaptiveAttempts: number;
    staticPct: number | null;
    adaptivePct: number | null;
    deltaPct: number | null;
    marksDelta: number | null;
    percentageIncrease: number | null;
    staticAvgMarks: number | null;
    staticAvgOutOf: number | null;
    adaptiveAvgMarks: number | null;
    adaptiveAvgOutOf: number | null;
  }>;
};

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const MODE_LABELS: Record<string, string> = {
  static: "Static",
  random: "Random",
  adaptive: "Adaptive",
  final: "Fair final",
};

const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
const signedPct = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
const signedRelative = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const marks = (value: number | null, outOf: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}${outOf === null ? "" : ` / ${outOf.toFixed(1)}`}`;
const shortName = (value: string) => {
  const cleaned = value.replace(/^TEST\s*[—-]\s*/i, "");
  return cleaned.length > 18 ? `${cleaned.slice(0, 17)}…` : cleaned;
};

function ChartCard({
  title,
  hint,
  children,
  wide,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`clay p-5${wide ? " xl:col-span-2" : ""}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
        <p className="text-sm font-bold">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: StudentRow["trend"] }) {
  if (trend === "improved")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.9_0.07_145)] px-2 py-0.5 text-[11px] font-semibold text-[oklch(0.32_0.09_145)]">
        <ArrowUpRight className="size-3" /> Improved
      </span>
    );
  if (trend === "declined")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
        <ArrowDownRight className="size-3" /> Declined
      </span>
    );
  if (trend === "stable")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.93_0.06_85)] px-2 py-0.5 text-[11px] font-semibold text-[oklch(0.35_0.08_85)]">
        <Minus className="size-3" /> Stable
      </span>
    );
  return <span className="text-xs text-muted-foreground">No adaptive</span>;
}

export default function AdminPerformanceDashboard() {
  const data = useQuery(api.adminPerformance.getPerformanceDashboard) as
    | Dashboard
    | undefined;
  const [search, setSearch] = useState("");

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { overview } = data;
  const filteredStudents = data.students.filter((row) => {
    const haystack = `${row.name} ${row.email ?? ""} ${row.classes.join(" ")}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const improvementRows = data.improvement.filter((row) => row.deltaPct !== null);

  return (
    <>
      <AdminPageHeader
        title="Performance dashboard"
        subtitle="Overall scores, pass/fail rates, class and subject comparisons, and Static → Adaptive improvement — all computed from stored submissions."
      />

      {overview.completedAttempts === 0 ? (
        <div className="clay p-10 text-center text-sm text-muted-foreground">
          No completed assessment submissions yet. Results appear here as soon as
          students submit assessments.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Overall average"
              value={pct(overview.avgPct)}
              hint={`Median ${pct(overview.medianPct)}`}
              icon={<BarChart3 className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Pass rate"
              value={pct(overview.passRate)}
              hint={`${overview.passed} passed · ${overview.failed} failed`}
              icon={<CheckCircle2 className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Students assessed"
              value={overview.participants}
              hint={`${overview.enrolledStudents} enrolled`}
              icon={<GraduationCap className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Completed attempts"
              value={overview.completedAttempts}
              hint={`${pct(overview.completionRate)} completion · ${overview.answers} answers`}
              icon={<ClipboardList className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Static → Adaptive"
              value={signedPct(overview.avgDeltaPct)}
              hint={`${overview.matchedStudents} matched students`}
              icon={<TrendingUp className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Marks earned"
              value={`${overview.earnedMarks} / ${overview.totalMarks}`}
              hint={`${overview.assessmentsWithResults} assessments with results`}
              icon={<Award className="size-4 text-muted-foreground" />}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="clay flex items-center justify-between p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Static + random avg
                </p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums">
                  {pct(overview.staticCombined.avgPct)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {overview.staticCombined.attempts} attempts · {pct(overview.staticCombined.passRate)} pass · fixed papers
                </p>
              </div>
              <BarChart3 className="size-5 text-[var(--color-chart-2)]" />
            </div>
            <div className="clay flex items-center justify-between p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Adaptive average
                </p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums">
                  {pct(overview.adaptive.avgPct)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {overview.adaptive.attempts} attempts · {pct(overview.adaptive.passRate)} pass
                </p>
              </div>
              <Target className="size-5 text-[var(--color-chart-1)]" />
            </div>
            <div className="clay p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Improved / declined
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums">
                {overview.improved} <span className="text-muted-foreground">/</span>{" "}
                {overview.declined}
              </p>
              <p className="text-xs text-muted-foreground">
                {overview.stable} stable · ±5 pp threshold
              </p>
            </div>
            <div className="clay p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Average relative gain
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums">
                {signedRelative(overview.avgPercentageIncrease)}
              </p>
              <p className="text-xs text-muted-foreground">
                Adaptive vs static, matched students
              </p>
            </div>
          </div>

          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <ChartCard
              title="Subject comparison"
              hint="Average score and pass rate by subject"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.subjects} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="subject" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="avgPct" name="Average %" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="passRate" name="Pass %" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Class comparison"
              hint="Average score and pass rate by class"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.classes}
                  margin={{ top: 8, right: 8, left: -18, bottom: 22 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9 }}
                    interval={0}
                    angle={-22}
                    textAnchor="end"
                    height={58}
                    tickFormatter={shortName}
                  />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="avgPct" name="Average %" fill="var(--color-chart-3)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="passRate" name="Pass %" fill="var(--color-chart-4)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Assessment mode comparison"
              hint="Average score by selection mode"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.modes.map((row) => ({
                    name: MODE_LABELS[row.mode] ?? row.mode,
                    avgPct: row.avgPct,
                    passRate: row.passRate,
                    attempts: row.attempts,
                  }))}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="avgPct" name="Average %" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="passRate" name="Pass %" fill="var(--color-chart-5)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Grade distribution" hint="Stored grades across completed attempts">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.gradeDistribution.filter((row) => row.count > 0)}
                    dataKey="count"
                    nameKey="grade"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={3}
                  >
                    {data.gradeDistribution
                      .filter((row) => row.count > 0)
                      .map((row, index) => (
                        <Cell
                          key={row.grade}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Static → Adaptive per student"
              hint="Each point is one matched student; above the diagonal means improvement"
            >
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, left: -18, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    type="number"
                    dataKey="staticPct"
                    name="Static %"
                    domain={[0, 100]}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="adaptivePct"
                    name="Adaptive %"
                    domain={[0, 100]}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <ReferenceLine
                    segment={[
                      { x: 0, y: 0 },
                      { x: 100, y: 100 },
                    ]}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                  />
                  <Scatter data={improvementRows} fill="var(--color-chart-1)" />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Score distribution" hint="Completed attempts by score band">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.scoreDistribution} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="band" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Attempts" radius={[6, 6, 0, 0]}>
                    {data.scoreDistribution.map((row, index) => (
                      <Cell key={row.band} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">
                  Static → Adaptive improvement
                </h2>
                <p className="text-sm text-muted-foreground">
                  Matched students only. Static % covers static and random papers.
                  Marks are per-paper averages; Δ marks is normalised to the static
                  paper total and percentage gain is relative to the student's
                  static average.
                </p>
              </div>
              <span className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold">
                {improvementRows.length} matched
              </span>
            </div>
            <DataTable
              headers={[
                "Student",
                "Class",
                "Static marks",
                "Static %",
                "Adaptive marks",
                "Adaptive %",
                "Δ marks (same paper)",
                "Δ pp",
                "Relative gain",
                "Trend",
              ]}
              empty={improvementRows.length === 0}
              colSpan={10}
            >
              {improvementRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-semibold">{row.name}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-muted-foreground">
                    {row.classes.join(", ")}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {marks(row.staticAvgMarks, row.staticAvgOutOf)}
                  </TableCell>
                  <TableCell className="tabular-nums">{pct(row.staticPct)}</TableCell>
                  <TableCell className="tabular-nums">
                    {marks(row.adaptiveAvgMarks, row.adaptiveAvgOutOf)}
                  </TableCell>
                  <TableCell className="tabular-nums">{pct(row.adaptivePct)}</TableCell>
                  <TableCell
                    className={`tabular-nums font-semibold ${
                      (row.marksDelta ?? 0) > 0
                        ? "text-[oklch(0.45_0.12_145)]"
                        : (row.marksDelta ?? 0) < 0
                          ? "text-destructive"
                          : ""
                    }`}
                  >
                    {row.marksDelta === null
                      ? "—"
                      : `${row.marksDelta > 0 ? "+" : ""}${row.marksDelta.toFixed(1)}`}
                  </TableCell>
                  <TableCell
                    className={`tabular-nums font-semibold ${
                      (row.deltaPct ?? 0) > 0
                        ? "text-[oklch(0.45_0.12_145)]"
                        : (row.deltaPct ?? 0) < 0
                          ? "text-destructive"
                          : ""
                    }`}
                  >
                    {signedPct(row.deltaPct)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {signedRelative(row.percentageIncrease)}
                  </TableCell>
                  <TableCell>
                    <TrendBadge
                      trend={
                        row.deltaPct !== null && row.deltaPct >= 5
                          ? "improved"
                          : row.deltaPct !== null && row.deltaPct <= -5
                            ? "declined"
                            : "stable"
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-2">
            <div>
              <h2 className="mb-3 text-lg font-extrabold tracking-tight">
                Class ranking
              </h2>
              <DataTable
                headers={["#", "Class", "Subject", "Attempts", "Avg %", "Pass %"]}
                empty={data.classes.length === 0}
                colSpan={6}
              >
                {data.classes.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-bold tabular-nums">{row.rank}</TableCell>
                    <TableCell>
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.instructor} · {row.participants}/{row.roster} students
                      </p>
                    </TableCell>
                    <TableCell>{row.subject}</TableCell>
                    <TableCell className="tabular-nums">{row.attempts}</TableCell>
                    <TableCell>
                      <ScoreBadge pct={row.avgPct} />
                    </TableCell>
                    <TableCell className="tabular-nums">{pct(row.passRate)}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-extrabold tracking-tight">
                Subject ranking
              </h2>
              <DataTable
                headers={["#", "Subject", "Classes", "Students", "Attempts", "Avg %", "Pass %"]}
                empty={data.subjects.length === 0}
                colSpan={7}
              >
                {data.subjects.map((row) => (
                  <TableRow key={row.subject}>
                    <TableCell className="font-bold tabular-nums">{row.rank}</TableCell>
                    <TableCell className="font-semibold">{row.subject}</TableCell>
                    <TableCell className="tabular-nums">{row.classes}</TableCell>
                    <TableCell className="tabular-nums">{row.participants}</TableCell>
                    <TableCell className="tabular-nums">{row.attempts}</TableCell>
                    <TableCell>
                      <ScoreBadge pct={row.avgPct} />
                    </TableCell>
                    <TableCell className="tabular-nums">{pct(row.passRate)}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">
                  Student rankings
                </h2>
                <p className="text-sm text-muted-foreground">
                  Ranked by average percentage across every completed attempt.
                </p>
              </div>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search student, email or class…"
                className="clay-inset max-w-xs rounded-full px-4"
              />
            </div>
            <DataTable
              headers={[
                "#",
                "Student",
                "Classes",
                "Attempts",
                "Average",
                "Best",
                "Passed",
                "Failed",
                "Static %",
                "Adaptive %",
                "Δ pp",
                "Trend",
              ]}
              empty={filteredStudents.length === 0}
              colSpan={12}
            >
              {filteredStudents.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-bold tabular-nums">{row.rank}</TableCell>
                  <TableCell>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.email ?? "—"}</p>
                  </TableCell>
                  <TableCell className="max-w-[190px] truncate text-muted-foreground">
                    {row.classes.join(", ") || "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.attempts}</TableCell>
                  <TableCell>
                    <ScoreBadge pct={row.avgPct} />
                  </TableCell>
                  <TableCell className="tabular-nums">{pct(row.bestPct)}</TableCell>
                  <TableCell className="tabular-nums text-[oklch(0.45_0.12_145)]">
                    {row.passed}
                  </TableCell>
                  <TableCell className="tabular-nums text-destructive">{row.failed}</TableCell>
                  <TableCell className="tabular-nums">{pct(row.staticPct)}</TableCell>
                  <TableCell className="tabular-nums">{pct(row.adaptivePct)}</TableCell>
                  <TableCell
                    className={`tabular-nums font-semibold ${
                      (row.deltaPct ?? 0) > 0
                        ? "text-[oklch(0.45_0.12_145)]"
                        : (row.deltaPct ?? 0) < 0
                          ? "text-destructive"
                          : ""
                    }`}
                  >
                    {signedPct(row.deltaPct)}
                  </TableCell>
                  <TableCell>
                    <TrendBadge trend={row.trend} />
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </section>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Subjects"
              value={overview.subjects}
              hint="With completed results"
              icon={<ClipboardList className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Classes"
              value={overview.classes}
              hint={`${overview.instructors} instructors`}
              icon={<Users className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Assessments"
              value={`${overview.assessmentsWithResults} / ${overview.assessments}`}
              hint="With results / total"
              icon={<Percent className="size-4 text-muted-foreground" />}
            />
            <StatCard
              label="Highest / lowest"
              value={`${pct(overview.highestPct)} / ${pct(overview.lowestPct)}`}
              hint="Single attempt range"
              icon={<Award className="size-4 text-muted-foreground" />}
            />
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Live from {overview.completedAttempts} completed submissions ·{" "}
            {overview.earnedMarks.toLocaleString()} /{" "}
            {overview.totalMarks.toLocaleString()} marks · generated{" "}
            {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </>
      )}
    </>
  );
}

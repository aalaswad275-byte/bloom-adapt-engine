/**
 * Admin — Student Overall Results Dashboard.
 *
 * Every figure comes from `adminStudentResults.getStudentResultsDashboard`,
 * which deduplicates submissions by student + assessment before aggregating.
 * Filters are applied server-side so the KPIs and charts always describe the
 * same unique attempt set.
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import {
  Award,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FilterX,
  GraduationCap,
  Loader2,
  Percent,
  Target,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHeader,
  DataTable,
  ScoreBadge,
  StatCard,
  TableCell,
  TableRow,
} from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type BucketStats = {
  attempts: number;
  completed: number;
  scored: number;
  participants: number;
  passed: number;
  failed: number;
  avgPct: number | null;
  passRate: number | null;
  avgMarks: number | null;
  avgOutOf: number | null;
  finalAttempts: number;
  finalCompleted: number;
  finalPassed: number;
  finalFailed: number;
  finalAvgPct: number | null;
  finalPassRate: number | null;
};

type ClassRow = BucketStats & {
  rank: number;
  id: string;
  name: string;
  subject: string;
  instructor: string;
  roster: number;
};

type SubjectRow = BucketStats & {
  rank: number;
  subject: string;
  classes: number;
};

type StudentRow = {
  rank: number;
  id: string;
  name: string;
  email: string | null;
  classes: string[];
  subjects: string[];
  attempts: number;
  completed: number;
  passed: number;
  failed: number;
  avgPct: number | null;
  passRate: number | null;
  bestPct: number | null;
  worstPct: number | null;
  finalAttempts: number;
  finalCompleted: number;
  finalPct: number | null;
  finalPassed: number;
  finalFailed: number;
  finalPassRate: number | null;
};

type Dashboard = {
  generatedAt: number;
  filters: {
    classId: string | null;
    subject: string | null;
    mode: "all" | "final" | "standard";
    days: number;
  };
  options: {
    classes: Array<{ id: string; name: string; subject: string }>;
    subjects: string[];
  };
  overview: {
    totalAttempts: number;
    completedAttempts: number;
    inProgress: number;
    completionRate: number | null;
    participants: number;
    classes: number;
    activeClasses: number;
    subjects: number;
    activeSubjects: number;
    passed: number;
    failed: number;
    passRate: number | null;
    avgPct: number | null;
    medianPct: number | null;
    highestPct: number | null;
    lowestPct: number | null;
    earnedMarks: number;
    totalMarks: number;
    duplicatesRemoved: number;
    fairFinal: {
      attempts: number;
      completed: number;
      participants: number;
      passed: number;
      failed: number;
      passRate: number | null;
      avgPct: number | null;
    };
  };
  gradeDistribution: Array<{ grade: string; count: number }>;
  scoreDistribution: Array<{ band: string; count: number }>;
  trend: Array<{
    key: string;
    label: string;
    attempts: number;
    avgPct: number | null;
    passRate: number | null;
  }>;
  modes: Array<{
    mode: string;
    attempts: number;
    completed: number;
    avgPct: number | null;
    passRate: number | null;
  }>;
  classes: ClassRow[];
  subjects: SubjectRow[];
  students: StudentRow[];
};

const COLORS = [
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
  final: "Fair Final",
};

const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
const shortName = (value: string) => {
  const cleaned = value.replace(/^TEST\s*[—-]\s*/i, "");
  return cleaned.length > 20 ? `${cleaned.slice(0, 19)}…` : cleaned;
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

export default function StudentResultsDashboard() {
  const [subject, setSubject] = useState("all");
  const [classId, setClassId] = useState("all");
  const [mode, setMode] = useState<"all" | "final" | "standard">("all");
  const [days, setDays] = useState("0");
  const [search, setSearch] = useState("");

  const data = useQuery(api.adminStudentResults.getStudentResultsDashboard, {
    subject: subject === "all" ? undefined : subject,
    classId: classId === "all" ? undefined : (classId as Id<"classes">),
    mode,
    days: Number(days),
  }) as Dashboard | undefined;

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { overview } = data;
  const classOptions =
    subject === "all"
      ? data.options.classes
      : data.options.classes.filter((row) => row.subject === subject);
  const filteredStudents = data.students.filter((row) => {
    const haystack =
      `${row.name} ${row.email ?? ""} ${row.classes.join(" ")} ${row.subjects.join(" ")}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  const filtersActive =
    subject !== "all" || classId !== "all" || mode !== "all" || days !== "0";
  const classesWithResults = data.classes.filter((row) => row.attempts > 0);

  return (
    <>
      <AdminPageHeader
        title="Student overall results"
        subtitle="Unique examination attempts and Fair Adaptive Final results across every class — deduplicated by student and assessment."
        actions={
          <span className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            {data.overview.duplicatesRemoved} duplicate row
            {data.overview.duplicatesRemoved === 1 ? "" : "s"} excluded
          </span>
        }
      />

      <div className="clay mb-6 flex flex-wrap items-center gap-3 p-4">
        <Select
          value={subject}
          onValueChange={(value) => {
            setSubject(value);
            setClassId("all");
          }}
        >
          <SelectTrigger className="w-44 rounded-full">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subjects</SelectItem>
            {data.options.subjects.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="w-52 rounded-full">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {classOptions.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={mode}
          onValueChange={(value) =>
            setMode(value as "all" | "final" | "standard")
          }
        >
          <SelectTrigger className="w-44 rounded-full">
            <SelectValue placeholder="Exam type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All exam types</SelectItem>
            <SelectItem value="final">Fair Final only</SelectItem>
            <SelectItem value="standard">Other assessments</SelectItem>
          </SelectContent>
        </Select>

        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40 rounded-full">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">All time</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 6 months</SelectItem>
            <SelectItem value="365">Last 12 months</SelectItem>
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button
            variant="ghost"
            className="rounded-full text-muted-foreground"
            onClick={() => {
              setSubject("all");
              setClassId("all");
              setMode("all");
              setDays("0");
            }}
          >
            <FilterX className="mr-2 size-4" />
            Reset filters
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {overview.totalAttempts} unique attempt
          {overview.totalAttempts === 1 ? "" : "s"} in scope
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Total attempts"
          value={overview.totalAttempts}
          hint={`${overview.inProgress} in progress`}
          icon={<ClipboardList className="size-4 text-muted-foreground" />}
        />
        <StatCard
          label="Completed exams"
          value={overview.completedAttempts}
          hint={`${pct(overview.completionRate)} completion`}
          icon={<CheckCircle2 className="size-4 text-muted-foreground" />}
        />
        <StatCard
          label="Passed"
          value={overview.passed}
          hint="Completed, scored attempts"
          icon={<Trophy className="size-4 text-[oklch(0.55_0.12_145)]" />}
        />
        <StatCard
          label="Failed"
          value={overview.failed}
          hint="Below pass threshold"
          icon={<XCircle className="size-4 text-destructive" />}
        />
        <StatCard
          label="Combined pass rate"
          value={pct(overview.passRate)}
          hint={`${overview.passed} of ${overview.passed + overview.failed} scored`}
          icon={<Percent className="size-4 text-primary" />}
        />
        <StatCard
          label="Average performance"
          value={pct(overview.avgPct)}
          hint={`Median ${pct(overview.medianPct)}`}
          icon={<BarChart3 className="size-4 text-muted-foreground" />}
        />
        <StatCard
          label="Students assessed"
          value={overview.participants}
          hint={`${overview.activeClasses} of ${overview.classes} classes active`}
          icon={<GraduationCap className="size-4 text-muted-foreground" />}
        />
        <StatCard
          label="Fair Final pass rate"
          value={pct(overview.fairFinal.passRate)}
          hint={`${overview.fairFinal.completed} final exams completed`}
          icon={<Target className="size-4 text-muted-foreground" />}
        />
      </div>

      <section className="clay mt-6 overflow-hidden p-0">
        <div className="grid gap-0 md:grid-cols-[1.2fr_2fr]">
          <div className="bg-[var(--primary)] px-6 py-6 text-[var(--primary-foreground)]">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-80">
              <Award className="size-4" /> Fair Adaptive Final Exam
            </p>
            <p className="mt-3 text-4xl font-extrabold tabular-nums">
              {pct(overview.fairFinal.passRate)}
            </p>
            <p className="mt-1 text-sm opacity-85">
              Combined pass rate across {overview.fairFinal.completed} completed
              final exam{overview.fairFinal.completed === 1 ? "" : "s"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Final attempts</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums">
                {overview.fairFinal.attempts}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Students</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums">
                {overview.fairFinal.participants}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Average score</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums">
                {pct(overview.fairFinal.avgPct)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Passed / failed</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums">
                <span className="text-[oklch(0.45_0.12_145)]">
                  {overview.fairFinal.passed}
                </span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="text-destructive">
                  {overview.fairFinal.failed}
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {overview.totalAttempts === 0 ? (
        <div className="clay mt-6 p-10 text-center text-sm text-muted-foreground">
          No attempts match these filters. Clear the filters or wait for students
          to submit assessments.
        </div>
      ) : (
        <>
          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <ChartCard
              title="Subject comparison"
              hint="Average score and pass rate by subject"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.subjects.filter((row) => row.attempts > 0)}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="subject"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    tickFormatter={shortName}
                  />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="avgPct"
                    name="Average %"
                    fill="var(--color-chart-1)"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="passRate"
                    name="Pass %"
                    fill="var(--color-chart-2)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Class comparison"
              hint="Unique attempts by class"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={classesWithResults}
                  margin={{ top: 8, right: 8, left: -18, bottom: 26 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9 }}
                    interval={0}
                    angle={-22}
                    textAnchor="end"
                    height={62}
                    tickFormatter={shortName}
                  />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="avgPct"
                    name="Average %"
                    fill="var(--color-chart-3)"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="passRate"
                    name="Pass %"
                    fill="var(--color-chart-4)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Performance trend"
              hint="Completed, scored attempts over the last six months"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.trend}
                  margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="avgPct"
                    name="Average %"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="passRate"
                    name="Pass %"
                    stroke="var(--color-chart-2)"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Exam type comparison"
              hint="Average score and pass rate by delivery mode"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.modes.map((row) => ({
                    ...row,
                    name: MODE_LABELS[row.mode] ?? row.mode,
                  }))}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="avgPct"
                    name="Average %"
                    fill="var(--color-chart-3)"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="passRate"
                    name="Pass %"
                    fill="var(--color-chart-5)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Grade distribution"
              hint="Completed, scored unique attempts"
            >
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
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Score distribution" hint="Attempts by score band">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.scoreDistribution}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="band" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Attempts" radius={[6, 6, 0, 0]}>
                    {data.scoreDistribution.map((row, index) => (
                      <Cell
                        key={row.band}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-2">
            <div>
              <div className="mb-3">
                <h2 className="text-lg font-extrabold tracking-tight">
                  Class results
                </h2>
                <p className="text-sm text-muted-foreground">
                  Every attempt in scope, with Fair Final separated.
                </p>
              </div>
              <DataTable
                headers={[
                  "#",
                  "Class",
                  "Attempts",
                  "Completed",
                  "Avg %",
                  "Pass %",
                  "Final avg",
                  "Final pass",
                ]}
                empty={data.classes.length === 0}
                colSpan={8}
              >
                {data.classes.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-bold tabular-nums">
                      {row.rank}
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.subject} · {row.instructor}
                      </p>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.attempts}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.completed}
                    </TableCell>
                    <TableCell>
                      <ScoreBadge pct={row.avgPct} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {pct(row.passRate)}
                    </TableCell>
                    <TableCell>
                      <ScoreBadge pct={row.finalAvgPct} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {pct(row.finalPassRate)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({row.finalCompleted})
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </div>

            <div>
              <div className="mb-3">
                <h2 className="text-lg font-extrabold tracking-tight">
                  Subject results
                </h2>
                <p className="text-sm text-muted-foreground">
                  Combined pass rate and averages across each subject.
                </p>
              </div>
              <DataTable
                headers={[
                  "#",
                  "Subject",
                  "Classes",
                  "Students",
                  "Attempts",
                  "Avg %",
                  "Pass %",
                ]}
                empty={data.subjects.length === 0}
                colSpan={7}
              >
                {data.subjects.map((row) => (
                  <TableRow key={row.subject}>
                    <TableCell className="font-bold tabular-nums">
                      {row.rank}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {row.subject}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.classes}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.participants}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.attempts}</TableCell>
                    <TableCell>
                      <ScoreBadge pct={row.avgPct} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {pct(row.passRate)}
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">
                  Student overall performance
                </h2>
                <p className="text-sm text-muted-foreground">
                  One row per student, ranked by average across unique completed
                  assessments. Final exam performance is shown separately.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search student, email, class or subject…"
                  className="clay-inset w-72 max-w-full rounded-full px-4"
                />
              </div>
            </div>
            <DataTable
              headers={[
                "#",
                "Student",
                "Classes",
                "Attempts",
                "Completed",
                "Average",
                "Best",
                "Passed",
                "Failed",
                "Final result",
              ]}
              empty={filteredStudents.length === 0}
              colSpan={10}
            >
              {filteredStudents.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-bold tabular-nums">
                    {row.rank}
                  </TableCell>
                  <TableCell>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.email ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-[210px] truncate text-xs text-muted-foreground">
                    {row.classes.join(", ") || "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.attempts}</TableCell>
                  <TableCell className="tabular-nums">{row.completed}</TableCell>
                  <TableCell>
                    <ScoreBadge pct={row.avgPct} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {pct(row.bestPct)}
                  </TableCell>
                  <TableCell className="tabular-nums text-[oklch(0.45_0.12_145)]">
                    {row.passed}
                  </TableCell>
                  <TableCell className="tabular-nums text-destructive">
                    {row.failed}
                  </TableCell>
                  <TableCell>
                    {row.finalAttempts === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Not taken
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <ScoreBadge pct={row.finalPct} />
                        <span className="text-xs text-muted-foreground">
                          {row.finalPassRate === null
                            ? "—"
                            : `${row.finalPassed}/${row.finalCompleted} passed`}
                        </span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </section>

          <p className="mt-6 text-xs text-muted-foreground">
            {overview.completedAttempts} completed · {overview.participants}{" "}
            students · {overview.earnedMarks.toLocaleString()} /{" "}
            {overview.totalMarks.toLocaleString()} marks · range{" "}
            {pct(overview.lowestPct)}–{pct(overview.highestPct)} · generated{" "}
            {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </>
      )}
    </>
  );
}

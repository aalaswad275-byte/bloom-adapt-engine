import { useState } from "react";
import { useQuery } from "convex/react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ClipboardList,
  GraduationCap,
  LineChart as LineChartIcon,
  Loader2,
  Search,
  SlidersHorizontal,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Mode = "static" | "adaptive";

type AnalysisData = {
  class: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    instructor: string;
    rosterSize: number;
  };
  assessments: Array<{
    id: string;
    title: string;
    type: Mode;
    status: string;
    at: number;
  }>;
  students: Array<{
    id: string;
    name: string;
    email: string | null;
    overallAvg: number | null;
    attempts: number;
    trend: Array<{
      assessmentId: string;
      title: string;
      at: number;
      pct: number;
      type: Mode;
    }>;
  }>;
};

type Dashboard = {
  classes: Array<{ id: string; name: string }>;
};

const LINE_COLORS = [
  "#2563eb",
  "#e11d48",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#dc2626",
  "#4f46e5",
  "#0d9488",
  "#b45309",
  "#9333ea",
  "#0284c7",
  "#ca8a04",
  "#16a34a",
  "#be123c",
  "#6d28d9",
];

const fmt = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)}%`;

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function AnalysisBoard({ report }: { report: AnalysisData }) {
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[] | null>(
    null,
  );
  const [studentQuery, setStudentQuery] = useState("");
  const [includeStatic, setIncludeStatic] = useState(true);
  const [includeAdaptive, setIncludeAdaptive] = useState(true);

  const allStudentIds = report.students.map((s) => s.id);
  const selectedIds = selectedStudentIds ?? allStudentIds;
  const selectedSet = new Set(selectedIds);
  const selectedStudents = report.students.filter((s) => selectedSet.has(s.id));

  const staticCount = report.assessments.filter(
    (a) => a.type === "static",
  ).length;
  const adaptiveCount = report.assessments.length - staticCount;

  const typeIncluded = (type: Mode) =>
    type === "static" ? includeStatic : includeAdaptive;

  const scoreLookup = new Map<string, Map<string, number>>();
  for (const student of selectedStudents) {
    for (const point of student.trend) {
      if (!typeIncluded(point.type)) continue;
      const byStudent = scoreLookup.get(point.assessmentId) ?? new Map();
      byStudent.set(student.id, point.pct);
      scoreLookup.set(point.assessmentId, byStudent);
    }
  }

  const visibleAssessments = report.assessments.filter(
    (a) =>
      typeIncluded(a.type) && (scoreLookup.get(a.id)?.size ?? 0) > 0,
  );

  const plottedStudents = selectedStudents.filter((student) =>
    visibleAssessments.some((a) => scoreLookup.get(a.id)?.has(student.id)),
  );

  const colorById = new Map(
    report.students.map((s, i) => [
      s.id,
      LINE_COLORS[i % LINE_COLORS.length],
    ]),
  );

  const seenTitles = new Map<string, number>();
  const chartData = visibleAssessments.map((a) => {
    const baseTitle = a.title.trim() || "Untitled assessment";
    const seen = seenTitles.get(baseTitle) ?? 0;
    seenTitles.set(baseTitle, seen + 1);
    const exam =
      seen === 0
        ? baseTitle
        : `${baseTitle} · ${new Date(a.at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}${seen > 1 ? ` (${seen + 1})` : ""}`;
    const row: Record<string, string | number | null> = { exam };
    for (const student of plottedStudents) {
      row[student.id] = scoreLookup.get(a.id)?.get(student.id) ?? null;
    }
    return row;
  });

  const scores = visibleAssessments.flatMap((a) =>
    Array.from(scoreLookup.get(a.id)?.values() ?? []),
  );
  const average =
    scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null;
  const passRate =
    scores.length > 0
      ? (scores.filter((score) => score >= 50).length / scores.length) * 100
      : null;

  const search = studentQuery.trim().toLowerCase();
  const filteredStudents = report.students.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search) ||
      (s.email ?? "").toLowerCase().includes(search),
  );

  const toggleStudent = (id: string) => {
    const base = selectedStudentIds ?? allStudentIds;
    setSelectedStudentIds(
      base.includes(id) ? base.filter((x) => x !== id) : [...base, id],
    );
  };

  const filtersChanged =
    selectedStudentIds !== null || !includeStatic || !includeAdaptive;

  const resetFilters = () => {
    setSelectedStudentIds(null);
    setIncludeStatic(true);
    setIncludeAdaptive(true);
    setStudentQuery("");
  };

  const emptyReason =
    !includeStatic && !includeAdaptive
      ? "Select Static, Adaptive, or both to draw the graph."
      : selectedStudents.length === 0
        ? "Select at least one student to draw their line."
        : "No scored assessments match these filters yet.";

  const studentButtonLabel =
    selectedStudentIds === null
      ? `All students (${report.students.length})`
      : selectedStudents.length === 0
        ? "No students"
        : `${selectedStudents.length} of ${report.students.length} students`;

  return (
    <div className="space-y-5">
      <div className="clay p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold">
              <SlidersHorizontal className="size-4 text-primary" />
              Filter the view
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose who appears on the graph and which assessment types feed it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Assessment type
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={includeStatic}
              className={cn(
                "rounded-full",
                includeStatic &&
                  "border-[#2563eb]/40 bg-[#2563eb]/10 text-[#1d4ed8]",
              )}
              onClick={() => setIncludeStatic((value) => !value)}
            >
              <span className="mr-1.5 size-2 rounded-full bg-[#2563eb]" />
              Static
              <span className="ml-1.5 text-[10px] opacity-70">
                {staticCount}
              </span>
              {includeStatic && <Check className="ml-1 size-3" />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={includeAdaptive}
              className={cn(
                "rounded-full",
                includeAdaptive &&
                  "border-primary/40 bg-primary/10 text-primary",
              )}
              onClick={() => setIncludeAdaptive((value) => !value)}
            >
              <span className="mr-1.5 size-2 rounded-full bg-primary" />
              Adaptive
              <span className="ml-1.5 text-[10px] opacity-70">
                {adaptiveCount}
              </span>
              {includeAdaptive && <Check className="ml-1 size-3" />}
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                >
                  <Users className="mr-1.5 size-3.5" />
                  {studentButtonLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="border-b p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold">Students</p>
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setSelectedStudentIds(null)}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:underline"
                        onClick={() => setSelectedStudentIds([])}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={studentQuery}
                      onChange={(e) => setStudentQuery(e.target.value)}
                      placeholder="Find a student"
                      className="clay-inset h-8 rounded-full pl-8 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto p-2">
                  {filteredStudents.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      No students match “{studentQuery}”.
                    </p>
                  ) : (
                    filteredStudents.map((student) => (
                      <label
                        key={student.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-xs hover:bg-[var(--accent)]"
                      >
                        <Checkbox
                          checked={selectedSet.has(student.id)}
                          onCheckedChange={() => toggleStudent(student.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            {student.name}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {student.email ?? `${student.attempts} attempts`}
                          </span>
                        </span>
                        <span className="shrink-0 font-bold tabular-nums text-muted-foreground">
                          {fmt(student.overallAvg)}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {filtersChanged && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-full text-muted-foreground"
                onClick={resetFilters}
              >
                Reset
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="clay p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Assessments
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">
            {visibleAssessments.length}
          </p>
        </div>
        <div className="clay p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Students shown
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">
            {plottedStudents.length}
          </p>
        </div>
        <div className="clay p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Average score
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">
            {fmt(average)}
          </p>
        </div>
        <div className="clay p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Pass rate
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">
            {fmt(passRate)}
          </p>
        </div>
      </div>

      <div className="clay p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold">Scores across assessments</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              X-axis: assessment · Y-axis: score. Each line is one student;
              hover a point for the full exam name and score. Missing points
              mean that student has no graded result for that assessment.
            </p>
          </div>
          <Badge className="clay-inset rounded-full text-[10px] font-bold text-foreground">
            Pass mark 50%
          </Badge>
        </div>

        <div className="mt-4 overflow-x-auto pb-2">
          {visibleAssessments.length === 0 || plottedStudents.length === 0 ? (
            <div className="flex h-[420px] min-w-[640px] flex-col items-center justify-center px-6 text-center">
              <LineChartIcon className="size-8 text-primary" />
              <p className="mt-3 font-bold">Nothing to plot</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {emptyReason}
              </p>
              {filtersChanged && (
                <Button
                  type="button"
                  variant="outline"
                  className="clay-press mt-4 rounded-full"
                  onClick={resetFilters}
                >
                  Reset filters
                </Button>
              )}
            </div>
          ) : (
            <div
              className="h-[430px]"
              style={{
                minWidth: Math.max(680, visibleAssessments.length * 110),
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 28, left: 2, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border)"
                  />
                  <XAxis
                    dataKey="exam"
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={88}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) => truncate(value, 20)}
                    tick={{
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 20, 40, 60, 80, 100]}
                    width={46}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => `${value}%`}
                    tick={{
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    y={50}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    label={{
                      value: "Pass 50%",
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: "var(--muted-foreground)",
                    }}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border)" }}
                    formatter={(value) => `${value}%`}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      fontSize: 12,
                    }}
                    labelStyle={{
                      color: "var(--foreground)",
                      fontWeight: 700,
                      marginBottom: 4,
                    }}
                  />
                  <Legend
                    iconType="plainline"
                    wrapperStyle={{ fontSize: 11, paddingTop: 14 }}
                  />
                  {plottedStudents.map((student) => (
                    <Line
                      key={student.id}
                      type="monotone"
                      dataKey={student.id}
                      name={student.name}
                      stroke={colorById.get(student.id)}
                      strokeWidth={2.25}
                      dot={{
                        r: 3,
                        strokeWidth: 0,
                        fill: colorById.get(student.id),
                      }}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {plottedStudents.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              Showing {plottedStudents.length} student
              {plottedStudents.length === 1 ? "" : "s"} across{" "}
              {visibleAssessments.length} assessment
              {visibleAssessments.length === 1 ? "" : "s"}.
            </span>
            {selectedStudents.length > plottedStudents.length && (
              <span className="text-amber-600">
                {selectedStudents.length - plottedStudents.length} selected
                student
                {selectedStudents.length - plottedStudents.length === 1
                  ? " has"
                  : "s have"}{" "}
                no scores in this view.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Instructor view: one line per student across a subject's assessments. */
export default function StudentResultsAnalysis() {
  const params = useParams();
  const navigate = useNavigate();
  const dashboard = useQuery(api.instructorPortal.getInstructorDashboard) as
    | Dashboard
    | undefined;
  const classes = dashboard?.classes ?? [];
  const classId = params.classId ?? classes[0]?.id;

  const report = useQuery(
    api.classReport.getClassPerformanceReport,
    classId ? { classId: classId as Id<"classes"> } : "skip",
  ) as unknown as AnalysisData | undefined;

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
            <Button
              variant="outline"
              size="sm"
              className="clay-press rounded-full"
            >
              <ArrowLeft className="mr-1.5 size-4" /> Portal
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="clay-sm flex size-10 items-center justify-center">
              <TrendingUp className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">
                Student results analysis
              </p>
              <p className="text-xs text-muted-foreground">
                {report?.class.name ?? "Scores by assessment"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={classId ?? ""}
            onValueChange={(value) =>
              navigate(`/instructor/results-analysis/${value}`)
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
            <Link to={`/instructor/reports/${classId}`}>
              <Button variant="outline" className="clay-press rounded-full">
                <BarChart3 className="mr-1.5 size-4" /> Class report
              </Button>
            </Link>
          )}
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
              Create a class, add students, and publish assessments to compare
              their results here.
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
        <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl space-y-5 px-6 pb-16">
          <div className="clay p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-extrabold">{report.class.name}</h1>
                  <Badge className="clay-inset rounded-full text-[10px] uppercase text-foreground">
                    {report.class.status}
                  </Badge>
                </div>
                {report.class.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {report.class.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.class.rosterSize} students · {report.assessments.length}{" "}
                  published assessments · instructor {report.class.instructor}
                </p>
              </div>
            </div>
            <p className="mt-4 rounded-2xl bg-[var(--accent)]/60 p-3 text-sm leading-relaxed">
              Compare every student's score across this subject's assessments.
              Filter the class roster and switch between static and adaptive
              papers to see how performance moves over time.
            </p>
          </div>

          <AnalysisBoard key={classId} report={report} />
        </section>
      )}
    </main>
  );
}

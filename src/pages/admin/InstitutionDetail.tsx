import { useQuery } from "convex/react";
import { Link, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AdminPageHeader,
  DataTable,
  ScoreBadge,
  StatCard,
  TableCell,
} from "@/components/admin/kit";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";

type Perf = {
  institution: {
    _id: string;
    name: string;
    type: string;
    city?: string;
    status: string;
  };
  summary: {
    totalStudents: number;
    totalInstructors: number;
    totalAssessments: number;
    completedAssessments: number;
    averageScore: number | null;
    passRate: number | null;
    completionRate: number | null;
    highest: { id: string; name: string; avgScore: number } | null;
    lowest: { id: string; name: string; avgScore: number } | null;
  };
  charts: {
    trend: Array<{ month: string; avgScore: number; sessions: number }>;
    distribution: Array<{ name: string; value: number }>;
    byInstructor: Array<{ name: string; avgScore: number | null }>;
    byCenter: Array<{ name: string; avgScore: number | null }>;
    byAssessment: Array<{ name: string; avgScore: number | null }>;
    passFail: Array<{ name: string; value: number }>;
  };
  studentTable: Array<{
    id: string;
    name: string;
    assessments: number;
    avgScore: number | null;
  }>;
};

const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-5)",
];

export default function InstitutionDetail() {
  const { id } = useParams<{ id: string }>();
  const data = useQuery(api.adminAnalytics.getInstitutionPerformance, {
    id: id as never,
  }) as Perf | undefined;

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return <p className="p-8 text-center text-sm">Institution not found.</p>;
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const s = data.summary;

  return (
    <>
      <AdminPageHeader
        title={data.institution.name}
        subtitle={`${data.institution.type.replace(/_/g, " ")} · ${data.institution.city ?? ""}`}
        actions={
          <Badge className="clay-inset rounded-full text-foreground">
            {data.institution.status}
          </Badge>
        }
      />

      <div className="mb-4 text-sm">
        <Link to="/admin/institutions" className="text-primary hover:underline">
          ← All institutions
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Total students" value={s.totalStudents} />
        <StatCard label="Instructors" value={s.totalInstructors} />
        <StatCard label="Assessments" value={s.totalAssessments} />
        <StatCard label="Completed" value={s.completedAssessments} />
        <StatCard label="Average score" value={pct(s.averageScore)} />
        <StatCard label="Pass rate" value={pct(s.passRate)} />
        <StatCard label="Completion rate" value={pct(s.completionRate)} />
        <div className="clay p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Highest / lowest
          </p>
          <p className="mt-2 truncate text-sm font-semibold">
            {s.highest ? (
              <Link to={`/admin/students/${s.highest.id}/performance`} className="hover:underline">
                ↑ {s.highest.name} ({Math.round(s.highest.avgScore)}%)
              </Link>
            ) : (
              "—"
            )}
          </p>
          <p className="truncate text-sm font-semibold">
            {s.lowest ? (
              <Link to={`/admin/students/${s.lowest.id}/performance`} className="hover:underline">
                ↓ {s.lowest.name} ({Math.round(s.lowest.avgScore)}%)
              </Link>
            ) : (
              "—"
            )}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ChartCard title="Average performance over time">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.charts.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="avgScore" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Student performance distribution">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.charts.distribution} dataKey="value" nameKey="name" outerRadius={90}>
                {data.charts.distribution.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
                <Tooltip />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Performance by instructor">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.byInstructor}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="avgScore" fill="var(--color-chart-2)" radius={8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Performance by teaching center">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.byCenter}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="avgScore" fill="var(--color-chart-3)" radius={8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Performance by assessment">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.charts.byAssessment} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 9 }} />
              <Tooltip />
              <Bar dataKey="avgScore" fill="var(--color-chart-4)" radius={8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Pass / fail distribution">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.charts.passFail} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
                <Cell fill="var(--color-chart-2)" />
                <Cell fill="var(--destructive)" />
                <Tooltip />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <h2 className="mb-3 mt-8 text-base font-bold">Teaching centers</h2>
      <DataTable headers={["Center", "Students", "Avg score"]} empty={false} colSpan={3}>
        {data.charts.byCenter.map((c) => (
          <tr key={c.name}>
            <TableCell className="font-medium">{c.name}</TableCell>
            <TableCell>—</TableCell>
            <TableCell><ScoreBadge pct={c.avgScore} /></TableCell>
          </tr>
        ))}
      </DataTable>

      <h2 className="mb-3 mt-8 text-base font-bold">Student performance</h2>
      <DataTable
        headers={["Student", "Assessments", "Average score", "Performance"]}
        empty={data.studentTable.length === 0}
        colSpan={4}
      >
        {data.studentTable.map((r) => (
          <tr key={r.id} className="hover:bg-[var(--accent)]/40">
            <TableCell>
              <Link to={`/admin/students/${r.id}/performance`} className="font-medium hover:underline">
                {r.name}
              </Link>
            </TableCell>
            <TableCell className="tabular-nums">{r.assessments}</TableCell>
            <TableCell><ScoreBadge pct={r.avgScore} /></TableCell>
            <TableCell>
              {r.avgScore === null ? "—" : r.avgScore >= 85 ? "excellent" : r.avgScore >= 70 ? "good" : r.avgScore >= 55 ? "average" : "needs support"}
            </TableCell>
          </tr>
        ))}
      </DataTable>
    </>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="clay p-5">
      <p className="mb-3 text-sm font-bold">{title}</p>
      <div className="h-64">{children}</div>
    </div>
  );
}

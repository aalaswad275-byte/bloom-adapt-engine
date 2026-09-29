import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AdminPageHeader, StatCard } from "@/components/admin/kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { Link } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Dash = {
  counts: {
    institutions: number;
    teachingCenters: number;
    governmentFacilities: number;
    instructors: number;
    students: number;
    assessments: number;
    completedAssessments: number;
    activeStudents: number;
  };
  performance: {
    avgScore: number | null;
    passRate: number | null;
    completionRate: number | null;
    avgInstitutionPerformance: number | null;
  };
  charts: {
    studentsByInstitution: Array<{ name: string; value: number }>;
    studentsByCenter: Array<{ name: string; value: number }>;
    studentsByFacility: Array<{ name: string; value: number }>;
    activeVsInactive: Array<{ name: string; value: number }>;
    enrollmentOverTime: Array<{ month: string; enrolled: number }>;
    performanceTrend: Array<{ month: string; avgScore: number; sessions: number }>;
  };
  recent: {
    students: Array<{ id: string; name: string; at: number }>;
    instructors: Array<{ id: string; name: string; at: number }>;
    institutions: Array<{ id: string; name: string; at: number }>;
    assessments: Array<{ id: string; name: string; at: number }>;
  };
};

export default function AdminDashboard() {
  const data = useQuery(api.adminAnalytics.getAdminDashboard) as Dash | undefined;

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pct = (v: number | null) =>
    v === null ? "—" : `${Math.round(v)}%`;

  return (
    <>
      <AdminPageHeader
        title="Admin dashboard"
        subtitle="System-wide overview — every figure computed live from the database"
        actions={
          <Link to="/admin/analytics" className="text-sm text-primary hover:underline">
            Open full analytics →
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Institutions" value={data.counts.institutions} />
        <StatCard label="Teaching centers" value={data.counts.teachingCenters} />
        <StatCard label="Gov. facilities" value={data.counts.governmentFacilities} />
        <StatCard label="Instructors" value={data.counts.instructors} />
        <StatCard label="Students" value={data.counts.students} hint={`${data.counts.activeStudents} active`} />
        <StatCard label="Assessments" value={data.counts.assessments} />
        <StatCard label="Completed assessments" value={data.counts.completedAssessments} />
        <StatCard label="Avg student performance" value={pct(data.performance.avgScore)} />
        <StatCard label="Avg institution performance" value={pct(data.performance.avgInstitutionPerformance)} />
        <StatCard label="Pass rate" value={pct(data.performance.passRate)} />
        <StatCard label="Completion rate" value={pct(data.performance.completionRate)} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="clay border-0">
          <CardHeader>
            <CardTitle className="text-base">Students by institution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.studentsByInstitution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--primary)" radius={8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="clay border-0">
          <CardHeader>
            <CardTitle className="text-base">Students by teaching center</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.studentsByCenter}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--color-chart-2)" radius={8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="clay border-0">
          <CardHeader>
            <CardTitle className="text-base">Students by government facility</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.studentsByFacility}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--color-chart-4)" radius={8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="clay border-0">
          <CardHeader>
            <CardTitle className="text-base">Active vs inactive students</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.charts.activeVsInactive}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={4}
                  >
                    <Tooltip />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="clay border-0">
          <CardHeader>
            <CardTitle className="text-base">Student enrollment over time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.charts.enrollmentOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="enrolled" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="clay border-0">
          <CardHeader>
            <CardTitle className="text-base">Performance trend (avg score by month)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.charts.performanceTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="avgScore" stroke="var(--color-chart-2)" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <RecentCard title="Recent students" rows={data.recent.students.map((s) => ({ id: s.id, label: s.name, at: s.at }))} to="/admin/students" />
        <RecentCard title="Recent instructors" rows={data.recent.instructors.map((s) => ({ id: s.id, label: s.name, at: s.at }))} to="/admin/instructors" />
        <RecentCard title="Recent institutions" rows={data.recent.institutions.map((s) => ({ id: s.id, label: s.name, at: s.at }))} to="/admin/institutions" />
        <RecentCard title="Recent assessments" rows={data.recent.assessments.map((s) => ({ id: s.id, label: s.name, at: s.at }))} to="/admin/assessments" />
      </div>
    </>
  );
}

function RecentCard({
  title,
  rows,
  to,
}: {
  title: string;
  rows: Array<{ id: string; label: string; at: number }>;
  to: string;
}) {
  return (
    <Card className="clay border-0">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        )}
        {rows.map((r) => (
          <Link
            key={r.id}
            to={to}
            className="clay-inset flex items-center justify-between px-3 py-2 text-sm hover:opacity-80"
          >
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(r.at).toLocaleDateString()}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

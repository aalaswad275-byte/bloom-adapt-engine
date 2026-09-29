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
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Perf = {
  instructor: {
    _id: string;
    name: string;
    email?: string;
    specialization?: string;
    status: string;
  };
  institution: { name: string } | null;
  center: { name: string } | null;
  summary: {
    students: number;
    assessments: number;
    avgStudentScore: number | null;
    passRate: number | null;
    completionRate: number | null;
  };
  trend: Array<{ month: string; avgScore: number; sessions: number }>;
  byAssessment: Array<{ name: string; avgScore: number | null }>;
  students: Array<{
    id: string;
    name: string;
    assessments: number;
    avgScore: number | null;
  }>;
};

export default function InstructorPerformance() {
  const { id } = useParams<{ id: string }>();
  const data = useQuery(api.adminAnalytics.getInstructorPerformance, {
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
    return <p className="p-8 text-center text-sm">Instructor not found.</p>;
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const s = data.summary;

  return (
    <>
      <AdminPageHeader
        title={data.instructor.name}
        subtitle={`${data.instructor.specialization ?? "Instructor"} · ${data.institution?.name ?? "Unassigned"}${data.center ? ` · ${data.center.name}` : ""}`}
      />

      <div className="mb-4 text-sm">
        <Link to="/admin/instructors" className="text-primary hover:underline">
          ← All instructors
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Students" value={s.students} />
        <StatCard label="Assessments" value={s.assessments} />
        <StatCard label="Avg student score" value={pct(s.avgStudentScore)} />
        <StatCard label="Pass rate" value={pct(s.passRate)} />
        <StatCard label="Completion rate" value={pct(s.completionRate)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="clay p-5">
          <p className="mb-3 text-sm font-bold">Student performance trend</p>
          {data.trend.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="avgScore" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="clay p-5">
          <p className="mb-3 text-sm font-bold">Average score by assessment</p>
          {data.byAssessment.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assessments yet.</p>
          ) : (
            <div className="h-64 overflow-y-auto">
              {data.byAssessment.map((a) => (
                <div key={a.name} className="clay-inset mb-2 flex items-center justify-between px-3 py-2 text-sm">
                  <span className="truncate">{a.name}</span>
                  <ScoreBadge pct={a.avgScore} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-base font-bold">Students</h2>
      <DataTable
        headers={["Student", "Assessments", "Average score"]}
        empty={data.students.length === 0}
        colSpan={3}
      >
        {data.students.map((st) => (
          <tr key={st.id} className="hover:bg-[var(--accent)]/40">
            <TableCell>
              <Link to={`/admin/students/${st.id}/performance`} className="font-medium hover:underline">
                {st.name}
              </Link>
            </TableCell>
            <TableCell className="tabular-nums">{st.assessments}</TableCell>
            <TableCell><ScoreBadge pct={st.avgScore} /></TableCell>
          </tr>
        ))}
      </DataTable>
    </>
  );
}

import { useQuery } from "convex/react";
import { Link, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AdminPageHeader,
  DataTable,
  ScoreBadge,
  StatCard,
  StatusBadge,
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
  student: {
    _id: string;
    name: string;
    email?: string;
    phone?: string;
    enrolledAt: number;
    status: string;
  };
  institution: { name: string } | null;
  center: { name: string } | null;
  facility: { name: string } | null;
  instructor: { name: string } | null;
  summary: {
    overallAverage: number | null;
    assessments: number;
    completed: number;
    highest: number | null;
    lowest: number | null;
    improvementPct: number | null;
    avgDurationSec: number | null;
    currentLevel: string | null;
  };
  scoreHistory: Array<{ date: number; score: number | null; label: string }>;
  history: Array<{
    sessionId: string;
    assessment: string;
    date: number;
    score: number;
    answered: number;
    percentage: number | null;
    grade: string | null;
    level: string | null;
    durationSec: number | null;
    status: string;
  }>;
  adaptive: {
    sessionId: string;
    thetaProfile: Record<string, number>;
    progression: Array<{
      step: number;
      bloom: string;
      theta: number;
      difficulty: number;
      correct: number;
    }>;
    improvement: number | null;
  } | null;
};

export default function StudentPerformance() {
  const { id } = useParams<{ id: string }>();
  const data = useQuery(api.adminAnalytics.getStudentPerformance, {
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
    return <p className="p-8 text-center text-sm">Student not found.</p>;
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const s = data.summary;
  const scoreSeries = data.scoreHistory
    .filter((h) => h.score !== null)
    .map((h, i) => ({ i: i + 1, score: h.score!, label: h.label }));

  return (
    <>
      <AdminPageHeader
        title={data.student.name}
        subtitle={`Enrolled ${new Date(data.student.enrolledAt).toLocaleDateString()} · ${data.student.status}`}
      />

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <Link to="/admin/students" className="text-primary hover:underline">
          ← All students
        </Link>
      </div>

      {/* General information */}
      <div className="clay mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Email" value={data.student.email ?? "—"} />
        <Info label="Phone" value={data.student.phone ?? "—"} />
        <Info label="Institution" value={data.institution?.name ?? "Unassigned"} />
        <Info label="Teaching center" value={data.center?.name ?? "—"} />
        <Info label="Government facility" value={data.facility?.name ?? "—"} />
        <Info label="Instructor" value={data.instructor?.name ?? "—"} />
        <Info label="Status">
          <StatusBadge status={data.student.status} />
        </Info>
        <Info label="Current level" value={s.currentLevel ?? "—"} />
      </div>

      {/* Performance summary */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Overall average" value={pct(s.overallAverage)} />
        <StatCard label="Assessments" value={s.assessments} hint={`${s.completed} completed`} />
        <StatCard label="Highest score" value={pct(s.highest)} />
        <StatCard label="Lowest score" value={pct(s.lowest)} />
        <StatCard
          label="Improvement"
          value={s.improvementPct !== null ? `${s.improvementPct > 0 ? "+" : ""}${Math.round(s.improvementPct)} pts` : "—"}
        />
        <StatCard
          label="Avg completion time"
          value={s.avgDurationSec !== null ? `${Math.round(s.avgDurationSec / 60)} min` : "—"}
        />
      </div>

      {/* Score over time */}
      <div className="clay mb-6 p-5">
        <p className="mb-3 text-sm font-bold">Performance history (score % over time)</p>
        {scoreSeries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed assessments yet.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={scoreSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="i" tick={{ fontSize: 10 }} label={{ value: "attempt", fontSize: 10, position: "insideBottomRight", offset: -2 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v: number) => [`${v}%`, "score"]}
                  labelFormatter={(i: number) => scoreSeries[i - 1]?.label ?? ""}
                />
                <Line type="monotone" dataKey="score" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Assessment history */}
      <h2 className="mb-3 text-base font-bold">Assessment history</h2>
      <DataTable
        headers={["Assessment", "Date", "Score", "Percentage", "Grade", "Time", "Status", "Report"]}
        empty={data.history.length === 0}
        colSpan={8}
      >
        {data.history.map((h) => (
          <tr key={h.sessionId} className="hover:bg-[var(--accent)]/40">
            <TableCell className="font-medium">{h.assessment}</TableCell>
            <TableCell className="text-xs">{new Date(h.date).toLocaleDateString()}</TableCell>
            <TableCell className="tabular-nums">{h.score}/{h.answered}</TableCell>
            <TableCell><ScoreBadge pct={h.percentage} /></TableCell>
            <TableCell className="text-xs font-bold">{h.grade ?? "—"}</TableCell>
            <TableCell className="text-xs">
              {h.durationSec !== null ? `${Math.floor(h.durationSec / 60)}m ${h.durationSec % 60}s` : "—"}
            </TableCell>
            <TableCell><StatusBadge status={h.status} /></TableCell>
            <TableCell>
              <Link to={`/results/${h.sessionId}`} className="text-xs text-primary hover:underline">
                open →
              </Link>
            </TableCell>
          </tr>
        ))}
      </DataTable>

      {/* Adaptive engine analytics */}
      {data.adaptive && (
        <>
          <h2 className="mb-3 mt-8 text-base font-bold">
            Adaptive engine analysis
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              latest session · θ {data.adaptive.improvement !== null ? `${data.adaptive.improvement >= 0 ? "+" : ""}${data.adaptive.improvement.toFixed(2)}` : ""}
            </span>
          </h2>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="clay p-5">
              <p className="mb-3 text-sm font-bold">θ progression & item difficulty</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.adaptive.progression}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[-3, 3]} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="theta" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} name="θ" />
                    <Line type="monotone" dataKey="difficulty" stroke="var(--color-chart-5)" strokeWidth={2} dot={false} name="b" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="clay p-5">
              <p className="mb-3 text-sm font-bold">θ profile by Bloom level (latest session)</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(data.adaptive.thetaProfile).map(([k, v]) => (
                  <div key={k} className="clay-inset px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</p>
                    <p className="text-sm font-bold tabular-nums">θ {v.toFixed(2)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {data.adaptive.progression.map((p) => (
                  <div key={p.step} className="flex items-center justify-between text-xs">
                    <span>Q{p.step} · {p.bloom}</span>
                    <span className={p.correct === 1 ? "font-semibold text-[oklch(0.55_0.14_145)]" : p.correct === 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
                      {p.correct === 1 ? "correct" : p.correct === 0 ? "incorrect" : "skipped"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Info({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium">{children ?? value}</div>
    </div>
  );
}

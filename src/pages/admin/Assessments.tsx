import { useQuery } from "convex/react";
import { Link } from "react-router";
import { ClipboardList, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AdminPageHeader,
  DataTable,
  ScoreBadge,
  StatCard,
  TableCell,
} from "@/components/admin/kit";

type Assessment = {
  id: string;
  title: string;
  institution: string | null;
  totalQuestions: number;
  attempts: number;
  completed: number;
  avgScore: number | null;
  passRate: number | null;
  createdAt: number;
};

export default function AdminAssessments() {
  const data = useQuery(api.adminAnalytics.listAdminAssessments, {}) as
    | Assessment[]
    | undefined;

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const list = data;

  return (
    <>
      <AdminPageHeader
        title="Assessments"
        subtitle="All adaptive assessments with live participation statistics"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Assessments" value={list.length} icon={<ClipboardList className="size-4 text-primary" />} />
        <StatCard label="Total attempts" value={list.reduce((a, r) => a + r.attempts, 0)} />
        <StatCard label="Total completed" value={list.reduce((a, r) => a + r.completed, 0)} />
        <StatCard
          label="Overall avg score"
          value={
            list.some((r) => r.avgScore !== null)
              ? `${Math.round(
                  list.filter((r) => r.avgScore !== null).reduce((a, r) => a + (r.avgScore ?? 0), 0) /
                    list.filter((r) => r.avgScore !== null).length,
                )}%`
              : "—"
          }
        />
      </div>

      <DataTable
        headers={["Assessment", "Institution", "Questions", "Attempts", "Completed", "Avg score", "Pass rate", "Created"]}
        empty={list.length === 0}
        colSpan={8}
      >
        {list.map((r) => (
          <tr key={r.id} className="hover:bg-[var(--accent)]/40">
            <TableCell className="font-medium">{r.title}</TableCell>
            <TableCell className="text-xs">{r.institution ?? "—"}</TableCell>
            <TableCell className="tabular-nums">{r.totalQuestions}</TableCell>
            <TableCell className="tabular-nums">{r.attempts}</TableCell>
            <TableCell className="tabular-nums">{r.completed}</TableCell>
            <TableCell><ScoreBadge pct={r.avgScore} /></TableCell>
            <TableCell className="tabular-nums">
              {r.passRate !== null ? `${Math.round(r.passRate)}%` : "—"}
            </TableCell>
            <TableCell className="text-xs">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
          </tr>
        ))}
      </DataTable>

      <p className="mt-4 text-xs text-muted-foreground">
        Results per assessment are available in{" "}
        <Link to="/admin/results" className="text-primary hover:underline">
          Results
        </Link>{" "}
        filtered by assessment.
      </p>
    </>
  );
}

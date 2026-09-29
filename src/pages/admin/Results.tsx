import { useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router";
import { Award, Eye } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHeader,
  AdminToolbar,
  DataTable,
  Pager,
  ScoreBadge,
  StatCard,
  StatusBadge,
  TableCell,
  downloadCsv,
} from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

type ResultRow = {
  sessionId: string;
  studentName: string;
  institution: string | null;
  teachingCenter: string | null;
  instructor: string | null;
  assessment: string;
  date: number;
  score: number;
  answered: number;
  percentage: number;
  grade: string;
  level: string;
  durationSec: number | null;
  status: string;
};

type Detail = {
  session: {
    _id: string;
    status: string;
    startedAt: number;
    completedAt: number | null;
    stepCount: number;
    correctCount: number;
    riskScore: number;
    confirmedViolations: number;
  };
  assessment: string;
  studentName: string;
  percentage: number | null;
  history: Array<{
    step: number;
    bloom: string;
    correct: number;
    responseTime: number;
    thetaBefore: number;
    thetaAfter: number;
    difficulty: number;
  }>;
};

const PAGE_SIZE = 20;

export default function AdminResults() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{
    studentId?: Id<"students">;
    examId?: Id<"exams">;
    institutionId?: Id<"institutions">;
    performanceLevel?: string;
    from?: number;
    to?: number;
  }>({});

  const orgs = useQuery(api.adminOrgs.orgOptions, {}) as
    | {
        institutions: Array<{ value: string; label: string }>;
        instructors: Array<{ value: string; label: string }>;
      }
    | undefined;
  const students = useQuery(api.adminPeople.listStudents, {}) as
    | Array<{ _id: string; name: string }>
    | undefined;
  const assessments = useQuery(api.adminAnalytics.listAdminAssessments, {}) as
    | Array<{ id: string; title: string }>
    | undefined;

  const data = useQuery(api.adminPeople.listResults, {
    page,
    pageSize: PAGE_SIZE,
    ...filters,
  }) as { rows: ResultRow[]; total: number } | undefined;

  const [detailId, setDetailId] = useState<Id<"examSessions"> | null>(null);
  const detail = useQuery(
    api.adminPeople.getResultDetail,
    detailId ? { sessionId: detailId } : "skip",
  ) as Detail | undefined;

  const rows = data?.rows ?? [];

  return (
    <>
      <AdminPageHeader
        title="Results"
        subtitle="Every assessment result across the system — server-side paginated"
        actions={
          <Button
            variant="outline"
            className="clay-press rounded-full"
            onClick={() =>
              downloadCsv(
                "results.csv",
                ["Student", "Institution", "Center", "Instructor", "Assessment", "Date", "Score", "Percentage", "Grade", "Status"],
                rows.map((r) => [
                  r.studentName,
                  r.institution,
                  r.teachingCenter,
                  r.instructor,
                  r.assessment,
                  new Date(r.date).toISOString().slice(0, 10),
                  `${r.score}/${r.answered}`,
                  r.percentage,
                  r.grade,
                  r.status,
                ]),
              )
            }
          >
            Export page CSV
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total results" value={data?.total ?? "…"} icon={<Award className="size-4 text-primary" />} />
        <StatCard
          label="Avg percentage (page)"
          value={
            rows.length
              ? `${Math.round(rows.reduce((a, r) => a + r.percentage, 0) / rows.length)}%`
              : "—"
          }
        />
        <StatCard
          label="Pass rate (page)"
          value={
            rows.length
              ? `${Math.round((rows.filter((r) => r.percentage >= 50).length / rows.length) * 100)}%`
              : "—"
          }
        />
        <StatCard
          label="Completed (page)"
          value={rows.filter((r) => r.status === "completed").length}
        />
      </div>

      <AdminToolbar search={search} onSearch={setSearch}>
        <Select
          value={filters.institutionId ?? "all"}
          onValueChange={(v) => { setPage(0); setFilters((f) => ({ ...f, institutionId: v === "all" ? undefined : (v as Id<"institutions">) })); }}
        >
          <SelectTrigger className="w-44 rounded-full"><SelectValue placeholder="Institution" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All institutions</SelectItem>
            {(orgs?.institutions ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.studentId ?? "all"}
          onValueChange={(v) => { setPage(0); setFilters((f) => ({ ...f, studentId: v === "all" ? undefined : (v as Id<"students">) })); }}
        >
          <SelectTrigger className="w-44 rounded-full"><SelectValue placeholder="Student" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All students</SelectItem>
            {(students ?? []).map((s) => (
              <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.examId ?? "all"}
          onValueChange={(v) => { setPage(0); setFilters((f) => ({ ...f, examId: v === "all" ? undefined : (v as Id<"exams">) })); }}
        >
          <SelectTrigger className="w-44 rounded-full"><SelectValue placeholder="Assessment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assessments</SelectItem>
            {(assessments ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.performanceLevel ?? "all"}
          onValueChange={(v) => { setPage(0); setFilters((f) => ({ ...f, performanceLevel: v === "all" ? undefined : v })); }}
        >
          <SelectTrigger className="w-40 rounded-full"><SelectValue placeholder="Level" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="excellent">Excellent</SelectItem>
            <SelectItem value="good">Good</SelectItem>
            <SelectItem value="average">Average</SelectItem>
            <SelectItem value="below">Below</SelectItem>
            <SelectItem value="poor">Poor</SelectItem>
          </SelectContent>
        </Select>
      </AdminToolbar>

      <DataTable
        headers={["Student", "Institution", "Center", "Instructor", "Assessment", "Date", "Score", "%", "Grade", "Level", "Time", "Status", ""]}
        empty={rows.length === 0}
        colSpan={13}
      >
        {rows
          .filter((r) => !search || r.studentName.toLowerCase().includes(search.toLowerCase()) || r.assessment.toLowerCase().includes(search.toLowerCase()))
          .map((r) => (
            <tr key={r.sessionId} className="hover:bg-[var(--accent)]/40">
              <TableCell className="font-medium">{r.studentName}</TableCell>
              <TableCell className="text-xs">{r.institution ?? "—"}</TableCell>
              <TableCell className="text-xs">{r.teachingCenter ?? "—"}</TableCell>
              <TableCell className="text-xs">{r.instructor ?? "—"}</TableCell>
              <TableCell className="max-w-48 truncate text-xs">{r.assessment}</TableCell>
              <TableCell className="text-xs">{new Date(r.date).toLocaleDateString()}</TableCell>
              <TableCell className="tabular-nums">{r.score}/{r.answered}</TableCell>
              <TableCell><ScoreBadge pct={r.percentage} /></TableCell>
              <TableCell className="text-xs font-bold">{r.grade}</TableCell>
              <TableCell className="text-xs">{r.level}</TableCell>
              <TableCell className="text-xs">{r.durationSec !== null ? `${Math.floor(r.durationSec / 60)}m` : "—"}</TableCell>
              <TableCell><StatusBadge status={r.status} /></TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => setDetailId(r.sessionId as Id<"examSessions">)}>
                    <Eye className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </tr>
          ))}
      </DataTable>

      {data && (
        <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
      )}

      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="clay max-h-[85vh] overflow-y-auto border-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail ? `${detail.studentName} — ${detail.assessment}` : "Result detail"}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="clay-inset grid grid-cols-2 gap-2 p-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Score</p>
                  <p className="font-bold tabular-nums">{detail.session.correctCount}/{detail.session.stepCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Percentage</p>
                  <p className="font-bold tabular-nums">
                    {detail.percentage !== null ? `${Math.round(detail.percentage)}%` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Integrity</p>
                  <p className="font-bold tabular-nums">
                    {detail.session.confirmedViolations} violation{detail.session.confirmedViolations === 1 ? "" : "s"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-bold">{detail.session.status}</p>
                </div>
              </div>
              <div className="text-sm">
                <Label className="text-xs font-semibold">Question-by-question progression</Label>
                <div className="mt-2 space-y-1.5">
                  {detail.history.map((h) => (
                    <div key={h.step} className="clay-inset flex items-center justify-between px-3 py-2 text-xs">
                      <span>
                        Q{h.step} · {h.bloom}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono">θ {h.thetaBefore.toFixed(2)}→{h.thetaAfter.toFixed(2)}</span>
                        <span className="font-mono">b {h.difficulty.toFixed(2)}</span>
                        <span className={h.correct === 1 ? "font-bold text-[oklch(0.55_0.14_145)]" : h.correct === 0 ? "font-bold text-destructive" : "text-muted-foreground"}>
                          {h.correct === 1 ? "correct" : h.correct === 0 ? "incorrect" : "skipped"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <Link to={`/results/${detail.session._id}`} className="text-sm text-primary hover:underline">
                Open full research report →
              </Link>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

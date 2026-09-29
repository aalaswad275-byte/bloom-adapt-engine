import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { FileBarChart, FileDown, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AdminPageHeader,
  DataTable,
  ScoreBadge,
  StatCard,
  TableCell,
  downloadCsv,
} from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Orgs = {
  institutions: Array<{ value: string; label: string }>;
};

const REPORT_TYPES = [
  { value: "institution", label: "Institution performance" },
  { value: "teaching_center", label: "Teaching center performance" },
  { value: "government_facility", label: "Government facility performance" },
  { value: "student", label: "Student performance" },
  { value: "instructor", label: "Instructor performance" },
  { value: "assessment", label: "Assessment results" },
  { value: "system", label: "Overall system performance" },
];

export default function Reports() {
  const [type, setType] = useState("institution");
  const [institutionId, setInstitutionId] = useState<string>("all");
  const orgs = useQuery(api.adminOrgs.orgOptions, {}) as Orgs | undefined;
  const institutions = useQuery(api.adminOrgs.listInstitutions, {}) as
    | Array<{
        _id: string;
        name: string;
        studentCount: number;
        centerCount: number;
        instructorCount: number;
        avgScore: number | null;
        status: string;
      }>
    | undefined;
  const centers = useQuery(api.adminOrgs.listTeachingCenters, {}) as
    | Array<{
        _id: string;
        name: string;
        institutionName: string;
        studentCount: number;
        instructorCount: number;
        status: string;
      }>
    | undefined;
  const facilities = useQuery(api.adminOrgs.listGovernmentFacilities, {}) as
    | Array<{ _id: string; name: string; personnelCount: number; status: string }>
    | undefined;
  const students = useQuery(api.adminPeople.listStudents, {}) as
    | Array<{ _id: string; name: string; status: string }>
    | undefined;
  const instructors = useQuery(api.adminPeople.listInstructors, {}) as
    | Array<{ _id: string; name: string; specialization?: string; status: string }>
    | undefined;
  const assessments = useQuery(api.adminAnalytics.listAdminAssessments, {}) as
    | Array<{ id: string; title: string; attempts: number; completed: number; avgScore: number | null; passRate: number | null }>
    | undefined;
  const seedDemo = useMutation(api.adminAnalytics.seedAdminDemo);

  const filteredInstitutions = (institutions ?? []).filter(
    (i) => institutionId === "all" || i._id === institutionId,
  );

  const summary = (() => {
    switch (type) {
      case "institution": {
        const rows = filteredInstitutions;
        const scores = rows.map((r) => r.avgScore).filter((v): v is number => v !== null);
        return {
          cards: [
            { label: "Institutions", value: rows.length },
            { label: "Students", value: rows.reduce((a, r) => a + r.studentCount, 0) },
            { label: "Centers", value: rows.reduce((a, r) => a + r.centerCount, 0) },
            {
              label: "Avg score",
              value: scores.length ? `${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}%` : "—",
            },
          ],
        };
      }
      case "teaching_center": {
        const rows = centers ?? [];
        return {
          cards: [
            { label: "Centers", value: rows.length },
            { label: "Students", value: rows.reduce((a, r) => a + r.studentCount, 0) },
            { label: "Instructors", value: rows.reduce((a, r) => a + r.instructorCount, 0) },
            { label: "Active", value: rows.filter((r) => r.status === "active").length },
          ],
        };
      }
      case "government_facility": {
        const rows = facilities ?? [];
        return {
          cards: [
            { label: "Facilities", value: rows.length },
            { label: "Personnel", value: rows.reduce((a, r) => a + r.personnelCount, 0) },
            { label: "Active", value: rows.filter((r) => r.status === "active").length },
            { label: "Inactive", value: rows.filter((r) => r.status !== "active").length },
          ],
        };
      }
      case "student":
      case "instructor": {
        const rows = (type === "student" ? students : instructors) ?? [];
        return {
          cards: [
            { label: type === "student" ? "Students" : "Instructors", value: rows.length },
            { label: "Active", value: rows.filter((r) => r.status === "active").length },
            { label: "Inactive", value: rows.filter((r) => r.status !== "active").length },
            { label: "Report type", value: type === "student" ? "Student performance" : "Instructor performance" },
          ],
        };
      }
      case "assessment": {
        const rows = assessments ?? [];
        const scores = rows.map((r) => r.avgScore).filter((v): v is number => v !== null);
        return {
          cards: [
            { label: "Assessments", value: rows.length },
            { label: "Attempts", value: rows.reduce((a, r) => a + r.attempts, 0) },
            { label: "Completions", value: rows.reduce((a, r) => a + r.completed, 0) },
            {
              label: "Avg score",
              value: scores.length ? `${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}%` : "—",
            },
          ],
        };
      }
      default: {
        const rows = filteredInstitutions;
        return {
          cards: [
            { label: "Institutions", value: rows.length },
            { label: "Students", value: rows.reduce((a, r) => a + r.studentCount, 0) },
            { label: "Assessments", value: (assessments ?? []).length },
            { label: "Attempts", value: (assessments ?? []).reduce((a, r) => a + r.attempts, 0) },
          ],
        };
      }
    }
  })();

  const reportTitle = REPORT_TYPES.find((r) => r.value === type)?.label ?? "Report";

  const currentRows = (): { headers: string[]; rows: Array<Array<string | number | null>> } => {
    switch (type) {
      case "institution":
      case "system":
        return {
          headers: ["Institution", "Status", "Students", "Centers", "Instructors", "Avg score %"],
          rows: filteredInstitutions.map((r) => [
            r.name, r.status, r.studentCount, r.centerCount, r.instructorCount,
            r.avgScore !== null ? Math.round(r.avgScore) : null,
          ]),
        };
      case "teaching_center":
        return {
          headers: ["Center", "Institution", "Students", "Instructors", "Status"],
          rows: (centers ?? []).map((r) => [r.name, r.institutionName, r.studentCount, r.instructorCount, r.status]),
        };
      case "government_facility":
        return {
          headers: ["Facility", "Personnel", "Status"],
          rows: (facilities ?? []).map((r) => [r.name, r.personnelCount, r.status]),
        };
      case "student":
        return {
          headers: ["Student", "Status"],
          rows: (students ?? []).map((r) => [r.name, r.status]),
        };
      case "instructor":
        return {
          headers: ["Instructor", "Specialization", "Status"],
          rows: (instructors ?? []).map((r) => [r.name, r.specialization ?? "", r.status]),
        };
      case "assessment":
        return {
          headers: ["Assessment", "Attempts", "Completed", "Avg %", "Pass %"],
          rows: (assessments ?? []).map((r) => [
            r.title, r.attempts, r.completed,
            r.avgScore !== null ? Math.round(r.avgScore) : null,
            r.passRate !== null ? Math.round(r.passRate) : null,
          ]),
        };
      default:
        return { headers: [], rows: [] };
    }
  };

  const table = currentRows();

  return (
    <>
      <AdminPageHeader
        title="Reports"
        subtitle="Generate performance reports with live data and export them"
        actions={
          <>
            <Button
              variant="outline"
              className="clay-press rounded-full"
              onClick={() => window.print()}
            >
              <Printer className="mr-1.5 size-4" /> Print / PDF
            </Button>
            <Button
              className="clay-press rounded-full"
              onClick={() =>
                downloadCsv(
                  `${type}-report-${new Date().toISOString().slice(0, 10)}.csv`,
                  table.headers,
                  table.rows,
                )
              }
            >
              <FileDown className="mr-1.5 size-4" /> Export CSV
            </Button>
          </>
        }
      />

      <div className="clay mb-6 grid gap-4 p-5 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Report type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Institution filter</Label>
          <Select value={institutionId} onValueChange={setInstitutionId}>
            <SelectTrigger className="rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All institutions</SelectItem>
              {(orgs?.institutions ?? []).map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid content-end">
          <Input
            value={new Date().toLocaleDateString()}
            readOnly
            className="clay-inset rounded-full px-4 text-xs"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Report title: {reportTitle}
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {summary.cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} />
        ))}
      </div>

      <DataTable headers={table.headers} empty={table.rows.length === 0} colSpan={Math.max(1, table.headers.length)}>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <TableCell key={j} className="text-xs">
                {j === row.length - 1 && typeof cell === "number" ? (
                  <ScoreBadge pct={cell} />
                ) : (
                  String(cell ?? "—")
                )}
              </TableCell>
            ))}
          </tr>
        ))}
      </DataTable>

      <div className="clay mt-6 flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
        <p className="flex items-center gap-2 text-muted-foreground">
          <FileBarChart className="size-4 text-primary" />
          Need demo data to explore reports? The seed creates a full institution
          hierarchy with real assessment sessions.
        </p>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={async () => {
            try {
              const res = await seedDemo();
              toast.success(
                res?.seeded ? "Demo org data seeded" : "Demo data already present",
              );
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Seed failed");
            }
          }}
        >
          Seed demo org data
        </Button>
      </div>
    </>
  );
}

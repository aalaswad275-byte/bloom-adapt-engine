import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import { Eye, GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHeader,
  AdminToolbar,
  DataTable,
  ScoreBadge,
  StatCard,
  StatusBadge,
  TableCell,
  downloadCsv,
  useConfirmAction,
} from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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

type Student = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  institutionId?: Id<"institutions">;
  teachingCenterId?: Id<"teachingCenters">;
  governmentFacilityId?: Id<"governmentFacilities">;
  instructorId?: Id<"instructors">;
  enrolledAt: number;
  status: "active" | "inactive";
};

type Orgs = {
  institutions: Array<{ value: string; label: string }>;
  centers: Array<{ value: string; label: string; institutionId: string }>;
  facilities: Array<{ value: string; label: string }>;
  instructors: Array<{ value: string; label: string }>;
};

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  institutionId: "none",
  teachingCenterId: "none",
  governmentFacilityId: "none",
  instructorId: "none",
};

export default function Students() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("all");
  const rows = useQuery(api.adminPeople.listStudents, {
    search: search || undefined,
    status: status === "all" ? undefined : status,
  }) as Student[] | undefined;
  const orgs = useQuery(api.adminOrgs.orgOptions, {}) as Orgs | undefined;

  const create = useMutation(api.adminPeople.createStudent);
  const update = useMutation(api.adminPeople.updateStudent);
  const setStatusMut = useMutation(api.adminPeople.setStudentStatus);
  const remove = useMutation(api.adminPeople.deleteStudent);
  const { confirm, element } = useConfirmAction();

  const [editing, setEditing] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const orgLabel = useMemo(() => {
    const m = new Map<string, string>();
    orgs?.institutions.forEach((i) => m.set(i.value, i.label));
    orgs?.centers.forEach((c) => m.set(c.value, c.label));
    orgs?.facilities.forEach((f) => m.set(f.value, f.label));
    orgs?.instructors.forEach((i) => m.set(i.value, i.label));
    return m;
  }, [orgs]);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const none = (v: string) => (v === "none" ? undefined : (v as Id<never>));
    const payload = {
      name: form.name.trim(),
      email: form.email || undefined,
      phone: form.phone || undefined,
      institutionId: none(form.institutionId) as Id<"institutions"> | undefined,
      teachingCenterId: none(form.teachingCenterId) as Id<"teachingCenters"> | undefined,
      governmentFacilityId: none(form.governmentFacilityId) as Id<"governmentFacilities"> | undefined,
      instructorId: none(form.instructorId) as Id<"instructors"> | undefined,
    };
    try {
      if (editing) {
        await update({ id: editing._id as Id<"students">, fields: payload });
        toast.success("Student updated");
      } else {
        await create(payload);
        toast.success("Student created");
      }
      setCreating(false);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const list = rows ?? [];

  return (
    <>
      {element}
      <AdminPageHeader
        title="Students"
        subtitle="All learners across institutions, centers, and government facilities"
        actions={
          <>
            <Button
              variant="outline"
              className="clay-press rounded-full"
              onClick={() =>
                downloadCsv(
                  "students.csv",
                  ["Name", "Email", "Status", "Enrolled", "Institution"],
                  list.map((r) => [
                    r.name,
                    r.email ?? null,
                    r.status,
                    new Date(r.enrolledAt).toISOString().slice(0, 10),
                    r.institutionId ? (orgLabel.get(r.institutionId) ?? "") : "",
                  ]),
                )
              }
            >
              Export CSV
            </Button>
            <Button className="clay-press rounded-full" onClick={() => { setForm(EMPTY); setCreating(true); }}>
              <Plus className="mr-1.5 size-4" /> Add student
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Students" value={list.length} icon={<GraduationCap className="size-4 text-primary" />} />
        <StatCard label="Active" value={list.filter((r) => r.status === "active").length} />
        <StatCard label="Inactive" value={list.filter((r) => r.status === "inactive").length} />
        <StatCard label="Newest" value={list[0]?.name ?? "—"} hint={list[0] ? `enrolled ${new Date(list[0].enrolledAt).toLocaleDateString()}` : undefined} />
      </div>

      <AdminToolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} />

      <DataTable
        headers={["Student", "Institution", "Center / facility", "Instructor", "Enrolled", "Status", ""]}
        empty={list.length === 0}
        colSpan={7}
      >
        {list.map((r) => (
          <tr key={r._id} className="hover:bg-[var(--accent)]/40">
            <TableCell>
              <Link to={`/admin/students/${r._id}/performance`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <p className="text-xs text-muted-foreground">{r.email ?? ""}</p>
            </TableCell>
            <TableCell className="text-xs">{r.institutionId ? (orgLabel.get(r.institutionId) ?? "—") : "—"}</TableCell>
            <TableCell className="text-xs">
              {r.teachingCenterId
                ? (orgLabel.get(r.teachingCenterId) ?? "—")
                : r.governmentFacilityId
                  ? (orgLabel.get(r.governmentFacilityId) ?? "—")
                  : "—"}
            </TableCell>
            <TableCell className="text-xs">{r.instructorId ? (orgLabel.get(r.instructorId) ?? "—") : "—"}</TableCell>
            <TableCell className="text-xs">{new Date(r.enrolledAt).toLocaleDateString()}</TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button asChild variant="ghost" size="icon" className="size-8 rounded-full">
                  <Link to={`/admin/students/${r._id}/performance`}><Eye className="size-4" /></Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => {
                  setForm({
                    name: r.name,
                    email: r.email ?? "",
                    phone: r.phone ?? "",
                    institutionId: r.institutionId ?? "none",
                    teachingCenterId: r.teachingCenterId ?? "none",
                    governmentFacilityId: r.governmentFacilityId ?? "none",
                    instructorId: r.instructorId ?? "none",
                  });
                  setEditing(r);
                }}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-2 text-xs"
                  onClick={() =>
                    confirm({
                      title: r.status === "active" ? "Deactivate student?" : "Activate student?",
                      description: `${r.name} will be set to ${r.status === "active" ? "inactive" : "active"}.`,
                      run: async () => {
                        await setStatusMut({
                          id: r._id as Id<"students">,
                          status: r.status === "active" ? "inactive" : "active",
                        });
                        toast.success("Status updated");
                      },
                    })
                  }
                >
                  {r.status === "active" ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full text-destructive"
                  onClick={() =>
                    confirm({
                      title: "Delete student?",
                      description: `${r.name} will be permanently removed. Assessment history rows remain for research integrity.`,
                      run: async () => {
                        await remove({ id: r._id as Id<"students"> });
                        toast.success("Student deleted");
                      },
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </TableCell>
          </tr>
        ))}
      </DataTable>

      <Dialog open={creating || editing !== null} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="clay border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit student" : "Add student"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Full name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="clay-inset rounded-full px-4" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
            </div>
            <OrgSelect
              label="Institution"
              value={form.institutionId}
              onChange={(v) => setForm({ ...form, institutionId: v })}
              options={orgs?.institutions ?? []}
            />
            <OrgSelect
              label="Teaching center"
              value={form.teachingCenterId}
              onChange={(v) => setForm({ ...form, teachingCenterId: v })}
              options={orgs?.centers ?? []}
            />
            <OrgSelect
              label="Government facility"
              value={form.governmentFacilityId}
              onChange={(v) => setForm({ ...form, governmentFacilityId: v })}
              options={orgs?.facilities ?? []}
            />
            <OrgSelect
              label="Instructor"
              value={form.instructorId}
              onChange={(v) => setForm({ ...form, instructorId: v })}
              options={orgs?.instructors ?? []}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button className="rounded-full" onClick={() => void save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrgSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="rounded-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Unassigned</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

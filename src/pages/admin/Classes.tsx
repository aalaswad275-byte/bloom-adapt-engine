import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { GraduationCap, Layers, Pencil, Plus, Trash2 } from "lucide-react";
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

type ClassRow = {
  _id: string;
  name: string;
  instructorId: Id<"instructors">;
  institutionId?: Id<"institutions">;
  teachingCenterId?: Id<"teachingCenters">;
  description?: string;
  subject?: string;
  status: "active" | "inactive";
  createdAt: number;
  studentCount: number;
  activeStudents: number;
  avgScore: number | null;
};

type Orgs = {
  institutions: Array<{ value: string; label: string }>;
  centers: Array<{ value: string; label: string; institutionId: string }>;
  instructors: Array<{ value: string; label: string }>;
};

const EMPTY = {
  name: "",
  description: "",
  subject: "",
  instructorId: "none",
  institutionId: "none",
  teachingCenterId: "none",
};

export default function Classes() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("all");
  const [instructorFilter, setInstructorFilter] = useState("all");
  const rows = useQuery(api.adminClasses.listClasses, {
    search: search || undefined,
    status: status === "all" ? undefined : status,
    instructorId:
      instructorFilter === "all"
        ? undefined
        : (instructorFilter as Id<"instructors">),
  }) as ClassRow[] | undefined;
  const orgs = useQuery(api.adminOrgs.orgOptions, {}) as Orgs | undefined;

  const create = useMutation(api.adminClasses.createClass);
  const update = useMutation(api.adminClasses.updateClass);
  const setStatusMut = useMutation(api.adminClasses.setClassStatus);
  const remove = useMutation(api.adminClasses.deleteClass);
  const { confirm, element } = useConfirmAction();

  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const instructorLabel = useMemo(() => {
    const m = new Map<string, string>();
    orgs?.instructors.forEach((i) => m.set(i.value, i.label));
    return m;
  }, [orgs]);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Class name is required");
      return;
    }
    if (form.instructorId === "none") {
      toast.error("Select an instructor for the class");
      return;
    }
    const none = (v: string) => (v === "none" ? undefined : v);
    const payload = {
      name: form.name.trim(),
      description: form.description || undefined,
      subject: form.subject.trim() || undefined,
      instructorId: form.instructorId as Id<"instructors">,
      institutionId: none(form.institutionId) as Id<"institutions"> | undefined,
      teachingCenterId: none(form.teachingCenterId) as
        | Id<"teachingCenters">
        | undefined,
    };
    try {
      if (editing) {
        await update({ id: editing._id as Id<"classes">, fields: payload });
        toast.success("Class updated");
      } else {
        await create(payload);
        toast.success("Class created");
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
        title="Classes"
        subtitle="Instructor-led teaching groups and their rosters"
        actions={
          <>
            <Button
              variant="outline"
              className="clay-press rounded-full"
              onClick={() =>
                downloadCsv(
                  "classes.csv",
                  ["Class", "Instructor", "Students", "Active", "Avg score", "Status"],
                  list.map((r) => [
                    r.name,
                    instructorLabel.get(r.instructorId) ?? "",
                    r.studentCount,
                    r.activeStudents,
                    r.avgScore !== null ? Math.round(r.avgScore) : null,
                    r.status,
                  ]),
                )
              }
            >
              Export CSV
            </Button>
            <Button
              className="clay-press rounded-full"
              onClick={() => {
                setForm(EMPTY);
                setCreating(true);
              }}
            >
              <Plus className="mr-1.5 size-4" /> Add class
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Classes"
          value={list.length}
          icon={<Layers className="size-4 text-primary" />}
        />
        <StatCard
          label="Students enrolled"
          value={list.reduce((a, c) => a + c.studentCount, 0)}
          icon={<GraduationCap className="size-4 text-primary" />}
        />
        <StatCard label="Active classes" value={list.filter((c) => c.status === "active").length} />
        <StatCard
          label="Average score"
          value={
            list.some((c) => c.avgScore !== null)
              ? `${Math.round(
                  list.reduce((a, c) => a + (c.avgScore ?? 0), 0) /
                    list.filter((c) => c.avgScore !== null).length,
                )}%`
              : "—"
          }
        />
      </div>

      <AdminToolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus}>
        <Select value={instructorFilter} onValueChange={setInstructorFilter}>
          <SelectTrigger className="w-52 rounded-full">
            <SelectValue placeholder="All instructors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All instructors</SelectItem>
            {(orgs?.instructors ?? []).map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AdminToolbar>

      <DataTable
        headers={["Class", "Instructor", "Students", "Avg score", "Created", "Status", ""]}
        empty={list.length === 0}
        colSpan={7}
      >
        {list.map((r) => (
          <tr key={r._id} className="hover:bg-[var(--accent)]/40">
            <TableCell>
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                {[r.subject, r.description].filter(Boolean).join(" · ")}
              </p>
            </TableCell>
            <TableCell className="text-xs">
              {instructorLabel.get(r.instructorId) ?? "—"}
            </TableCell>
            <TableCell className="text-xs tabular-nums">
              {r.studentCount} ({r.activeStudents} active)
            </TableCell>
            <TableCell><ScoreBadge pct={r.avgScore} /></TableCell>
            <TableCell className="text-xs">
              {new Date(r.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={() => {
                    setForm({
                      name: r.name,
                      description: r.description ?? "",
                      subject: r.subject ?? "",
                      instructorId: r.instructorId,
                      institutionId: r.institutionId ?? "none",
                      teachingCenterId: r.teachingCenterId ?? "none",
                    });
                    setEditing(r);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-2 text-xs"
                  onClick={() =>
                    confirm({
                      title: r.status === "active" ? "Deactivate class?" : "Activate class?",
                      description: `${r.name} will be set to ${r.status === "active" ? "inactive" : "active"}.`,
                      run: async () => {
                        await setStatusMut({
                          id: r._id as Id<"classes">,
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
                      title: "Delete class?",
                      description: `${r.name} will be removed. Students keep their history but lose class membership.`,
                      run: async () => {
                        await remove({ id: r._id as Id<"classes"> });
                        toast.success("Class deleted");
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

      <Dialog
        open={creating || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="clay border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit class" : "Add class"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Class name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="clay-inset rounded-full px-4"
                placeholder="e.g. Algorithms — Section A"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Subject</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="clay-inset rounded-full px-4"
                placeholder="e.g. English, Physics"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Instructor</Label>
              <Select
                value={form.instructorId}
                onValueChange={(v) => setForm({ ...form, instructorId: v })}
              >
                <SelectTrigger className="rounded-full">
                  <SelectValue placeholder="Choose instructor" />
                </SelectTrigger>
                <SelectContent>
                  {(orgs?.instructors ?? []).map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Institution</Label>
                <Select
                  value={form.institutionId}
                  onValueChange={(v) => setForm({ ...form, institutionId: v })}
                >
                  <SelectTrigger className="rounded-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {(orgs?.institutions ?? []).map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Teaching center</Label>
                <Select
                  value={form.teachingCenterId}
                  onValueChange={(v) => setForm({ ...form, teachingCenterId: v })}
                >
                  <SelectTrigger className="rounded-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {(orgs?.centers ?? []).map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="clay-inset rounded-full px-4"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={() => void save()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

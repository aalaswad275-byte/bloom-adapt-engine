import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import { Eye, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHeader,
  AdminToolbar,
  DataTable,
  StatCard,
  StatusBadge,
  TableCell,
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

type Instructor = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  institutionId?: Id<"institutions">;
  teachingCenterId?: Id<"teachingCenters">;
  specialization?: string;
  status: "active" | "inactive";
};

type Orgs = {
  institutions: Array<{ value: string; label: string }>;
  centers: Array<{ value: string; label: string; institutionId: string }>;
};

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  specialization: "",
  institutionId: "none",
  teachingCenterId: "none",
};

export default function Instructors() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("all");
  const rows = useQuery(api.adminPeople.listInstructors, {
    search: search || undefined,
    status: status === "all" ? undefined : status,
  }) as Instructor[] | undefined;
  const orgs = useQuery(api.adminOrgs.orgOptions, {}) as Orgs | undefined;

  const create = useMutation(api.adminPeople.createInstructor);
  const update = useMutation(api.adminPeople.updateInstructor);
  const setStatusMut = useMutation(api.adminPeople.setInstructorStatus);
  const remove = useMutation(api.adminPeople.deleteInstructor);
  const { confirm, element } = useConfirmAction();

  const [editing, setEditing] = useState<Instructor | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const orgLabel = useMemo(() => {
    const m = new Map<string, string>();
    orgs?.institutions.forEach((i) => m.set(i.value, i.label));
    orgs?.centers.forEach((c) => m.set(c.value, c.label));
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
      specialization: form.specialization || undefined,
      institutionId: none(form.institutionId) as Id<"institutions"> | undefined,
      teachingCenterId: none(form.teachingCenterId) as Id<"teachingCenters"> | undefined,
    };
    try {
      if (editing) {
        await update({ id: editing._id as Id<"instructors">, fields: payload });
        toast.success("Instructor updated");
      } else {
        await create(payload);
        toast.success("Instructor created");
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
        title="Instructors"
        subtitle="Teaching staff with their assignments and performance links"
        actions={
          <Button className="clay-press rounded-full" onClick={() => { setForm(EMPTY); setCreating(true); }}>
            <Plus className="mr-1.5 size-4" /> Add instructor
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Instructors" value={list.length} icon={<UsersRound className="size-4 text-primary" />} />
        <StatCard label="Active" value={list.filter((r) => r.status === "active").length} />
        <StatCard label="With institution" value={list.filter((r) => r.institutionId).length} />
        <StatCard label="Specializations" value={new Set(list.map((r) => r.specialization).filter(Boolean)).size} />
      </div>

      <AdminToolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} />

      <DataTable
        headers={["Instructor", "Specialization", "Institution", "Center", "Status", ""]}
        empty={list.length === 0}
        colSpan={6}
      >
        {list.map((r) => (
          <tr key={r._id} className="hover:bg-[var(--accent)]/40">
            <TableCell>
              <Link to={`/admin/instructors/${r._id}/performance`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <p className="text-xs text-muted-foreground">{r.email ?? ""}</p>
            </TableCell>
            <TableCell className="text-xs">{r.specialization ?? "—"}</TableCell>
            <TableCell className="text-xs">{r.institutionId ? (orgLabel.get(r.institutionId) ?? "—") : "—"}</TableCell>
            <TableCell className="text-xs">{r.teachingCenterId ? (orgLabel.get(r.teachingCenterId) ?? "—") : "—"}</TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button asChild variant="ghost" size="icon" className="size-8 rounded-full">
                  <Link to={`/admin/instructors/${r._id}/performance`}><Eye className="size-4" /></Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => {
                  setForm({
                    name: r.name,
                    email: r.email ?? "",
                    phone: r.phone ?? "",
                    specialization: r.specialization ?? "",
                    institutionId: r.institutionId ?? "none",
                    teachingCenterId: r.teachingCenterId ?? "none",
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
                      title: r.status === "active" ? "Deactivate instructor?" : "Activate instructor?",
                      description: `${r.name} will be set to ${r.status === "active" ? "inactive" : "active"}.`,
                      run: async () => {
                        await setStatusMut({
                          id: r._id as Id<"instructors">,
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
                      title: "Delete instructor?",
                      description: `${r.name} will be removed; their students become unassigned.`,
                      run: async () => {
                        await remove({ id: r._id as Id<"instructors"> });
                        toast.success("Instructor deleted");
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
            <DialogTitle>{editing ? "Edit instructor" : "Add instructor"}</DialogTitle>
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
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Specialization</Label>
              <Input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} className="clay-inset rounded-full px-4" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Institution</Label>
              <Select value={form.institutionId} onValueChange={(v) => setForm({ ...form, institutionId: v })}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(orgs?.institutions ?? []).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Teaching center</Label>
              <Select value={form.teachingCenterId} onValueChange={(v) => setForm({ ...form, teachingCenterId: v })}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(orgs?.centers ?? []).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

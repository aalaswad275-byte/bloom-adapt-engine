import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import { Eye, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

type Center = {
  _id: string;
  name: string;
  institutionId: string;
  institutionName: string;
  description?: string;
  address?: string;
  city?: string;
  contactInfo?: string;
  manager?: string;
  status: "active" | "inactive";
  studentCount: number;
  instructorCount: number;
};

const EMPTY = {
  name: "",
  institutionId: "",
  description: "",
  address: "",
  city: "",
  contactInfo: "",
  manager: "",
};

export default function TeachingCenters() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("all");
  const rows = useQuery(api.adminOrgs.listTeachingCenters, {
    search: search || undefined,
    status: status === "all" ? undefined : status,
  }) as Center[] | undefined;
  const orgs = useQuery(api.adminOrgs.orgOptions, {}) as
    | { institutions: Array<{ value: string; label: string }> }
    | undefined;

  const create = useMutation(api.adminOrgs.createTeachingCenter);
  const update = useMutation(api.adminOrgs.updateTeachingCenter);
  const setStatusMut = useMutation(api.adminOrgs.setTeachingCenterStatus);
  const remove = useMutation(api.adminOrgs.deleteTeachingCenter);
  const { confirm, element } = useConfirmAction();

  const [editing, setEditing] = useState<Center | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const save = async () => {
    if (!form.name.trim() || !form.institutionId) {
      toast.error("Name and parent institution are required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      institutionId: form.institutionId as Id<"institutions">,
      description: form.description || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      contactInfo: form.contactInfo || undefined,
      manager: form.manager || undefined,
    };
    try {
      if (editing) {
        await update({ id: editing._id as Id<"teachingCenters">, fields: payload });
        toast.success("Teaching center updated");
      } else {
        await create(payload);
        toast.success("Teaching center created");
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
        title="Teaching centers"
        subtitle="Centers belonging to institutions, with instructors and students"
        actions={
          <Button className="clay-press rounded-full" onClick={() => { setForm(EMPTY); setCreating(true); }}>
            <Plus className="mr-1.5 size-4" /> Add teaching center
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Centers" value={list.length} icon={<Landmark className="size-4 text-primary" />} />
        <StatCard label="Active" value={list.filter((r) => r.status === "active").length} />
        <StatCard label="Students" value={list.reduce((a, r) => a + r.studentCount, 0)} />
        <StatCard label="Instructors" value={list.reduce((a, r) => a + r.instructorCount, 0)} />
      </div>

      <AdminToolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} />

      <DataTable headers={["Center", "Institution", "City", "Manager", "Status", "Students", "Instructors", ""]} empty={list.length === 0} colSpan={8}>
        {list.map((r) => (
          <tr key={r._id} className="hover:bg-[var(--accent)]/40">
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-xs">{r.institutionName}</TableCell>
            <TableCell className="text-xs">{r.city ?? "—"}</TableCell>
            <TableCell className="text-xs">{r.manager ?? "—"}</TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell className="tabular-nums">{r.studentCount}</TableCell>
            <TableCell className="tabular-nums">{r.instructorCount}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => {
                  setForm({
                    name: r.name,
                    institutionId: r.institutionId,
                    description: r.description ?? "",
                    address: r.address ?? "",
                    city: r.city ?? "",
                    contactInfo: r.contactInfo ?? "",
                    manager: r.manager ?? "",
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
                      title: r.status === "active" ? "Deactivate center?" : "Activate center?",
                      description: `${r.name} will be set to ${r.status === "active" ? "inactive" : "active"}.`,
                      run: async () => {
                        await setStatusMut({
                          id: r._id as Id<"teachingCenters">,
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
                      title: "Delete teaching center?",
                      description: `${r.name} will be permanently removed. Fails while it still has students or instructors.`,
                      run: async () => {
                        await remove({ id: r._id as Id<"teachingCenters"> });
                        toast.success("Teaching center deleted");
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
            <DialogTitle>{editing ? "Edit teaching center" : "Add teaching center"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="clay-inset rounded-full px-4" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Parent institution</Label>
              <Select value={form.institutionId} onValueChange={(v) => setForm({ ...form, institutionId: v })}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Choose institution" /></SelectTrigger>
                <SelectContent>
                  {(orgs?.institutions ?? []).map((i) => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="clay-inset min-h-16 rounded-2xl" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Contact</Label>
                <Input value={form.contactInfo} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Manager</Label>
                <Input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
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

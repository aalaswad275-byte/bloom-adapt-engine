import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

type Facility = {
  _id: string;
  name: string;
  sector?: string;
  department?: string;
  description?: string;
  location?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  headcount?: number;
  status: "active" | "inactive";
  personnelCount: number;
};

const EMPTY = {
  name: "",
  sector: "",
  department: "",
  description: "",
  location: "",
  contactPerson: "",
  phone: "",
  email: "",
  headcount: "",
};

export default function GovernmentFacilities() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("all");
  const rows = useQuery(api.adminOrgs.listGovernmentFacilities, {
    search: search || undefined,
    status: status === "all" ? undefined : status,
  }) as Facility[] | undefined;

  const create = useMutation(api.adminOrgs.createGovernmentFacility);
  const update = useMutation(api.adminOrgs.updateGovernmentFacility);
  const setStatusMut = useMutation(api.adminOrgs.setGovernmentFacilityStatus);
  const remove = useMutation(api.adminOrgs.deleteGovernmentFacility);
  const { confirm, element } = useConfirmAction();

  const [editing, setEditing] = useState<Facility | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      sector: form.sector || undefined,
      department: form.department || undefined,
      description: form.description || undefined,
      location: form.location || undefined,
      contactPerson: form.contactPerson || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      headcount: form.headcount ? Number(form.headcount) : undefined,
    };
    try {
      if (editing) {
        await update({ id: editing._id as Id<"governmentFacilities">, fields: payload });
        toast.success("Facility updated");
      } else {
        await create(payload);
        toast.success("Facility created");
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
        title="Government facilities"
        subtitle="Ministries, agencies, and public training wings in the assessment program"
        actions={
          <Button className="clay-press rounded-full" onClick={() => { setForm(EMPTY); setCreating(true); }}>
            <Plus className="mr-1.5 size-4" /> Add facility
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Facilities" value={list.length} icon={<Landmark className="size-4 text-primary" />} />
        <StatCard label="Active" value={list.filter((r) => r.status === "active").length} />
        <StatCard label="Personnel" value={list.reduce((a, r) => a + r.personnelCount, 0)} />
        <StatCard
          label="Declared headcount"
          value={list.reduce((a, r) => a + (r.headcount ?? 0), 0)}
        />
      </div>

      <AdminToolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} />

      <DataTable headers={["Facility", "Sector / dept.", "Location", "Contact", "Status", "Personnel", ""]} empty={list.length === 0} colSpan={7}>
        {list.map((r) => (
          <tr key={r._id} className="hover:bg-[var(--accent)]/40">
            <TableCell className="font-medium">
              {r.name}
              {r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}
            </TableCell>
            <TableCell className="text-xs">
              {[r.sector, r.department].filter(Boolean).join(" · ") || "—"}
            </TableCell>
            <TableCell className="text-xs">{r.location ?? "—"}</TableCell>
            <TableCell className="text-xs">{r.contactPerson ?? "—"}</TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell className="tabular-nums">{r.personnelCount}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => {
                  setForm({
                    name: r.name,
                    sector: r.sector ?? "",
                    department: r.department ?? "",
                    description: r.description ?? "",
                    location: r.location ?? "",
                    contactPerson: r.contactPerson ?? "",
                    phone: r.phone ?? "",
                    email: r.email ?? "",
                    headcount: r.headcount !== undefined ? String(r.headcount) : "",
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
                      title: r.status === "active" ? "Deactivate facility?" : "Activate facility?",
                      description: `${r.name} will be set to ${r.status === "active" ? "inactive" : "active"}.`,
                      run: async () => {
                        await setStatusMut({
                          id: r._id as Id<"governmentFacilities">,
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
                      title: "Delete facility?",
                      description: `${r.name} will be permanently removed. Fails while personnel are still assigned.`,
                      run: async () => {
                        await remove({ id: r._id as Id<"governmentFacilities"> });
                        toast.success("Facility deleted");
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
            <DialogTitle>{editing ? "Edit facility" : "Add government facility"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Facility name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="clay-inset rounded-full px-4" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Government sector</Label>
                <Input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Department</Label>
                <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="clay-inset min-h-16 rounded-2xl" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Contact person</Label>
                <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="clay-inset rounded-full px-4" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold">Employees / students</Label>
                <Input type="number" value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} className="clay-inset rounded-full px-4" />
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

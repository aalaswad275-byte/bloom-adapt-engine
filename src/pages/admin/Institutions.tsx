import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import { Building2, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHeader,
  AdminToolbar,
  DataTable,
  ScoreBadge,
  StatCard,
  StatusBadge,
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
import { Textarea } from "@/components/ui/textarea";
import {
  TableCell,
} from "@/components/ui/table";

type Institution = {
  _id: string;
  name: string;
  type: string;
  description?: string;
  address?: string;
  city?: string;
  region?: string;
  phone?: string;
  email?: string;
  website?: string;
  contactPerson?: string;
  status: "active" | "inactive";
  createdAt: number;
  studentCount: number;
  centerCount: number;
  instructorCount: number;
  avgScore: number | null;
};

const TYPES = [
  { value: "university", label: "University" },
  { value: "institute", label: "Institute" },
  { value: "teaching_center", label: "Teaching Center" },
  { value: "government_facility", label: "Government Facility" },
  { value: "training_center", label: "Training Center" },
  { value: "other", label: "Other" },
];

const EMPTY = {
  name: "",
  type: "university",
  description: "",
  address: "",
  city: "",
  region: "",
  phone: "",
  email: "",
  website: "",
  contactPerson: "",
};

export default function Institutions() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("all");
  const rows = useQuery(api.adminOrgs.listInstitutions, {
    search: search || undefined,
    status: status === "all" ? undefined : status,
  }) as Institution[] | undefined;

  const create = useMutation(api.adminOrgs.createInstitution);
  const update = useMutation(api.adminOrgs.updateInstitution);
  const setStatusMut = useMutation(api.adminOrgs.setInstitutionStatus);
  const remove = useMutation(api.adminOrgs.deleteInstitution);
  const { confirm, element } = useConfirmAction();

  const [editing, setEditing] = useState<Institution | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, type: "university" });

  const openCreate = () => {
    setForm({ ...EMPTY });
    setCreating(true);
  };
  const openEdit = (r: Institution) => {
    setForm({
      name: r.name,
      type: r.type,
      description: r.description ?? "",
      address: r.address ?? "",
      city: r.city ?? "",
      region: r.region ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      website: r.website ?? "",
      contactPerson: r.contactPerson ?? "",
    });
    setEditing(r);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      type: form.type as Institution["type"] as never,
      description: form.description || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      region: form.region || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      website: form.website || undefined,
      contactPerson: form.contactPerson || undefined,
    };
    try {
      if (editing) {
        await update({ id: editing._id as Id<"institutions">, fields: payload });
        toast.success("Institution updated");
      } else {
        await create(payload);
        toast.success("Institution created");
      }
      setCreating(false);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const toggle = (r: Institution) =>
    confirm({
      title: r.status === "active" ? "Deactivate institution?" : "Activate institution?",
      description: `${r.name} will be set to ${r.status === "active" ? "inactive" : "active"}.`,
      run: async () => {
        await setStatusMut({
          id: r._id as Id<"institutions">,
          status: r.status === "active" ? "inactive" : "active",
        });
        toast.success("Status updated");
      },
    });

  const del = (r: Institution) =>
    confirm({
      title: "Delete institution?",
      description: `${r.name} will be permanently removed. This fails while it still has centers or students.`,
      run: async () => {
        await remove({ id: r._id as Id<"institutions"> });
        toast.success("Institution deleted");
      },
    });

  const list = rows ?? [];

  return (
    <>
      {element}
      <AdminPageHeader
        title="Institutions"
        subtitle="Universities, institutes, teaching centers, and government facilities"
        actions={
          <>
            <Button variant="outline" className="clay-press rounded-full"
              onClick={() =>
                downloadCsv(
                  "institutions.csv",
                  ["Name", "Type", "City", "Status", "Students", "Centers", "Instructors", "Avg score"],
                  list.map((r) => [r.name, r.type, r.city ?? null, r.status, r.studentCount, r.centerCount, r.instructorCount, r.avgScore !== null ? Math.round(r.avgScore) : null]),
                )
              }
            >
              Export CSV
            </Button>
            <Button className="clay-press rounded-full" onClick={openCreate}>
              <Plus className="mr-1.5 size-4" /> Add institution
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total" value={list.length} icon={<Building2 className="size-4 text-primary" />} />
        <StatCard label="Active" value={list.filter((r) => r.status === "active").length} />
        <StatCard label="Students" value={list.reduce((a, r) => a + r.studentCount, 0)} />
        <StatCard label="Centers" value={list.reduce((a, r) => a + r.centerCount, 0)} />
      </div>

      <AdminToolbar search={search} onSearch={setSearch} status={status} onStatus={setStatus} />

      <DataTable headers={["Institution", "Type", "Location", "Status", "Students", "Centers", "Avg score", ""]} empty={list.length === 0} colSpan={8}>
        {list.map((r) => (
          <tr key={r._id} className="hover:bg-[var(--accent)]/40">
            <TableCell>
              <Link to={`/admin/institutions/${r._id}`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <p className="text-xs text-muted-foreground">{r.contactPerson ?? r.email ?? ""}</p>
            </TableCell>
            <TableCell className="text-xs">{r.type.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-xs">{[r.city, r.region].filter(Boolean).join(", ") || "—"}</TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell className="tabular-nums">{r.studentCount}</TableCell>
            <TableCell className="tabular-nums">{r.centerCount}</TableCell>
            <TableCell><ScoreBadge pct={r.avgScore !== null ? Math.round(r.avgScore) : null} /></TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button asChild variant="ghost" size="icon" className="size-8 rounded-full">
                  <Link to={`/admin/institutions/${r._id}`}><Eye className="size-4" /></Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => openEdit(r)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 rounded-full px-2 text-xs" onClick={() => toggle(r)}>
                  {r.status === "active" ? "Disable" : "Enable"}
                </Button>
                <Button variant="ghost" size="icon" className="size-8 rounded-full text-destructive" onClick={() => del(r)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </TableCell>
          </tr>
        ))}
      </DataTable>

      <Dialog open={creating || editing !== null} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="clay max-h-[85vh] overflow-y-auto border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit institution" : "Add institution"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="clay-inset rounded-full px-4" />
            </Field>
            <Field label="Type">
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="rounded-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="clay-inset min-h-16 rounded-2xl" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="clay-inset rounded-full px-4" /></Field>
              <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="clay-inset rounded-full px-4" /></Field>
              <Field label="Region"><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="clay-inset rounded-full px-4" /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="clay-inset rounded-full px-4" /></Field>
              <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="clay-inset rounded-full px-4" /></Field>
              <Field label="Website"><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="clay-inset rounded-full px-4" /></Field>
            </div>
            <Field label="Contact person">
              <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="clay-inset rounded-full px-4" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => { setCreating(false); setEditing(null); }}>
              Cancel
            </Button>
            <Button className="rounded-full" onClick={() => void save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
    </div>
  );
}

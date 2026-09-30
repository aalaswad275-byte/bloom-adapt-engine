import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  GraduationCap,
  Layers,
  Loader2,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AdminPageHeader, StatCard } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export default function AdminSettings() {
  const { user } = useAuth();
  const viewer = useQuery(api.adminAnalytics.getAdminViewer) as
    | { role: string | null; email: string | null }
    | undefined;
  const claim = useMutation(api.adminAnalytics.claimAdmin);
  const seed = useMutation(api.adminAnalytics.seedAdminDemo);
  const seedInstr = useMutation(api.instructorPortal.seedInstructorDemo);
  const [busy, setBusy] = useState<string | null>(null);

  const doClaim = async () => {
    setBusy("claim");
    try {
      await claim();
      toast.success("Admin role granted — reload if the menu does not appear.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setBusy(null);
    }
  };

  const doSeed = async () => {
    setBusy("seed");
    try {
      const res = await seed();
      toast.success(res?.seeded ? "Demo org data created" : "Demo data already present");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(null);
    }
  };

  const doSeedInstr = async () => {
    setBusy("seedInstr");
    try {
      const res = await seedInstr();
      toast.success(
        res?.seeded
          ? "Instructor demo classes + rosters created"
          : (res?.reason ?? "Instructor demo data already present"),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <AdminPageHeader
        title="Settings"
        subtitle="Admin account, demo data, and system information"
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="clay p-6">
          <div className="flex items-center gap-2 text-base font-bold">
            <ShieldCheck className="size-5 text-primary" /> Admin access
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Role-based access control is enforced server-side on every admin
            query and mutation. Your session:{" "}
            <span className="font-semibold text-foreground">
              {viewer?.email ?? user?.email ?? "…"}
            </span>{" "}
            · role{" "}
            <span className="font-semibold text-foreground">
              {viewer?.role ?? "none"}
            </span>
          </p>
          {viewer?.role !== "admin" && (
            <Button
              className="clay-press mt-4 rounded-full"
              disabled={busy === "claim"}
              onClick={() => void doClaim()}
            >
              {busy === "claim" && <Loader2 className="mr-2 size-4 animate-spin" />}
              Claim admin role (first admin)
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Self-claim is only possible while no admin exists; afterwards the
            role must be granted by an existing admin directly in the database.
          </p>
        </div>

        <div className="clay p-6">
          <div className="flex items-center gap-2 text-base font-bold">
            <SettingsIcon className="size-5 text-primary" /> Demo data
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Creates a complete institution hierarchy — 3 institutions, 3
            teaching centers, 1 government facility, 3 instructors, 14 students
            — plus real completed assessment sessions and per-question history
            so every dashboard and chart has genuine data underneath.
          </p>
          <Button
            variant="outline"
            className="clay-press mt-4 rounded-full"
            disabled={busy === "seed"}
            onClick={() => void doSeed()}
          >
            {busy === "seed" && <Loader2 className="mr-2 size-4 animate-spin" />}
            Seed demo org data
          </Button>
        </div>

        <div className="clay p-6">
          <div className="flex items-center gap-2 text-base font-bold">
            <Layers className="size-5 text-primary" /> Instructor portal demo
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Creates two demo classes (Sections A &amp; B) for the seeded
            instructor “Dr. Omar Nasser” with 8 students enrolled. Instructors
            then claim their role at{" "}
            <span className="font-semibold text-foreground">/instructor</span>
            {" "}— the first instructor to claim gets linked automatically.
          </p>
          <Button
            variant="outline"
            className="clay-press mt-4 rounded-full"
            disabled={busy === "seedInstr"}
            onClick={() => void doSeedInstr()}
          >
            {busy === "seedInstr" && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Seed instructor classes
          </Button>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <GraduationCap className="size-3.5" />
            Requires “Seed demo org data” to run first.
          </p>
        </div>

        <div className="clay p-6 xl:col-span-2">
          <p className="text-base font-bold">System information</p>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Module" value="Admin console v1" />
            <StatCard label="Backend" value="Convex" hint="role-guarded functions" />
            <StatCard label="Auth" value="Convex Auth" hint="role-based access" />
            <StatCard label="Audit" value="Enabled" hint="all admin actions logged" />
          </div>
        </div>
      </div>
    </>
  );
}

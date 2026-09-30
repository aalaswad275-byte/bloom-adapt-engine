/**
 * Admin layout — responsive sidebar + role gate.
 *
 * Security: RequireAdmin blocks any signed-in user without role === "admin"
 * (server queries independently enforce the same rule, so direct API calls
 * from non-admins fail with Unauthorized even if the UI were bypassed).
 */

import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import {
  Award,
  BarChart3,
  Building2,
  ClipboardList,
  FileBarChart,
  GraduationCap,
  Landmark,
  Layers,
  LayoutDashboard,
  Loader2,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/institutions", label: "Institutions", icon: Building2 },
  { to: "/admin/teaching-centers", label: "Teaching Centers", icon: Landmark },
  {
    to: "/admin/government-facilities",
    label: "Gov. Facilities",
    icon: Landmark,
  },
  { to: "/admin/instructors", label: "Instructors", icon: UsersRound },
  { to: "/admin/classes", label: "Classes", icon: Layers },
  { to: "/admin/students", label: "Students", icon: GraduationCap },
  { to: "/admin/assessments", label: "Assessments", icon: ClipboardList },
  { to: "/admin/results", label: "Results", icon: Award },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/reports", label: "Reports", icon: FileBarChart },
  { to: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "clay-sm bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "text-muted-foreground hover:bg-[var(--accent)] hover:text-foreground",
            )
          }
        >
          <Icon className="size-4 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <ShieldCheck className="mx-auto size-8 text-destructive" />
          <h1 className="mt-4 text-xl font-bold">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAuthenticated
              ? "Your account does not have the admin role."
              : "Sign in with an administrator account to continue."}
          </p>
          <Link to="/auth?returnTo=%2Fadmin" className="mt-6 inline-block">
            <Button className="rounded-full">Sign in as admin</Button>
          </Link>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const { user, signOut } = useAuth();

  return (
    <div className="relative min-h-screen">
      <div className="clay-blob left-[-10%] top-[-6%] size-[300px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-8%] bottom-[10%] size-[260px] bg-[oklch(0.86_0.08_200)]" />

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)]/80 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/admin" className="flex items-center gap-2 font-bold">
          <ShieldCheck className="size-5 text-primary" /> Admin
        </Link>
        <Button variant="outline" size="icon" className="rounded-full" onClick={() => setOpen(!open)}>
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </Button>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 lg:px-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="clay sticky top-6 p-4">
            <Link to="/admin" className="mb-4 flex items-center gap-2 px-2 pt-1 font-bold">
              <ShieldCheck className="size-5 text-primary" /> Admin Console
            </Link>
            <NavLinks />
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <p className="truncate px-3 text-xs text-muted-foreground">
                {user?.email ?? "admin"}
              </p>
              <button
                onClick={() => void signOut()}
                className="mt-1 w-full rounded-2xl px-3 py-2 text-left text-xs text-muted-foreground hover:bg-[var(--accent)] hover:text-foreground"
              >
                Sign out
              </button>
              <Link
                to="/dashboard"
                className="block rounded-2xl px-3 py-2 text-xs text-muted-foreground hover:bg-[var(--accent)] hover:text-foreground"
              >
                ← Student view
              </Link>
            </div>
          </div>
        </aside>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => setOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-[var(--background)] p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold">
                  <ShieldCheck className="size-5 text-primary" /> Admin Console
                </span>
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        )}

        {/* Content */}
        <main className="min-w-0 flex-1 pb-16">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export { NAV as ADMIN_NAV, Users };

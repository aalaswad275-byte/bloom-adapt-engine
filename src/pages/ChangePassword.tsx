import { useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Link } from "react-router";
import {
  ArrowLeft,
  Check,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";

/** Mirrors the minimum enforced by `passwordAuth.setMyPassword`. */
const MIN_LENGTH = 8;

/** Human-readable errors from the sign-in service, as on the auth page. */
function friendlyError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(msg);
    if (parsed && typeof parsed === "object") {
      return parsed.message || parsed.error || parsed.detail || fallback;
    }
  } catch {
    /* not JSON — fall through */
  }
  return msg || fallback;
}

/**
 * Account security page: change (or set, for accounts that never picked one)
 * the signed-in user's password.
 *
 * The current password is re-checked with `passwordAuth.verifyPassword`
 * before `setMyPassword` writes the new hash, so a hijacked tab still needs
 * the existing credential.
 */
export default function ChangePassword() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const convex = useConvex();
  const email = user?.email ?? "";

  const account = useQuery(
    api.passwordAuth.getAccountStatus,
    email ? { email } : "skip",
  );
  const setMyPassword = useMutation(api.passwordAuth.setMyPassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPassword = account?.hasPassword ?? false;

  const doSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (next.length < MIN_LENGTH) {
      setError(`Choose a password of at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      if (hasPassword) {
        const result = await convex.query(api.passwordAuth.verifyPassword, {
          email,
          password: current,
        });
        if (result.status !== "ok") {
          setError("Your current password is incorrect.");
          return;
        }
      }

      const saved = await setMyPassword({ password: next });
      if (!saved.success) {
        setError(saved.error ?? "Your password could not be saved.");
        return;
      }

      toast.success(
        hasPassword ? "Password updated" : "Password set for your account",
      );
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(friendlyError(err, "Could not update your password."));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || (email && account === undefined)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <h1 className="text-xl font-bold">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to change your password.
          </p>
          <Link
            to={`/auth?returnTo=${encodeURIComponent("/change-password")}`}
            className="mt-5 inline-block"
          >
            <Button className="rounded-full">Sign in</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!email) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="clay max-w-md p-8 text-center">
          <Lock className="mx-auto size-8 text-primary" />
          <h1 className="mt-3 text-xl font-bold">No email on this account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A password is tied to an email address. This session has no email
            attached, so there is nothing to set a password for.
          </p>
          <Link to="/dashboard" className="mt-5 inline-block">
            <Button variant="outline" className="rounded-full">
              <ArrowLeft className="mr-1.5 size-4" /> Back to dashboard
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="clay-blob left-[-8%] top-[-8%] size-[320px] bg-[oklch(0.85_0.09_320)]" />
      <div className="clay-blob right-[-6%] bottom-[10%] size-[280px] bg-[oklch(0.86_0.08_200)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center gap-3 px-6 pt-8">
        <Link to="/dashboard">
          <Button variant="outline" size="icon" className="clay-press rounded-full">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div>
          <p className="text-sm font-bold leading-tight">Account security</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </div>
      </header>

      <section className="relative z-10 mx-auto mt-6 w-full max-w-3xl px-6 pb-16">
        <div className="clay p-6 sm:p-8">
          <div className="flex items-center gap-2 text-base font-bold">
            <KeyRound className="size-5 text-primary" />
            {hasPassword ? "Change password" : "Set a password"}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasPassword
              ? "Enter your current password, then choose a new one. You'll use the new password the next time you sign in with Email & Password."
              : "This account doesn't have a password yet — it signs in with an emailed verification code. Choose a password so you can also use Email & Password."}
          </p>

          <form className="mt-6 grid gap-4" onSubmit={(e) => void doSubmit(e)}>
            {hasPassword && (
              <div className="grid gap-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your current password"
                    className="clay-inset rounded-full pl-9"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={`At least ${MIN_LENGTH} characters`}
                    className="clay-inset rounded-full pl-9"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    required
                    minLength={MIN_LENGTH}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat the new password"
                    className="clay-inset rounded-full pl-9"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={MIN_LENGTH}
                  />
                </div>
              </div>
            </div>

            {error && (
              <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                Minimum {MIN_LENGTH} characters. Changing this signs you out of
                nothing — your current session stays active.
              </p>
              <Button
                type="submit"
                className="clay-press shrink-0 rounded-full"
                disabled={
                  busy ||
                  account === undefined ||
                  (hasPassword && current.length === 0) ||
                  next.length < MIN_LENGTH ||
                  next !== confirm
                }
              >
                {busy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Check className="mr-2 size-4" />
                )}
                {hasPassword ? "Update password" : "Set password"}
              </Button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, QueryCtx } from "./_generated/server";
import { audit, requireAdmin } from "./adminLib";

/**
 * Password helpers for accounts that sign in via email verification codes.
 *
 * This deployment registers only the `email-otp` and `anonymous` providers
 * (see auth.ts), so there is no credentials provider that can create a
 * session from a password alone. The password flows therefore work like this:
 *
 *  - Sign-up:    user verifies an emailed code, then `setMyPassword` saves
 *                the password on the (now existing) user. The framework
 *                creates/links the user — we never insert users ourselves,
 *                which avoids duplicate accounts for the same email.
 *  - Sign-in:    `verifyPassword` checks the password, then the client sends
 *                an emailed code that completes the sign-in.
 *  - Reset:      user verifies an emailed code (signed in), then
 *                `setMyPassword` sets the new password.
 */

// SHA-256 hex hash (matches the existing `users.password` convention)
async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Find a user by email. The `email` index matches exactly (the auth
 * framework stores the email exactly as typed), so try the exact match
 * first, then common casings, then a bounded case-insensitive fallback.
 */
async function findUserByEmail(ctx: QueryCtx, email: string) {
  const trimmed = email.trim();
  const exact = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", trimmed))
    .first();
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  const lowered = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", lower))
    .first();
  if (lowered) return lowered;

  // Last resort for other casings (v1 user table is small).
  const users = await ctx.db.query("users").take(1000);
  return users.find((u) => u.email?.toLowerCase() === lower) ?? null;
}

/**
 * The shared default password applied to every account by
 * `setDefaultPasswordsForAll`. Change this string to change the default.
 */
export const DEFAULT_PASSWORD = "Assessment123!@#";

/**
 * Admin-only: set the default password on every account.
 *
 * Each user's stored hash is replaced with `hashPassword(DEFAULT_PASSWORD)`,
 * so all accounts can sign in with the shared default until the owner changes
 * it. Accounts that already carry the default are skipped, and the run is
 * written to the audit log.
 */
export const setDefaultPasswordsForAll = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const hash = await hashPassword(DEFAULT_PASSWORD);
    const users = await ctx.db.query("users").collect();

    let updated = 0;
    for (const user of users) {
      if (user.password === hash) continue;
      await ctx.db.patch(user._id, { password: hash });
      updated += 1;
    }

    await audit(ctx, admin, {
      action: "auth.default_password_applied",
      entity: "users",
      detail: `Default password applied to ${updated} of ${users.length} accounts`,
      newValue: { updated, total: users.length },
    });

    return { total: users.length, updated, password: DEFAULT_PASSWORD };
  },
});

/** Whether an account exists for the email and if it already has a password. */
export const getAccountStatus = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await findUserByEmail(ctx, email);
    return { exists: user !== null, hasPassword: !!user?.password };
  },
});

/**
 * Check an email/password pair. "no_password" is returned when the account
 * does not exist or has no password set — the UI then points the user at the
 * verification-code method instead of revealing whether the email exists.
 */
export const verifyPassword = query({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const user = await findUserByEmail(ctx, email);
    if (!user || !user.password) {
      return { status: "no_password" as const };
    }
    const hash = await hashPassword(password);
    return { status: (hash === user.password ? "ok" : "invalid") as "ok" | "invalid" };
  },
});

/**
 * Resolver for the `password` credentials provider (see
 * `src/convex/auth/password.ts`).
 *
 * `authorize` runs inside an action, which has no `ctx.db`, so the provider
 * calls this query and gets the user id back only when the SHA-256 hash of
 * the supplied password matches the stored one. It is the same comparison
 * `verifyPassword` performs — it just reports which of the three cases
 * applies so the provider can explain the failure instead of a bare "denied".
 */
export const resolvePasswordUser = query({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const user = await findUserByEmail(ctx, email);
    if (user === null) return { status: "unknown" as const };
    if (!user.password) return { status: "no_password" as const };
    const hash = await hashPassword(password);
    return hash === user.password
      ? { status: "ok" as const, userId: user._id }
      : { status: "invalid" as const };
  },
});

/**
 * Save the password for the currently signed-in user. Called right after the
 * emailed code completes sign-in (account creation and password reset).
 */
export const setMyPassword = mutation({
  args: {
    password: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { password, name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { success: false, error: "Not signed in — verify the emailed code first" };
    }
    if (password.length < 8) {
      return { success: false, error: "Password must be at least 8 characters" };
    }
    await ctx.db.patch(userId, {
      password: await hashPassword(password),
      ...(name ? { name } : {}),
    });
    return { success: true, message: "Password saved" };
  },
});

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, QueryCtx } from "./_generated/server";

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

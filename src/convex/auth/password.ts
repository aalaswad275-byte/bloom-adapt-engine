import type { GenericId } from "convex/values";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { api } from "../_generated/api";

/** What `passwordAuth.resolvePasswordUser` reports back. */
type PasswordResolution =
  | { status: "ok"; userId: GenericId<"users"> }
  | { status: "no_password" }
  | { status: "unknown" }
  | { status: "invalid" };

/**
 * Email + password sign-in that completes in a single step.
 *
 * The `email-otp` provider always runs in two steps (send a code, then verify
 * it), which is right for the Verification Code tab but wrong for the
 * Email & Password tab: there the user has already proven they know the
 * password, so making them also open their inbox is a second, redundant
 * hurdle. This provider makes the password check itself the sign-in.
 *
 * `authorize` deliberately trusts nothing the client sends beyond the two
 * strings it was handed — it re-derives the user server-side through
 * `passwordAuth.resolvePasswordUser`, which compares the SHA-256 hash stored
 * on `users.password`. That is the same record `verifyPassword` checks, so
 * accounts created (or backfilled) through the existing flows work here with
 * no migration.
 *
 * Failures throw rather than return `null`, so the auth page surfaces a
 * specific reason instead of silently staying signed out.
 *
 * The explicit type annotations matter: `api`'s generated type includes this
 * module (through `auth.ts`), so leaving `password` or `result` to be
 * inferred would make TypeScript chase its own tail and collapse them — and
 * the whole `api` object — to `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export const password: ReturnType<typeof ConvexCredentials> = ConvexCredentials(
  {
    id: "password",
    async authorize(
      credentials,
      ctx,
    ): Promise<{ userId: GenericId<"users"> }> {
      const email =
        typeof credentials.email === "string" ? credentials.email.trim() : "";
      const secret =
        typeof credentials.password === "string" ? credentials.password : "";

      if (email === "" || secret === "") {
        throw new Error("Enter your email and password.");
      }

      const result: PasswordResolution = await ctx.runQuery(
        api.passwordAuth.resolvePasswordUser,
        { email, password: secret },
      );

      switch (result.status) {
        case "ok":
          return { userId: result.userId };
        case "no_password":
          throw new Error(
            "This account doesn't have a password yet — sign in with a verification code instead.",
          );
        case "unknown":
          throw new Error(
            "No account with that email yet — use the Verification Code tab to create one.",
          );
        default:
          throw new Error("Invalid email or password. Please try again.");
      }
    },
  },
);

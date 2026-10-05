import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Password hashing using Web Crypto API (available in Convex Node environment)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate a secure random token for password reset
function generateResetToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const passwordAuth = {
  // Request password reset
  requestPasswordReset: mutation({
    args: {
      email: v.string(),
    },
    handler: async (ctx, { email }) => {
      const normalizedEmail = email.toLowerCase().trim();

      // Find user by email
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), normalizedEmail))
        .first();

      if (!user) {
        // Don't reveal if email exists or not (security best practice)
        return {
          success: true,
          message: "If an account exists with this email, a reset link has been sent",
        };
      }

      // Generate reset token
      const token = generateResetToken();
      const createdAt = Date.now();

      // Store reset token in the user record temporarily
      await ctx.db.patch(user._id, {
        _passwordResetToken: token,
        _passwordResetExpiry: createdAt + 60 * 60 * 1000, // 1 hour
      });

      // In production, send email with reset link
      console.log(`Password reset token for ${normalizedEmail}: ${token}`);

      return {
        success: true,
        message: "If an account exists with this email, a reset link has been sent",
      };
    },
  }),

  // Reset password with token
  resetPassword: mutation({
    args: {
      token: v.string(),
      newPassword: v.string(),
    },
    handler: async (ctx, { token, newPassword }) => {
      // Find user with this reset token
      const users = await ctx.db
        .query("users")
        .filter((q) =>
          q.and(
            q.eq(q.field("_passwordResetToken"), token),
            q.neq(q.field("_passwordResetExpiry"), null),
          ),
        )
        .collect();

      if (users.length === 0) {
        return { success: false, error: "Invalid or expired reset token" };
      }

      const user = users[0];
      const expiry = user._passwordResetExpiry as number;

      // Check if token is expired
      if (Date.now() > expiry) {
        // Clean up expired token
        await ctx.db.patch(user._id, {
          _passwordResetToken: undefined,
          _passwordResetExpiry: undefined,
        });
        return { success: false, error: "Reset token has expired" };
      }

      // Hash and save the new password
      const passwordHash = await hashPassword(newPassword);
      await ctx.db.patch(user._id, {
        password: passwordHash,
        _passwordResetToken: undefined,
        _passwordResetExpiry: undefined,
        isAnonymous: false,
      });

      return { success: true, message: "Password updated successfully" };
    },
  }),

  // Check if password reset token is valid
  verifyResetToken: query({
    args: {
      token: v.string(),
    },
    handler: async (ctx, { token }) => {
      const users = await ctx.db
        .query("users")
        .filter((q) =>
          q.and(
            q.eq(q.field("_passwordResetToken"), token),
            q.neq(q.field("_passwordResetExpiry"), null),
          ),
        )
        .collect();

      if (users.length === 0) {
        return { valid: false, error: "Invalid reset token" };
      }

      const user = users[0];
      const expiry = user._passwordResetExpiry as number;

      if (Date.now() > expiry) {
        return { valid: false, error: "Reset token has expired" };
      }

      return {
        valid: true,
        userId: user._id,
        email: user.email,
      };
    },
  }),

  // Get auth methods available
  getAuthMethods: query({
    args: {},
    handler: async () => {
      return {
        google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
        apple: Boolean(process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET),
        password: true,
        code: true,
        anonymous: true,
      };
    },
  }),
};

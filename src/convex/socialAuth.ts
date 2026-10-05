import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Social authentication helpers for Google and Apple.
 *
 * These functions handle linking social accounts to existing users
 * or creating new users when no account exists.
 */

// Link a social account to the current user
export const linkSocialAccount = mutation({
  args: {
    provider: v.union(v.literal("google"), v.literal("apple")),
    providerId: v.string(),
    providerEmail: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { provider, providerId, providerEmail, name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    // Check if this social account is already linked to another user
    const existingLink = await ctx.db
      .query("socialAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("provider"), provider),
          q.eq(q.field("providerId"), providerId),
        ),
      )
      .first();

    if (existingLink && existingLink.userId !== userId) {
      return {
        success: false,
        error: "This social account is already linked to a different user",
      };
    }

    // If social account exists and is linked to this user, skip
    if (existingLink && existingLink.userId === userId) {
      return {
        success: true,
        message: "Social account already linked",
        userId,
      };
    }

    // Check if this email is already associated with another user
    if (providerEmail) {
      const normalizedEmail = providerEmail.toLowerCase().trim();
      const existingUser = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), normalizedEmail))
        .first();

      if (existingUser && existingUser._id !== userId) {
        // Link this social account to the existing user
        await ctx.db.insert("socialAccounts", {
          userId: existingUser._id,
          provider,
          providerId,
          providerEmail: normalizedEmail,
          createdAt: Date.now(),
        });

        return {
          success: true,
          linkedToExisting: true,
          userId: existingUser._id,
          message: "This email is associated with an existing account. You will be signed in to that account.",
        };
      }

      // Update current user's email if not set
      const currentUser = await ctx.db.get(userId);
      if (currentUser && !currentUser.email) {
        await ctx.db.patch(userId, {
          email: normalizedEmail,
        });
      }
    }

    // Link the social account to current user
    await ctx.db.insert("socialAccounts", {
      userId,
      provider,
      providerId,
      providerEmail: providerEmail?.toLowerCase().trim(),
      createdAt: Date.now(),
    });

    // Update user profile with name if provided
    if (name) {
      const currentUser = await ctx.db.get(userId);
      if (currentUser && (!currentUser.name || currentUser.name === undefined)) {
        await ctx.db.patch(userId, {
          name,
        });
      }
    }

    return {
      success: true,
      message: "Social account linked successfully",
      userId,
    };
  },
});

// Get social accounts linked to current user
export const getLinkedSocialAccounts = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const accounts = await ctx.db
      .query("socialAccounts")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    return accounts.map((acc) => ({
      provider: acc.provider,
      providerId: acc.providerId,
      providerEmail: acc.providerEmail,
      linkedAt: acc.createdAt,
    }));
  },
});

// Unlink a social account
export const unlinkSocialAccount = mutation({
  args: {
    provider: v.union(v.literal("google"), v.literal("apple")),
  },
  handler: async (ctx, { provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user
    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Count social accounts
    const socialAccounts = await ctx.db
      .query("socialAccounts")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    const hasPassword = !!user.password;
    const hasOtherSocial = socialAccounts.some((acc) => acc.provider !== provider);
    const hasEmail = !!user.email;

    // Check if we can unlink
    const accountsToRemove = socialAccounts.filter(
      (acc) => acc.provider === provider,
    );

    if (accountsToRemove.length === 0) {
      return { success: false, error: "No such social account linked" };
    }

    // Ensure at least one auth method remains
    if (!hasPassword && !hasOtherSocial && !hasEmail && accountsToRemove.length > 0) {
      return {
        success: false,
        error: "Cannot unlink this account. You must have at least one sign-in method remaining.",
      };
    }

    // Delete the social account links
    for (const acc of accountsToRemove) {
      await ctx.db.delete(acc._id);
    }

    return { success: true, message: "Social account unlinked" };
  },
});

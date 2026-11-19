/** Server-side Gemini generation quotas. Internal mutations only. */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const MIN_INTERVAL_MS = 5_000;
const DEFAULT_DAILY_LIMIT = 50;

function clampInt(
  value: unknown,
  low: number,
  high: number,
  fallback: number,
): number {
  const number =
    typeof value === "number" ? Math.round(value) : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
}

function dailyLimit(): number {
  return clampInt(
    process.env.GEMINI_DAILY_QUESTION_LIMIT,
    1,
    200,
    DEFAULT_DAILY_LIMIT,
  );
}

/** Reserve quota before calling Gemini. */
export const claimQuota = internalMutation({
  args: {
    ownerKey: v.string(),
    dayKey: v.string(),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiGenerationUsage")
      .withIndex("by_owner_day", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("dayKey", args.dayKey),
      )
      .unique();
    const now = Date.now();
    if (existing && now - existing.lastAt < MIN_INTERVAL_MS) {
      const wait = Math.ceil((MIN_INTERVAL_MS - (now - existing.lastAt)) / 1_000);
      throw new Error(`Please wait ${wait}s before generating again.`);
    }
    const used = existing?.questions ?? 0;
    if (used + args.count > dailyLimit()) {
      throw new Error(
        `Daily AI generation limit reached (${dailyLimit()} questions). Try again tomorrow.`,
      );
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        requests: existing.requests + 1,
        questions: used + args.count,
        lastAt: now,
      });
    } else {
      await ctx.db.insert("aiGenerationUsage", {
        ownerKey: args.ownerKey,
        dayKey: args.dayKey,
        requests: 1,
        questions: args.count,
        lastAt: now,
      });
    }
  },
});

/** Return reserved quota when the Gemini request itself fails. */
export const refundQuota = internalMutation({
  args: {
    ownerKey: v.string(),
    dayKey: v.string(),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiGenerationUsage")
      .withIndex("by_owner_day", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("dayKey", args.dayKey),
      )
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      requests: Math.max(0, existing.requests - 1),
      questions: Math.max(0, existing.questions - args.count),
    });
  },
});

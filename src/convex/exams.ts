/**
 * Exam management + one-click seeding (v1: single-user model testing).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { SEED_QUESTIONS } from "./seedData";
import type { BloomLevel, SelectorWeights } from "../lib/irt";

const DEFAULT_DISTRIBUTION: Record<BloomLevel, number> = {
  remember: 0.15,
  understand: 0.2,
  apply: 0.25,
  analyze: 0.2,
  evaluate: 0.1,
  create: 0.1,
};

const DEFAULT_MINIMUMS: Record<BloomLevel, number> = {
  remember: 0.08,
  understand: 0.1,
  apply: 0.1,
  analyze: 0.08,
  evaluate: 0.05,
  create: 0.05,
};

export const listExams = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("exams")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

export const getExam = query({
  args: { examId: v.id("exams") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.examId);
  },
});

/** Idempotent seed: demo exam + full question bank. */
export const seedDatabase = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    // --- Questions: insert any missing (match on questionText) ---
    const existing = await ctx.db.query("questions").collect();
    const knownTexts = new Set(existing.map((q) => q.questionText));
    let inserted = 0;
    for (const sq of SEED_QUESTIONS) {
      if (knownTexts.has(sq.questionText)) continue;
      const now = Date.now();
      await ctx.db.insert("questions", {
        questionText: sq.questionText,
        questionType: sq.questionType,
        bloomLevel: sq.bloomLevel,
        topic: sq.topic,
        learningOutcome: sq.learningOutcome,
        discriminationA: sq.discriminationA,
        difficultyB: sq.difficultyB,
        expectedTime: sq.expectedTime,
        marks: sq.marks,
        correctAnswer: sq.correctAnswer,
        options: sq.options ?? undefined,
        explanation: sq.explanation,
        visualFeatures: undefined,
        source: "seed" as const,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    // --- Demo exam (create once) ---
    const exams = await ctx.db
      .query("exams")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    let exam = exams[0];
    if (!exam) {
      const examId = await ctx.db.insert("exams", {
        title: "Adaptive Diagnostic — Data Structures & Algorithms",
        description:
          "Adaptive 14-question diagnostic across all six Bloom levels. Difficulty, Bloom level, and item selection respond to your ability, response speed, and visual attention.",
        totalQuestions: 14,
        bloomDistribution: DEFAULT_DISTRIBUTION,
        mandatoryMinimums: DEFAULT_MINIMUMS,
        gamma: 0.35,
        delta: 0.25,
        targetProbability: 0.5,
        weights: {
          w1: 1.0,
          w2: 0.8,
          w3: 0.6,
          w4: 0.25,
          w5: 0.7,
          w6: 0.5,
        } as SelectorWeights,
        difficultyRange: { min: -2.5, max: 2.5 },
        timeStrainClip: { low: -1, high: 1 },
        violationThreshold: 3,
        monitoringEnabled: true,
        monitoringConfig: {
          minConfidence: 0.55,
          thresholds: {
            NO_PERSON: 5000,
            PHONE_DETECTED: 2000,
            MULTIPLE_PERSONS: 3000,
            LOOKING_AWAY: 5000,
            IDENTITY_NOT_VERIFIED: 5000,
          },
          warnViolations: 1,
          pauseViolations: 2,
          maxViolations: 3,
          identityVerificationEnabled: false,
          phoneMode: "any_visible" as const,
        },
        showDebugPanel: true,
        active: true,
        createdAt: Date.now(),
      });
      const created = await ctx.db.get(examId);
      if (!created) throw new Error("Failed to create seed exam");
      exam = created;
    }

    if (!exam) throw new Error("Seed exam missing");
    return { examId: exam._id as Id<"exams">, questionsInserted: inserted };
  },
});

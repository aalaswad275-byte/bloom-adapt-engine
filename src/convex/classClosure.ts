/**
 * Class closure + final exam.
 *
 * Closing a class is an instructor-owned finalization step: the roster is
 * frozen, no new regular assessments can start, and one CLASS FINAL is
 * generated from the class question bank using the same adaptive model that
 * scores the rest of the course.
 *
 * The final is a fixed paper:
 *   • the question set is selected once, deterministically, and attached to a
 *     single assessment record — every student gets exactly the same items
 *     and therefore the same total marks;
 *   • each student's presentation order is shuffled from a seed derived only
 *     from the assessment and the student, so orders differ per student but
 *     stay stable across a resume;
 *   • grading runs over the stored presented sequence, so an order change can
 *     never change what is asked or how it is marked.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { audit } from "./adminLib";
import { requireOwnedClass } from "./instructorPortal";
import {
  finalPoolErrors,
  randomTotal,
  selectFinalPaper,
  suggestedFinalCounts,
} from "./assessmentAdaptive";
import { BLOOM_LEVELS, type BloomLevel } from "../lib/irt";

type QuestionDoc = Doc<"instructorQuestions">;

const BLOOM_KEYS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

/** Every question held by the class question bank. */
async function bankQuestionsOf(
  ctx: QueryCtx,
  classId: Id<"classes">,
): Promise<QuestionDoc[]> {
  return await ctx.db
    .query("instructorQuestions")
    .withIndex("by_class", (x) => x.eq("classId", classId))
    .collect();
}

/** Rostered + joined students, deduplicated (a student may be both). */
async function membersOf(ctx: QueryCtx, classId: Id<"classes">) {
  const roster = await ctx.db
    .query("students")
    .withIndex("by_class", (q) => q.eq("classId", classId))
    .collect();
  const enrollments = await ctx.db
    .query("classEnrollments")
    .withIndex("by_class", (q) => q.eq("classId", classId))
    .collect();
  const joinedAt = new Map(
    enrollments.map((e) => [e.studentId, e.joinedAt] as const),
  );
  const members = [...roster];
  for (const e of enrollments) {
    if (!roster.some((s) => s._id === e.studentId)) {
      const doc = await ctx.db.get(e.studentId);
      if (doc) members.push(doc);
    }
  }
  return { members, joinedAt };
}

/** Questions attached to an assessment, in order. */
async function attachedQuestions(
  ctx: QueryCtx,
  assessmentId: Id<"instructorAssessments">,
): Promise<QuestionDoc[]> {
  const links = await ctx.db
    .query("assessmentQuestions")
    .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
    .collect();
  links.sort((a, b) => a.order - b.order);
  const out: QuestionDoc[] = [];
  for (const link of links) {
    const q = await ctx.db.get(link.questionId);
    if (q) out.push(q);
  }
  return out;
}

/**
 * Instructor view of one class's closure state: bank coverage, the generated
 * final (if any), per-student progress, and a fairness audit proving every
 * submission faced the same question set.
 */
export const getClassClosureOverview = query({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const { cls } = await requireOwnedClass(ctx, classId);

    const { members, joinedAt } = await membersOf(ctx, classId);
    const bank = await bankQuestionsOf(ctx, classId);

    const byLevel = BLOOM_LEVELS.reduce(
      (acc, level) => {
        acc[level] = bank.filter((q) => q.bloomLevel === level).length;
        return acc;
      },
      {} as Record<BloomLevel, number>,
    );
    const suggestedCounts = suggestedFinalCounts(bank);

    const priorAssessments = await ctx.db
      .query("instructorAssessments")
      .withIndex("by_class", (x) => x.eq("classId", classId))
      .collect();

    const finalRow = cls.finalAssessmentId
      ? await ctx.db.get(cls.finalAssessmentId)
      : null;
    const finalQuestions = finalRow
      ? await attachedQuestions(ctx, finalRow._id)
      : [];
    const finalSubs = finalRow
      ? await ctx.db
          .query("assessmentSubmissions")
          .withIndex("by_assessment", (x) =>
            x.eq("assessmentId", finalRow._id),
          )
          .collect()
      : [];

    const memberIds = new Set(members.map((m) => m._id));
    const validSubs = finalSubs.filter((s) => memberIds.has(s.studentId));
    const submitted = validSubs.filter((s) => s.status !== "in_progress");
    const scored = submitted.filter(
      (s) => s.score !== undefined && (s.maxScore ?? 0) > 0,
    );
    const pcts = scored.map(
      (s) => ((s.score ?? 0) / (s.maxScore ?? 1)) * 100,
    );

    // Fairness audit: the presented question SET must be identical for every
    // submission (order may differ), and the marked total must match.
    const setKey = (s: Doc<"assessmentSubmissions">) =>
      [...(s.questionSequence ?? [])].sort().join(",");
    const orderKey = (s: Doc<"assessmentSubmissions">) =>
      (s.questionSequence ?? []).join(",");
    const distinctSets = new Set(submitted.map(setKey)).size;
    const distinctOrders = new Set(submitted.map(orderKey)).size;
    const marksSpread = new Set(
      submitted.map((s) => s.maxScore ?? 0),
    ).size;

    const subByStudent = new Map(validSubs.map((s) => [s.studentId, s]));
    const tracking = members
      .map((m) => {
        const sub = subByStudent.get(m._id);
        const pct =
          sub && sub.maxScore && sub.score !== undefined
            ? (sub.score / sub.maxScore) * 100
            : null;
        return {
          studentId: m._id,
          name: m.name,
          email: m.email ?? null,
          joined: joinedAt.has(m._id),
          status:
            sub === undefined
              ? ("not_started" as const)
              : sub.status === "in_progress"
                ? ("in_progress" as const)
                : ("submitted" as const),
          pct,
          submittedAt: sub?.submittedAt ?? null,
          violations: sub?.violationCount ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      class: {
        id: cls._id,
        name: cls.name,
        description: cls.description ?? null,
        status: cls.status,
        closedAt: cls.closedAt ?? null,
        closureNote: cls.closureNote ?? null,
        rosterSize: members.length,
        joinedCount: joinedAt.size,
      },
      bank: {
        total: bank.length,
        byLevel,
        suggestedCounts,
        canBuildFinal: randomTotal(suggestedCounts) > 0,
      },
      prior: {
        assessments: priorAssessments.length,
        published: priorAssessments.filter((a) => a.status === "published")
          .length,
      },
      finalExam: finalRow
        ? {
            id: finalRow._id,
            title: finalRow.title,
            description: finalRow.description ?? null,
            status: finalRow.status,
            timeLimitMin: finalRow.timeLimitMin,
            publishedAt: finalRow.publishedAt ?? null,
            questionCount: finalQuestions.length,
            totalMarks: finalQuestions.reduce((sum, q) => sum + q.marks, 0),
            questions: finalQuestions.map((q, index) => ({
              id: q._id,
              index,
              questionText: q.questionText,
              questionType: q.questionType,
              bloomLevel: q.bloomLevel,
              marks: q.marks,
              difficultyB: q.difficultyB ?? null,
              options: q.options ?? null,
            })),
            submissions: {
              total: validSubs.length,
              inProgress: validSubs.length - submitted.length,
              submitted: submitted.length,
            },
            avgPct:
              pcts.length > 0
                ? pcts.reduce((a, b) => a + b, 0) / pcts.length
                : null,
            passRate:
              pcts.length > 0
                ? (pcts.filter((p) => p >= 50).length / pcts.length) * 100
                : null,
            /** Same set for everyone; only the presentation order differs. */
            fairness: {
              distinctQuestionSets: distinctSets,
              distinctOrders,
              identicalSet: submitted.length === 0 || distinctSets === 1,
              marksSpread,
              identicalMarks: submitted.length === 0 || marksSpread === 1,
            },
          }
        : null,
      tracking,
    };
  },
});

/**
 * Close (finalize) a class. Idempotent: the first closure stamps the time and
 * note, later calls keep them. Closure freezes the roster and stops regular
 * assessments from starting; the generated final stays available.
 */
export const closeMyClass = mutation({
  args: {
    classId: v.id("classes"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { classId, note }) => {
    const { me, cls } = await requireOwnedClass(ctx, classId);
    if (cls.closedAt !== undefined)
      return { closedAt: cls.closedAt, alreadyClosed: true };

    const { members } = await membersOf(ctx, classId);
    if (members.length === 0)
      throw new Error("Add students to this class before closing it.");

    const now = Date.now();
    const cleanNote = note?.trim() || undefined;
    await ctx.db.patch(classId, {
      closedAt: now,
      closureNote: cleanNote,
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "class.closed",
      entity: "classes",
      entityId: classId,
      newValue: { closedAt: now, students: members.length, note: cleanNote },
    });
    return { closedAt: now, alreadyClosed: false };
  },
});

/** Reopen a closed class (undoes the freeze; the final exam row is kept). */
export const reopenMyClass = mutation({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const { me, cls } = await requireOwnedClass(ctx, classId);
    if (cls.closedAt === undefined) return { reopened: false as const };
    await ctx.db.patch(classId, {
      closedAt: undefined,
      closureNote: undefined,
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "class.reopened",
      entity: "classes",
      entityId: classId,
      previousValue: { closedAt: cls.closedAt },
    });
    return { reopened: true as const };
  },
});

/**
 * Build and publish the class final.
 *
 * Requires the class to be closed. Selects one shared paper from the class
 * bank (adaptive model difficulty spread across all six Bloom levels),
 * attaches it to a `selectionMode: "final"` assessment, and publishes it to
 * the roster. Order is NOT fixed here — each student's order is shuffled at
 * start from a per-student seed.
 */
export const createFinalExam = mutation({
  args: {
    classId: v.id("classes"),
    title: v.optional(v.string()),
    timeLimitMin: v.optional(v.number()),
    /** Per-Bloom draw counts; omitted = 4 per level wherever available. */
    counts: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (
    ctx,
    { classId, title, timeLimitMin, counts: requestedCounts },
  ) => {
    const { me, cls } = await requireOwnedClass(ctx, classId);
    if (cls.closedAt === undefined)
      throw new Error("Close the class before creating its final exam.");

    if (cls.finalAssessmentId) {
      const existing = await ctx.db.get(cls.finalAssessmentId);
      if (existing)
        throw new Error(
          `This class already has a final exam (${existing.title}).`,
        );
    }
    if (timeLimitMin !== undefined && timeLimitMin < 0)
      throw new Error("Time limit cannot be negative.");

    const bank = await bankQuestionsOf(ctx, classId);
    if (bank.length === 0)
      throw new Error(
        "The class question bank is empty — add questions before creating a final exam.",
      );

    const counts: Record<string, number> = {};
    for (const level of BLOOM_KEYS) {
      const raw = requestedCounts?.[level] ?? suggestedFinalCounts(bank)[level];
      if (!Number.isFinite(raw) || raw < 0)
        throw new Error(`Question count for "${level}" must be 0 or more.`);
      if (!Number.isInteger(raw))
        throw new Error(`Question count for "${level}" must be a whole number.`);
      counts[level] = raw;
    }
    const errors = finalPoolErrors(bank, counts);
    if (errors.length > 0) throw new Error(errors.join(" "));

    const paper = selectFinalPaper(bank, counts);
    if (paper.length === 0)
      throw new Error("Select at least one question for the final exam.");

    const now = Date.now();
    const assessmentId = await ctx.db.insert("instructorAssessments", {
      classId,
      instructorId: me._id,
      title: title?.trim() || `${cls.name} — Final Exam`,
      description:
        "Class final: every student answers the same questions, each in their own randomized order.",
      timeLimitMin: timeLimitMin ?? 0,
      displayCount: paper.length,
      // Fixed paper presented through the "final" strategy.
      assessmentType: "static",
      selectionMode: "final",
      status: "published",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < paper.length; i++) {
      await ctx.db.insert("assessmentQuestions", {
        assessmentId,
        questionId: paper[i]._id,
        order: i,
      });
    }

    await ctx.db.patch(classId, { finalAssessmentId: assessmentId });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "class.final_exam_created",
      entity: "instructorAssessments",
      entityId: assessmentId,
      newValue: {
        classId,
        questions: paper.length,
        totalMarks: paper.reduce((sum, q) => sum + q.marks, 0),
        counts,
        order: "per-student shuffled",
      },
    });

    return {
      assessmentId,
      questionCount: paper.length,
      totalMarks: paper.reduce((sum, q) => sum + q.marks, 0),
    };
  },
});

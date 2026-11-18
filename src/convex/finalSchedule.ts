/**
 * Enforced scheduling window for Fair Adaptive final exams.
 *
 * The schedule is stored as absolute epoch milliseconds (start = scheduledFor,
 * end = scheduledUntil) plus the instructor's IANA timezone for display. This
 * keeps every client, instructor and student, on the same instant regardless
 * of browser locale.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { audit } from "./adminLib";
import { requireOwnedClass } from "./instructorPortal";
import { finalizeAssessmentSubmission } from "./studentAssessments";

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Store a start/end window for the class final and schedule its auto-close. */
export const scheduleFinalExam = mutation({
  args: {
    assessmentId: v.id("instructorAssessments"),
    startAt: v.number(),
    endAt: v.number(),
    timeZone: v.string(),
  },
  handler: async (ctx, args) => {
    const assessment = await ctx.db.get(args.assessmentId);
    if (!assessment) throw new Error("Assessment not found");
    if (assessment.selectionMode !== "final")
      throw new Error("Scheduling windows apply only to Fair Adaptive finals.");
    const { user, me, cls } = await requireOwnedClass(ctx, assessment.classId);
    if (cls.finalAssessmentId !== assessment._id)
      throw new Error("This assessment is not the class final exam.");

    if (!Number.isFinite(args.startAt) || !Number.isFinite(args.endAt))
      throw new Error("Choose a valid start and end date/time.");
    if (args.startAt >= args.endAt)
      throw new Error("The exam end must be after its start.");
    if (args.endAt <= Date.now())
      throw new Error("The exam end must be in the future.");
    if (!validTimeZone(args.timeZone))
      throw new Error("Choose a valid timezone.");

    // Reject overlapping finals owned by the same instructor. Each class has
    // one final, so an overlap would require simultaneous live monitoring.
    const mine = await ctx.db
      .query("instructorAssessments")
      .withIndex("by_instructor", (x) => x.eq("instructorId", me._id))
      .collect();
    for (const other of mine) {
      if (other._id === assessment._id) continue;
      if (other.selectionMode !== "final") continue;
      if (other.scheduledFor === undefined || other.scheduledUntil === undefined)
        continue;
      if (other.status === "archived") continue;
      const overlaps =
        args.startAt < other.scheduledUntil && args.endAt > other.scheduledFor;
      if (overlaps) {
        throw new Error(
          `This window overlaps the final "${other.title}" (${new Date(
            other.scheduledFor,
          ).toLocaleString()} – ${new Date(
            other.scheduledUntil,
          ).toLocaleString()}).`,
        );
      }
    }

    const previous = {
      startAt: assessment.scheduledFor ?? null,
      endAt: assessment.scheduledUntil ?? null,
      timeZone: assessment.scheduleTimeZone ?? null,
    };
    await ctx.db.patch(assessment._id, {
      scheduledFor: args.startAt,
      scheduledUntil: args.endAt,
      scheduleTimeZone: args.timeZone,
      status: "published",
      publishedAt: assessment.publishedAt ?? Date.now(),
      updatedAt: Date.now(),
    });

    // The job re-checks the stored end before closing, so a later
    // reschedule makes an older job a harmless no-op.
    await ctx.scheduler.runAt(
      args.endAt,
      internal.finalSchedule.closeExpiredFinal,
      { assessmentId: assessment._id },
    );

    await audit(
      ctx,
      { _id: user._id, email: user.email },
      {
        action: "final_exam.scheduled",
        entity: "instructorAssessments",
        entityId: assessment._id,
        previousValue: previous,
        newValue: {
          startAt: args.startAt,
          endAt: args.endAt,
          timeZone: args.timeZone,
        },
        detail: `Final exam window set in ${args.timeZone}`,
      },
    );

    return {
      ok: true as const,
      startAt: args.startAt,
      endAt: args.endAt,
      timeZone: args.timeZone,
    };
  },
});

/** Close a final at its end and grade every attempt already in progress. */
export const closeExpiredFinal = internalMutation({
  args: { assessmentId: v.id("instructorAssessments") },
  handler: async (ctx, { assessmentId }) => {
    const assessment = await ctx.db.get(assessmentId);
    if (!assessment) return { closed: false as const };
    if (
      assessment.selectionMode !== "final" ||
      assessment.scheduledUntil === undefined ||
      assessment.scheduledUntil > Date.now() ||
      assessment.status === "closed" ||
      assessment.status === "archived"
    )
      return { closed: false as const };

    const submissions = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
      .collect();
    let finalized = 0;
    for (const submission of submissions) {
      if (submission.status !== "in_progress") continue;
      await finalizeAssessmentSubmission(
        ctx,
        submission,
        undefined,
        assessment.scheduledUntil,
      );
      finalized += 1;
    }

    await ctx.db.patch(assessment._id, {
      status: "closed",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      action: "final_exam.auto_closed",
      entity: "instructorAssessments",
      entityId: assessmentId,
      newValue: JSON.stringify({
        closedAt: Date.now(),
        scheduledUntil: assessment.scheduledUntil,
        finalizedSubmissions: finalized,
      }),
      detail: `Final exam window ended; ${finalized} in-progress attempt(s) finalized.`,
      timestamp: Date.now(),
    });
    return { closed: true as const, finalized };
  },
});

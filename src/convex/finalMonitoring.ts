/**
 * Live monitoring and instructor review for Fair Adaptive final exams.
 *
 * Security:
 *   • a student can publish only their own in-progress submission;
 *   • only the instructor who owns the final's class can read feeds, dismiss
 *     detections, or flag behaviour;
 *   • every review decision is written to auditLogs;
 *   • detector evidence stays in the submission's violationLog. Dismissal
 *     annotates the original entry instead of deleting it.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { audit, currentUserOf } from "./adminLib";
import { requireOwnedClass } from "./instructorPortal";
import { myStudentRecord } from "./studentAssessments";
import { ASSESSMENT_PROCTOR_CONFIG } from "../lib/monitoring/types";
import { policyForCount } from "../lib/monitoring/engine";

const MAX_FRAME_CHARS = 500_000;
const FRAME_PREFIX = "data:image/jpeg;base64,";

type SubmissionDoc = Doc<"assessmentSubmissions">;

function eventIdOf(
  entry: NonNullable<SubmissionDoc["violationLog"]>[number],
  index: number,
): string {
  return entry.eventId ?? `legacy-${index}`;
}

/** Instructor + owned Fair Adaptive final for read/review operations. */
async function requireOwnedFinal(
  ctx: QueryCtx,
  assessmentId: Id<"instructorAssessments">,
) {
  const assessment = await ctx.db.get(assessmentId);
  if (!assessment) throw new Error("Assessment not found");
  if (assessment.selectionMode !== "final")
    throw new Error(
      "Live final-exam monitoring is only available for Fair Adaptive final exams.",
    );
  const { user, me, cls } = await requireOwnedClass(ctx, assessment.classId);
  return { assessment, user, me, cls };
}

async function classMembers(ctx: QueryCtx, classId: Id<"classes">) {
  const roster = await ctx.db
    .query("students")
    .withIndex("by_class", (x) => x.eq("classId", classId))
    .collect();
  const enrollments = await ctx.db
    .query("classEnrollments")
    .withIndex("by_class", (x) => x.eq("classId", classId))
    .collect();
  const ids = new Set(roster.map((row) => row._id));
  for (const enrollment of enrollments) ids.add(enrollment.studentId);
  return ids;
}

/**
 * Instructor dashboard payload. Convex reactivity pushes new snapshots,
 * violation rows, and review decisions without the student's exam being
 * interrupted or reloaded.
 */
export const getFinalExamLiveDashboard = query({
  args: { assessmentId: v.id("instructorAssessments") },
  handler: async (ctx, { assessmentId }) => {
    const { assessment, cls } = await requireOwnedFinal(ctx, assessmentId);
    const memberIds = await classMembers(ctx, assessment.classId);
    const students: Doc<"students">[] = [];
    for (const studentId of memberIds) {
      const student = await ctx.db.get(studentId);
      if (student) students.push(student);
    }
    students.sort((a, b) => a.name.localeCompare(b.name));

    const submissions = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
      .collect();
    const byStudent = new Map(
      submissions.map((submission) => [submission.studentId, submission] as const),
    );

    const feeds = await ctx.db
      .query("assessmentLiveFeeds")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
      .collect();
    const feedByStudent = new Map(
      feeds.map((feed) => [feed.studentId, feed] as const),
    );

    const rows = [];
    for (const student of students) {
      const submission = byStudent.get(student._id);
      const feed = feedByStudent.get(student._id);
      const identityImageUrl = student.identityImageId
        ? await ctx.storage.getUrl(student.identityImageId)
        : null;
      const violations = (submission?.violationLog ?? []).map((entry, index) => ({
        eventId: eventIdOf(entry, index),
        type: entry.type,
        at: entry.at,
        confidence: entry.confidence,
        durationMs: entry.durationMs ?? null,
        reviewStatus: entry.reviewStatus ?? ("active" as const),
        reviewReason: entry.reviewReason ?? null,
        reviewedAt: entry.reviewedAt ?? null,
      }));
      const activeCount = violations.filter(
        (entry) => entry.reviewStatus !== "dismissed",
      ).length;

      rows.push({
        studentId: student._id,
        name: student.name,
        email: student.email ?? null,
        studentIdNumber: student.studentIdNumber ?? null,
        identityImageUrl,
        faceRegisteredAt: student.faceRegisteredAt ?? null,
        lastFaceCheckAt: student.lastFaceCheckAt ?? null,
        lastFaceCheckStatus: student.lastFaceCheckStatus ?? null,
        submission: submission
          ? {
              id: submission._id,
              status: submission.status,
              startedAt: submission.startedAt,
              timerStartedAt: submission.timerStartedAt ?? null,
              submittedAt: submission.submittedAt ?? null,
              currentQuestionIndex: submission.currentQuestionIndex ?? null,
              violationCount: activeCount,
              rawViolationCount: violations.length,
              dismissedViolationCount:
                submission.dismissedViolationCount ??
                Math.max(0, violations.length - activeCount),
              activeViolationCount: activeCount,
              policyAction: submission.policyAction ?? "NONE",
              riskScore: submission.riskScore ?? 0,
              instructorFlags: submission.instructorFlags ?? [],
            }
          : null,
        violations,
        feed: feed
          ? {
              frameDataUrl: feed.frameDataUrl,
              cameraState: feed.cameraState,
              detectorMode: feed.detectorMode,
              personCount: feed.personCount,
              phoneCount: feed.phoneCount,
              capturedAt: feed.capturedAt,
            }
          : null,
      });
    }

    return {
      assessment: {
        id: assessment._id,
        title: assessment.title,
        titleAr: assessment.titleAr ?? null,
        classId: cls._id,
        className: cls.name,
        status: assessment.status,
        timeLimitMin: assessment.timeLimitMin,
        selectionMode: "final" as const,
      },
      students: rows,
      serverTime: Date.now(),
    };
  },
});

/**
 * Student publishes a low-frequency JPEG snapshot while their Fair Adaptive
 * final is in progress. Frames are only readable through the instructor query
 * above; they are never returned to other students.
 */
export const publishAssessmentLiveFrame = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    frameDataUrl: v.string(),
    cameraState: v.string(),
    detectorMode: v.string(),
    personCount: v.number(),
    phoneCount: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const student = await myStudentRecord(ctx, user._id);
    if (!student) throw new Error("No student record linked to this account");

    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.studentId !== student._id)
      throw new Error("Submission not found");
    if (submission.status !== "in_progress")
      return { ok: false as const, reason: "submission is not in progress" };

    const assessment = await ctx.db.get(submission.assessmentId);
    if (!assessment) throw new Error("Assessment not found");
    if (assessment.selectionMode !== "final")
      return { ok: false as const, reason: "not a Fair Adaptive final" };

    if (
      !args.frameDataUrl.startsWith(FRAME_PREFIX) ||
      args.frameDataUrl.length > MAX_FRAME_CHARS
    )
      throw new Error("Invalid live frame");

    const now = Date.now();
    const fields = {
      frameDataUrl: args.frameDataUrl,
      cameraState: args.cameraState,
      detectorMode: args.detectorMode,
      personCount: Math.max(0, Math.floor(args.personCount)),
      phoneCount: Math.max(0, Math.floor(args.phoneCount)),
      capturedAt: now,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("assessmentLiveFeeds")
      .withIndex("by_submission", (x) => x.eq("submissionId", args.submissionId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("assessmentLiveFeeds", {
        assessmentId: submission.assessmentId,
        submissionId: submission._id,
        studentId: student._id,
        ...fields,
      });
    }
    return { ok: true as const, capturedAt: now };
  },
});

/**
 * Dismiss one detector violation after instructor review. The original log
 * entry is retained and annotated; active counts, risk, and policy are
 * recomputed from the remaining active detections.
 */
export const dismissAssessmentViolation = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    eventId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (reason.length < 5)
      throw new Error("A dismissal reason of at least 5 characters is required");

    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found");
    const { assessment, user, me } = await requireOwnedFinal(
      ctx,
      submission.assessmentId,
    );
    if (submission.assessmentId !== assessment._id)
      throw new Error("Submission does not belong to this assessment");

    const log = [...(submission.violationLog ?? [])];
    const index = log.findIndex(
      (entry, entryIndex) => eventIdOf(entry, entryIndex) === args.eventId,
    );
    if (index < 0) throw new Error("Violation not found");
    if (log[index].reviewStatus === "dismissed")
      throw new Error("This violation has already been dismissed");

    const now = Date.now();
    const previous = log[index];
    log[index] = {
      ...previous,
      reviewStatus: "dismissed",
      reviewReason: reason,
      reviewedAt: now,
      reviewedByInstructorId: me._id,
      reviewedByUserId: user._id,
    };
    const activeCount = log.filter(
      (entry) => entry.reviewStatus !== "dismissed",
    ).length;
    const policyAction = policyForCount(activeCount, ASSESSMENT_PROCTOR_CONFIG);

    await ctx.db.patch(submission._id, {
      violationLog: log,
      violationCount: activeCount,
      activeViolationCount: activeCount,
      dismissedViolationCount: log.length - activeCount,
      policyAction,
      riskScore: Math.min(0.99, 1 - Math.exp(-activeCount / 3)),
    });

    await audit(
      ctx,
      { _id: user._id, email: user.email },
      {
        action: "assessment_violation.dismissed",
        entity: "assessmentSubmissions",
        entityId: submission._id,
        previousValue: {
          eventId: args.eventId,
          type: previous.type,
          at: previous.at,
          confidence: previous.confidence,
        },
        newValue: {
          reviewStatus: "dismissed",
          reason,
          reviewedAt: now,
          reviewedByInstructorId: me._id,
          activeViolationCount: activeCount,
        },
        detail: `Instructor dismissed ${previous.type} after review: ${reason}`,
      },
    );

    return {
      ok: true as const,
      activeViolationCount: activeCount,
      dismissedViolationCount: log.length - activeCount,
      policyAction,
    };
  },
});

/** Record a manual suspicion flag without altering detector evidence. */
export const flagAssessmentSuspicion = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const note = args.note.trim();
    if (note.length < 3)
      throw new Error("Describe the suspicious behaviour before flagging it");

    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found");
    const { user, me } = await requireOwnedFinal(ctx, submission.assessmentId);

    const flag = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      note,
      at: Date.now(),
      instructorId: me._id,
      userId: user._id,
    };
    await ctx.db.patch(submission._id, {
      instructorFlags: [...(submission.instructorFlags ?? []), flag],
    });
    await audit(
      ctx,
      { _id: user._id, email: user.email },
      {
        action: "assessment_suspicion.flagged",
        entity: "assessmentSubmissions",
        entityId: submission._id,
        newValue: flag,
        detail: note,
      },
    );
    return { ok: true as const, flag };
  },
});

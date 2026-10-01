/**
 * Multi-pose facial registration + pre-assessment face verification.
 *
 * The student registers 7 poses (center, slight left/right, far left/right,
 * slightly up/down). Each capture is stored in Convex file storage and its
 * 128-d descriptor — computed client-side by the project's CV pipeline
 * (TinyFaceDetector, a YOLO-family single-shot detector, plus the ResNet
 * recognition net) — is stored on the row so a live frame can be compared
 * against every registered angle without re-processing the images.
 *
 * Raw facial images are never returned by these queries: only registration
 * counts, pose keys, and verification status are exposed to views outside
 * the student's own session.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUserOf, audit } from "./adminLib";
import { myStudentRecord } from "./studentAssessments";

/** Source of truth: FACE_POSES in src/lib/faceMatch.ts (client-side). */
const FACE_POSE_KEYS = [
  "center",
  "slight_left",
  "slight_right",
  "far_left",
  "far_right",
  "slight_up",
  "slight_down",
] as const;

type FacePoseKey = (typeof FACE_POSE_KEYS)[number];

/** All 7 distinct poses must be registered before assessments unlock. */
function posesComplete(poses: string[]): boolean {
  return FACE_POSE_KEYS.every((p) => poses.includes(p));
}

/** The signed-in student's face registration + verification status. */
export const getMyFaceStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const rows = await ctx.db
      .query("faceRegistrations")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();

    return {
      registered: me.faceRegisteredAt !== undefined,
      faceRegisteredAt: me.faceRegisteredAt ?? null,
      imageCount: rows.length,
      poses: rows.map((r) => r.pose),
      lastFaceCheckAt: me.lastFaceCheckAt ?? null,
      lastFaceCheckStatus: me.lastFaceCheckStatus ?? null,
      /** The student's own embeddings, used for live verification. */
      embeddings: rows.map((r) => ({
        pose: r.pose,
        embedding: r.embedding,
      })),
    };
  },
});

/** Upload URL for one registration capture (client uploads the blob). */
export const generateFaceUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Store one registered pose: replaces any previous capture of the same pose
 * (deleting the old file), saves the 128-d descriptor, and stamps
 * faceRegisteredAt once all 7 poses are present.
 */
export const saveFaceImage = mutation({
  args: {
    storageId: v.id("_storage"),
    pose: v.string(),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, { storageId, pose, embedding }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    if (!(FACE_POSE_KEYS as readonly string[]).includes(pose))
      throw new Error("Unknown face pose");
    if (embedding.length !== 128 || embedding.some((n) => !Number.isFinite(n)))
      throw new Error("Invalid face embedding — re-capture the pose");

    // Replace the previous capture of this pose, if any.
    const existing = await ctx.db
      .query("faceRegistrations")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    const samePose = existing.find((r) => r.pose === pose);
    if (samePose) {
      await ctx.storage.delete(samePose.storageId);
      await ctx.db.delete(samePose._id);
    }
    if (existing.length >= 14)
      throw new Error("Too many face captures — reset registration first");

    await ctx.db.insert("faceRegistrations", {
      studentId: me._id,
      storageId,
      pose,
      embedding,
      capturedAt: Date.now(),
    });

    const poses = existing
      .filter((r) => r.pose !== pose)
      .map((r) => r.pose);
    poses.push(pose);
    const complete = posesComplete(poses);
    if (complete && me.faceRegisteredAt === undefined) {
      await ctx.db.patch(me._id, { faceRegisteredAt: Date.now() });
    }

    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "face_registered",
      entity: "faceRegistrations",
      entityId: storageId,
      newValue: { pose, complete },
    });
    return { ok: true as const, complete, poseCount: poses.length };
  },
});

/** Delete all registration data for the signed-in student (fresh start). */
export const resetFaceRegistration = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const rows = await ctx.db
      .query("faceRegistrations")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    for (const r of rows) {
      await ctx.storage.delete(r.storageId);
      await ctx.db.delete(r._id);
    }
    await ctx.db.patch(me._id, {
      faceRegisteredAt: undefined,
      lastFaceCheckAt: undefined,
      lastFaceCheckStatus: undefined,
    });
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "face_registration_reset",
      entity: "students",
      entityId: me._id,
      newValue: { removed: rows.length },
    });
    return { ok: true as const };
  },
});

/**
 * Record the outcome of a pre-assessment live verification attempt
 * (status only — no biometric data).
 */
export const recordFaceCheck = mutation({
  args: {
    passed: v.boolean(),
    similarity: v.number(),
  },
  handler: async (ctx, { passed, similarity }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sim = Math.max(0, Math.min(1, similarity));
    await ctx.db.patch(me._id, {
      lastFaceCheckAt: Date.now(),
      lastFaceCheckStatus: passed ? "passed" : "failed",
    });
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "face_check",
      entity: "students",
      entityId: me._id,
      newValue: { passed, similarity: Math.round(sim * 100) / 100 },
    });
    return { ok: true as const };
  },
});

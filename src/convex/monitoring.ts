/**
 * Academic-integrity ingestion — a subsystem SEPARATE from assessment.
 *
 * Raw detections from the browser monitor (camera/tab events, face/gaze
 * adapters) are recorded here and evaluated by the evidence-aggregation
 * engine (src/lib/irt/monitoring.ts). Confirmed violations — never single
 * raw detections — drive warnings and the configurable violation threshold.
 * Nothing in this file touches theta or any IRT variable.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  DEFAULT_MONITORING_THRESHOLDS,
  eventSeverity,
  eventUserMessage,
  evaluateIntegrity,
  type MonitoringEvent,
  type MonitoringEventType,
  type MonitoringThresholds,
} from "../lib/irt";

type SessionDoc = Doc<"examSessions">;

export const listEvents = query({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) return [];
    return await ctx.db
      .query("monitoringEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

/**
 * Ingest a monitoring event. High-confidence events immediately produce a
 * soft warning toast for the student (raw detections never become
 * violations by themselves — see evaluateIntegrity).
 */
export const ingestEvent = mutation({
  args: {
    sessionId: v.id("examSessions"),
    type: v.string(),
    confidence: v.number(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    if (session.status !== "active") return { ok: false };

    const exam = await ctx.db.get(session.examId);
    if (!exam || !exam.monitoringEnabled) return { ok: false };

    const type = args.type as MonitoringEventType;
    const severity = eventSeverity(type);
    const timestamp = Date.now();

    await ctx.db.insert("monitoringEvents", {
      sessionId: session._id,
      userId,
      timestamp,
      type,
      confidence: args.confidence,
      severity,
      detail: args.detail ?? undefined,
    });

    // Re-run the aggregate risk engine over this session's evidential events.
    const events = await ctx.db
      .query("monitoringEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const evidence: MonitoringEvent[] = events.map((e) => ({
      id: e._id,
      sessionId: e.sessionId,
      studentId: String(e.userId),
      timestamp: e.timestamp,
      type: e.type as MonitoringEventType,
      confidence: e.confidence,
      severity: e.severity as MonitoringEvent["severity"],
    }));
    const state = evaluateIntegrity(
      evidence,
      DEFAULT_MONITORING_THRESHOLDS,
      timestamp,
    );

    // Issue a warning row when a type gets confirmed (aggregated evidence).
    const newlyConfirmed = state.confirmedTypes.filter(
      (t) => !session.confirmedViolations, // always create warning on confirm
    );
    for (const t of state.confirmedTypes) {
      const alreadyWarned = events.some(
        (e) => e.type === t && e.confidence >= DEFAULT_MONITORING_THRESHOLDS.minConfidence,
      );
      void alreadyWarned;
      const alreadyHasWarning = await ctx.db
        .query("warnings")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect()
        .then((rows) => rows.some((r) => r.eventType === t));
      if (!alreadyHasWarning) {
        await ctx.db.insert("warnings", {
          sessionId: session._id,
          userId,
          timestamp,
          message: eventUserMessage(t),
          eventType: t,
          severity: eventSeverity(t),
        });
      }
    }
    void newlyConfirmed;

    // Persist confirmed incidents (aggregated, not raw).
    for (const t of state.confirmedTypes) {
      const existingIncident = await ctx.db
        .query("integrityIncidents")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect()
        .then((rows) => rows.find((r) => r.type === t));
      if (!existingIncident) {
        await ctx.db.insert("integrityIncidents", {
          sessionId: session._id,
          userId,
          type: t,
          confirmedAt: timestamp,
          evidenceCount: state.perType[t]?.count ?? 0,
        });
      }
    }

    const terminated =
      state.shouldTerminate && session.status === "active" &&
      state.confirmedViolations >= (exam.violationThreshold ?? 3);

    await ctx.db.patch(session._id, {
      riskScore: state.riskScore,
      confirmedViolations: state.confirmedViolations,
      ...(terminated
        ? {
            status: "terminated" as const,
            completedAt: timestamp,
            terminationReason: "violation_threshold" as const,
          }
        : {}),
    });

    return {
      ok: true,
      riskScore: state.riskScore,
      confirmedViolations: state.confirmedViolations,
      shouldWarn: state.shouldWarn,
      shouldTerminate: terminated,
      warningMessage:
        state.confirmedTypes.length > 0
          ? eventUserMessage(
              state.confirmedTypes[state.confirmedTypes.length - 1],
            )
          : null,
    };
  },
});

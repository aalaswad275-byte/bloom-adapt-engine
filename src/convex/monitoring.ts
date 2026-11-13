/**
 * Academic-integrity ingestion — a subsystem SEPARATE from assessment.
 *
 * Two detection lanes combine here through ONE violation-management service:
 *   • browser lane — TAB_SWITCH / WINDOW_BLUR / BROWSER_MINIMIZED / LEFT_EXAM_PAGE
 *   • vision lane  — NO_PERSON / PHONE_DETECTED / MULTIPLE_PERSONS / LOOKING_AWAY / …
 *   • camera lane  — CAMERA_DISABLED / CAMERA_ERROR
 *
 * The client (useExamMonitor) runs the same ViolationEngine as a debouncer,
 * so events only arrive after their configured grace period; this mutation
 * re-validates severity server-side and drives the policy ladder
 * (WARNING → PAUSE_EXAM → TERMINATE_EXAM) from the unified counter.
 * Nothing here touches theta or any IRT variable.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  DEFAULT_MONITORING_CONFIG,
  SEVERITY_WEIGHT,
  type MonitoringConfig,
  type PolicyAction,
  type Severity,
  type ViolationType,
  policyForCount,
  violationSeverity,
  violationSource,
  violationUserMessage,
} from "../lib/monitoring";

type SessionDoc = Doc<"examSessions">;
type ExamDoc = Doc<"exams">;

/** Read the exam's monitoring config, merged over the engine defaults. */
export function monitoringConfigFor(exam: ExamDoc): MonitoringConfig {
  return {
    ...DEFAULT_MONITORING_CONFIG,
    ...(exam.monitoringConfig ?? {}),
    thresholds: {
      ...DEFAULT_MONITORING_CONFIG.thresholds,
      ...(exam.monitoringConfig?.thresholds ?? {}),
    } as MonitoringConfig["thresholds"],
    // The exam-level three-strike rule stays authoritative unless the
    // stored config explicitly overrides it.
    maxViolations:
      exam.monitoringConfig?.maxViolations ?? exam.violationThreshold,
  };
}

const RANK: Record<PolicyAction, number> = {
  NONE: 0,
  WARNING: 1,
  PAUSE_EXAM: 2,
  TERMINATE_EXAM: 3,
};

/**
 * Batch-ingest engine events from the client. Both lanes arrive here; each
 * violation increments the unified counter once and the policy ladder is
 * applied server-side (the client can never bypass pause/terminate).
 */
export const ingestEvents = mutation({
  args: {
    sessionId: v.id("examSessions"),
    events: v.array(
      v.object({
        type: v.string(),
        kind: v.union(v.literal("violation"), v.literal("recovery")),
        confidence: v.number(),
        durationMs: v.optional(v.number()),
        source: v.optional(v.string()),
        detail: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    if (session.status === "completed" || session.status === "terminated")
      return { ok: false, reason: "session closed" };

    const exam = (await ctx.db.get(session.examId)) as ExamDoc | null;
    if (!exam || !exam.monitoringEnabled)
      return { ok: false, reason: "monitoring disabled" };
    const cfg = monitoringConfigFor(exam);

    const timestamp = Date.now();
    let count = session.confirmedViolations;
    let applied: PolicyAction =
      (session.policyAction as PolicyAction | undefined) ?? "NONE";

    for (const ev of args.events) {
      const type = ev.type as ViolationType;
      let severity: Severity;
      try {
        severity = violationSeverity(type);
      } catch {
        continue; // unknown type — ignore (forward compatibility)
      }

      // Re-validate the configured detection rule server-side. A violation
      // only counts when its evidence meets the exam's confidence floor AND
      // persisted for the configured threshold. Recovery rows remain useful
      // audit evidence, but can never increment the counter.
      if (ev.kind === "violation") {
        if (ev.confidence < cfg.minConfidence) continue;
        const thresholdMs = cfg.thresholds[type] ?? 0;
        if ((ev.durationMs ?? 0) < thresholdMs) continue;
      }

      await ctx.db.insert("monitoringEvents", {
        sessionId: session._id,
        userId,
        timestamp,
        type,
        kind: ev.kind,
        source: ev.source ?? violationSource(type),
        confidence: ev.confidence,
        severity,
        durationMs: ev.durationMs,
        stepNumber: session.stepCount,
        detail: ev.detail,
      });

      if (ev.kind !== "violation") continue;
      count += 1;

      const action = policyForCount(count, cfg);
      if (RANK[action] > RANK[applied]) {
        applied = action;
        await ctx.db.insert("warnings", {
          sessionId: session._id,
          userId,
          timestamp,
          message:
            action === "TERMINATE_EXAM"
              ? `Exam terminated: ${violationUserMessage(type)}`
              : `${action === "PAUSE_EXAM" ? "Exam paused" : "Warning"}: ${violationUserMessage(type)}`,
          eventType: type,
          severity,
        });
      }
    }

    // Apply policy — escalates only; resume is an explicit mutation.
    // (status here is "active" | "paused" — closed sessions returned above.)
    let status: SessionDoc["status"] = session.status;
    let terminationReason: string | undefined = undefined;
    if (applied === "TERMINATE_EXAM") {
      status = "terminated";
      terminationReason = "violation_threshold";
    } else if (applied === "PAUSE_EXAM" && session.status === "active") {
      status = "paused";
    }

    await ctx.db.patch(session._id, {
      confirmedViolations: count,
      policyAction: applied,
      riskScore: Math.min(0.99, 1 - Math.exp(-count / 3)),
      status,
      ...(terminationReason ? { terminationReason } : {}),
    });

    return {
      ok: true,
      violationCount: count,
      policyAction: applied,
      status,
      acknowledged: args.events.length,
    };
  },
});

/**
 * Resume a policy-paused exam. The student acknowledges the warning; the
 * unified violation count is preserved so the next violation escalates.
 */
export const resumeSession = mutation({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session || session.userId !== userId) throw new Error("Not your session");
    if (session.status !== "paused") return { ok: false, reason: "not paused" };
    await ctx.db.patch(args.sessionId, { status: "active" });
    return { ok: true };
  },
});

/**
 * Complete admin monitoring timeline for one session: every violation and
 * recovery across both lanes, with type, duration, confidence, severity,
 * the question step it happened on, and a per-type summary.
 */
export const getSessionMonitoring = query({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session || session.userId !== userId) return null;

    const events = await ctx.db
      .query("monitoringEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    events.sort((a, b) => a.timestamp - b.timestamp);

    // questionId → step number, so each event shows which item was on screen.
    const history = await ctx.db
      .query("adaptiveHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const stepByQuestion = new Map<Id<"questions">, number>();
    for (const h of history)
      stepByQuestion.set(h.currentQuestionId, h.stepNumber + 1);

    const violations = events.filter((e) => e.kind !== "recovery");
    const byType: Record<string, number> = {};
    for (const v of violations) byType[v.type] = (byType[v.type] ?? 0) + 1;

    return {
      status: session.status,
      policyAction: session.policyAction ?? "NONE",
      violationCount: session.confirmedViolations,
      riskScore: session.riskScore,
      events: events.map((e) => ({
        timestamp: e.timestamp,
        type: e.type,
        source: e.source ?? violationSource(e.type as ViolationType),
        kind: e.kind ?? "raw",
        confidence: e.confidence,
        severity: e.severity,
        durationMs: e.durationMs ?? null,
        stepNumber: e.stepNumber ?? null,
        questionStep:
          e.stepNumber !== undefined ? (e.stepNumber + 1 as number) : null,
        detail: e.detail ?? null,
      })),
      summary: { total: violations.length, byType },
      recoveries: events.filter((e) => e.kind === "recovery").length,
      _steps: stepByQuestion.size,
    };
  },
});

/** Legacy single-event ingestion kept for compatibility (raw lane events). */
export const ingestEvent = mutation({
  args: {
    sessionId: v.id("examSessions"),
    type: v.string(),
    confidence: v.number(),
    durationMs: v.optional(v.number()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    if (session.status !== "active") return { ok: false };

    const exam = (await ctx.db.get(session.examId)) as ExamDoc | null;
    if (!exam || !exam.monitoringEnabled) return { ok: false };

    let severity: Severity;
    try {
      severity = violationSeverity(args.type as ViolationType);
    } catch {
      return { ok: false, reason: "unknown type" };
    }

    await ctx.db.insert("monitoringEvents", {
      sessionId: session._id,
      userId,
      timestamp: Date.now(),
      type: args.type,
      kind: "raw",
      source: violationSource(args.type as ViolationType),
      confidence: args.confidence,
      severity,
      durationMs: args.durationMs,
      stepNumber: session.stepCount,
      detail: args.detail,
    });

    // Raw events nudge the risk score but never the violation counter.
    const raw = args.confidence * SEVERITY_WEIGHT[severity];
    await ctx.db.patch(session._id, {
      riskScore: Math.min(
        0.99,
        Math.max(session.riskScore, 1 - Math.exp(-raw / 3)),
      ),
    });
    return { ok: true };
  },
});

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

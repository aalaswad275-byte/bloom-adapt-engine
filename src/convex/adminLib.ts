/**
 * Admin module shared library — authorization guard, audit logging, and
 * performance math used by every admin query/mutation.
 *
 * Security model (mirrors the platform's auth):
 *   • every admin function resolves the caller via Convex Auth;
 *   • requireAdmin() throws unless users.role === "admin";
 *   • all admin actions are written to auditLogs with actor, entity, and
 *     previous/new values;
 *   • the demo seed creates the institutions/people/assessments/results as
 *     REAL rows so every dashboard statistic is computed from data.
 *
 * Score semantics across the system:
 *   a completed session's score = correctCount / answered
 *   (answered = stepCount, excluding skipped items; 0–100 scale).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

type SessionDoc = Doc<"examSessions">;
type ExamDoc = Doc<"exams">;
type StudentDoc = Doc<"students">;

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/** Resolve the signed-in user, or null. */
export async function currentUserOf(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

/**
 * Admin guard. Throws on non-admin callers. Every admin query/mutation must
 * call this FIRST — it is the single authorization point for the module.
 */
export async function requireAdmin(ctx: QueryCtx) {
  const user = await currentUserOf(ctx);
  if (!user || user.role !== "admin") {
    throw new Error("Unauthorized: admin role required");
  }
  return user;
}

/** Non-throwing variant for client-side role gating. */
export async function getAdminViewer(ctx: QueryCtx) {
  const user = await currentUserOf(ctx);
  if (!user || user.role !== "admin") return null;
  return { _id: user._id, email: user.email ?? null, name: user.name ?? null };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditInput = {
  action: string;
  entity?: string;
  entityId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  detail?: string;
};

/** Persist a structured audit row (never throws into the caller's flow). */
export async function audit(
  ctx: QueryCtx,
  actor: { _id: Id<"users">; email?: string | null },
  input: AuditInput,
) {
  await ctx.db.insert("auditLogs", {
    userId: actor._id,
    actorEmail: actor.email ?? undefined,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    previousValue:
      input.previousValue !== undefined
        ? JSON.stringify(input.previousValue)
        : undefined,
    newValue:
      input.newValue !== undefined ? JSON.stringify(input.newValue) : undefined,
    detail: input.detail,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Shared performance math (single source of truth for every stat surface)
// ---------------------------------------------------------------------------

export interface AggStats {
  count: number;
  completed: number;
  avgScore: number | null;
  passRate: number | null;
  completionRate: number | null;
}

/** Session-level score in percent (correct/answered, skips excluded). */
export function sessionScorePct(s: SessionDoc): number | null {
  const answered = s.stepCount;
  if (answered <= 0) return null;
  return (s.correctCount / answered) * 100;
}

export const PASS_MARK = 50; // percent

/** Aggregate sessions into the standard stats block. */
export function aggregateSessions(
  sessions: SessionDoc[],
  now: number = Date.now(),
): AggStats & { avgDurationSec: number | null; total: number } {
  let completed = 0;
  let scoreSum = 0;
  let scoreN = 0;
  let durationSum = 0;
  let durationN = 0;
  let passN = 0;

  for (const s of sessions) {
    if (s.status === "completed" || s.status === "terminated") completed += 1;
    const score = sessionScorePct(s);
    if (score !== null) {
      scoreSum += score;
      scoreN += 1;
      if (score >= PASS_MARK) passN += 1;
    }
    if (s.completedAt) {
      durationSum += (s.completedAt - s.startedAt) / 1000;
      durationN += 1;
    }
  }

  return {
    count: sessions.length,
    total: sessions.length,
    completed,
    avgScore: scoreN > 0 ? scoreSum / scoreN : null,
    passRate: scoreN > 0 ? (passN / scoreN) * 100 : null,
    completionRate:
      sessions.length > 0 ? (completed / sessions.length) * 100 : null,
    avgDurationSec: durationN > 0 ? durationSum / durationN : null,
  };
}

/** Median of a numeric array (average of middle two for even lengths). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Bucket sessions into ISO-style month keys ("2026-09") for trend charts. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Month-over-month average-score trend from sessions. */
export function trendByMonth(
  sessions: SessionDoc[],
): Array<{ month: string; avgScore: number; sessions: number }> {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const s of sessions) {
    const score = sessionScorePct(s);
    if (score === null) continue;
    const key = monthKey(s.startedAt);
    const b = buckets.get(key) ?? { sum: 0, n: 0 };
    b.sum += score;
    b.n += 1;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => ({
      month,
      avgScore: Math.round((b.sum / b.n) * 10) / 10,
      sessions: b.n,
    }));
}

// ---------------------------------------------------------------------------
// Org lookups
// ---------------------------------------------------------------------------

export async function loadStudentsOfStudentIds(
  ctx: QueryCtx,
  studentIds: Id<"students">[],
): Promise<Map<Id<"students">, StudentDoc>> {
  const map = new Map<Id<"students">, StudentDoc>();
  for (const id of studentIds) {
    const doc = await ctx.db.get(id);
    if (doc) map.set(id, doc);
  }
  return map;
}

/** Sessions whose studentId OR legacy userId belongs to any of these students. */
export async function sessionsForStudents(
  ctx: QueryCtx,
  studentIds: Id<"students">[],
): Promise<SessionDoc[]> {
  const out: SessionDoc[] = [];
  for (const sid of studentIds) {
    const byStudent = await ctx.db
      .query("examSessions")
      .withIndex("by_student", (q) => q.eq("studentId", sid))
      .collect();
    out.push(...byStudent);
    // Legacy fallback: sessions run by a linked auth user before assignment.
    const student = await ctx.db.get(sid);
    if (student?.userId) {
      const byUser = await ctx.db
        .query("examSessions")
        .withIndex("by_user", (q) => q.eq("userId", student.userId))
        .collect();
        out.push(...byUser.filter((s) => s.studentId === undefined));
    }
  }
  return out;
}

/** Sessions linked to an institution (direct link or via its students). */
export async function sessionsForInstitution(
  ctx: QueryCtx,
  institutionId: Id<"institutions">,
): Promise<SessionDoc[]> {
  const direct = await ctx.db
    .query("examSessions")
    .withIndex("by_institution", (q) => q.eq("institutionId", institutionId))
    .collect();
  const students = await ctx.db
    .query("students")
    .withIndex("by_institution", (q) => q.eq("institutionId", institutionId))
    .collect();
  const viaStudents = await sessionsForStudents(
    ctx,
    students.map((s) => s._id),
  );
  const seen = new Set<string>();
  return [...direct, ...viaStudents].filter((s) => {
    if (seen.has(s._id)) return false;
    seen.add(s._id);
    return true;
  });
}

/** Full exam doc lookup with null tolerance. */
export async function examOf(
  ctx: QueryCtx,
  sessionId: SessionDoc,
): Promise<ExamDoc | null> {
  return (await ctx.db.get(sessionId.examId)) as ExamDoc | null;
}

/**
 * Score an individual session-row for the results table. Kept here so list
 * and detail views never disagree about grade/performance-level mapping.
 */
export function gradeFor(pct: number): string {
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  if (pct >= 50) return "E";
  return "F";
}

export function performanceLevel(pct: number): "excellent" | "good" | "average" | "below" | "poor" {
  if (pct >= 85) return "excellent";
  if (pct >= 70) return "good";
  if (pct >= 55) return "average";
  if (pct >= 40) return "below";
  return "poor";
}

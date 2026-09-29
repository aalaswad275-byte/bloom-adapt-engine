/**
 * Admin performance helper queries — shared session lookups and chart
 * builders used by the performance dashboards. Kept intentionally small.
 */

import type { QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { sessionScorePct } from "./adminLib";

export type SessionDoc = Doc<"examSessions">;

/** Sessions linked to a set of students (direct link or legacy userId). */
export async function sessionsForStudents(
  ctx: QueryCtx,
  students: Doc<"students">[],
): Promise<SessionDoc[]> {
  const out: SessionDoc[] = [];
  for (const st of students) {
    const direct = await ctx.db
      .query("examSessions")
      .withIndex("by_student", (q) => q.eq("studentId", st._id))
      .collect();
    out.push(...direct);
    const uid = st.userId;
    if (uid) {
      const byUser = await ctx.db
        .query("examSessions")
        .withIndex("by_user", (q) => q.eq("userId", uid))
        .collect();
      out.push(...byUser.filter((s) => s.studentId === undefined));
    }
  }
  return out;
}

/** Sessions linked to an institution (direct or via its students), deduped. */
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
    .withIndex("by_institution", (x) => x.eq("institutionId", institutionId))
    .collect();
  const via = await sessionsForStudents(ctx, students);
  const seen = new Set<string>();
  return [...direct, ...via].filter((s) => {
    if (seen.has(s._id)) return false;
    seen.add(s._id);
    return true;
  });
}

/** Distinct exams used by these sessions. */
export function examIdsOf(sessions: SessionDoc[]): number {
  return new Set(sessions.map((s) => s.examId)).size;
}

/** Score distribution histogram for chart display. */
export function distributionOf(scores: number[]): Array<{ name: string; value: number }> {
  const buckets = [
    { name: "0–49", min: 0, max: 50 },
    { name: "50–69", min: 50, max: 70 },
    { name: "70–84", min: 70, max: 85 },
    { name: "85–100", min: 85, max: 101 },
  ];
  return buckets.map((b) => ({
    name: b.name,
    value: scores.filter((s) => s >= b.min && s < b.max).length,
  }));
}

/** Per-assessment average from sessions, joined against exam titles. */
export async function byExam(
  ctx: QueryCtx,
  sessions: SessionDoc[],
): Promise<Array<{ name: string; avgScore: number | null }>> {
  const exams = await ctx.db.query("exams").collect();
  const out: Array<{ name: string; avgScore: number | null }> = [];
  for (const e of exams) {
    const ss = sessions.filter((s) => s.examId === e._id);
    if (ss.length === 0) continue;
    const scores = ss
      .map(sessionScorePct)
      .filter((v): v is number => v !== null);
    out.push({
      name: e.title,
      avgScore: scores.length
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null,
    });
  }
  return out;
}

/** Simple per-student summary rows over a session set. */
export function perStudentRows(
  students: Doc<"students">[],
  sessions: SessionDoc[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aggregate: (sessions: any[]) => { avgScore: number | null },
) {
  return students.map((st) => {
    const ss = sessions.filter((s) => s.studentId === st._id);
    return {
      id: st._id,
      name: st.name,
      assessments: ss.length,
      avgScore: aggregate(ss).avgScore,
    };
  });
}

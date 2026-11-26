/** Administrative analytics helpers — students, assessments, results. */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { SessionDoc } from "./adminLib";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, sessionScorePct } from "./adminLib";

type AssessmentDoc = Doc<"instructorAssessments">;
type SubmissionDoc = Doc<"assessmentSubmissions">;
type StudentDoc = Doc<"students">;

function roundPct(value: number) {
  return Math.round(value * 10) / 10;
}

function localGradeFor(pct: number): string {
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  if (pct >= 50) return "E";
  return "F";
}

function localPerformanceLevel(pct: number): string {
  if (pct >= 85) return "excellent";
  if (pct >= 70) return "good";
  if (pct >= 55) return "average";
  if (pct >= 40) return "below";
  return "poor";
}

/**
 * Composite student profile built from the legacy examSessions table AND the
 * current class assessment pipeline (instructorAssessments /
 * assessmentSubmissions). This keeps the admin student profile working even
 * when a student has only one kind of result recorded.
 */

export const getStudentPerformanceV3 = query({
  args: { id: v.id("students") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);

    const student = await ctx.db.get(id);
    if (!student) return null;

    const classes = await ctx.db.query("classes").collect();
    const assessments = await ctx.db.query("instructorAssessments").collect();
    const subs = await ctx.db.query("assessmentSubmissions").collect();
    const legacySessions = await ctx.db.query("examSessions").collect();

    const classById = new Map<string, Doc<"classes"> | null>(
      classes.map((c) => [String(c._id), c] as const),
    );
    const assessmentById = new Map<string, Doc<"instructorAssessments"> | null>(
      assessments.map((a) => [String(a._id), a] as const),
    );

    const examMap = new Map<string, { title: string; titleAr: string | null }>();
    for (const s of legacySessions) {
      const key = String(s._id);
      if (!examMap.has(key)) {
        examMap.set(key, { title: "(exam)", titleAr: null });
      }
    }

    // Canonical records for this student — legacy exams plus class submissions.
    const legacy = legacySessions.filter(
      (s) => s.studentId === id || (s.userId === student.userId && !s.studentId),
    );
    const classSubs = subs.filter((s) => s.studentId === id);

    const allSessions: Array<SessionForProfile> = [];

    for (const s of legacy) {
      const existing = examMap.get(String(s._id));
      const pct = sessionScorePct(s);
      allSessions.push({
        id: String(s._id),
        studentId: id,
        title: existing?.title ?? "(deleted)",
        titleAr: existing?.titleAr ?? null,
        startedAt: s.startedAt,
        completedAt: s.completedAt ?? null,
        status: s.status,
        score: s.correctCount,
        max: s.stepCount,
        pct,
        grade: pct !== null ? localGradeFor(pct) : null,
        detail: null,
        mode: "exam",
        classTitle: null,
        classId: null,
      });
    }

    for (const sub of classSubs) {
      const assessment = assessmentById.get(String(sub.assessmentId));
      const cls = sub.classId ? classById.get(String(sub.classId)) : null;
      const pct =
        sub.maxScore && sub.maxScore > 0
          ? roundPct((sub.score ?? 0) / sub.maxScore * 100)
          : null;
      allSessions.push({
        id: String(sub._id),
        studentId: id,
        title: assessment?.title ?? "(deleted assessment)",
        titleAr: assessment?.titleAr ?? null,
        startedAt: sub.startedAt ?? sub.submittedAt ?? 0,
        completedAt: sub.submittedAt ?? null,
        status: sub.status ?? "unknown",
        score: sub.score ?? 0,
        max: sub.maxScore ?? 0,
        pct,
        grade: pct !== null ? localGradeFor(pct) : null,
        detail: sub.weakestBloomAreas ?? null,
        mode: "assessment",
        classTitle: cls?.name ?? null,
        classId: sub.classId ?? null,
      });
    }

    allSessions.sort((a, b) => a.startedAt - b.startedAt);

    const completed =
      allSessions.filter((s) => {
        if (s.mode === "exam") return s.status === "completed" || s.status === "terminated";
        return s.status === "submitted" || s.status === "graded";
      }).length;

    const scored = allSessions.filter((s) => s.pct !== null);
    const pcts = scored.map((s) => s.pct!);
    const best = pcts.length ? Math.max(...pcts) : null;
    const worst = pcts.length ? Math.min(...pcts) : null;
    const improvement =
      pcts.length >= 2 ? pcts[pcts.length - 1] - pcts[0] : null;

    const durations = allSessions
      .filter((s) => s.completedAt && s.startedAt)
      .map((s) => (s.completedAt! - s.startedAt) / 1000);
    const avgDuration =
      durations.length > 0
        ? roundPct(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    const scoreHistory = scored.map((s) => ({
      date: s.startedAt,
      score: s.pct,
      label: s.title,
    }));

    const history = allSessions.map((s) => ({
      sessionId: s.id,
      assessment: s.title,
      assessmentAr: s.titleAr,
      date: s.startedAt,
      score: s.score,
      answered: s.max,
      percentage: s.pct,
      grade: s.grade,
            level: s.pct !== null ? localPerformanceLevel(s.pct) : null,
      });
    });

    const latestPct = pcts.length ? pcts[pcts.length - 1] : null;

    return {
      student,
      institution: student.institutionId
        ? await ctx.db.get(student.institutionId)
        : null,
      center: student.teachingCenterId
        ? await ctx.db.get(student.teachingCenterId)
        : null,
      facility: student.governmentFacilityId
        ? await ctx.db.get(student.governmentFacilityId)
        : null,
      instructor: student.instructorId
        ? await ctx.db.get(student.instructorId)
        : null,
      summary: {
        overallAverage:
          pcts.length > 0 ? roundPct(pcts.reduce((sum, value) => sum + value, 0) / pcts.length) : null,
        assessments: allSessions.length,
        completed,
        highest: best,
        lowest: worst,
        improvementPct: improvement,
        avgDurationSec: avgDuration,
        currentLevel: latestPct !== null ? localPerformanceLevel(latestPct) : null,
      },
      scoreHistory,
      history,
    };
  },
});

export const getStudentAssessmentDetail = query({
  args: { sessionId: v.id("assessmentSubmissions") },
  handler: async (ctx, { sessionId }) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(sessionId);
    if (!sub) return null;
    const student = await ctx.db.get(sub.studentId);
    if (!student) return null;
    const assessment = await ctx.db.get(sub.assessmentId);
    const cls = sub.classId ? await ctx.db.get(sub.classId) : null;
    return {
      id: String(sub._id),
      studentId: String(student._id),
      studentName: student.name,
      assessmentId: String(sub.assessmentId),
      assessmentTitle: assessment?.title ?? "(deleted)",
      classTitle: cls?.name ?? null,
      status: sub.status ?? "unknown",
      startedAt: sub.startedAt,
      submittedAt: sub.submittedAt ?? null,
      score: sub.score ?? 0,
      maxScore: sub.maxScore ?? 0,
      pct:
        sub.maxScore && sub.maxScore > 0
          ? roundPct((sub.score ?? 0) / sub.maxScore * 100)
          : null,
      grade: sub.grade ?? null,
      passed: sub.passed ?? null,
      completionReason: sub.completionReason ?? null,
      weakestBloomAreas: sub.weakestBloomAreas ?? [],
      createdAt: sub._creationTime,
    };
  },
});
      durationSec:
        s.completedAt && s.startedAt
          ? Math.round((s.completedAt - s.startedAt) / 1000)
          : null,
      status: s.status,
      mode: s.mode,
      classTitle: s.classTitle,
      classId: s.classId,
    }));

    const latestPct = pcts.length ? pcts[pcts.length - 1] : null;

    return {
      student,
      institution: student.institutionId
        ? await ctx.db.get(student.institutionId)
        : null,
      center: student.teachingCenterId
        ? await ctx.db.get(student.teachingCenterId)
        : null,
      facility: student.governmentFacilityId
        ? await ctx.db.get(student.governmentFacilityId)
        : null,
      instructor: student.instructorId
        ? await ctx.db.get(student.instructorId)
        : null,
      summary: {
        overallAverage:
          pcts.length > 0 ? roundPct(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
        assessments: allSessions.length,
        completed,
        highest: best,
        lowest: worst,
        improvementPct: improvement,
        avgDurationSec: avgDuration,
        currentLevel: latestPct !== null ? localPerformanceLevel(latestPct) : null,
      },
    };
  },
});

export const getStudentAssessmentDetail = query({
  args: { sessionId: v.id("assessmentSubmissions") },
  handler: async (ctx, { sessionId }) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(sessionId);
    if (!sub) return null;
    const student = await ctx.db.get(sub.studentId);
    if (!student) return null;
    const assessment = await ctx.db.get(sub.assessmentId);
    const cls = sub.classId ? await ctx.db.get(sub.classId) : null;
    return {
      id: sub._id as unknown as string,
      studentId: student._id as unknown as string,
      studentName: student.name,
      assessmentId: sub.assessmentId as unknown as string,
      assessmentTitle: assessment?.title ?? "(deleted)",
      classTitle: cls?.name ?? null,
      status: sub.status ?? "unknown",
      startedAt: sub.startedAt,
      submittedAt: sub.submittedAt ?? null,
      score: sub.score ?? 0,
      maxScore: sub.maxScore ?? 0,
      pct:
        sub.maxScore && sub.maxScore > 0
          ? roundPct((sub.score ?? 0) / sub.maxScore * 100)
          : null,
      grade: sub.grade ?? null,
      passed: sub.passed ?? null,
      completionReason: sub.completionReason ?? null,
      weakestBloomAreas: sub.weakestBloomAreas ?? [],
      createdAt: sub._creationTime,
    };
  },
});
      },
      scoreHistory,
      history,
    };
  },
});

export const getStudentAssessmentDetail = query({
  args: { sessionId: v.id("assessmentSubmissions") },
  handler: async (ctx, { sessionId }) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(sessionId);
    if (!sub) return null;
    const student = await ctx.db.get(sub.studentId);
    if (!student) return null;
    const assessment = await ctx.db.get(sub.assessmentId);
    const cls = sub.classId ? await ctx.db.get(sub.classId) : null;
    return {
      id: sub._id,
      studentId: student._id,
      studentName: student.name,
      assessmentId: sub.assessmentId,
      assessmentTitle: assessment?.title ?? "(deleted)",
      classTitle: cls?.name ?? null,
      status: sub.status ?? "unknown",
      startedAt: sub.startedAt,
      submittedAt: sub.submittedAt ?? null,
      score: sub.score ?? 0,
      maxScore: sub.maxScore ?? 0,
      pct:
        sub.maxScore && sub.maxScore > 0
          ? roundPct((sub.score ?? 0) / sub.maxScore * 100)
          : null,
      grade: sub.grade ?? null,
      passed: sub.passed ?? null,
      completionReason: sub.completionReason ?? null,
      weakestBloomAreas: sub.weakestBloomAreas ?? [],
      createdAt: sub._creationTime,
    };
  },
});

function performanceLevel(pct: number): string {
  if (pct >= 85) return "excellent";
  if (pct >= 70) return "good";
  if (pct >= 55) return "average";
  if (pct >= 40) return "below";
  return "poor";
}

interface SessionForProfile {
  id: Id<"examSessions"> | Id<"assessmentSubmissions">;
  studentId: Id<"students">;
  title: string;
  titleAr: string | null;
  startedAt: number;
  completedAt: number | null;
  status: string;
  score: number;
  max: number;
  pct: number | null;
  grade: string | null;
  detail: string[] | null;
  mode: "exam" | "assessment";
  classTitle: string | null;
  classId: Id<"classes"> | null;
}

/**
 * Unified class performance report — one read model for the instructor's
 * class-report page.
 *
 * Static (traditional fixed papers, including the random-per-level variant)
 * and adaptive (AI/IRT) results are aggregated SEPARATELY from the same
 * assessment engine (`assessmentSubmissions`), so the two panels can be
 * compared without mixing their populations.
 *
 * Everything here is derived from stored submissions: percentages come from
 * `score / maxScore`, grades/pass flags from the submit-time grading, and
 * per-Bloom performance is re-derived against each submission's OWN presented
 * sequence (falling back to linked order for legacy linear submissions).
 * The narrative and recommendations are deterministic rules over those
 * numbers — no model call, no fabricated metrics.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwnedClass } from "./instructorPortal";
import { gradeOne, normalizeSequence } from "./assessmentAdaptive";
import { DEFAULT_PASS_THRESHOLD, gradeFromPercent } from "../lib/adaptiveLadder";
import { DEFAULT_BLOOM_LABELS, resolveBloomLabels } from "../lib/irt";

type BloomKey =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";
type Mode = "static" | "adaptive";

const BLOOM_KEYS: BloomKey[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

const round1 = (n: number) => Math.round(n * 10) / 10;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((x, y) => x + y, 0) / values.length);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return round1(value);
}

function pct(earned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (earned / total) * 100));
}

/** Type of an assessment: explicit field, else legacy selectionMode. */
function typeOfAssessment(a: Doc<"instructorAssessments">): Mode {
  if (a.assessmentType) return a.assessmentType;
  const mode = a.selectionMode ?? "adaptive";
  return mode === "adaptive" ? "adaptive" : "static";
}

type BloomAgg = { earned: number; total: number };

type SubRow = {
  studentId: Id<"students">;
  assessmentId: Id<"instructorAssessments">;
  assessmentTitle: string;
  type: Mode;
  at: number;
  pct: number;
  grade: string | null;
  passed: boolean;
  durationMin: number | null;
  violations: number;
  terminated: boolean;
  bloom: Record<BloomKey, BloomAgg>;
};

const emptyBloom = (): Record<BloomKey, BloomAgg> =>
  Object.fromEntries(BLOOM_KEYS.map((k) => [k, { earned: 0, total: 0 }])) as
    Record<BloomKey, BloomAgg>;

/** Aggregate per-Bloom marks for a set of submission rows. */
function bloomProfile(
  rows: SubRow[],
  labels: Record<BloomKey, string>,
) {
  const agg = emptyBloom();
  const studentsPerLevel: Record<BloomKey, Set<string>> = Object.fromEntries(
    BLOOM_KEYS.map((k) => [k, new Set<string>()]),
  ) as Record<BloomKey, Set<string>>;
  for (const row of rows) {
    for (const level of BLOOM_KEYS) {
      const b = row.bloom[level];
      if (b.total <= 0) continue;
      agg[level].earned += b.earned;
      agg[level].total += b.total;
      studentsPerLevel[level].add(row.studentId);
    }
  }
  return BLOOM_KEYS.map((level) => ({
    bloom: level as string,
    label: labels[level],
    pct: agg[level].total > 0 ? round1(pct(agg[level].earned, agg[level].total)) : null,
    answers: agg[level].total,
    students: studentsPerLevel[level].size,
  }));
}

function groupStats(
  rows: SubRow[],
  rosterSize: number,
  assessmentCount: number,
) {
  const pcts = rows.map((r) => r.pct);
  const durations = rows
    .map((r) => r.durationMin)
    .filter((d): d is number => d !== null);
  const passed = rows.filter((r) => r.passed).length;
  const participants = new Set(rows.map((r) => r.studentId)).size;
  const gradeMix: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of rows) {
    const g = r.grade ?? gradeFromPercent(r.pct);
    if (gradeMix[g] !== undefined) gradeMix[g] += 1;
  }
  return {
    assessments: assessmentCount,
    submissions: rows.length,
    participants,
    participationRate:
      rosterSize > 0 ? round1((participants / rosterSize) * 100) : null,
    completionRate:
      assessmentCount > 0 && rosterSize > 0
        ? round1((rows.length / (assessmentCount * rosterSize)) * 100)
        : null,
    avgPct: mean(pcts),
    medianPct: median(pcts),
    passRate: rows.length > 0 ? round1((passed / rows.length) * 100) : null,
    highest: pcts.length > 0 ? round1(Math.max(...pcts)) : null,
    lowest: pcts.length > 0 ? round1(Math.min(...pcts)) : null,
    avgDurationMin: mean(durations),
    passed,
    failed: rows.length - passed,
    gradeMix,
  };
}

export const getClassPerformanceReport = query({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const { me, cls } = await requireOwnedClass(ctx, classId);

    // Roster = students assigned to the class + students who joined it.
    const assigned = await ctx.db
      .query("students")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();
    const enrollments = await ctx.db
      .query("classEnrollments")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();
    const roster: Doc<"students">[] = [...assigned];
    for (const e of enrollments) {
      if (!roster.some((r) => r._id === e.studentId)) {
        const doc = await ctx.db.get(e.studentId);
        if (doc) roster.push(doc);
      }
    }

    const questions = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();
    const qById = new Map(questions.map((q) => [q._id, q] as const));

    const allAssessments = await ctx.db
      .query("instructorAssessments")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();
    const assessments = allAssessments.filter((a) => a.status !== "draft");
    const draftCount = allAssessments.length - assessments.length;

    const allSubs = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();

    // Bloom display names: the instructor's most-used custom label per level
    // across this class's assessments, falling back to the taxonomy defaults.
    const labelVotes: Record<BloomKey, Map<string, number>> = Object.fromEntries(
      BLOOM_KEYS.map((k) => [k, new Map<string, number>()]),
    ) as Record<BloomKey, Map<string, number>>;
    for (const a of assessments) {
      const resolved = resolveBloomLabels(a.bloomLabels) as Record<
        BloomKey,
        string
      >;
      for (const level of BLOOM_KEYS) {
        const label = resolved[level] || DEFAULT_BLOOM_LABELS[level];
        const votes = labelVotes[level];
        votes.set(label, (votes.get(label) ?? 0) + 1);
      }
    }
    const labels = Object.fromEntries(
      BLOOM_KEYS.map((level) => {
        let best = DEFAULT_BLOOM_LABELS[level];
        let bestCount = 0;
        for (const [label, count] of labelVotes[level]) {
          if (count > bestCount) {
            best = label;
            bestCount = count;
          }
        }
        return [level, best];
      }),
    ) as Record<BloomKey, string>;

    const rows: SubRow[] = [];
    const assessmentRows: Array<{
      id: Id<"instructorAssessments">;
      title: string;
      type: Mode;
      selectionMode: string;
      status: string;
      questionCount: number;
      maxMarks: number;
      participants: number;
      submitted: number;
      expected: number;
      avgPct: number | null;
      passRate: number | null;
      highest: number | null;
      lowest: number | null;
      avgDurationMin: number | null;
      at: number;
    }> = [];

    for (const a of assessments) {
      const type = typeOfAssessment(a);
      const links = await ctx.db
        .query("assessmentQuestions")
        .withIndex("by_assessment", (x) => x.eq("assessmentId", a._id))
        .collect();
      links.sort((x, y) => x.order - y.order);
      const linkIds = links.map((l) => l.questionId);

      const subs = allSubs.filter((s) => s.assessmentId === a._id);
      const graded = subs.filter((s) => s.status !== "in_progress");
      const assessRows: SubRow[] = [];

      for (const s of graded) {
        const { sequence } = normalizeSequence(s, linkIds);
        const bloom = emptyBloom();
        let recomputedEarned = 0;
        let recomputedTotal = 0;
        for (let i = 0; i < sequence.length; i++) {
          const q = qById.get(sequence[i]);
          if (!q) continue;
          const given = (s.answers?.[i] ?? "").trim();
          const correct = gradeOne(q, given);
          recomputedTotal += q.marks;
          if (correct) recomputedEarned += q.marks;
          const b = bloom[q.bloomLevel as BloomKey] ?? {
            earned: 0,
            total: 0,
          };
          b.total += q.marks;
          if (correct) b.earned += q.marks;
          bloom[q.bloomLevel as BloomKey] = b;
        }

        const hasStored =
          s.maxScore !== undefined && s.maxScore > 0 && s.score !== undefined;
        const earned = hasStored ? (s.score as number) : recomputedEarned;
        const total = hasStored ? (s.maxScore as number) : recomputedTotal;
        if (total <= 0) continue;
        const percentage = round1(pct(earned, total));
        const submittedAt = s.submittedAt ?? s.startedAt;
        const durationMin =
          s.submittedAt !== undefined
            ? round1(Math.max(0, s.submittedAt - s.startedAt) / 60000)
            : null;

        const row: SubRow = {
          studentId: s.studentId,
          assessmentId: a._id,
          assessmentTitle: a.title,
          type,
          at: submittedAt,
          pct: percentage,
          grade: s.grade ?? gradeFromPercent(percentage),
          passed: s.passed ?? percentage >= DEFAULT_PASS_THRESHOLD,
          durationMin,
          violations: s.violationCount ?? 0,
          terminated: s.terminatedByPolicy ?? false,
          bloom,
        };
        rows.push(row);
        assessRows.push(row);
      }

      const assessPcts = assessRows.map((r) => r.pct);
      const maxMarks = linkIds.reduce((sum, id) => {
        const q = qById.get(id);
        return sum + (q?.marks ?? 0);
      }, 0);
      assessmentRows.push({
        id: a._id,
        title: a.title,
        type,
        selectionMode: a.selectionMode ?? "adaptive",
        status: a.status,
        questionCount:
          linkIds.length > 0
            ? linkIds.length
            : type === "static"
              ? 0
              : questions.length,
        maxMarks,
        participants: new Set(assessRows.map((r) => r.studentId)).size,
        submitted: assessRows.length,
        expected: roster.length,
        avgPct: mean(assessPcts),
        passRate:
          assessRows.length > 0
            ? round1(
                (assessRows.filter((r) => r.passed).length /
                  assessRows.length) *
                  100,
              )
            : null,
        highest: assessPcts.length > 0 ? round1(Math.max(...assessPcts)) : null,
        lowest: assessPcts.length > 0 ? round1(Math.min(...assessPcts)) : null,
        avgDurationMin: mean(
          assessRows
            .map((r) => r.durationMin)
            .filter((d): d is number => d !== null),
        ),
        at: a.publishedAt ?? a.createdAt,
      });
    }

    assessmentRows.sort((x, y) => x.at - y.at);

    const staticRows = rows.filter((r) => r.type === "static");
    const adaptiveRows = rows.filter((r) => r.type === "adaptive");
    const staticAssessments = assessments.filter(
      (a) => typeOfAssessment(a) === "static",
    ).length;
    const adaptiveAssessments = assessments.length - staticAssessments;

    const totals = groupStats(rows, roster.length, assessments.length);
    const staticStats = groupStats(
      staticRows,
      roster.length,
      staticAssessments,
    );
    const adaptiveStats = groupStats(
      adaptiveRows,
      roster.length,
      adaptiveAssessments,
    );

    const combinedBloom = bloomProfile(rows, labels);
    const staticBloom = bloomProfile(staticRows, labels);
    const adaptiveBloom = bloomProfile(adaptiveRows, labels);

    const comparison = {
      avgDelta:
        staticStats.avgPct !== null && adaptiveStats.avgPct !== null
          ? round1(adaptiveStats.avgPct - staticStats.avgPct)
          : null,
      passDelta:
        staticStats.passRate !== null && adaptiveStats.passRate !== null
          ? round1(adaptiveStats.passRate - staticStats.passRate)
          : null,
      participationDelta:
        staticStats.participationRate !== null &&
        adaptiveStats.participationRate !== null
          ? round1(
              adaptiveStats.participationRate - staticStats.participationRate,
            )
          : null,
      bloom: BLOOM_KEYS.map((level) => {
        const s = staticBloom.find((b) => b.bloom === level)?.pct ?? null;
        const ad = adaptiveBloom.find((b) => b.bloom === level)?.pct ?? null;
        return {
          bloom: level as string,
          label: labels[level],
          staticPct: s,
          adaptivePct: ad,
          delta: s !== null && ad !== null ? round1(ad - s) : null,
        };
      }),
      gradeMix: ["A", "B", "C", "D", "F"].map((letter) => ({
        grade: letter,
        static: staticStats.gradeMix[letter] ?? 0,
        adaptive: adaptiveStats.gradeMix[letter] ?? 0,
      })),
    };

    // Per-student summaries (static and adaptive kept apart).
    const students = roster.map((st) => {
      const mine = rows
        .filter((r) => r.studentId === st._id)
        .sort((x, y) => x.at - y.at);
      const mineStatic = mine.filter((r) => r.type === "static");
      const mineAdaptive = mine.filter((r) => r.type === "adaptive");
      const staticAvg = mean(mineStatic.map((r) => r.pct));
      const adaptiveAvg = mean(mineAdaptive.map((r) => r.pct));
      const overallAvg = mean(mine.map((r) => r.pct));
      const perLevel = emptyBloom();
      for (const r of mine) {
        for (const level of BLOOM_KEYS) {
          perLevel[level].earned += r.bloom[level].earned;
          perLevel[level].total += r.bloom[level].total;
        }
      }
      const attempted = new Set(mine.map((r) => r.assessmentId));
      const missing = assessmentRows.filter((a) => !attempted.has(a.id));
      const first = mine[0] ?? null;
      const last = mine[mine.length - 1] ?? null;
      const risk =
        mine.length === 0
          ? ("no_data" as const)
          : (overallAvg ?? 0) < DEFAULT_PASS_THRESHOLD
            ? ("at_risk" as const)
            : (overallAvg ?? 0) < 60
              ? ("watch" as const)
              : ("on_track" as const);
      return {
        id: st._id,
        name: st.name,
        email: st.email ?? null,
        attempts: mine.length,
        staticAttempts: mineStatic.length,
        adaptiveAttempts: mineAdaptive.length,
        staticAvg,
        adaptiveAvg,
        overallAvg,
        delta:
          staticAvg !== null && adaptiveAvg !== null
            ? round1(adaptiveAvg - staticAvg)
            : null,
        passRate:
          mine.length > 0
            ? round1((mine.filter((r) => r.passed).length / mine.length) * 100)
            : null,
        bestPct:
          mine.length > 0 ? round1(Math.max(...mine.map((r) => r.pct))) : null,
        lastPct: last?.pct ?? null,
        improvement:
          first && last && mine.length > 1
            ? round1(last.pct - first.pct)
            : null,
        grade: last?.grade ?? (overallAvg !== null ? gradeFromPercent(overallAvg) : null),
        risk,
        missingCount: missing.length,
        missingAssessments: missing.map((a) => a.title),
        violations: mine.reduce((sum, r) => sum + r.violations, 0),
        terminated: mine.some((r) => r.terminated),
        bloom: BLOOM_KEYS.map((level) => ({
          bloom: level as string,
          label: labels[level],
          pct:
            perLevel[level].total > 0
              ? round1(pct(perLevel[level].earned, perLevel[level].total))
              : null,
        })),
        trend: mine.map((r) => ({
          title: r.assessmentTitle,
          at: r.at,
          pct: r.pct,
          type: r.type,
        })),
      };
    });
    students.sort((x, y) => {
      if (x.overallAvg === null && y.overallAvg === null) return 0;
      if (x.overallAvg === null) return 1;
      if (y.overallAvg === null) return -1;
      return y.overallAvg - x.overallAvg;
    });

    const activeStudents = students.filter((s) => s.attempts > 0);
    const atRisk = students.filter((s) => s.risk === "at_risk");
    const watch = students.filter((s) => s.risk === "watch");
    const noData = students.filter((s) => s.risk === "no_data");
    const withImprovement = activeStudents.filter(
      (s) => s.improvement !== null,
    );
    const classImprovement = mean(
      withImprovement.map((s) => s.improvement as number),
    );

    // Chronological class progress (one point per assessment).
    const progress = assessmentRows.map((a) => ({
      label: a.title,
      at: a.at,
      type: a.type,
      avgPct: a.avgPct,
      passRate: a.passRate,
      participants: a.participants,
    }));

    // ---------------------------------------------------------------
    // Deterministic analysis
    // ---------------------------------------------------------------
    const strengths: Array<{ title: string; detail: string }> = [];
    const weaknesses: Array<{ title: string; detail: string }> = [];
    const gaps: Array<{ title: string; detail: string; severity: string }> =
      [];
    const recommendations: Array<{ title: string; detail: string }> = [];

    const scoredLevels = combinedBloom
      .filter((b) => b.pct !== null)
      .sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0));
    const topLevel = scoredLevels[0] ?? null;
    const bottomLevel = scoredLevels[scoredLevels.length - 1] ?? null;
    const hasData = rows.length > 0;

    const avg = totals.avgPct;
    const passRate = totals.passRate;

    // Strengths
    for (const level of scoredLevels.filter((b) => (b.pct ?? 0) >= 70).slice(0, 2)) {
      strengths.push({
        title: `${level.label} is secure`,
        detail: `${level.pct}% of the marks on ${level.label} items were earned by ${level.students} student${level.students === 1 ? "" : "s"}.`,
      });
    }
    if (passRate !== null && passRate >= 70) {
      strengths.push({
        title: "Pass rate is healthy",
        detail: `${passRate}% of submissions met the ${DEFAULT_PASS_THRESHOLD}% pass mark.`,
      });
    }
    if (comparison.avgDelta !== null && comparison.avgDelta >= 5) {
      strengths.push({
        title: "Adaptive delivery is working",
        detail: `Adaptive papers average ${comparison.avgDelta} points above static papers, suggesting the IRT ladder is reaching students at a workable difficulty.`,
      });
    }
    if (classImprovement !== null && classImprovement >= 3) {
      strengths.push({
        title: "Scores are trending up",
        detail: `Students improved by an average of ${classImprovement} points between their first and latest assessment.`,
      });
    }

    // Weaknesses
    for (const level of [...scoredLevels].reverse().filter((b) => (b.pct ?? 100) < 60).slice(0, 2)) {
      weaknesses.push({
        title: `${level.label} is below target`,
        detail: `${level.pct}% of marks earned on ${level.label} items — ${level.students} student${level.students === 1 ? "" : "s"} tested at this level.`,
      });
    }
    if (avg !== null && avg < 60) {
      weaknesses.push({
        title: "Class average is low",
        detail: `The class average is ${avg}%, below the 60% target band.`,
      });
    }
    if (passRate !== null && passRate < 60) {
      weaknesses.push({
        title: "Too few passing submissions",
        detail: `Only ${passRate}% of graded submissions reached the ${DEFAULT_PASS_THRESHOLD}% pass mark (${totals.failed} below).`,
      });
    }
    if (
      totals.participationRate !== null &&
      totals.participationRate < 75 &&
      roster.length > 0
    ) {
      weaknesses.push({
        title: "Assessment coverage is partial",
        detail: `Only ${totals.participationRate}% of the roster has at least one graded submission.`,
      });
    }

    // Learning gaps
    for (const level of scoredLevels.filter((b) => (b.pct ?? 100) < 50)) {
      const withLevel = activeStudents.filter(
        (s) => (s.bloom.find((b) => b.bloom === level.bloom)?.pct ?? 100) < 50,
      );
      gaps.push({
        title: `${level.label} gap`,
        detail:
          withLevel.length > 0
            ? `${level.pct}% mastery overall; ${withLevel.length} student${withLevel.length === 1 ? "" : "s"} below 50% at this level. It blocks performance on the higher-order levels that build on it.`
            : `${level.pct}% mastery overall — no student reaches 50% on these items.`,
        severity: (level.pct ?? 0) < 35 ? "high" : "medium",
      });
    }
    if (comparison.avgDelta !== null && Math.abs(comparison.avgDelta) >= 8) {
      const higher = comparison.avgDelta > 0 ? "adaptive" : "static";
      gaps.push({
        title: "Delivery-mode gap",
        detail: `The same class scores ${Math.abs(comparison.avgDelta)} points higher on ${higher} papers. The format, not just the content, is shaping results.`,
        severity: Math.abs(comparison.avgDelta) >= 15 ? "high" : "medium",
      });
    }
    if (noData.length > 0) {
      gaps.push({
        title: "No assessment evidence",
        detail: `${noData.length} student${noData.length === 1 ? "" : "s"} (${noData
          .slice(0, 3)
          .map((s) => s.name)
          .join(", ")}${noData.length > 3 ? ", …" : ""}) ${noData.length === 1 ? "has" : "have"} no graded submission, so their learning gaps cannot be diagnosed.`,
        severity: "medium",
      });
    }

    // Recommendations
    if (bottomLevel && (bottomLevel.pct ?? 100) < 70) {
      recommendations.push({
        title: `Re-teach ${bottomLevel.label}`,
        detail: `Start the next cycle with a short diagnostic, then 2–3 scaffolded ${bottomLevel.label.toLowerCase()}-level tasks with worked examples. Re-check with a 10-minute formative quiz before the next paper.`,
      });
    }
    if (comparison.avgDelta !== null && comparison.avgDelta >= 8) {
      recommendations.push({
        title: "Extend adaptive practice",
        detail: `Students gain ${comparison.avgDelta} points under adaptive delivery. Use adaptive sets for practice and reserve static papers for summative checks so the format does not cap the score.`,
      });
    } else if (comparison.avgDelta !== null && comparison.avgDelta <= -8) {
      recommendations.push({
        title: "Review the adaptive path",
        detail: `Static papers score ${Math.abs(comparison.avgDelta)} points higher. Check adaptive pacing, guessing behaviour and the display count before treating adaptive results as ability estimates.`,
      });
    }
    if (noData.length > 0) {
      recommendations.push({
        title: "Close the participation gap",
        detail: `Schedule a make-up window for ${noData.length} student${noData.length === 1 ? "" : "s"} with no graded submission (${noData
          .slice(0, 3)
          .map((s) => s.name)
          .join(", ")}${noData.length > 3 ? ", …" : ""}). Without a submission there is no evidence to grade.`,
      });
    }
    if (atRisk.length > 0) {
      recommendations.push({
        title: `Target ${atRisk.length} at-risk student${atRisk.length === 1 ? "" : "s"}`,
        detail: `Overall averages below ${DEFAULT_PASS_THRESHOLD}%: ${atRisk
          .slice(0, 4)
          .map((s) => `${s.name} (${s.overallAvg}%)`)
          .join(", ")}${atRisk.length > 4 ? ", …" : ""}. Pair each with a peer tutor and a weekly short check.`,
      });
    } else if (watch.length > 0) {
      recommendations.push({
        title: `Watch ${watch.length} borderline student${watch.length === 1 ? "" : "s"}`,
        detail: `${watch
          .slice(0, 4)
          .map((s) => `${s.name} (${s.overallAvg}%)`)
          .join(", ")} sit between ${DEFAULT_PASS_THRESHOLD}% and 60% — a focused revision session should move them into a secure pass.`,
      });
    }
    if (passRate !== null && passRate < 60) {
      recommendations.push({
        title: "Re-base the next assessment",
        detail: `Raise the share of Remember/Understand items on the next paper to rebuild confidence, then reintroduce higher-order items once the class average clears 60%.`,
      });
    }
    if (strengths.length > 0 && topLevel) {
      recommendations.push({
        title: `Use ${topLevel.label} as the anchor`,
        detail: `Lead new topics from ${topLevel.label.toLowerCase()} tasks the class already handles (${topLevel.pct}%), then bridge to the weaker levels.`,
      });
    }
    if (!hasData) {
      recommendations.length = 0;
      recommendations.push({
        title: "Collect evidence first",
        detail:
          "No graded submissions exist for this class yet. Publish a short static diagnostic and an adaptive set, then reopen this report — every section fills in automatically.",
      });
    }

    const headline = hasData
      ? `${avg}% class average · ${passRate}% pass rate · ${totals.submissions} graded submission${totals.submissions === 1 ? "" : "s"}`
      : "No graded submissions yet";

    const narrativeParts: string[] = [];
    if (hasData && avg !== null && passRate !== null) {
      narrativeParts.push(
        `${cls.name} has ${totals.submissions} graded submission${totals.submissions === 1 ? "" : "s"} across ${assessments.length} assessment${assessments.length === 1 ? "" : "s"} (${staticAssessments} static, ${adaptiveAssessments} adaptive), averaging ${avg}% with a ${passRate}% pass rate.`,
      );
      if (topLevel && bottomLevel) {
        narrativeParts.push(
          `${topLevel.label} is the strongest Bloom level (${topLevel.pct}%) and ${bottomLevel.label} the weakest (${bottomLevel.pct}%).`,
        );
      }
      if (comparison.avgDelta !== null) {
        narrativeParts.push(
          comparison.avgDelta === 0
            ? `Static and adaptive papers average the same score, so the delivery mode is not currently changing outcomes.`
            : `Adaptive papers average ${Math.abs(comparison.avgDelta)} points ${comparison.avgDelta > 0 ? "higher" : "lower"} than static papers.`,
        );
      }
      if (atRisk.length > 0) {
        narrativeParts.push(
          `${atRisk.length} student${atRisk.length === 1 ? " is" : "s are"} below the ${DEFAULT_PASS_THRESHOLD}% pass mark and need${atRisk.length === 1 ? "s" : ""} targeted support.`,
        );
      } else if (noData.length > 0) {
        narrativeParts.push(
          `${noData.length} student${noData.length === 1 ? "" : "s"} have no graded submission yet, so the class picture is incomplete.`,
        );
      } else {
        narrativeParts.push(
          `Every enrolled student has at least one graded submission.`,
        );
      }
    } else {
      narrativeParts.push(
        `${cls.name} has no graded submissions yet. Publish a static paper and an adaptive set to generate the first comparison.`,
      );
    }

    return {
      generatedAt: Date.now(),
      class: {
        id: cls._id,
        name: cls.name,
        description: cls.description ?? null,
        status: cls.status,
        instructor: me.name,
        rosterSize: roster.length,
      },
      totals: {
        ...totals,
        assessments: assessments.length,
        staticAssessments,
        adaptiveAssessments,
        drafts: draftCount,
        activeStudents: activeStudents.length,
        atRisk: atRisk.length,
        watch: watch.length,
        noData: noData.length,
        proctoringFlags: rows.filter((r) => r.violations > 0 || r.terminated)
          .length,
        classImprovement,
      },
      static: staticStats,
      adaptive: adaptiveStats,
      comparison,
      bloom: {
        combined: combinedBloom,
        static: staticBloom,
        adaptive: adaptiveBloom,
      },
      assessments: assessmentRows,
      students,
      progress,
      analysis: {
        headline,
        narrative: narrativeParts.join(" "),
        status:
          !hasData
            ? ("no_data" as const)
            : (avg ?? 0) >= 70 && (passRate ?? 0) >= 70
              ? ("on_track" as const)
              : (avg ?? 0) < DEFAULT_PASS_THRESHOLD ||
                  (passRate ?? 100) < DEFAULT_PASS_THRESHOLD
                ? ("critical" as const)
                : ("watch" as const),
        strengths: strengths.slice(0, 4),
        weaknesses: weaknesses.slice(0, 4),
        gaps: gaps.slice(0, 5),
        recommendations: recommendations.slice(0, 5),
      },
    };
  },
});

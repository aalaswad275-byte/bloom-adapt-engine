/**
 * Demo data for the unified class performance report.
 *
 * Seeds a realistic mixed cohort into an existing instructor class:
 *   • 3 static papers + 3 adaptive papers (closed, dated across six weeks);
 *   • 5 additional roster students (existing roster students are reused);
 *   • one graded submission per student per paper, with answers, marks,
 *     grades, durations and a couple of proctoring flags.
 *
 * The score patterns are intentional so the report exercises every story it
 * is built to tell:
 *   • students who fail the static paper but score far higher adaptively,
 *   • consistently strong / consistently middling students,
 *   • improving and declining trajectories across the six papers,
 *   • a low-attainment student and one roster student with no data at all.
 *
 * Answers are written so that re-grading the submission (score = correctness ×
 * marks) reproduces the stored score exactly, and per-Bloom performance is
 * therefore internally consistent.
 *
 * Re-running the mutation replaces the demo papers' links and submissions and
 * leaves everything else alone. Any other published/closed assessment in the
 * class is archived to `draft` so the report shows this clean dataset instead
 * of old scratch papers; the papers and their submissions are not deleted, so
 * the change is reversible.
 *
 * Run with:
 *   bunx convex run demoSeed:seedClassPerformanceDemo '{"classId":"<id>"}'
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_PASS_THRESHOLD, gradeFromPercent } from "../lib/adaptiveLadder";

type BloomKey =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";
type Mode = "static" | "adaptive";
type QuestionDoc = Doc<"instructorQuestions">;

const BLOOM_KEYS: BloomKey[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

/** How much easier/harder each Bloom level is for the demo cohort. */
const BLOOM_OFFSET: Record<BloomKey, number> = {
  remember: 0.14,
  understand: 0.08,
  apply: 0.02,
  analyze: -0.04,
  evaluate: -0.12,
  create: -0.26,
};

/** Extra higher-order penalty applied on static papers (format effect). */
const FORMAT_PENALTY: Record<BloomKey, number> = {
  remember: 0,
  understand: 0.02,
  apply: 0.05,
  analyze: 0.1,
  evaluate: 0.18,
  create: 0.26,
};

type StudentSpec = {
  name: string;
  /** Used to find an existing roster row before creating one. */
  email: string;
  /** Baseline Bloom mastery, 0–1. */
  base: number;
  /** Target percentage on static papers 1–3. */
  staticTargets: [number, number, number];
  /** Target percentage on adaptive papers 1–3. */
  adaptiveTargets: [number, number, number];
  /** 0–1; how much the static format suppresses higher-order performance. */
  formatGap?: number;
};

/**
 * 12 active students. The two existing "Abdulrazag Alaswad" roster rows are
 * disambiguated by email; the second one is intentionally left with no data
 * so the report still surfaces a participation gap.
 */
const STUDENTS: StudentSpec[] = [
  {
    name: "waheeb",
    email: "w.alzoog@epc.ly",
    base: 0.86,
    staticTargets: [92, 90, 94],
    adaptiveTargets: [88, 92, 90],
  },
  {
    name: "salah",
    email: "s.algabsi@epc.ly",
    base: 0.6,
    staticTargets: [52, 61, 70],
    adaptiveTargets: [55, 66, 77],
  },
  {
    name: "syhual",
    email: "s.altayf@epc.ly",
    base: 0.74,
    staticTargets: [84, 73, 65],
    adaptiveTargets: [82, 71, 62],
  },
  {
    name: "hanan mohammed",
    email: "h.ali@epc.fly",
    base: 0.66,
    staticTargets: [40, 45, 48],
    adaptiveTargets: [76, 81, 85],
    formatGap: 1,
  },
  {
    name: "limia",
    email: "l.althabet@epc.ly",
    base: 0.63,
    staticTargets: [62, 65, 63],
    adaptiveTargets: [60, 65, 68],
  },
  {
    name: "Fatema",
    email: "f.benglew@epc.ly",
    base: 0.4,
    staticTargets: [36, 40, 43],
    adaptiveTargets: [39, 42, 46],
  },
  {
    name: "ِAbdulrazag Alaswad",
    email: "alaswad@epc.ly",
    base: 0.67,
    staticTargets: [44, 41, 47],
    adaptiveTargets: [78, 84, 88],
    formatGap: 0.9,
  },
  {
    name: "Mariam Faraj",
    email: "mariam.faraj@epc.ly",
    base: 0.87,
    staticTargets: [86, 90, 88],
    adaptiveTargets: [90, 88, 92],
  },
  {
    name: "Yousef Ben Omar",
    email: "yousef.benomar@epc.ly",
    base: 0.64,
    staticTargets: [36, 42, 45],
    adaptiveTargets: [71, 77, 81],
    formatGap: 1,
  },
  {
    name: "Salma Al-Amin",
    email: "salma.alamin@epc.ly",
    base: 0.62,
    staticTargets: [47, 57, 68],
    adaptiveTargets: [51, 63, 74],
  },
  {
    name: "Omar Zaid",
    email: "omar.zaid@epc.ly",
    base: 0.72,
    staticTargets: [80, 70, 65],
    adaptiveTargets: [77, 68, 64],
  },
  {
    name: "Nour Al-Hadi",
    email: "nour.alhadi@epc.ly",
    base: 0.5,
    staticTargets: [43, 50, 58],
    adaptiveTargets: [45, 54, 64],
  },
];

type PaperSpec = {
  key: string;
  type: Mode;
  title: string;
  description: string;
  daysAgo: number;
  timeLimitMin: number;
};

/** Chronological: static, adaptive, static, adaptive, static, adaptive. */
const PAPERS: PaperSpec[] = [
  {
    key: "s1",
    type: "static",
    title: "Reading Comprehension — Quiz 1",
    description:
      "Fixed paper covering the first reading unit: inference, vocabulary in context and sentence accuracy.",
    daysAgo: 45,
    timeLimitMin: 30,
  },
  {
    key: "a1",
    type: "adaptive",
    title: "Adaptive Diagnostic — Reading",
    description:
      "Adaptive diagnostic used to place students; difficulty follows each response.",
    daysAgo: 38,
    timeLimitMin: 30,
  },
  {
    key: "s2",
    type: "static",
    title: "Grammar & Vocabulary — Quiz 2",
    description:
      "Fixed paper on tense choice, question forms and word formation.",
    daysAgo: 31,
    timeLimitMin: 30,
  },
  {
    key: "a2",
    type: "adaptive",
    title: "Adaptive Practice — Grammar",
    description:
      "Adaptive grammar practice set; every student receives a different sequence.",
    daysAgo: 24,
    timeLimitMin: 25,
  },
  {
    key: "s3",
    type: "static",
    title: "Literary Analysis — Unit Test",
    description:
      "Summative fixed paper: analysis of a short passage, evaluation of evidence and a written response.",
    daysAgo: 17,
    timeLimitMin: 45,
  },
  {
    key: "a3",
    type: "adaptive",
    title: "Adaptive Mastery Check",
    description:
      "End-of-unit adaptive check spanning all six Bloom levels.",
    daysAgo: 10,
    timeLimitMin: 30,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const ADAPTIVE_DISPLAY_COUNT = 12;

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Stable pseudo-random value in [0,1) — makes re-runs deterministic. */
function jitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

function wrongAnswerFor(q: QuestionDoc): string {
  if (q.questionType === "true_false") {
    return q.correctAnswer === "True" ? "False" : "True";
  }
  if (q.questionType === "multiple_choice" && q.options?.length) {
    return (
      q.options.find(
        (o) => o.trim().toLowerCase() !== q.correctAnswer.trim().toLowerCase(),
      ) ?? "No answer"
    );
  }
  return "Not sure";
}

/**
 * Decide which questions are answered correctly for one paper.
 *
 * Each question is first answered by a probability draw from the student's
 * Bloom mastery (plus question-level noise), which keeps easy items fallible
 * and gives every student a distinct per-Bloom profile. The draws are then
 * nudged toward the paper's target score by flipping the single question that
 * moves the percentage closest to target, until no flip improves it. The
 * stored score is the sum of the resulting correct marks, so re-grading and
 * the stored score always agree.
 */
function correctQuestionIds(
  sequence: QuestionDoc[],
  targetPct: number,
  masteryFor: (level: BloomKey) => number,
  seed: string,
): Set<string> {
  const target = clamp(targetPct, 0, 100);
  const maxScore = sequence.reduce((sum, q) => sum + q.marks, 0);
  if (maxScore <= 0) return new Set();

  const probability = new Map<string, number>();
  const correct = new Map<string, boolean>();
  for (const q of sequence) {
    const p = clamp(
      masteryFor(q.bloomLevel as BloomKey) +
        (jitter(`${seed}:p:${q._id}`) - 0.5) * 0.18,
      0.02,
      0.98,
    );
    probability.set(q._id, p);
    correct.set(q._id, jitter(`${seed}:c:${q._id}`) < p);
  }

  const earned = () =>
    sequence.reduce(
      (sum, q) => sum + (correct.get(q._id) ? q.marks : 0),
      0,
    );
  const distance = () => Math.abs((earned() / maxScore) * 100 - target);
  const byProbability = [...sequence].sort(
    (x, y) =>
      (probability.get(y._id) ?? 0) - (probability.get(x._id) ?? 0) ||
      x._id.localeCompare(y._id),
  );

  // Calibrate toward the target, but only by flipping items in the direction
  // the score needs and in mastery order: weak students lose their hardest
  // items first, strong students gain their easiest missing items first.
  for (let step = 0; step < sequence.length; step++) {
    const needMore = (earned() / maxScore) * 100 < target;
    const candidates = needMore
      ? byProbability.filter((q) => !correct.get(q._id))
      : [...byProbability].reverse().filter((q) => correct.get(q._id));
    const before = distance();
    let flipped = false;
    for (const q of candidates) {
      correct.set(q._id, !correct.get(q._id));
      const after = distance();
      correct.set(q._id, !correct.get(q._id));
      if (after < before - 1e-9) {
        correct.set(q._id, !correct.get(q._id));
        flipped = true;
        break;
      }
    }
    if (!flipped) break;
  }

  return new Set(
    sequence.filter((q) => correct.get(q._id)).map((q) => q._id),
  );
}

export const seedClassPerformanceDemo = internalMutation({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const cls = await ctx.db.get(classId);
    if (!cls) throw new Error("Class not found.");
    const instructorId = cls.instructorId;
    const now = Date.now();

    // ---------------------------------------------------------------
    // Question bank grouped by Bloom level (deterministic order)
    // ---------------------------------------------------------------
    const bank = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();
    if (bank.length < 24) {
      throw new Error(
        `The class needs at least 24 bank questions to seed demo papers (found ${bank.length}).`,
      );
    }
    const byBloom = new Map<BloomKey, QuestionDoc[]>();
    for (const level of BLOOM_KEYS) {
      byBloom.set(level, []);
    }
    for (const q of [...bank].sort((x, y) => x._id.localeCompare(y._id))) {
      byBloom.get(q.bloomLevel as BloomKey)?.push(q);
    }
    for (const level of BLOOM_KEYS) {
      if ((byBloom.get(level)?.length ?? 0) < 2) {
        throw new Error(`Not enough ${level} questions to build demo papers.`);
      }
    }
    const group = (level: BloomKey) => byBloom.get(level) as QuestionDoc[];

    // ---------------------------------------------------------------
    // Roster: reuse students by email, create the missing ones
    // ---------------------------------------------------------------
    const roster = await ctx.db
      .query("students")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();
    const normalizeEmail = (e: string | undefined) =>
      (e ?? "").trim().toLowerCase();

    type SeededStudent = {
      spec: StudentSpec;
      id: Id<"students">;
      index: number;
    };
    const seededStudents: SeededStudent[] = [];
    let createdStudents = 0;

    for (let i = 0; i < STUDENTS.length; i++) {
      const spec = STUDENTS[i];
      const email = spec.email.trim().toLowerCase();
      let student = roster.find((s) => normalizeEmail(s.email) === email);
      if (!student) {
        const newId = await ctx.db.insert("students", {
          name: spec.name,
          email: spec.email,
          instructorId,
          classId,
          enrolledAt: now - 60 * DAY_MS,
          status: "active",
        });
        student = (await ctx.db.get(newId)) ?? undefined;
        createdStudents += 1;
      }
      if (student) {
        seededStudents.push({ spec, id: student._id, index: i });
      }
    }

    // ---------------------------------------------------------------
    // Create/replace the six demo papers
    // ---------------------------------------------------------------
    const classAssessments = await ctx.db
      .query("instructorAssessments")
      .withIndex("by_class", (q) => q.eq("classId", classId))
      .collect();

    const staticPaperKeys = PAPERS.filter((p) => p.type === "static").map(
      (p) => p.key,
    );
    const staticSequences = new Map<string, QuestionDoc[]>(
      staticPaperKeys.map((key, paperIndex) => [
        key,
        BLOOM_KEYS.map((level, levelIndex) => {
          const pool = group(level);
          return pool[(paperIndex * 2 + levelIndex) % pool.length];
        }),
      ]),
    );

    const adaptiveSequence = (studentIndex: number, paperIndex: number) =>
      BLOOM_KEYS.flatMap((level, levelIndex) => {
        const pool = group(level);
        return [0, 1].map(
          (k) =>
            pool[(studentIndex + paperIndex * 3 + levelIndex + k * 2) % pool.length],
        );
      });

    const assessmentIds = new Map<string, Id<"instructorAssessments">>();
    let archived = 0;
    let createdAssessments = 0;

    for (const paper of PAPERS) {
      const publishedAt = now - paper.daysAgo * DAY_MS;
      const existing = classAssessments.find((a) => a.title === paper.title);
      const fields = {
        classId,
        instructorId,
        title: paper.title,
        description: paper.description,
        timeLimitMin: paper.timeLimitMin,
        assessmentType: paper.type,
        selectionMode: paper.type,
        status: "closed" as const,
        publishedAt,
        poolSize: paper.type === "adaptive" ? bank.length : undefined,
        displayCount:
          paper.type === "adaptive" ? ADAPTIVE_DISPLAY_COUNT : undefined,
        updatedAt: publishedAt,
      };

      let assessmentId: Id<"instructorAssessments">;
      if (existing) {
        assessmentId = existing._id;
        await ctx.db.patch(assessmentId, fields);
      } else {
        assessmentId = await ctx.db.insert("instructorAssessments", {
          ...fields,
          createdAt: publishedAt,
        });
        createdAssessments += 1;
      }
      assessmentIds.set(paper.key, assessmentId);

      // Replace this paper's links and submissions.
      const oldLinks = await ctx.db
        .query("assessmentQuestions")
        .withIndex("by_assessment", (q) => q.eq("assessmentId", assessmentId))
        .collect();
      for (const link of oldLinks) await ctx.db.delete(link._id);
      const oldSubs = await ctx.db
        .query("assessmentSubmissions")
        .withIndex("by_assessment", (q) => q.eq("assessmentId", assessmentId))
        .collect();
      for (const sub of oldSubs) await ctx.db.delete(sub._id);

      const linkPool =
        paper.type === "static"
          ? (staticSequences.get(paper.key) ?? bank)
          : bank;
      for (let order = 0; order < linkPool.length; order++) {
        await ctx.db.insert("assessmentQuestions", {
          assessmentId,
          questionId: linkPool[order]._id,
          order,
        });
      }
    }

    // Archive everything that is not part of this demo set.
    const demoIds = new Set(assessmentIds.values());
    for (const a of classAssessments) {
      if (!demoIds.has(a._id) && a.status !== "draft") {
        await ctx.db.patch(a._id, { status: "draft", updatedAt: now });
        archived += 1;
      }
    }

    // ---------------------------------------------------------------
    // Submissions
    // ---------------------------------------------------------------
    const incidentKeys = new Set(["s.algabsi@epc.ly:s2", "omar.zaid@epc.ly:a2"]);

    let submissionCount = 0;
    for (const student of seededStudents) {
      const spec = student.spec;
      let staticIndex = 0;
      let adaptiveIndex = 0;

      for (let paperIndex = 0; paperIndex < PAPERS.length; paperIndex++) {
        const paper = PAPERS[paperIndex];
        const assessmentId = assessmentIds.get(paper.key);
        if (!assessmentId) continue;

        const sequence =
          paper.type === "static"
            ? (staticSequences.get(paper.key) ?? [])
            : adaptiveSequence(student.index, paperIndex);
        const targetPct =
          paper.type === "static"
            ? spec.staticTargets[staticIndex++]
            : spec.adaptiveTargets[adaptiveIndex++];

        const masteryFor = (level: BloomKey) => {
          // Individual variation keeps every student's Bloom profile distinct.
          const personal =
            (jitter(`${spec.email.trim().toLowerCase()}:${level}`) - 0.5) *
            0.18;
          let m = spec.base + BLOOM_OFFSET[level] + personal;
          if (paper.type === "static" && spec.formatGap) {
            m -= spec.formatGap * FORMAT_PENALTY[level];
          }
          return clamp(m, 0.04, 0.97);
        };

        const correct = correctQuestionIds(
          sequence,
          targetPct,
          masteryFor,
          `${spec.email.trim().toLowerCase()}:${paper.key}`,
        );

        let earned = 0;
        let maxScore = 0;
        const answers: string[] = [];
        const responseTimesMs: number[] = [];
        const theta = Object.fromEntries(
          BLOOM_KEYS.map((level) => [level, 0]),
        ) as Record<BloomKey, number>;
        const bloomEarned: Record<BloomKey, number> = Object.fromEntries(
          BLOOM_KEYS.map((level) => [level, 0]),
        ) as Record<BloomKey, number>;
        const bloomTotal: Record<BloomKey, number> = Object.fromEntries(
          BLOOM_KEYS.map((level) => [level, 0]),
        ) as Record<BloomKey, number>;

        for (const q of sequence) {
          const level = q.bloomLevel as BloomKey;
          maxScore += q.marks;
          bloomTotal[level] += q.marks;
          const isCorrect = correct.has(q._id);
          answers.push(isCorrect ? q.correctAnswer : wrongAnswerFor(q));
          responseTimesMs.push(
            Math.round(
              q.expectedTimeSec *
                1000 *
                (0.7 + jitter(`${spec.email}:${paper.key}:${q._id}`) * 0.7),
            ),
          );
          if (isCorrect) {
            earned += q.marks;
            bloomEarned[level] += q.marks;
          }
        }

        // Plausible θ per Bloom level (results views may display it).
        for (const level of BLOOM_KEYS) {
          const levelPct =
            bloomTotal[level] > 0 ? bloomEarned[level] / bloomTotal[level] : 0.5;
          theta[level] =
            Math.round((levelPct - 0.5) * 2.6 * 10) / 10;
        }

        const percentage = Math.round((earned / maxScore) * 1000) / 10;
        const durationMin =
          paper.type === "static"
            ? 24 + ((student.index * 3 + paperIndex * 4) % 18)
            : 15 + ((student.index * 2 + paperIndex * 3) % 13);
        const submittedAt =
          now -
          (paper.daysAgo - 1) * DAY_MS +
          (9 * 60 + ((student.index * 47 + paperIndex * 23) % 240)) * 60000;
        const startedAt = submittedAt - durationMin * 60000;

        const incident = incidentKeys.has(
          `${spec.email.trim().toLowerCase()}:${paper.key}`,
        );

        await ctx.db.insert("assessmentSubmissions", {
          assessmentId,
          classId,
          studentId: student.id,
          status: "graded",
          answers,
          startedAt,
          timerStartedAt: startedAt,
          submittedAt,
          score: earned,
          maxScore,
          autoGraded: true,
          currentQuestionIndex: sequence.length,
          questionSequence: sequence.map((q) => q._id),
          thetaProfile: theta,
          responseTimesMs,
          completionReason: paper.type === "adaptive" ? "quota" : undefined,
          grade: gradeFromPercent(percentage),
          passed: percentage >= DEFAULT_PASS_THRESHOLD,
          violationCount: incident ? 1 : 0,
          riskScore: incident ? 0.22 : 0.02,
          policyAction: incident ? "WARNING" : undefined,
          violationLog: incident
            ? [
                {
                  type: "phone_detected",
                  at: submittedAt - 6 * 60000,
                  confidence: 0.84,
                  durationMs: 4200,
                },
              ]
            : undefined,
        });
        submissionCount += 1;
      }
    }

    return {
      class: cls.name,
      papers: PAPERS.length,
      assessmentsCreated: createdAssessments,
      submissions: submissionCount,
      activeStudents: seededStudents.length,
      studentsCreated: createdStudents,
      archivedAssessments: archived,
      archivedNote:
        "Other published/closed papers were moved to draft; their submissions were kept.",
    };
  },
});

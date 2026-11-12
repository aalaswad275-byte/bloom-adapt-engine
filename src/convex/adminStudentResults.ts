/**
 * Student Overall Results Dashboard.
 *
 * Aggregates completed `assessmentSubmissions` for every class, with a
 * per-student/per-assessment dedupe pass so stale or repeated submission rows
 * can never inflate attempts, pass counts, averages or pass rates. Fair
 * Adaptive Final (`selectionMode: "final"`) results are reported separately.
 * Admin-only and computed entirely from stored database rows.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./adminLib";
import { DEFAULT_PASS_THRESHOLD, gradeFromPercent } from "../lib/adaptiveLadder";

type AssessmentDoc = Doc<"instructorAssessments">;
type ClassDoc = Doc<"classes">;
type StudentDoc = Doc<"students">;
type SubmissionDoc = Doc<"assessmentSubmissions">;

type Mode = "adaptive" | "static" | "random" | "final";

const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) =>
  values.length === 0
    ? null
    : round1(values.reduce((sum, value) => sum + value, 0) / values.length);
const rate = (part: number, total: number) =>
  total === 0 ? null : round1((part / total) * 100);

interface Attempt {
  submission: SubmissionDoc;
  assessment: AssessmentDoc;
  cls: ClassDoc | null;
  student: StudentDoc;
  subject: string;
  mode: Mode;
  score: number;
  maxScore: number;
  pct: number;
  grade: string;
  passed: boolean;
  completed: boolean;
  date: number;
}

interface Bucket {
  attempts: number;
  completed: number;
  scored: number;
  pctSum: number;
  passed: number;
  failed: number;
  marks: number;
  outOf: number;
  students: Set<string>;
  finalAttempts: number;
  finalCompleted: number;
  finalScored: number;
  finalPctSum: number;
  finalPassed: number;
  finalFailed: number;
}

const emptyBucket = (): Bucket => ({
  attempts: 0,
  completed: 0,
  scored: 0,
  pctSum: 0,
  passed: 0,
  failed: 0,
  marks: 0,
  outOf: 0,
  students: new Set<string>(),
  finalAttempts: 0,
  finalCompleted: 0,
  finalScored: 0,
  finalPctSum: 0,
  finalPassed: 0,
  finalFailed: 0,
});

const bucketFor = <K>(map: Map<K, Bucket>, key: K): Bucket => {
  const existing = map.get(key);
  if (existing) return existing;
  const created = emptyBucket();
  map.set(key, created);
  return created;
};

const addAttempt = (bucket: Bucket, attempt: Attempt) => {
  bucket.attempts += 1;
  bucket.students.add(attempt.student._id);
  if (attempt.completed) {
    bucket.completed += 1;
    if (attempt.maxScore > 0) {
      bucket.scored += 1;
      bucket.pctSum += attempt.pct;
      bucket.marks += attempt.score;
      bucket.outOf += attempt.maxScore;
      if (attempt.passed) bucket.passed += 1;
      else bucket.failed += 1;
    }
  }
  if (attempt.mode === "final") {
    bucket.finalAttempts += 1;
    if (attempt.completed) {
      bucket.finalCompleted += 1;
      if (attempt.maxScore > 0) {
        bucket.finalScored += 1;
        bucket.finalPctSum += attempt.pct;
        if (attempt.passed) bucket.finalPassed += 1;
        else bucket.finalFailed += 1;
      }
    }
  }
};

const bucketStats = (bucket: Bucket) => ({
  attempts: bucket.attempts,
  completed: bucket.completed,
  scored: bucket.scored,
  participants: bucket.students.size,
  passed: bucket.passed,
  failed: bucket.failed,
  avgPct: bucket.scored > 0 ? round1(bucket.pctSum / bucket.scored) : null,
  passRate: rate(bucket.passed, bucket.scored),
  avgMarks:
    bucket.scored > 0 ? round1(bucket.marks / bucket.scored) : null,
  avgOutOf:
    bucket.scored > 0 ? round1(bucket.outOf / bucket.scored) : null,
  finalAttempts: bucket.finalAttempts,
  finalCompleted: bucket.finalCompleted,
  finalPassed: bucket.finalPassed,
  finalFailed: bucket.finalFailed,
  finalAvgPct:
    bucket.finalScored > 0
      ? round1(bucket.finalPctSum / bucket.finalScored)
      : null,
  finalPassRate: rate(bucket.finalPassed, bucket.finalScored),
});

const monthKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });

const lastMonths = (count: number) => {
  const now = new Date();
  const rows: Array<{ key: string; label: string }> = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    rows.push({ key: monthKey(date.getTime()), label: monthLabel(date.getTime()) });
  }
  return rows;
};

export const getStudentResultsDashboard = query({
  args: {
    classId: v.optional(v.id("classes")),
    subject: v.optional(v.string()),
    mode: v.optional(
      v.union(v.literal("all"), v.literal("final"), v.literal("standard")),
    ),
    /** 0 = all time, otherwise only submissions in the last N days. */
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const [
      classes,
      instructors,
      students,
      enrollments,
      assessments,
      submissions,
      categories,
    ] = await Promise.all([
      ctx.db.query("classes").collect(),
      ctx.db.query("instructors").collect(),
      ctx.db.query("students").collect(),
      ctx.db.query("classEnrollments").collect(),
      ctx.db.query("instructorAssessments").collect(),
      ctx.db.query("assessmentSubmissions").collect(),
      ctx.db.query("questionCategories").collect(),
    ]);

    const classById = new Map(classes.map((row) => [row._id, row] as const));
    const instructorById = new Map(
      instructors.map((row) => [row._id, row] as const),
    );
    const studentById = new Map(students.map((row) => [row._id, row] as const));
    const assessmentById = new Map(
      assessments.map((row) => [row._id, row] as const),
    );
    const categoryById = new Map(
      categories.map((row) => [row._id, row] as const),
    );

    const subjectOf = (cls: ClassDoc | null): string => {
      if (!cls) return "Unassigned";
      if (cls.subject) return cls.subject;
      if (cls.categoryId) {
        const category = categoryById.get(cls.categoryId);
        if (category) return category.name;
      }
      return "Unassigned";
    };

    // ---- Stable subjects/classes for filter controls -----------------------
    const subjectOptions = [
      ...new Set([
        ...classes.map((cls) => subjectOf(cls)),
        ...categories.filter((row) => row.status === "active").map((row) => row.name),
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const classOptions = [...classes]
      .map((cls) => ({
        id: cls._id,
        name: cls.name,
        subject: subjectOf(cls),
      }))
      .sort(
        (a, b) =>
          a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name),
      );

    // ---- Build attempts, then dedupe student + assessment ------------------
    const raw: Attempt[] = [];
    for (const submission of submissions) {
      const assessment = assessmentById.get(submission.assessmentId);
      if (!assessment) continue;
      const student = studentById.get(submission.studentId);
      if (!student) continue;
      const cls =
        classById.get(submission.classId) ??
        classById.get(assessment.classId) ??
        null;
      const mode = (assessment.selectionMode ?? "adaptive") as Mode;
      const completed = submission.status !== "in_progress";
      const maxScore = submission.maxScore ?? 0;
      const score = submission.score ?? 0;
      const pct =
        maxScore > 0 ? Math.max(0, Math.min(100, (score / maxScore) * 100)) : 0;
      raw.push({
        submission,
        assessment,
        cls,
        student,
        subject: subjectOf(cls),
        mode,
        score,
        maxScore,
        pct,
        grade: submission.grade ?? (completed && maxScore > 0 ? gradeFromPercent(pct) : "—"),
        passed:
          submission.passed ??
          (completed && maxScore > 0 ? pct >= DEFAULT_PASS_THRESHOLD : false),
        completed,
        date: submission.submittedAt ?? submission.startedAt,
      });
    }

    /**
     * Dedupe key: one student's attempt at one assessment. Prefer a completed
     * row over an in-progress row, then the most recently submitted/started
     * row. This guarantees attempts and pass rates are not double counted.
     */
    const uniqueByKey = new Map<string, Attempt>();
    for (const attempt of raw) {
      const key = `${attempt.student._id}:${attempt.assessment._id}`;
      const existing = uniqueByKey.get(key);
      if (!existing) {
        uniqueByKey.set(key, attempt);
        continue;
      }
      if (attempt.completed !== existing.completed) {
        if (attempt.completed) uniqueByKey.set(key, attempt);
        continue;
      }
      if (attempt.date > existing.date) uniqueByKey.set(key, attempt);
    }
    const allUnique = [...uniqueByKey.values()];

    // ---- Apply dashboard filters -------------------------------------------
    const cutoff =
      args.days !== undefined && args.days > 0
        ? Date.now() - args.days * 24 * 60 * 60 * 1000
        : null;
    const modeFilter = args.mode ?? "all";
    const attempts = allUnique.filter((attempt) => {
      if (args.classId && attempt.cls?._id !== args.classId) return false;
      if (args.subject && attempt.subject !== args.subject) return false;
      if (modeFilter === "final" && attempt.mode !== "final") return false;
      if (modeFilter === "standard" && attempt.mode === "final") return false;
      if (cutoff !== null && attempt.date < cutoff) return false;
      return true;
    });

    const completed = attempts.filter((attempt) => attempt.completed);
    const scored = completed.filter((attempt) => attempt.maxScore > 0);
    const finals = attempts.filter((attempt) => attempt.mode === "final");
    const finalCompleted = finals.filter((attempt) => attempt.completed);
    const finalScored = finalCompleted.filter((attempt) => attempt.maxScore > 0);

    const pcts = scored.map((attempt) => attempt.pct);
    const sortedPcts = [...pcts].sort((a, b) => a - b);
    const medianPct =
      sortedPcts.length === 0
        ? null
        : sortedPcts.length % 2 === 1
          ? round1(sortedPcts[Math.floor(sortedPcts.length / 2)])
          : round1(
              (sortedPcts[sortedPcts.length / 2 - 1] +
                sortedPcts[sortedPcts.length / 2]) /
                2,
            );

    // ---- Class comparison (all classes in scope, including no attempts) -----
    const classMap = new Map<string, Bucket>();
    for (const classId of args.classId ? [args.classId] : []) {
      if (classById.has(classId)) classMap.set(classId, emptyBucket());
    }
    const scopedClasses = classes.filter((cls) => {
      if (args.classId) return cls._id === args.classId;
      if (args.subject) return subjectOf(cls) === args.subject;
      return true;
    });
    for (const cls of scopedClasses) {
      if (!classMap.has(cls._id)) classMap.set(cls._id, emptyBucket());
    }
    for (const attempt of attempts) {
      if (attempt.cls) addAttempt(bucketFor(classMap, attempt.cls._id), attempt);
    }
    const rosterSize = new Map<string, number>();
    for (const enrollment of enrollments) {
      rosterSize.set(
        enrollment.classId,
        (rosterSize.get(enrollment.classId) ?? 0) + 1,
      );
    }
    const classRows = [...classMap.entries()]
      .map(([id, bucket]) => {
        const cls = classById.get(id as Id<"classes">) ?? null;
        const instructor = cls ? instructorById.get(cls.instructorId) : null;
        return {
          id,
          name: cls?.name ?? "Unassigned",
          subject: cls ? subjectOf(cls) : "Unassigned",
          instructor: instructor?.name ?? "—",
          roster: cls ? (rosterSize.get(cls._id) ?? 0) : 0,
          ...bucketStats(bucket),
        };
      })
      .sort(
        (a, b) =>
          (b.avgPct ?? -1) - (a.avgPct ?? -1) ||
          b.completed - a.completed ||
          a.name.localeCompare(b.name),
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));

    // ---- Subject comparison -------------------------------------------------
    const subjectMap = new Map<string, Bucket>();
    const subjectScope = new Set(
      scopedClasses.map((cls) => subjectOf(cls)),
    );
    if (args.subject) subjectScope.add(args.subject);
    for (const subject of subjectScope) subjectMap.set(subject, emptyBucket());
    for (const attempt of attempts) {
      addAttempt(bucketFor(subjectMap, attempt.subject), attempt);
    }
    const subjectRows = [...subjectMap.entries()]
      .filter(([, bucket]) => bucket.attempts > 0)
      .map(([subject, bucket]) => ({
        subject,
        classes: scopedClasses.filter((cls) => subjectOf(cls) === subject).length,
        ...bucketStats(bucket),
      }))
      .sort(
        (a, b) =>
          (b.avgPct ?? -1) - (a.avgPct ?? -1) ||
          b.completed - a.completed ||
          a.subject.localeCompare(b.subject),
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));

    // ---- Student aggregates -------------------------------------------------
    interface StudentAggregate {
      id: string;
      name: string;
      email: string | null;
      classes: Set<string>;
      subjects: Set<string>;
      bucket: Bucket;
      bestPct: number | null;
      worstPct: number | null;
      finalBucket: Bucket;
    }
    const studentMap = new Map<string, StudentAggregate>();
    for (const attempt of attempts) {
      let row = studentMap.get(attempt.student._id);
      if (!row) {
        row = {
          id: attempt.student._id,
          name: attempt.student.name,
          email: attempt.student.email ?? null,
          classes: new Set<string>(),
          subjects: new Set<string>(),
          bucket: emptyBucket(),
          bestPct: null,
          worstPct: null,
          finalBucket: emptyBucket(),
        };
        studentMap.set(attempt.student._id, row);
      }
      addAttempt(row.bucket, attempt);
      if (attempt.mode === "final") addAttempt(row.finalBucket, attempt);
      if (attempt.cls) row.classes.add(attempt.cls.name);
      row.subjects.add(attempt.subject);
      if (attempt.completed && attempt.maxScore > 0) {
        row.bestPct =
          row.bestPct === null ? attempt.pct : Math.max(row.bestPct, attempt.pct);
        row.worstPct =
          row.worstPct === null ? attempt.pct : Math.min(row.worstPct, attempt.pct);
      }
    }
    const studentRows = [...studentMap.values()]
      .map((row) => {
        const stats = bucketStats(row.bucket);
        const finalStats = bucketStats(row.finalBucket);
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          classes: [...row.classes].sort(),
          subjects: [...row.subjects].sort(),
          attempts: stats.attempts,
          completed: stats.completed,
          passed: stats.passed,
          failed: stats.failed,
          avgPct: stats.avgPct,
          passRate: stats.passRate,
          bestPct: row.bestPct === null ? null : round1(row.bestPct),
          worstPct: row.worstPct === null ? null : round1(row.worstPct),
          finalAttempts: finalStats.attempts,
          finalCompleted: finalStats.completed,
          finalPct: finalStats.avgPct,
          finalPassed: finalStats.passed,
          finalFailed: finalStats.failed,
          finalPassRate: finalStats.passRate,
        };
      })
      .sort(
        (a, b) =>
          (b.avgPct ?? -1) - (a.avgPct ?? -1) ||
          b.completed - a.completed ||
          a.name.localeCompare(b.name),
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));

    // ---- Charts -------------------------------------------------------------
    const gradeOrder = ["A", "B", "C", "D", "E", "F"] as const;
    const gradeDistribution = gradeOrder.map((grade) => ({
      grade,
      count: scored.filter((attempt) => attempt.grade === grade).length,
    }));
    const scoreDistribution = [
      { band: "0–49", count: pcts.filter((pct) => pct < 50).length },
      { band: "50–59", count: pcts.filter((pct) => pct >= 50 && pct < 60).length },
      { band: "60–69", count: pcts.filter((pct) => pct >= 60 && pct < 70).length },
      { band: "70–79", count: pcts.filter((pct) => pct >= 70 && pct < 80).length },
      { band: "80–89", count: pcts.filter((pct) => pct >= 80 && pct < 90).length },
      { band: "90–100", count: pcts.filter((pct) => pct >= 90).length },
    ];
    const modes: Mode[] = ["static", "random", "adaptive", "final"];
    const modeRows = modes.map((mode) => {
      const rows = attempts.filter((attempt) => attempt.mode === mode);
      const done = rows.filter((attempt) => attempt.completed);
      const valid = done.filter((attempt) => attempt.maxScore > 0);
      const passed = valid.filter((attempt) => attempt.passed).length;
      return {
        mode,
        attempts: rows.length,
        completed: done.length,
        avgPct: mean(valid.map((attempt) => attempt.pct)),
        passRate: rate(passed, valid.length),
      };
    });

    const trendKeys = lastMonths(6);
    const trend = trendKeys.map(({ key, label }) => {
      const rows = scored.filter((attempt) => monthKey(attempt.date) === key);
      const passed = rows.filter((attempt) => attempt.passed).length;
      return {
        key,
        label,
        attempts: rows.length,
        avgPct: mean(rows.map((attempt) => attempt.pct)),
        passRate: rate(passed, rows.length),
      };
    });

    // ---- Overview -----------------------------------------------------------
    const passed = scored.filter((attempt) => attempt.passed).length;
    const completedCount = completed.length;
    const participants = new Set(attempts.map((attempt) => attempt.student._id)).size;
    const activeClasses = new Set(
      attempts.map((attempt) => attempt.cls?._id ?? "unassigned"),
    ).size;
    const activeSubjects = new Set(attempts.map((attempt) => attempt.subject)).size;
    const finalPassed = finalScored.filter((attempt) => attempt.passed).length;

    return {
      generatedAt: Date.now(),
      filters: {
        classId: args.classId ?? null,
        subject: args.subject ?? null,
        mode: modeFilter,
        days: args.days ?? 0,
      },
      options: {
        classes: classOptions,
        subjects: subjectOptions,
      },
      overview: {
        totalAttempts: attempts.length,
        completedAttempts: completedCount,
        inProgress: attempts.length - completedCount,
        completionRate: rate(completedCount, attempts.length),
        participants,
        classes: classRows.length,
        activeClasses,
        subjects: subjectRows.length,
        activeSubjects,
        passed,
        failed: scored.length - passed,
        passRate: rate(passed, scored.length),
        avgPct: mean(pcts),
        medianPct,
        highestPct: pcts.length > 0 ? round1(Math.max(...pcts)) : null,
        lowestPct: pcts.length > 0 ? round1(Math.min(...pcts)) : null,
        earnedMarks: round1(scored.reduce((sum, attempt) => sum + attempt.score, 0)),
        totalMarks: round1(scored.reduce((sum, attempt) => sum + attempt.maxScore, 0)),
        duplicatesRemoved: raw.length - allUnique.length,
        fairFinal: {
          attempts: finals.length,
          completed: finalCompleted.length,
          participants: new Set(finals.map((attempt) => attempt.student._id)).size,
          passed: finalPassed,
          failed: finalScored.length - finalPassed,
          passRate: rate(finalPassed, finalScored.length),
          avgPct: mean(finalScored.map((attempt) => attempt.pct)),
        },
      },
      gradeDistribution,
      scoreDistribution,
      trend,
      modes: modeRows,
      classes: classRows,
      subjects: subjectRows,
      students: studentRows,
    };
  },
});

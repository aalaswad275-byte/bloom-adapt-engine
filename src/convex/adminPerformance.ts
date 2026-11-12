/**
 * Admin Performance Dashboard — assessment-engine results.
 *
 * Reads completed `assessmentSubmissions` joined to their assessment, class,
 * student and instructor, and derives every figure on the page from stored
 * rows (no precomputed or mocked grades). Admin-only; every entry point calls
 * `requireAdmin` before touching data.
 */
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin } from "./adminLib";
import { DEFAULT_PASS_THRESHOLD, gradeFromPercent } from "../lib/adaptiveLadder";

type AssessmentDoc = Doc<"instructorAssessments">;
type ClassDoc = Doc<"classes">;
type StudentDoc = Doc<"students">;

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (values: number[]) =>
  values.length === 0
    ? null
    : round1(values.reduce((sum, value) => sum + value, 0) / values.length);
const rate = (part: number, total: number) =>
  total === 0 ? null : round1((part / total) * 100);

type Mode = "adaptive" | "static" | "random" | "final";

interface Attempt {
  submission: Doc<"assessmentSubmissions">;
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
}

interface ModeTotals {
  attempts: number;
  pctSum: number;
  passed: number;
  marks: number;
  outOf: number;
}

const emptyMode = (): ModeTotals => ({
  attempts: 0,
  pctSum: 0,
  passed: 0,
  marks: 0,
  outOf: 0,
});

interface StudentAggregate {
  id: string;
  name: string;
  email: string | null;
  classNames: Set<string>;
  subjects: Set<string>;
  attempts: number;
  pctSum: number;
  passed: number;
  failed: number;
  bestPct: number | null;
  worstPct: number | null;
  marks: number;
  outOf: number;
  staticMode: ModeTotals;
  adaptiveMode: ModeTotals;
}

export const getPerformanceDashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [classes, instructors, students, enrollments, assessments, submissions, categories] =
      await Promise.all([
        ctx.db.query("classes").collect(),
        ctx.db.query("instructors").collect(),
        ctx.db.query("students").collect(),
        ctx.db.query("classEnrollments").collect(),
        ctx.db.query("instructorAssessments").collect(),
        ctx.db.query("assessmentSubmissions").collect(),
        ctx.db.query("questionCategories").collect(),
      ]);

    const classById = new Map(classes.map((row) => [row._id, row]));
    const instructorById = new Map(instructors.map((row) => [row._id, row]));
    const studentById = new Map(students.map((row) => [row._id, row]));
    const assessmentById = new Map(assessments.map((row) => [row._id, row]));
    const categoryById = new Map(categories.map((row) => [row._id, row]));

    const subjectOf = (cls: ClassDoc | null): string => {
      if (!cls) return "Unassigned";
      if (cls.subject) return cls.subject;
      if (cls.categoryId) {
        const category = categoryById.get(cls.categoryId);
        if (category) return category.name;
      }
      return "Unassigned";
    };

    const attempts: Attempt[] = [];
    for (const submission of submissions) {
      if (submission.status === "in_progress") continue;
      const maxScore = submission.maxScore ?? 0;
      const score = submission.score ?? 0;
      if (maxScore <= 0) continue;
      const assessment = assessmentById.get(submission.assessmentId);
      if (!assessment) continue;
      const student = studentById.get(submission.studentId);
      if (!student) continue;
      const cls = classById.get(submission.classId) ?? classById.get(assessment.classId) ?? null;
      const mode = (assessment.selectionMode ?? "adaptive") as Mode;
      const pct = (score / maxScore) * 100;
      attempts.push({
        submission,
        assessment,
        cls,
        student,
        subject: subjectOf(cls),
        mode,
        score,
        maxScore,
        pct,
        grade: submission.grade ?? gradeFromPercent(pct),
        passed:
          submission.passed ?? pct >= DEFAULT_PASS_THRESHOLD,
      });
    }

    // ---- Student aggregates -------------------------------------------------
    const studentAgg = new Map<string, StudentAggregate>();
    const ensureStudent = (student: StudentDoc): StudentAggregate => {
      const existing = studentAgg.get(student._id);
      if (existing) return existing;
      const created: StudentAggregate = {
        id: student._id,
        name: student.name,
        email: student.email ?? null,
        classNames: new Set<string>(),
        subjects: new Set<string>(),
        attempts: 0,
        pctSum: 0,
        passed: 0,
        failed: 0,
        bestPct: null,
        worstPct: null,
        marks: 0,
        outOf: 0,
        staticMode: emptyMode(),
        adaptiveMode: emptyMode(),
      };
      studentAgg.set(student._id, created);
      return created;
    };

    for (const attempt of attempts) {
      const row = ensureStudent(attempt.student);
      row.attempts += 1;
      row.pctSum += attempt.pct;
      row.marks += attempt.score;
      row.outOf += attempt.maxScore;
      if (attempt.passed) row.passed += 1;
      else row.failed += 1;
      row.bestPct = row.bestPct === null ? attempt.pct : Math.max(row.bestPct, attempt.pct);
      row.worstPct = row.worstPct === null ? attempt.pct : Math.min(row.worstPct, attempt.pct);
      if (attempt.cls) row.classNames.add(attempt.cls.name);
      row.subjects.add(attempt.subject);

      if (attempt.mode === "adaptive") {
        row.adaptiveMode.attempts += 1;
        row.adaptiveMode.pctSum += attempt.pct;
        row.adaptiveMode.marks += attempt.score;
        row.adaptiveMode.outOf += attempt.maxScore;
        if (attempt.passed) row.adaptiveMode.passed += 1;
      } else if (attempt.mode === "static" || attempt.mode === "random") {
        row.staticMode.attempts += 1;
        row.staticMode.pctSum += attempt.pct;
        row.staticMode.marks += attempt.score;
        row.staticMode.outOf += attempt.maxScore;
        if (attempt.passed) row.staticMode.passed += 1;
      }
    }

    const studentRows = [...studentAgg.values()]
      .map((row) => {
        const avgPct = row.attempts > 0 ? round1(row.pctSum / row.attempts) : null;
        const staticPct =
          row.staticMode.attempts > 0
            ? round1(row.staticMode.pctSum / row.staticMode.attempts)
            : null;
        const adaptivePct =
          row.adaptiveMode.attempts > 0
            ? round1(row.adaptiveMode.pctSum / row.adaptiveMode.attempts)
            : null;
        const deltaPct =
          staticPct !== null && adaptivePct !== null
            ? round1(adaptivePct - staticPct)
            : null;
        const percentageIncrease =
          deltaPct !== null && staticPct !== null && staticPct > 0
            ? round1((deltaPct / staticPct) * 100)
            : null;
        const staticAvgMarks =
          row.staticMode.attempts > 0
            ? round1(row.staticMode.marks / row.staticMode.attempts)
            : null;
        const adaptiveAvgMarks =
          row.adaptiveMode.attempts > 0
            ? round1(row.adaptiveMode.marks / row.adaptiveMode.attempts)
            : null;
        const staticAvgOutOf =
          row.staticMode.attempts > 0
            ? round1(row.staticMode.outOf / row.staticMode.attempts)
            : null;
        const adaptiveAvgOutOf =
          row.adaptiveMode.attempts > 0
            ? round1(row.adaptiveMode.outOf / row.adaptiveMode.attempts)
            : null;
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          classes: [...row.classNames].sort(),
          subjects: [...row.subjects].sort(),
          attempts: row.attempts,
          passed: row.passed,
          failed: row.failed,
          avgPct,
          bestPct: row.bestPct === null ? null : round1(row.bestPct),
          worstPct: row.worstPct === null ? null : round1(row.worstPct),
          avgMarks: row.attempts > 0 ? round1(row.marks / row.attempts) : null,
          avgOutOf: row.attempts > 0 ? round1(row.outOf / row.attempts) : null,
          staticAttempts: row.staticMode.attempts,
          staticPct,
          staticAvgMarks,
          staticAvgOutOf,
          adaptiveAttempts: row.adaptiveMode.attempts,
          adaptivePct,
          adaptiveAvgMarks,
          adaptiveAvgOutOf,
          deltaPct,
          // Papers differ in total marks, so a raw mark difference can
          // contradict the percentage gain (e.g. 9/9 vs 12/13). Normalise the
          // gain onto the student's static paper total.
          marksDelta:
            staticPct !== null && adaptivePct !== null && staticAvgOutOf !== null
              ? round1(((adaptivePct - staticPct) / 100) * staticAvgOutOf)
              : null,
          rawMarksDelta:
            staticAvgMarks !== null && adaptiveAvgMarks !== null
              ? round1(adaptiveAvgMarks - staticAvgMarks)
              : null,
          percentageIncrease,
          trend:
            deltaPct === null
              ? ("no_adaptive" as const)
              : deltaPct >= 5
                ? ("improved" as const)
                : deltaPct <= -5
                  ? ("declined" as const)
                  : ("stable" as const),
        };
      })
      .sort(
        (a, b) =>
          (b.avgPct ?? -1) - (a.avgPct ?? -1) ||
          b.attempts - a.attempts ||
          a.name.localeCompare(b.name),
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));

    // ---- Subject aggregates -------------------------------------------------
    interface Bucket {
      key: string;
      attempts: number;
      pctSum: number;
      passed: number;
      students: Set<string>;
      classes: Set<string>;
      marks: number;
      outOf: number;
    }
    const subjectMap = new Map<string, Bucket>();
    const classMap = new Map<string, Bucket>();
    const bucketFor = (map: Map<string, Bucket>, key: string): Bucket => {
      const existing = map.get(key);
      if (existing) return existing;
      const created: Bucket = {
        key,
        attempts: 0,
        pctSum: 0,
        passed: 0,
        students: new Set<string>(),
        classes: new Set<string>(),
        marks: 0,
        outOf: 0,
      };
      map.set(key, created);
      return created;
    };

    for (const attempt of attempts) {
      const subject = bucketFor(subjectMap, attempt.subject);
      subject.attempts += 1;
      subject.pctSum += attempt.pct;
      subject.marks += attempt.score;
      subject.outOf += attempt.maxScore;
      if (attempt.passed) subject.passed += 1;
      subject.students.add(attempt.student._id);
      if (attempt.cls) subject.classes.add(attempt.cls._id);

      const classKey = attempt.cls?._id ?? "unassigned";
      const cls = bucketFor(classMap, classKey);
      cls.attempts += 1;
      cls.pctSum += attempt.pct;
      cls.marks += attempt.score;
      cls.outOf += attempt.maxScore;
      if (attempt.passed) cls.passed += 1;
      cls.students.add(attempt.student._id);
      cls.classes.add(classKey);
    }

    const subjectRows = [...subjectMap.values()]
      .map((bucket) => ({
        subject: bucket.key,
        classes: bucket.classes.size,
        participants: bucket.students.size,
        attempts: bucket.attempts,
        passed: bucket.passed,
        failed: bucket.attempts - bucket.passed,
        avgPct: bucket.attempts > 0 ? round1(bucket.pctSum / bucket.attempts) : null,
        passRate: rate(bucket.passed, bucket.attempts),
        avgMarks: round1(bucket.marks / bucket.attempts),
        avgOutOf: round1(bucket.outOf / bucket.attempts),
      }))
      .sort((a, b) => (b.avgPct ?? -1) - (a.avgPct ?? -1))
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const rosterSize = new Map<string, number>();
    for (const enrollment of enrollments) {
      rosterSize.set(enrollment.classId, (rosterSize.get(enrollment.classId) ?? 0) + 1);
    }

    const classRows = [...classMap.values()]
      .map((bucket) => {
        const cls =
          bucket.key === "unassigned" ? null : classById.get(bucket.key as ClassDoc["_id"]);
        const instructor = cls ? instructorById.get(cls.instructorId) : null;
        const pcts = attempts
          .filter((attempt) => (attempt.cls?._id ?? "unassigned") === bucket.key)
          .map((attempt) => attempt.pct);
        return {
          id: bucket.key,
          name: cls?.name ?? "Unassigned",
          subject: cls ? subjectOf(cls) : "Unassigned",
          instructor: instructor?.name ?? "—",
          roster: cls ? (rosterSize.get(cls._id) ?? 0) : 0,
          participants: bucket.students.size,
          attempts: bucket.attempts,
          passed: bucket.passed,
          failed: bucket.attempts - bucket.passed,
          avgPct: bucket.attempts > 0 ? round1(bucket.pctSum / bucket.attempts) : null,
          passRate: rate(bucket.passed, bucket.attempts),
          bestPct: pcts.length > 0 ? round1(Math.max(...pcts)) : null,
          worstPct: pcts.length > 0 ? round1(Math.min(...pcts)) : null,
          avgMarks: round1(bucket.marks / bucket.attempts),
          avgOutOf: round1(bucket.outOf / bucket.attempts),
        };
      })
      .sort((a, b) => (b.avgPct ?? -1) - (a.avgPct ?? -1) || a.name.localeCompare(b.name))
      .map((row, index) => ({ ...row, rank: index + 1 }));

    // ---- Mode comparison ----------------------------------------------------
    const modeMap = new Map<Mode, ModeTotals>();
    for (const attempt of attempts) {
      const totals = modeMap.get(attempt.mode) ?? emptyMode();
      totals.attempts += 1;
      totals.pctSum += attempt.pct;
      totals.marks += attempt.score;
      totals.outOf += attempt.maxScore;
      if (attempt.passed) totals.passed += 1;
      modeMap.set(attempt.mode, totals);
    }
    const modeRows = (["static", "random", "adaptive", "final"] as Mode[]).map((mode) => {
      const totals = modeMap.get(mode) ?? emptyMode();
      return {
        mode,
        attempts: totals.attempts,
        avgPct: totals.attempts > 0 ? round1(totals.pctSum / totals.attempts) : null,
        passRate: rate(totals.passed, totals.attempts),
        avgMarks: totals.attempts > 0 ? round1(totals.marks / totals.attempts) : null,
        avgOutOf: totals.attempts > 0 ? round1(totals.outOf / totals.attempts) : null,
      };
    });

    // ---- Overall ------------------------------------------------------------
    const pcts = attempts.map((attempt) => attempt.pct);
    const sortedPcts = [...pcts].sort((a, b) => a - b);
    const medianPct =
      sortedPcts.length === 0
        ? null
        : sortedPcts.length % 2 === 1
          ? round1(sortedPcts[Math.floor(sortedPcts.length / 2)])
          : round1(
              (sortedPcts[sortedPcts.length / 2 - 1] + sortedPcts[sortedPcts.length / 2]) / 2,
            );
    const gradeOrder = ["A", "B", "C", "D", "E", "F"] as const;
    const gradeDistribution = gradeOrder.map((grade) => ({
      grade,
      count: attempts.filter((attempt) => attempt.grade === grade).length,
    }));
    const scoreDistribution = [
      { band: "0–49", count: pcts.filter((pct) => pct < 50).length },
      { band: "50–59", count: pcts.filter((pct) => pct >= 50 && pct < 60).length },
      { band: "60–69", count: pcts.filter((pct) => pct >= 60 && pct < 70).length },
      { band: "70–79", count: pcts.filter((pct) => pct >= 70 && pct < 80).length },
      { band: "80–89", count: pcts.filter((pct) => pct >= 80 && pct < 90).length },
      { band: "90–100", count: pcts.filter((pct) => pct >= 90).length },
    ];

    const passed = attempts.filter((attempt) => attempt.passed).length;
    const completed = attempts.length;
    const participants = studentAgg.size;
    const matched = studentRows.filter(
      (row) => row.staticPct !== null && row.adaptivePct !== null && row.deltaPct !== null,
    );
    const avgDelta = mean(
      matched.map((row) => row.deltaPct).filter((value): value is number => value !== null),
    );
    const avgPercentageIncrease = mean(
      matched
        .map((row) => row.percentageIncrease)
        .filter((value): value is number => value !== null),
    );

    const staticTotals = modeMap.get("static") ?? emptyMode();
    const randomTotals = modeMap.get("random") ?? emptyMode();
    const adaptiveTotals = modeMap.get("adaptive") ?? emptyMode();
    const staticCombined = {
      attempts: staticTotals.attempts + randomTotals.attempts,
      avgPct:
        staticTotals.attempts + randomTotals.attempts > 0
          ? round1(
              (staticTotals.pctSum + randomTotals.pctSum) /
                (staticTotals.attempts + randomTotals.attempts),
            )
          : null,
      passRate: rate(
        staticTotals.passed + randomTotals.passed,
        staticTotals.attempts + randomTotals.attempts,
      ),
    };

    return {
      generatedAt: Date.now(),
      overview: {
        subjects: subjectRows.length,
        classes: classRows.length,
        instructors: instructors.length,
        enrolledStudents: students.length,
        assessments: assessments.length,
        assessmentsWithResults: new Set(attempts.map((attempt) => attempt.assessment._id)).size,
        startedAttempts: submissions.length,
        completedAttempts: completed,
        completionRate: rate(completed, submissions.length),
        participants,
        passed,
        failed: completed - passed,
        passRate: rate(passed, completed),
        avgPct: mean(pcts),
        medianPct,
        highestPct: pcts.length > 0 ? round1(Math.max(...pcts)) : null,
        lowestPct: pcts.length > 0 ? round1(Math.min(...pcts)) : null,
        totalMarks: attempts.reduce((sum, attempt) => sum + attempt.maxScore, 0),
        earnedMarks: attempts.reduce((sum, attempt) => sum + attempt.score, 0),
        answers: attempts.reduce(
          (sum, attempt) => sum + (attempt.submission.answers?.length ?? 0),
          0,
        ),
        staticCombined,
        adaptive: {
          attempts: adaptiveTotals.attempts,
          avgPct:
            adaptiveTotals.attempts > 0
              ? round1(adaptiveTotals.pctSum / adaptiveTotals.attempts)
              : null,
          passRate: rate(adaptiveTotals.passed, adaptiveTotals.attempts),
        },
        matchedStudents: matched.length,
        avgDeltaPct: avgDelta,
        avgPercentageIncrease,
        improved: matched.filter((row) => (row.deltaPct ?? 0) >= 5).length,
        declined: matched.filter((row) => (row.deltaPct ?? 0) <= -5).length,
        stable: matched.filter((row) => Math.abs(row.deltaPct ?? 0) < 5).length,
      },
      gradeDistribution,
      scoreDistribution,
      subjects: subjectRows,
      classes: classRows,
      modes: modeRows,
      students: studentRows,
      improvement: matched
        .map((row) => ({
          id: row.id,
          name: row.name,
          classes: row.classes,
          staticAttempts: row.staticAttempts,
          adaptiveAttempts: row.adaptiveAttempts,
          staticPct: row.staticPct,
          adaptivePct: row.adaptivePct,
          deltaPct: row.deltaPct,
          marksDelta: row.marksDelta,
          percentageIncrease: row.percentageIncrease,
          staticAvgMarks: row.staticAvgMarks,
          staticAvgOutOf: row.staticAvgOutOf,
          adaptiveAvgMarks: row.adaptiveAvgMarks,
          adaptiveAvgOutOf: row.adaptiveAvgOutOf,
        }))
        .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0)),
    };
  },
});

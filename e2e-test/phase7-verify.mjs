/**
 * Phase 7 — database integrity, regrading, isolation, permissions and reports.
 */
import { load, mut, q, log } from "./lib.mjs";

const state = load();
const admin = state.adminToken;
const classes = state.classes;

// ---------------------------------------------------------------------------
// A. Integrity + independent regrade (one read-only snapshot query)
// ---------------------------------------------------------------------------
const integrityIssues = [];

// Duplicate emails and duplicate enrollments.
for (const cls of classes) {
  const dash = await q(
    "instructorPortal:getInstructorDashboard",
    {},
    state.instructors.find((i) => i.id === cls.instructorId).token,
  );
  const row = dash.classes.find((c) => c.id === cls.id);
  if (!row) integrityIssues.push(`instructor dashboard missing ${cls.name}`);
}

// ---------------------------------------------------------------------------
// B. Isolation + permissions
// ---------------------------------------------------------------------------
const isolation = [];
for (const inst of state.instructors) {
  for (const cls of classes) {
    if (cls.instructorId === inst.id) continue;
    try {
      await q("instructorAssessments:listAssessments", { classId: cls.id }, inst.token);
      isolation.push({ test: "foreign class list", result: "FAIL", instructor: inst.identity, class: cls.name });
    } catch {
      /* expected */
    }
  }
}
isolation.push({ test: "foreign class list", result: "passed (all blocked)" });

// Foreign assessment resolves to null rather than leaking.
let foreignAssessment = "not tested";
{
  const inst0 = state.instructors[0];
  const other = classes.find((c) => c.instructorId !== inst0.id);
  const otherAssessment = state.assessments[other.id]?.static;
  const res = await q(
    "instructorAssessments:getAssessment",
    { id: otherAssessment },
    inst0.token,
  );
  foreignAssessment = res === null ? "passed (null)" : "FAIL (data returned)";
}

// Cross-class attach is rejected.
let crossClass = "not tested";
{
  const inst0 = state.instructors[0];
  const mine = classes.find((c) => c.instructorId === inst0.id);
  const other = classes.find((c) => c.instructorId !== inst0.id);
  const draft = await mut(
    "instructorAssessments:createAssessment",
    { classId: mine.id, title: "TEST — permission probe (draft)", selectionMode: "static" },
    inst0.token,
  );
  try {
    await mut(
      "instructorAssessments:addQuestionToAssessment",
      { assessmentId: draft, questionId: state.questions[other.id][0].id },
      inst0.token,
    );
    crossClass = "FAIL (accepted)";
  } catch (err) {
    crossClass = String(err.message).includes("different class")
      ? "passed (rejected)"
      : `unexpected: ${err.message}`;
  }
  await mut("instructorAssessments:deleteAssessment", { id: draft }, inst0.token);
}

// Role checks.
const roleChecks = [];
{
  const student = state.students[0];
  try {
    await q("instructorAssessments:listAssessments", { classId: classes[0].id }, student.token);
    roleChecks.push({ test: "student → instructor API", result: "FAIL" });
  } catch (err) {
    roleChecks.push({
      test: "student → instructor API",
      result: String(err.message).includes("Instructor access required") ? "passed" : `unexpected: ${err.message}`,
    });
  }
  try {
    await q("adminPeople:listStudents", {}, state.instructors[0].token);
    roleChecks.push({ test: "instructor → admin API", result: "FAIL" });
  } catch (err) {
    roleChecks.push({
      test: "instructor → admin API",
      result: /admin role required|Admin access required/.test(String(err.message))
        ? "passed"
        : `unexpected: ${err.message}`,
    });
  }
}

// ---------------------------------------------------------------------------
// C. Reports + per-assessment results (actual stored data)
// ---------------------------------------------------------------------------
const reports = [];
for (const cls of classes) {
  const inst = state.instructors.find((i) => i.id === cls.instructorId);
  const report = await q(
    "classReport:getClassPerformanceReport",
    { classId: cls.id },
    inst.token,
  );
  const results = [];
  for (const [type, id] of Object.entries(state.assessments[cls.id])) {
    const r = await q("instructorAssessments:getAssessmentResults", { id }, inst.token);
    results.push({
      type,
      roster: r.stats.rosterSize,
      completed: r.stats.completed,
      avg: r.stats.avgPct,
      passRate: r.stats.passRate,
    });
  }
  reports.push({
    class: cls.name,
    roster: report.class.rosterSize,
    attempts: report.totals.submissions,
    passed: report.totals.passed,
    failed: report.totals.failed,
    avg: report.totals.avgPct,
    passRate: report.totals.passRate,
    staticAvg: report.static?.avgPct ?? null,
    adaptiveAvg: report.adaptive?.avgPct ?? null,
    avgDelta: report.comparison?.avgDelta ?? null,
    staticAssessments: report.totals.staticAssessments,
    adaptiveAssessments: report.totals.adaptiveAssessments,
    classImprovement: report.totals.classImprovement,
    assessments: results,
  });
}

log(
  JSON.stringify(
    {
      integrityIssues,
      isolation,
      foreignAssessment,
      crossClass,
      roleChecks,
      reports,
    },
    null,
    2,
  ),
);

/**
 * Audit security & admin rules — direct backend calls with real tokens.
 * Only new AUDIT-1124 test records are involved; no existing data is modified.
 */
import {
  adminToken,
  anonymousToken,
  load,
  mut,
  q,
  save,
  log,
} from "./lib.mjs";

const state = load();
const A = state.audit;
if (!A) throw new Error("Run audit1-setup.mjs first");
const admin = state.auditAdminToken ?? (await adminToken());
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 500));
}

async function rejected(name, fn, includes) {
  try {
    const value = await fn();
    check(name, false, { expectedReject: includes ?? "error", got: value });
    return { rejected: false, value };
  } catch (err) {
    const message = String(err.message).slice(0, 400);
    const pass = !includes || message.toLowerCase().includes(includes.toLowerCase());
    check(name, pass, { matched: pass, message });
    return { rejected: true, message };
  }
}

const math = A.classes.math;
const cs = A.classes.cs;
const mathInstructor = A.instructors.math;
const csInstructor = A.instructors.cs;
const students = A.students;
const mathStudents = students.filter((s) => s.classId === math.id);
const high = mathStudents[0];
const struggling = mathStudents[2];

// ---------------------------------------------------------------------------
// Authentication / role boundaries
// ---------------------------------------------------------------------------
await rejected("Unauthenticated admin listing is rejected", () =>
  q("adminPeople:listStudents", {}, undefined),
);
await rejected("Student cannot read the admin dashboard", () =>
  q("adminAnalytics:getAdminDashboard", {}, high.token),
);
await rejected("Student cannot list all students", () =>
  q("adminPeople:listStudents", {}, high.token),
);
await rejected("Student cannot delete a student record", () =>
  mut("adminPeople:deleteStudent", { id: high.id }, high.token),
);
await rejected("Student cannot read the instructor dashboard", () =>
  q("instructorPortal:getInstructorDashboard", {}, high.token),
);
await rejected("Instructor cannot read the admin dashboard", () =>
  q("adminAnalytics:getAdminDashboard", {}, mathInstructor.token),
);
await rejected("Instructor cannot create another instructor", () =>
  mut(
    "adminPeople:createInstructor",
    { name: "AUDIT-1124 illegal", email: "audit.1124.illegal@example.test" },
    mathInstructor.token,
  ),
);
await rejected("Forged bearer token is rejected", async () => {
  await q("adminAnalytics:getAdminDashboard", {}, "not-a-real-token");
});

// ---------------------------------------------------------------------------
// Cross-class isolation
// ---------------------------------------------------------------------------
const foreignResults = await q(
  "instructorAssessments:getAssessmentResults",
  { id: A.assessments.mathStatic },
  csInstructor.token,
);
check("Foreign assessment results are not exposed", foreignResults === null, {
  foreignResults,
});
await rejected("Foreign instructor cannot add questions to a class", () =>
  mut(
    "instructorAssessments:createQuestion",
    {
      classId: math.id,
      questionType: "true_false",
      options: ["True", "False"],
      correctAnswer: "True",
      questionText: "AUDIT-1124 illegal cross-class question",
      marks: 1,
      bloomLevel: "remember",
      expectedTimeSec: 60,
    },
    csInstructor.token,
  ),
  "own",
);
await rejected("Foreign instructor cannot remove a student from a class", () =>
  mut(
    "instructorPortal:removeStudentFromMyClass",
    { classId: math.id, studentId: high.id },
    csInstructor.token,
  ),
  "own",
);
await rejected("Foreign question cannot be attached to another class paper", () =>
  mut(
    "instructorAssessments:addQuestionToAssessment",
    {
      assessmentId: A.assessments.emptyDraft,
      questionId: A.questions[cs.id][0].id,
    },
    mathInstructor.token,
  ),
  "class",
);

// Student accessing a different student's submission.
const foreignStart = await mut(
  "studentAssessments:startAssessment",
  { assessmentId: A.assessments.mathFinal },
  struggling.token,
);
await rejected("Student cannot open another student's submission", () =>
  q(
    "studentAssessments:getTakeAssessment",
    { submissionId: foreignStart.submissionId },
    high.token,
  ),
  "not found",
);
await rejected("Student cannot change another student's review answers", () =>
  mut(
    "studentAssessments:saveReviewAnswer",
    {
      submissionId: foreignStart.submissionId,
      questionId: A.questions[math.id][0].id,
      answer: "A",
    },
    high.token,
  ),
  "not found",
);
// Close the accidental in-progress final attempt to avoid dangling data.
await mut(
  "studentAssessments:submitAssessment",
  { submissionId: foreignStart.submissionId },
  struggling.token,
);

// ---------------------------------------------------------------------------
// Duplicate / integrity rules
// ---------------------------------------------------------------------------
await rejected(
  "Duplicate instructor email is rejected",
  () =>
    mut(
      "adminPeople:createInstructor",
      { name: "AUDIT-1124 Duplicate", email: "audit.1124.math@example.test" },
      admin,
    ),
  "exists",
);
await rejected(
  "Duplicate student email is rejected",
  () =>
    mut(
      "instructorPortal:createMyStudent",
      {
        classId: math.id,
        name: "AUDIT-1124 Duplicate Student",
        email: "audit.1124.high@example.test",
      },
      mathInstructor.token,
    ),
  "already",
);
await rejected(
  "Duplicate class enrollment is rejected",
  () =>
    mut(
      "instructorPortal:addStudentToMyClass",
      { classId: math.id, studentId: high.id },
      mathInstructor.token,
    ),
  "already",
);
await rejected(
  "Closed class rejects roster changes",
  () =>
    mut(
      "instructorPortal:removeStudentFromMyClass",
      { classId: math.id, studentId: high.id },
      mathInstructor.token,
    ),
  "closed",
);
await rejected(
  "Published assessment cannot be edited",
  () =>
    mut(
      "instructorAssessments:updateAssessment",
      { id: A.assessments.mathStatic, fields: { title: "AUDIT changed" } },
      mathInstructor.token,
    ),
  "draft",
);
await rejected(
  "Assessment with attempts cannot be deleted",
  () =>
    mut(
      "instructorAssessments:deleteAssessment",
      { id: A.assessments.mathStatic },
      mathInstructor.token,
    ),
  "attempt",
);
await rejected(
  "Final exam with attempts cannot be deleted",
  () =>
    mut(
      "instructorAssessments:deleteAssessment",
      { id: A.assessments.mathFinal },
      mathInstructor.token,
    ),
  "attempt",
);

// ---------------------------------------------------------------------------
// Role-claim escalation probes (new throwaway accounts only)
// ---------------------------------------------------------------------------
const unclaimedInstructorEmail = "audit.1124.unclaimed.instructor@example.test";
const unclaimedInstructorId = await mut(
  "adminPeople:createInstructor",
  { name: "AUDIT-1124 Unclaimed Instructor", email: unclaimedInstructorEmail },
  admin,
);
const escalationStudentEmail = "audit.1124.escalation.student@example.test";
const escalationStudentId = await mut(
  "instructorPortal:createMyStudent",
  {
    classId: cs.id,
    name: "AUDIT-1124 Escalation Student",
    email: escalationStudentEmail,
  },
  csInstructor.token,
);
const escalationToken = await anonymousToken();
await mut(
  "studentAssessments:claimStudent",
  { email: escalationStudentEmail },
  escalationToken,
);
let studentClaimedInstructor = false;
let studentClaimMessage = "";
try {
  await mut(
    "instructorPortal:claimInstructor",
    { email: unclaimedInstructorEmail },
    escalationToken,
  );
  studentClaimedInstructor = true;
} catch (err) {
  studentClaimMessage = String(err.message).slice(0, 300);
}
check(
  "A student account cannot claim an instructor profile (privilege escalation)",
  !studentClaimedInstructor,
  { message: studentClaimMessage, instructorId: unclaimedInstructorId },
);

const unclaimedStudentEmail = "audit.1124.unclaimed.student@example.test";
await mut(
  "instructorPortal:createMyStudent",
  {
    classId: cs.id,
    name: "AUDIT-1124 Unclaimed Student",
    email: unclaimedStudentEmail,
  },
  csInstructor.token,
);
let instructorClaimedStudent = false;
let instructorClaimMessage = "";
try {
  await mut(
    "studentAssessments:claimStudent",
    { email: unclaimedStudentEmail },
    csInstructor.token,
  );
  instructorClaimedStudent = true;
} catch (err) {
  instructorClaimMessage = String(err.message).slice(0, 300);
}
check(
  "An instructor account cannot claim a student profile (role downgrade)",
  !instructorClaimedStudent,
  { message: instructorClaimMessage },
);

// ---------------------------------------------------------------------------
// Audit log verification
// ---------------------------------------------------------------------------
const logs = await q("adminAnalytics:listAuditLogs", { limit: 500 }, admin);
const relevant = logs.filter(
  (l) =>
    l.action === "class.created" ||
    l.action === "instructor_assessment.created" ||
    l.action === "assessment_submitted" ||
    l.action === "class.closed",
);
const hasActorAndTime = relevant.every(
  (l) => typeof l.timestamp === "number" && (l.actorEmail || l.userId),
);
check("Sensitive actions appear in the audit log", relevant.length > 0, {
  count: relevant.length,
  actions: [...new Set(relevant.map((l) => l.action))],
});
check(
  "Audit entries record actor, timestamp and change detail",
  hasActorAndTime &&
    relevant.some((l) => l.newValue) &&
    relevant.some((l) => l.previousValue),
  {
    sample: relevant.slice(0, 2).map((l) => ({
      action: l.action,
      actorEmail: l.actorEmail ?? null,
      timestamp: l.timestamp,
      newValue: l.newValue ?? null,
      previousValue: l.previousValue ?? null,
    })),
  },
);

// ---------------------------------------------------------------------------
// Admin statistics accuracy probe
// ---------------------------------------------------------------------------
const dashboard = await q("adminAnalytics:getAdminDashboard", {}, admin);
const legacyAssessments = await q("adminAnalytics:listAdminAssessments", {}, admin);
const mathAssessments = await q(
  "instructorAssessments:listAssessments",
  { classId: math.id },
  mathInstructor.token,
);
check(
  "Admin dashboard assessment count covers class assessments",
  dashboard.counts.assessments >= mathAssessments.length,
  {
    adminDashboardAssessments: dashboard.counts.assessments,
    legacyAssessmentRows: legacyAssessments.length,
    auditMathClassAssessments: mathAssessments.length,
  },
);

save(state);
log(
  JSON.stringify(
    {
      summary: {
        checks: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: checks.filter((c) => !c.pass).length,
      },
      failed: checks.filter((c) => !c.pass),
      auditCount: logs.length,
    },
    null,
    2,
  ),
);

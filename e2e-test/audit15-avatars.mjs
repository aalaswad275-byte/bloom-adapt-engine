import { load, q, mut, log } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 500));
}

const students = await q("adminPeople:listStudents", {}, admin);
const testStudents = students.filter((s) => s.testData === true);
const withImages = testStudents.filter((s) => s.identityImageId);
for (const student of withImages) {
  await mut(
    "adminPeople:clearStudentIdentityImage",
    { id: student._id },
    admin,
  );
}
const after = await q("adminPeople:listStudents", {}, admin);
const afterTest = after.filter((s) => s.testData === true);
check(
  "All test students now use the default avatar",
  afterTest.every((s) => !s.identityImageId),
  afterTest.filter((s) => s.identityImageId).map((s) => s.name),
);
check(
  "No artificial student/instructor labels remain",
  !after.some((s) => /^(TEST|AUDIT-1124)\b/.test(s.name)) &&
    !(await q("adminPeople:listInstructors", {}, admin)).some((i) =>
      /^(TEST|AUDIT-1124)\b/.test(i.name),
    ),
  null,
);
check(
  "All renamed students are internally marked testData",
  afterTest.length >= 65,
  { count: afterTest.length },
);
check(
  "Student names, emails and IDs are unique",
  new Set(afterTest.map((s) => s.name)).size === afterTest.length &&
    new Set(afterTest.map((s) => (s.email ?? "").toLowerCase())).size ===
      afterTest.length &&
    new Set(afterTest.map((s) => s.studentIdNumber)).size === afterTest.length,
  {
    names: new Set(afterTest.map((s) => s.name)).size,
    emails: new Set(afterTest.map((s) => (s.email ?? "").toLowerCase())).size,
    ids: new Set(afterTest.map((s) => s.studentIdNumber)).size,
    count: afterTest.length,
  },
);
const sample = after.find((s) => s.name.includes("محمد علي الورفلي"));
check(
  "Specific requested student name is present",
  Boolean(sample) && sample.studentIdNumber?.startsWith("2026-"),
  sample && { name: sample.name, id: sample.studentIdNumber, email: sample.email },
);
const results = await q(
  "instructorAssessments:getAssessmentResults",
  { id: state.audit.assessments.mathStatic },
  state.audit.instructors.math.token,
);
check(
  "Renamed students retain their static-assessment results",
  results?.rows?.some((r) => r.studentName?.includes("محمد علي الورفلي")),
  results?.rows?.map((r) => r.studentName),
);
const adminViewer = await q("adminAnalytics:getAdminViewer", {}, admin);
check(
  "Administrator display name is realistic",
  adminViewer.name?.includes("عبد الحكيم محمد الفيتوري"),
  adminViewer,
);

log(
  JSON.stringify(
    {
      clearedImages: withImages.length,
      testStudents: afterTest.length,
      sample: sample && {
        name: sample.name,
        studentIdNumber: sample.studentIdNumber,
        email: sample.email,
        classId: sample.classId,
      },
      summary: {
        checks: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: checks.filter((c) => !c.pass).length,
      },
      failed: checks.filter((c) => !c.pass),
    },
    null,
    2,
  ),
);

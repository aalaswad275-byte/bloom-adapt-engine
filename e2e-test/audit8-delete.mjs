import { load, mut, log } from "./lib.mjs";

const state = load();
const A = state.audit;
const admin = state.auditAdminToken;
const mathInstructor = A.instructors.math;
const suffix = Date.now();
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 400));
}
async function expectError(name, fn, includes) {
  try {
    const value = await fn();
    check(name, false, { got: value });
  } catch (err) {
    const message = String(err.message);
    check(
      name,
      !includes || message.toLowerCase().includes(includes.toLowerCase()),
      { message: message.slice(0, 300) },
    );
  }
}

const emptyStudentId = await mut(
  "adminPeople:createStudent",
  { name: "AUDIT-1124 Delete Me", email: `audit.1124.delete.${suffix}@example.test` },
  admin,
);
await mut("adminPeople:deleteStudent", { id: emptyStudentId }, admin);
check("Admin can delete a student with no history", true, null);

const emptyClassId = await mut(
  "adminClasses:createClass",
  {
    name: `AUDIT-1124 Empty Class ${suffix}`,
    instructorId: A.instructors.math.id,
    subject: "Mathematics",
  },
  admin,
);
await mut("adminClasses:deleteClass", { id: emptyClassId }, admin);
check("Admin can delete a class with no dependents", true, null);

const classId = await mut(
  "adminClasses:createClass",
  {
    name: `AUDIT-1124 Guarded Class ${suffix}`,
    instructorId: A.instructors.math.id,
    subject: "Mathematics",
  },
  admin,
);
const studentId = await mut(
  "adminPeople:createStudent",
  { name: "AUDIT-1124 Guarded Student", email: `audit.1124.guard.${suffix}@example.test` },
  admin,
);
await mut(
  "instructorPortal:addStudentToMyClass",
  { classId, studentId },
  mathInstructor.token,
);
await expectError(
  "Deleting a class with a roster is blocked",
  () => mut("adminClasses:deleteClass", { id: classId }, admin),
  "deactivate",
);
await expectError(
  "Deleting a student with enrollment history is blocked",
  () => mut("adminPeople:deleteStudent", { id: studentId }, admin),
  "deactivate",
);

const assessmentId = await mut(
  "instructorAssessments:createAssessment",
  { classId, title: `AUDIT-1124 Delete Guard ${suffix}`, selectionMode: "static" },
  mathInstructor.token,
);
await expectError(
  "Deleting a class with an assessment is blocked",
  () => mut("adminClasses:deleteClass", { id: classId }, admin),
  "deactivate",
);
await mut("instructorAssessments:deleteAssessment", { id: assessmentId }, mathInstructor.token);
await mut(
  "instructorPortal:removeStudentFromMyClass",
  { classId, studentId },
  mathInstructor.token,
);
await mut("adminClasses:deleteClass", { id: classId }, admin);
await mut("adminPeople:deleteStudent", { id: studentId }, admin);
check("Guarded test records delete cleanly once dependents are removed", true, null);

log(
  JSON.stringify(
    {
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

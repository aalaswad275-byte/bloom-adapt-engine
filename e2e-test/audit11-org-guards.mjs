import { load, mut, log } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;
const mathInstructorId = state.audit.instructors.math.id;
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

// Institution with a class but no roster/center must still be protected.
const institutionA = await mut(
  "adminOrgs:createInstitution",
  {
    name: `AUDIT-1124 Class Guard Institution ${suffix}`,
    type: "other",
    description: "AUDIT-1124 disposable deletion-guard record.",
    city: "Tripoli",
  },
  admin,
);
const classA = await mut(
  "adminClasses:createClass",
  {
    name: `AUDIT-1124 Class Guard ${suffix}`,
    instructorId: mathInstructorId,
    institutionId: institutionA,
    subject: "Mathematics",
  },
  admin,
);
await expectError(
  "Institution with an assigned class cannot be deleted",
  () => mut("adminOrgs:deleteInstitution", { id: institutionA }, admin),
  "cannot delete",
);
await mut("adminClasses:deleteClass", { id: classA }, admin);
await mut("adminOrgs:deleteInstitution", { id: institutionA }, admin);
check("Class-free institution deletes after cleanup", true, null);

// Institution/center with a directly assigned instructor and a class.
const institutionB = await mut(
  "adminOrgs:createInstitution",
  {
    name: `AUDIT-1124 Instructor Guard Institution ${suffix}`,
    type: "other",
    description: "AUDIT-1124 disposable deletion-guard record.",
    city: "Tripoli",
  },
  admin,
);
const instructorB = await mut(
  "adminPeople:createInstructor",
  {
    name: "AUDIT-1124 Guard Instructor",
    email: `audit.1124.guard.instructor.${suffix}@example.test`,
    institutionId: institutionB,
  },
  admin,
);
await expectError(
  "Institution with a directly assigned instructor cannot be deleted",
  () => mut("adminOrgs:deleteInstitution", { id: institutionB }, admin),
  "cannot delete",
);
const centerB = await mut(
  "adminOrgs:createTeachingCenter",
  {
    name: `AUDIT-1124 Center Guard ${suffix}`,
    institutionId: institutionB,
    description: "AUDIT-1124 disposable deletion-guard record.",
    city: "Tripoli",
  },
  admin,
);
const classB = await mut(
  "adminClasses:createClass",
  {
    name: `AUDIT-1124 Center Class Guard ${suffix}`,
    instructorId: mathInstructorId,
    institutionId: institutionB,
    teachingCenterId: centerB,
    subject: "Mathematics",
  },
  admin,
);
await expectError(
  "Teaching center with an assigned class cannot be deleted",
  () => mut("adminOrgs:deleteTeachingCenter", { id: centerB }, admin),
  "cannot delete",
);
await mut("adminClasses:deleteClass", { id: classB }, admin);
await mut("adminOrgs:deleteTeachingCenter", { id: centerB }, admin);
await mut("adminPeople:deleteInstructor", { id: instructorB }, admin);
await mut("adminOrgs:deleteInstitution", { id: institutionB }, admin);
check("Institution/center delete cleanly after assignments are removed", true, null);

// Facility with a directly assigned instructor and no students.
const facility = await mut(
  "adminOrgs:createGovernmentFacility",
  {
    name: `AUDIT-1124 Facility Guard ${suffix}`,
    sector: "Test",
    description: "AUDIT-1124 disposable deletion-guard record.",
    location: "Tripoli",
  },
  admin,
);
const instructorF = await mut(
  "adminPeople:createInstructor",
  {
    name: "AUDIT-1124 Facility Guard Instructor",
    email: `audit.1124.guard.facility.${suffix}@example.test`,
    governmentFacilityId: facility,
  },
  admin,
);
await expectError(
  "Government facility with a directly assigned instructor cannot be deleted",
  () => mut("adminOrgs:deleteGovernmentFacility", { id: facility }, admin),
  "cannot delete",
);
await mut("adminPeople:deleteInstructor", { id: instructorF }, admin);
await mut("adminOrgs:deleteGovernmentFacility", { id: facility }, admin);
check("Facility deletes after its instructor assignment is removed", true, null);

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

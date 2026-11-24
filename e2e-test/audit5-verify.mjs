import { load, q, mut, log } from "./lib.mjs";
import { URL } from "./lib.mjs";

const state = load();
const A = state.audit;
const admin = state.auditAdminToken;
const math = A.classes.math;
const mathInstructor = A.instructors.math;
const high = A.students.find((s) => s.classId === math.id);

async function attempt(label, fn) {
  try {
    const v = await fn();
    log(label, "SUCCEEDED", JSON.stringify(v).slice(0, 400));
    return { ok: true, v };
  } catch (err) {
    log(label, "REJECTED", String(err.message).slice(0, 300));
    return { ok: false, message: String(err.message) };
  }
}

// Raw forged token response (bypass the helper's body parser)
const raw = await fetch(`${URL}/api/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer bogus-token" },
  body: JSON.stringify({
    path: "adminPeople:listStudents",
    args: {},
    format: "json",
  }),
});
log("raw forged token HTTP", raw.status, (await raw.text()).slice(0, 300));

// Current role views for the two tokens involved in the claim probes.
await attempt("getInstructorViewer(cs instructor token)", () =>
  q("instructorPortal:getInstructorViewer", {}, A.instructors.cs.token),
);
await attempt("getStudentViewer(cs instructor token)", () =>
  q("studentAssessments:getStudentViewer", {}, A.instructors.cs.token),
);

const instructors = await q("adminPeople:listInstructors", {}, admin);
const unclaimed = instructors.find(
  (i) => (i.email ?? "").toLowerCase() === "audit.1124.unclaimed.instructor@example.test",
);
if (unclaimed) {
  await attempt("getInstructorDashboard for claimed unclaimed instructor profile", () =>
    q("instructorPortal:getInstructorDashboard", {}, A.instructors.cs.token),
  );
}

// Duplicate rules need an OPEN class; reopen, probe, close again.
await mut("classClosure:reopenMyClass", { classId: math.id }, mathInstructor.token);
await attempt("duplicate roster email on open class", () =>
  mut(
    "instructorPortal:createMyStudent",
    {
      classId: math.id,
      name: "AUDIT-1124 Duplicate Student",
      email: "audit.1124.high@example.test",
    },
    mathInstructor.token,
  ),
);
await attempt("duplicate enrollment on open class", () =>
  mut(
    "instructorPortal:addStudentToMyClass",
    { classId: math.id, studentId: high.id },
    mathInstructor.token,
  ),
);
await mut("classClosure:closeMyClass", { classId: math.id }, mathInstructor.token);

// Admin duplicate student creation (additive test record only).
const studentFields = {
  name: "AUDIT-1124 Admin Duplicate",
  email: "audit.1124.admin.duplicate@example.test",
};
const first = await mut("adminPeople:createStudent", studentFields, admin);
await attempt("admin duplicate student email", () =>
  mut("adminPeople:createStudent", studentFields, admin),
);
log("admin duplicate student firstId", first);

// Instructor duplicate check on the open CS class is unavailable (role was
// overwritten during the escalation probe), so use the admin path.
const dupInstructor = await attempt("admin duplicate instructor email", () =>
  mut(
    "adminPeople:createInstructor",
    { name: "AUDIT-1124 Duplicate 2", email: "audit.1124.math@example.test" },
    admin,
  ),
);
log("dupInstructor", JSON.stringify(dupInstructor));

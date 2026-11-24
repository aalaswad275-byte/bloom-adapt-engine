import { load, q, log } from "./lib.mjs";

const state = load();
const admin = state.auditAdminToken;

async function tryCall(label, fn) {
  try {
    const v = await fn();
    log(label, "SUCCEEDED", JSON.stringify(v).slice(0, 300));
  } catch (err) {
    log(label, "REJECTED", String(err.message).slice(0, 300));
  }
}

await tryCall("invalid-token getAdminViewer", () =>
  q("adminAnalytics:getAdminViewer", {}, "bogus-token-123"),
);
await tryCall("invalid-token listStudents", () =>
  q("adminPeople:listStudents", {}, "bogus-token-123"),
);
await tryCall("empty-token listStudents", () =>
  q("adminPeople:listStudents", {}, ""),
);

const instructors = await q("adminPeople:listInstructors", {}, admin);
const byEmail = new Map();
for (const i of instructors) {
  const key = (i.email ?? "").toLowerCase();
  if (!key) continue;
  byEmail.set(key, [...(byEmail.get(key) ?? []), i]);
}
log(
  "duplicate instructor emails",
  JSON.stringify(
    [...byEmail.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([email, rows]) => ({
        email,
        rows: rows.map((r) => ({ id: r._id ?? r.id, name: r.name, userId: r.userId })),
      })),
    null,
    2,
  ),
);

const logs = await q("adminAnalytics:listAuditLogs", { limit: 500 }, admin);
const submissions = logs.filter((l) => l.action === "assessment_submitted");
log(
  "assessment_submitted audit sample",
  JSON.stringify(submissions.slice(0, 3), null, 2),
);
const roleLogs = logs.filter((l) =>
  ["instructor.claimed", "student.claimed", "class.created", "class.closed"].includes(
    l.action,
  ),
);
log(
  "claim/class audit sample",
  JSON.stringify(roleLogs.slice(0, 6), null, 2),
);

const math = state.audit.classes.math;
const mathInstructor = state.audit.instructors.math;
const people = await q(
  "instructorPortal:getInstructorDashboard",
  {},
  mathInstructor.token,
);
log(
  "math instructor dashboard",
  JSON.stringify({
    classes: people.classes.map((c) => ({ id: c.id, name: c.name, students: c.studentCount })),
  }),
);

import { load, q, mut, log } from "./lib.mjs";

const state = load();
const A = state.audit;
const admin = state.auditAdminToken;
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 400));
}

const [instructors, students, classes, dashboard, auditLogs] = await Promise.all([
  q("adminPeople:listInstructors", {}, admin),
  q("adminPeople:listStudents", {}, admin),
  q("adminClasses:listClasses", {}, admin),
  q("adminAnalytics:getAdminDashboard", {}, admin),
  q("adminAnalytics:listAuditLogs", { limit: 1000 }, admin),
]);
const mathListing = await q(
  "instructorAssessments:listAssessments",
  { classId: A.classes.math.id },
  A.instructors.math.token,
);
const mathAssessments = mathListing.assessments;
const auditInstructors = instructors.filter((i) =>
  (i.email ?? "").toLowerCase().startsWith("audit.1124"),
);
const auditStudents = students.filter((s) =>
  (s.email ?? "").toLowerCase().startsWith("audit.1124"),
);
const auditClasses = classes.filter((c) => c.name.startsWith("AUDIT-1124"));

check(
  "Admin dashboard assessment count includes class assessments",
  dashboard.counts.assessments >= mathAssessments.length,
  {
    dashboard: dashboard.counts.assessments,
    auditMathAssessments: mathAssessments.length,
  },
);
check(
  "Admin dashboard completed-attempt count includes class submissions",
  dashboard.counts.completedAssessments >= 6,
  { dashboard: dashboard.counts.completedAssessments },
);
check(
  "Admin dashboard performance is computed from both engines",
  typeof dashboard.performance.avgScore === "number" &&
    dashboard.performance.avgScore >= 0 &&
    dashboard.performance.avgScore <= 100,
  dashboard.performance,
);
check(
  "Admin dashboard recent assessments include class assessments",
  dashboard.recent.assessments.some((a) =>
    mathAssessments.some((m) => m.id === a.id),
  ),
  dashboard.recent.assessments,
);

const searchedStudents = await q(
  "adminPeople:listStudents",
  { search: "audit.1124" },
  admin,
);
check(
  "Student search filters to the audit cohort",
  searchedStudents.length > 0 &&
    searchedStudents.every((s) =>
      `${s.name} ${s.email ?? ""}`.toLowerCase().includes("audit"),
    ),
  { count: searchedStudents.length },
);
const searchedClasses = await q(
  "adminClasses:listClasses",
  { search: "AUDIT-1124" },
  admin,
);
check(
  "Class search filters to the audit cohort",
  searchedClasses.length > 0 &&
    searchedClasses.every((c) => c.name.includes("AUDIT-1124")),
  { count: searchedClasses.length },
);

// Class update + status lifecycle on a disposable administrative class.
const suffix = Date.now();
const classId = await mut(
  "adminClasses:createClass",
  {
    name: `AUDIT-1124 Lifecycle ${suffix}`,
    instructorId: A.instructors.math.id,
    subject: "Mathematics",
  },
  admin,
);
await mut(
  "adminClasses:updateClass",
  {
    id: classId,
    fields: {
      name: `AUDIT-1124 Lifecycle Renamed ${suffix}`,
      instructorId: A.instructors.math.id,
      subject: "Mathematics",
    },
  },
  admin,
);
await mut("adminClasses:setClassStatus", { id: classId, status: "inactive" }, admin);
const inactive = await q(
  "adminClasses:listClasses",
  { status: "inactive" },
  admin,
);
check(
  "Admin class update and deactivation persist",
  inactive.some((c) => c._id === classId && c.name.includes("Renamed")),
  inactive.find((c) => c._id === classId),
);
await mut("adminClasses:deleteClass", { id: classId }, admin);

log(
  JSON.stringify(
    {
      liveCounts: {
        instructors: instructors.length,
        students: students.length,
        classes: classes.length,
        auditInstructors: auditInstructors.length,
        auditStudents: auditStudents.length,
        auditClasses: auditClasses.length,
        mathAssessments: mathAssessments.length,
        auditLogs: auditLogs.length,
      },
      dashboard,
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

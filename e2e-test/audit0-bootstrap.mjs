/**
 * Audit bootstrap (read-only) — verifies admin authentication, Convex
 * connectivity and the live data volumes without mutating anything.
 */
import { adminToken, load, q, save, log } from "./lib.mjs";

const state = load();
const admin = await adminToken();
state.auditAdminToken = admin;
state.auditStartedAt = Date.now();
save(state);

const [viewer, dashboard, taxonomy, instructors, students, classes] =
  await Promise.all([
    q("adminAnalytics:getAdminViewer", {}, admin),
    q("adminAnalytics:getAdminDashboard", {}, admin),
    q("taxonomy:getTaxonomy", {}, admin),
    q("adminPeople:listInstructors", {}, admin),
    q("adminPeople:listStudents", {}, admin),
    q("adminClasses:listClasses", {}, admin),
  ]);

const logs = await q("adminAnalytics:listAuditLogs", { limit: 20 }, admin);

log(
  JSON.stringify(
    {
      connected: true,
      viewerRole: viewer?.role ?? viewer?.user?.role ?? viewer,
      dashboardKeys: dashboard ? Object.keys(dashboard) : null,
      dashboardSample: dashboard,
      categories: taxonomy.categories.map((c) => ({
        name: c.name,
        topics: c.topics.length,
      })),
      counts: {
        instructors: instructors.length,
        students: students.length,
        classes: classes.length,
      },
      testInstructors: instructors
        .filter((i) => /^TEST/.test(i.name))
        .map((i) => ({ id: i.id, name: i.name, email: i.email, status: i.status })),
      auditLogSample: logs.slice(0, 5),
    },
    null,
    2,
  ),
);

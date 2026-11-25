import { load, save, q, adminToken, ADMIN_EMAIL } from "./lib.mjs";
async function main() {
  console.log(ADMIN_EMAIL);
  const t = await adminToken();
  console.log(t?.length ?? 0);
  const rows = await q("adminCourses:listCourseModules", { courseId: "n7..." }, t);
  console.log("rows?", (rows?.length ?? 0), typeof rows, String(rows));
}
main().catch((e) => { console.error(e); process.exit(1) });

import { load, q } from "./lib.mjs";
const s = load();
const modNameById = Object.fromEntries(s.auditModules.map((m) => [m._id, m.name]));
const mods = await Promise.all(
  s.auditModules.map((m) =>
    q("adminCourses:listCourseModules", { courseId: m._id }, s.auditAdminToken),
  ),
);
const rows = [];
for (const m of s.auditModules) {
  const list = mods.find((lst) => lst.length !== undefined);
  const found = mods.shift();
  rows.push({
    moduleId: m._id,
    moduleName: m.name,
    courseModuleCount: found.length,
    courseModuleRefs:
      found.length > 0 ? found.map((c) => c._id).slice(0, 3).join(", ") : null,
  });
}
console.log(JSON.stringify(rows, null, 2));
console.log("MODULES", mods.length);
console.log(
  "ATTEMPT sample (3)",
  await Promise.all(
    s.auditModules.slice(0, 3).map(async (m) => {
      const list = await q(
        "adminCourses:listCourseModules",
        { courseId: m._id },
        s.auditAdminToken,
      );
      return m.name + " -> " + list.length;
    }),
  ),
);

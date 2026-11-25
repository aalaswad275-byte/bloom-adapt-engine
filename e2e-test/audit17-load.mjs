import { load, save, q, mut, act } from "./lib.mjs";
const s = load();
const state = JSON.parse(JSON.stringify(s));
console.log("state keys", Object.keys(state));
const mods = await q("adminCourses:listCourseModules", { courseId: "missing" }, "missing");
console.log("auth behaviour", mods);

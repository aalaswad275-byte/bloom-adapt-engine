import { q, tokens, section, test, report } from "./harness";

section("Smoke");
await test("authenticated query over HTTP with a real JWT", async () => {
  const me = await q("users:currentUser");
  return `signed in as ${me.email} (${me.role})`;
});
await test("anonymous query sees no user", async () => {
  const me = await q("users:currentUser", {}, null);
  if (me !== null) throw new Error("expected null for an anonymous caller");
});
await test("instructor dashboard loads", async () => {
  const d = await q("instructorPortal:getInstructorDashboard");
  return `${d.classes.length} classes`;
});
console.log("roles:", Object.keys(tokens).join(", "));
report("Smoke");

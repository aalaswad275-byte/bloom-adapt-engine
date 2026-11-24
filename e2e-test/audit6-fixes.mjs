import {
  load,
  q,
  mut,
  log,
  URL,
  anonymousToken,
  uploadImage,
} from "./lib.mjs";

const state = load();
const A = state.audit;
const admin = state.auditAdminToken;
const mathInstructor = A.instructors.math;
const high = A.students.find((s) => s.classId === A.classes.math.id);
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail));
}
async function expectError(name, fn, includes) {
  try {
    const value = await fn();
    check(name, false, { got: value });
  } catch (err) {
    const message = String(err.message);
    const pass = !includes || message.toLowerCase().includes(includes.toLowerCase());
    check(name, pass, { message: message.slice(0, 300) });
  }
}

await expectError(
  "Admin duplicate instructor email is rejected",
  () =>
    mut(
      "adminPeople:createInstructor",
      { name: "AUDIT-1124 Dup", email: "audit.1124.math@example.test" },
      admin,
    ),
  "already exists",
);
await expectError(
  "Admin duplicate student email is rejected",
  () =>
    mut(
      "adminPeople:createStudent",
      { name: "AUDIT-1124 Dup", email: "audit.1124.high@example.test" },
      admin,
    ),
  "already exists",
);
const instructors = await q("adminPeople:listInstructors", {}, admin);
const mathRow = instructors.find(
  (i) => (i.email ?? "").toLowerCase() === "audit.1124.math@example.test" && i.userId,
);
if (mathRow) {
  await expectError(
    "Admin update to a duplicate instructor email is rejected",
    () =>
      mut(
        "adminPeople:updateInstructor",
        { id: mathRow._id, fields: { name: mathRow.name, email: "instructor@epc.ly" } },
        admin,
      ),
    "already exists",
  );
}

// Cross-role claim guards -----------------------------------------------------
// First establish a genuine student account, then try to claim an instructor.
const unclaimedStudentEmail = `audit.1124.priv.student.${Date.now()}@example.test`;
const unclaimedStudentId = await mut(
  "adminPeople:createStudent",
  { name: "AUDIT-1124 Priv Student", email: unclaimedStudentEmail },
  admin,
);
const studentToken = await anonymousToken();
await mut(
  "studentAssessments:claimStudent",
  { email: unclaimedStudentEmail },
  studentToken,
);
const studentViewer = await q("studentAssessments:getStudentViewer", {}, studentToken);
check("Test account has the student role", studentViewer?.role === "student", studentViewer);

const unclaimedInstructorEmail = `audit.1124.priv.${Date.now()}@example.test`;
const unclaimedInstructorId = await mut(
  "adminPeople:createInstructor",
  { name: "AUDIT-1124 Priv Instructor", email: unclaimedInstructorEmail },
  admin,
);
await expectError(
  "Student account cannot claim an instructor profile",
  () =>
    mut(
      "instructorPortal:claimInstructor",
      { email: unclaimedInstructorEmail },
      studentToken,
    ),
  "student account",
);
const afterInstructors = await q("adminPeople:listInstructors", {}, admin);
const stillUnclaimed = afterInstructors.find((i) => i._id === unclaimedInstructorId);
check(
  "Rejected claim leaves the instructor profile unclaimed",
  stillUnclaimed && !stillUnclaimed.userId,
  { userId: stillUnclaimed?.userId ?? null },
);

const secondStudentEmail = `audit.1124.priv.student2.${Date.now()}@example.test`;
await mut(
  "adminPeople:createStudent",
  { name: "AUDIT-1124 Priv Student 2", email: secondStudentEmail },
  admin,
);
await expectError(
  "Instructor account cannot claim a student profile",
  () =>
    mut(
      "studentAssessments:claimStudent",
      { email: secondStudentEmail },
      mathInstructor.token,
    ),
  "instructor account",
);
const mathViewer = await q(
  "instructorPortal:getInstructorViewer",
  {},
  mathInstructor.token,
);
check(
  "Instructor keeps the instructor role after rejected claim",
  mathViewer?.role === "instructor",
  mathViewer,
);
const students = await q("adminPeople:listStudents", {}, admin);
const stillStudentUnclaimed = students.find(
  (s) => (s.email ?? "").toLowerCase() === secondStudentEmail.toLowerCase(),
);
check(
  "Rejected claim leaves the student profile unclaimed",
  stillStudentUnclaimed && !stillStudentUnclaimed.userId,
  { userId: stillStudentUnclaimed?.userId ?? null },
);

// Image validation ------------------------------------------------------------
async function uploadBlob(token, contentType, body) {
  const url = await mut("studentAssessments:generateIdentityUploadUrl", {}, token);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!res.ok) throw new Error(`upload failed ${res.status}`);
  return (await res.json()).storageId;
}
const textStorage = await uploadBlob(high.token, "text/plain", "not an image");
await expectError(
  "Non-image upload is rejected by saveIdentityImage",
  () =>
    mut(
      "studentAssessments:saveIdentityImage",
      { storageId: textStorage },
      high.token,
    ),
  "images are allowed",
);
const faceStorage = await uploadBlob(high.token, "text/plain", "not a face");
await expectError(
  "Non-image upload is rejected by saveFaceImage",
  () =>
    mut(
      "studentFaces:saveFaceImage",
      {
        storageId: faceStorage,
        pose: "center",
        embedding: Array(128).fill(0.01),
      },
      high.token,
    ),
  "images are allowed",
);
const pngStorage = await uploadImage(high.token);
const saved = await mut(
  "studentAssessments:saveIdentityImage",
  { storageId: pngStorage },
  high.token,
);
check("Valid PNG identity image still saves", saved?.ok === true, saved);
const viewer = await q("studentAssessments:getStudentViewer", {}, high.token);
check(
  "Saved identity image resolves to a URL",
  typeof viewer?.student?.identityImageUrl === "string" &&
    viewer.student.identityImageUrl.startsWith("http"),
  { identityImageUrl: viewer?.student?.identityImageUrl ?? null },
);

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

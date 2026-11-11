/**
 * Phase 8 — shared-bank subject scoping, duplicate guards, student result
 * isolation, and login/logout behaviour.
 */
import { act, load, mut, q, log } from "./lib.mjs";

const state = load();
const out = { sharedBank: [], duplicates: [], studentIsolation: null, logout: null };

// Shared bank: every row returned for a class must belong to that class's
// category, and a class must see at least its own two shared questions.
for (const cls of state.classes) {
  const inst = state.instructors.find((i) => i.id === cls.instructorId);
  const ctx = await q("sharedQuestions:getSharedQuestionsContext", { classId: cls.id }, inst.token);
  const rows = ctx?.questions ?? [];
  const foreign = rows.filter((r) => r.categoryId && r.categoryId !== cls.categoryId);
  out.sharedBank.push({
    class: cls.name,
    rows: rows.length,
    foreign: foreign.length,
    categories: [...new Set(rows.map((r) => r.categoryId))].length,
  });
}

// Duplicate enrollment and duplicate email are rejected with a clear reason.
{
  const student = state.students[0];
  const cls = state.classes.find((c) => c.id === student.classes[0]);
  const inst = state.instructors.find((i) => i.id === cls.instructorId);
  for (const probe of ["enrollment", "email"]) {
    try {
      if (probe === "enrollment") {
        await mut(
          "instructorPortal:addStudentToMyClass",
          { classId: cls.id, studentId: student.id },
          inst.token,
        );
      } else {
        await mut(
          "instructorPortal:createMyStudent",
          { classId: cls.id, name: "TEST Duplicate Email", email: student.email },
          inst.token,
        );
      }
      out.duplicates.push({ probe, result: "FAIL — accepted" });
    } catch (err) {
      out.duplicates.push({ probe, result: "blocked", message: String(err.message).slice(0, 160) });
    }
  }
}

// A student cannot read another student's submission.
{
  const a = state.students[0];
  const b = state.students.find((s) => s.id !== a.id && s.classes.includes(a.classes[0]));
  const cls = state.classes.find((c) => c.id === a.classes[0]);
  const assessmentId = state.assessments[cls.id].static;
  const bSub = state.attempts[cls.id]?.find(
    (r) => r.assessmentId === assessmentId && r.studentId === b.id,
  )?.submissionId;
  try {
    await q("studentAssessments:getAssessmentResult", { submissionId: bSub }, a.token);
    out.studentIsolation = "FAIL — foreign result returned";
  } catch (err) {
    out.studentIsolation = {
      result: String(err.message).includes("Submission not found") ? "passed" : "unexpected",
      message: String(err.message).slice(0, 140),
    };
  }
}

// Login then sign out: the action succeeds and the client token is dropped.
// (Access JWTs are stateless in Convex Auth, so a copied token stays valid
// until expiry; that is recorded rather than hidden.)
{
  const session = await act("auth:signIn", {
    provider: "password",
    params: { email: "admin@epc.ly", password: "Assessment123!@#", flow: "signIn" },
  });
  const token = session?.tokens?.token;
  let before = false;
  try {
    await q("adminPeople:listStudents", {}, token);
    before = true;
  } catch {}
  const signOut = await act("auth:signOut", {}, token).catch((e) => String(e.message));
  let after = false;
  try {
    await q("adminPeople:listStudents", {}, token);
    after = true;
  } catch {}
  out.logout = { login: before, signOut: signOut === null ? "ok" : signOut.slice(0, 120), reusedTokenAccepted: after };
}

log(JSON.stringify(out, null, 2));

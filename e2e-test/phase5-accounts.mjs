/**
 * Phase 5 — real student onboarding for the test cohort: anonymous session,
 * claim of the roster record, identity image, seven face poses and class
 * enrollment. Runs in slices so each command stays bounded.
 *
 *   node e2e-test/phase5-accounts.mjs <from> <to>
 */
import {
  FACE_POSES,
  anonymousToken,
  load,
  mut,
  save,
  uploadImage,
  log,
} from "./lib.mjs";

const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? 999);
const state = load();
const failures = [];
let sharedImage = state.sharedImageId ?? null;

if (!sharedImage) {
  // Needs a student session: use the first successfully claimed student below.
}

const slice = state.students.slice(from, Math.min(to, state.students.length));
for (const student of slice) {
  if (student.token) continue;
  try {
    const token = await anonymousToken();
    await mut("studentAssessments:claimStudent", { email: student.email }, token);
    if (!sharedImage) {
      sharedImage = await uploadImage(token);
      state.sharedImageId = sharedImage;
      save(state);
    }
    await mut(
      "studentAssessments:saveIdentityImage",
      { storageId: sharedImage },
      token,
    );
    for (const pose of FACE_POSES) {
      await mut(
        "studentFaces:saveFaceImage",
        { storageId: sharedImage, pose, embedding: Array(128).fill(0.001) },
        token,
      );
    }
    for (const classId of student.classes) {
      await mut("studentAssessments:joinClass", { classId }, token).catch(
        (err) => {
          if (!String(err.message).includes("duplicate")) throw err;
        },
      );
    }
    student.token = token;
    save(state);
    log(`onboarded ${student.email}`);
  } catch (err) {
    failures.push({ email: student.email, error: String(err.message).slice(0, 300) });
    log(`FAILED ${student.email}: ${err.message}`.slice(0, 300));
  }
}

log(
  JSON.stringify(
    {
      slice: [from, slice.length + from],
      onboarded: state.students.filter((s) => s.token).length,
      failures,
    },
    null,
    2,
  ),
);

/**
 * Phase 3 — per class: static paper, random paper, adaptive paper and Fair
 * Adaptive final. Created, populated and published through the real
 * instructor mutations (the same path the UI uses).
 */
import { load, mut, save, log } from "./lib.mjs";

const state = load();
state.assessments = state.assessments ?? {};

for (const cls of state.classes) {
  if (state.assessments[cls.id]) continue;
  const instructor = state.instructors.find((i) => i.id === cls.instructorId);
  const token = instructor.token;
  const bank = state.questions[cls.id];
  if (!bank || bank.length < 18) throw new Error(`bank missing for ${cls.name}`);

  const created = {};

  // ---- Static paper: 8 authored questions in instructor order ----
  const staticId = await mut(
    "instructorAssessments:createAssessment",
    {
      classId: cls.id,
      title: `TEST — ${cls.name} — Static Paper`,
      description: "E2E test static assessment (manual selection).",
      timeLimitMin: 40,
      selectionMode: "static",
    },
    token,
  );
  for (const q of bank.slice(0, 8)) {
    await mut(
      "instructorAssessments:addQuestionToAssessment",
      { assessmentId: staticId, questionId: q.id },
      token,
    );
  }
  await mut(
    "instructorAssessments:setAssessmentStatus",
    { id: staticId, status: "published" },
    token,
  );
  created.static = staticId;

  // ---- Random paper: 2 questions per Bloom drawn from the class bank ----
  const randomId = await mut(
    "instructorAssessments:createAssessment",
    {
      classId: cls.id,
      title: `TEST — ${cls.name} — Random Paper`,
      description: "E2E test static assessment (random draw per student).",
      timeLimitMin: 35,
      selectionMode: "random",
      randomCounts: {
        remember: 2,
        understand: 2,
        apply: 2,
        analyze: 2,
        evaluate: 2,
        create: 2,
      },
    },
    token,
  );
  await mut(
    "instructorAssessments:setAssessmentStatus",
    { id: randomId, status: "published" },
    token,
  );
  created.random = randomId;

  // ---- Adaptive paper: 18-question pool, 9 served per student ----
  const adaptiveId = await mut(
    "instructorAssessments:createAssessment",
    {
      classId: cls.id,
      title: `TEST — ${cls.name} — Adaptive Paper`,
      description: "E2E test adaptive assessment (Bloom ladder).",
      timeLimitMin: 45,
      selectionMode: "adaptive",
      poolSize: 18,
      displayCount: 9,
    },
    token,
  );
  for (const q of bank) {
    await mut(
      "instructorAssessments:addQuestionToAssessment",
      { assessmentId: adaptiveId, questionId: q.id },
      token,
    );
  }
  await mut(
    "instructorAssessments:setAssessmentStatus",
    { id: adaptiveId, status: "published" },
    token,
  );
  created.adaptive = adaptiveId;

  // ---- Fair Adaptive final: shared set, shuffled order per student ----
  const finalId = await mut(
    "instructorAssessments:createAssessment",
    {
      classId: cls.id,
      title: `TEST — ${cls.name} — Fair Adaptive Final`,
      description: "E2E test final exam (same set, per-student order).",
      timeLimitMin: 60,
      selectionMode: "final",
    },
    token,
  );
  for (const q of bank.slice(6, 14)) {
    await mut(
      "instructorAssessments:addQuestionToAssessment",
      { assessmentId: finalId, questionId: q.id },
      token,
    );
  }
  await mut(
    "instructorAssessments:setAssessmentStatus",
    { id: finalId, status: "published" },
    token,
  );
  created.final = finalId;

  state.assessments[cls.id] = created;
  save(state);
  log(`assessments ${cls.name}: static/random/adaptive/final`);
}

log(
  JSON.stringify(
    Object.fromEntries(
      state.classes.map((c) => [
        c.name,
        Object.keys(state.assessments[c.id] ?? {}),
      ]),
    ),
    null,
    2,
  ),
);

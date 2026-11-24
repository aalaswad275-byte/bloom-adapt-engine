/**
 * Audit cohort setup — creates NEW additive records only, all prefixed
 * AUDIT-1124 / audit.1124.*. Existing users, classes, questions, attempts and
 * results are never edited or deleted.
 *
 * Run: node e2e-test/audit1-setup.mjs
 */
import fs from "node:fs";
import {
  FACE_POSES,
  adminToken,
  anonymousToken,
  load,
  mut,
  q,
  save,
  log,
} from "./lib.mjs";

const RUN = "AUDIT-1124";
const state = load();
const admin = state.auditAdminToken ?? (await adminToken());
state.auditAdminToken = admin;
state.audit = state.audit ?? {};
const A = state.audit;
const report = { steps: [], errors: [] };
const step = (name, data) => {
  report.steps.push({ name, ...data });
  log(`✓ ${name}`, JSON.stringify(data).slice(0, 300));
};

async function expectError(name, fn, includes) {
  try {
    await fn();
    report.errors.push({ check: name, expected: includes ?? "error", actual: "NO ERROR" });
    log(`✗ ${name}: expected failure but call succeeded`);
    return { ok: false };
  } catch (err) {
    const message = String(err.message).slice(0, 400);
    const ok = !includes || message.toLowerCase().includes(includes.toLowerCase());
    step(name, { rejected: true, matched: ok, message });
    if (!ok) report.errors.push({ check: name, expected: includes, actual: message });
    return { ok, message };
  }
}

// ---------------------------------------------------------------------------
// Taxonomy + instructors
// ---------------------------------------------------------------------------
const taxonomy = await q("taxonomy:getTaxonomy", {}, admin);
const categoryId = (name) => {
  const c = taxonomy.categories.find((x) => x.name === name);
  if (!c) throw new Error(`category missing: ${name}`);
  return c.id;
};
const mathCategory = categoryId("Mathematics");
const csCategory = categoryId("Computer Science");

A.instructors = A.instructors ?? {};
async function ensureInstructor(key, name, email, specialization) {
  if (A.instructors[key]?.token) return A.instructors[key];
  const existing = (await q("adminPeople:listInstructors", { search: email }, admin)).find(
    (i) => (i.email ?? "").toLowerCase() === email,
  );
  let id = existing?.id;
  if (!id) {
    id = await mut(
      "adminPeople:createInstructor",
      { name, email, specialization },
      admin,
    );
  }
  const token = await anonymousToken();
  await mut("instructorPortal:claimInstructor", { email }, token);
  const rec = { id, token, email, name };
  A.instructors[key] = rec;
  save(state);
  step(`instructor ready: ${email}`, { id });
  return rec;
}

const mathInstructor = await ensureInstructor(
  "math",
  `${RUN} Instructor — Mathematics`,
  "audit.1124.math@example.test",
  "Mathematics",
);
const csInstructor = await ensureInstructor(
  "cs",
  `${RUN} Instructor — Computer Science`,
  "audit.1124.cs@example.test",
  "Computer Science",
);

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------
A.classes = A.classes ?? {};
async function ensureClass(key, instructor, name, categoryIdValue, description) {
  if (A.classes[key]?.id) return A.classes[key];
  const id = await mut(
    "instructorPortal:createMyClass",
    { name, description, categoryId: categoryIdValue },
    instructor.token,
  );
  const rec = { id, name, instructorKey: key.startsWith("math") ? "math" : "cs" };
  A.classes[key] = rec;
  save(state);
  step(`class created: ${name}`, { id });
  return rec;
}

const mathClass = await ensureClass(
  "math",
  mathInstructor,
  `${RUN} — Algebra`,
  mathCategory,
  "Isolated audit class — Mathematics",
);
const csClass = await ensureClass(
  "cs",
  csInstructor,
  `${RUN} — Python`,
  csCategory,
  "Isolated audit class — Computer Science",
);

// ---------------------------------------------------------------------------
// Students (roster + enrollment) then real onboarding
// ---------------------------------------------------------------------------
A.students = A.students ?? [];
const STUDENTS = [
  { name: `${RUN} Student High`, email: "audit.1124.high@example.test", cls: "math", profile: "high" },
  { name: `${RUN} Student Average`, email: "audit.1124.average@example.test", cls: "math", profile: "average" },
  { name: `${RUN} Student Struggling`, email: "audit.1124.struggling@example.test", cls: "math", profile: "struggling" },
  { name: `${RUN} Student CS`, email: "audit.1124.cs.student@example.test", cls: "cs", profile: "average" },
];

function png() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function uploadBytes(token, bytes, mime) {
  const url = await mut("studentAssessments:generateIdentityUploadUrl", {}, token);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": mime },
    body: bytes,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, storageId: json?.storageId ?? null, body: text.slice(0, 160) };
}

async function onboard(spec) {
  let rec = A.students.find((s) => s.email === spec.email);
  const cls = spec.cls === "math" ? mathClass : csClass;
  const instructor = spec.cls === "math" ? mathInstructor : csInstructor;
  if (!rec) {
    const id = await mut(
      "instructorPortal:createMyStudent",
      { classId: cls.id, name: spec.name, email: spec.email },
      instructor.token,
    );
    rec = { id, ...spec, classId: cls.id };
    A.students.push(rec);
    save(state);
    step(`student roster created: ${spec.email}`, { id });
  }
  if (rec.token) return rec;
  const token = await anonymousToken();
  await mut("studentAssessments:claimStudent", { email: spec.email }, token);
  const uploaded = await uploadBytes(token, png(), "image/png");
  if (!uploaded.storageId) throw new Error(`upload failed for ${spec.email}: ${uploaded.status}`);
  await mut("studentAssessments:saveIdentityImage", { storageId: uploaded.storageId }, token);
  for (const pose of FACE_POSES) {
    await mut(
      "studentFaces:saveFaceImage",
      { storageId: uploaded.storageId, pose, embedding: Array(128).fill(0.001) },
      token,
    );
  }
  rec.token = token;
  rec.imageStorageId = uploaded.storageId;
  save(state);
  step(`student onboarded: ${spec.email}`, { id: rec.id });
  return rec;
}

const students = [];
for (const spec of STUDENTS) students.push(await onboard(spec));

// ---------------------------------------------------------------------------
// Image upload matrix (student identity image)
// ---------------------------------------------------------------------------
const high = students[0];
const imageChecks = [];
for (const [label, mime, bytes] of [
  ["PNG", "image/png", png()],
  ["JPEG", "image/jpeg", png()],
  ["WebP", "image/webp", png()],
  ["text/plain", "text/plain", Buffer.from("not an image")],
]) {
  const up = await uploadBytes(high.token, bytes, mime);
  let saved = null;
  let saveError = null;
  if (up.storageId) {
    try {
      await mut("studentAssessments:saveIdentityImage", { storageId: up.storageId }, high.token);
      saved = true;
    } catch (err) {
      saveError = String(err.message).slice(0, 200);
    }
  }
  const viewer = await q("studentAssessments:getStudentViewer", {}, high.token);
  imageChecks.push({
    label,
    uploadStatus: up.status,
    stored: Boolean(up.storageId),
    saveAccepted: saved,
    saveError,
    profileImageUrl: viewer?.student?.identityImageUrl ?? null,
  });
}
step("student image upload matrix", { checks: imageChecks });

// Instructor profile images: feature discovery
const instructorImageSupport = {
  hasInstructorUploadMutation: false,
  note: "No instructor image upload mutation/field exists in instructorPortal or adminPeople.",
};
step("instructor image upload discovery", instructorImageSupport);

// ---------------------------------------------------------------------------
// Question banks
// ---------------------------------------------------------------------------
A.questions = A.questions ?? {};
function questionSet(prefix, categoryIdValue, subject) {
  const rows = [];
  const blooms = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
  const diffs = ["easy", "medium", "hard", "expert", "medium", "hard"];
  for (let i = 0; i < 12; i++) {
    const bloomLevel = blooms[i % 6];
    const base = {
      categoryId: categoryIdValue,
      questionText: `[${RUN}] ${prefix} ${subject} question ${i + 1} (${bloomLevel})`,
      marks: 1 + (i % 3),
      bloomLevel,
      expectedTimeSec: 60,
      difficultyLevel: diffs[i % 6],
      source: "manual",
    };
    if (i === 0) {
      Object.assign(base, {
        questionType: "multiple_choice",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        questionTextAr: `[${RUN}] سؤال ${subject} الأول`,
        optionsAr: ["أ", "ب", "ج", "د"],
        correctAnswerAr: "أ",
        explanation: "Audit bank — option A is correct.",
      });
    } else if (i === 1) {
      Object.assign(base, {
        questionType: "true_false",
        options: ["True", "False"],
        correctAnswer: "True",
      });
    } else if (i === 2) {
      Object.assign(base, {
        questionType: "short_answer",
        correctAnswer: "audit answer",
        instructionsEn: "Write one short sentence.",
      });
    } else if (i === 3) {
      Object.assign(base, {
        questionType: "drag_drop",
        options: ["H2O", "CO2", "O2"],
        dragDropTargets: [
          { id: "t1", label: "Water" },
          { id: "t2", label: "Gas" },
        ],
        dragDropCorrect: [
          { targetId: "t1", item: "H2O" },
          { targetId: "t2", item: "CO2" },
          { targetId: "t2", item: "O2" },
        ],
        correctAnswer: "H2O → Water; CO2/O2 → Gas",
        partialCredit: true,
      });
    } else if (i === 4) {
      Object.assign(base, {
        questionType: "ordering",
        options: ["Fetch", "Decode", "Execute"],
        orderingCorrect: ["Fetch", "Decode", "Execute"],
        correctAnswer: "Fetch → Decode → Execute",
        partialCredit: true,
      });
    } else if (i % 2 === 0) {
      Object.assign(base, {
        questionType: "multiple_choice",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
      });
    } else {
      Object.assign(base, {
        questionType: "true_false",
        options: ["True", "False"],
        correctAnswer: i % 4 === 1 ? "False" : "True",
      });
    }
    rows.push(base);
  }
  return rows;
}

async function ensureBank(cls, instructor, prefix, categoryIdValue, subject) {
  if (A.questions[cls.id]) return A.questions[cls.id];
  const created = [];
  for (const row of questionSet(prefix, categoryIdValue, subject)) {
    const id = await mut(
      "instructorAssessments:createQuestion",
      { classId: cls.id, ...row },
      instructor.token,
    );
    created.push({ id, ...row });
  }
  A.questions[cls.id] = created;
  save(state);
  step(`question bank ready: ${cls.name}`, { count: created.length });
  return created;
}

const mathBank = await ensureBank(mathClass, mathInstructor, "Math", mathCategory, "Algebra");
const csBank = await ensureBank(csClass, csInstructor, "CS", csCategory, "Python");

// Negative authoring rules
await expectError(
  "MC with correct answer outside options is rejected",
  () =>
    mut(
      "instructorAssessments:createQuestion",
      {
        classId: mathClass.id,
        questionType: "multiple_choice",
        options: ["A", "B"],
        correctAnswer: "Z",
        questionText: `[${RUN}] invalid MC`,
        marks: 1,
        bloomLevel: "remember",
        expectedTimeSec: 60,
      },
      mathInstructor.token,
    ),
  "correct answer",
);
await expectError(
  "Question with non-positive marks is rejected",
  () =>
    mut(
      "instructorAssessments:createQuestion",
      {
        classId: mathClass.id,
        questionType: "true_false",
        options: ["True", "False"],
        correctAnswer: "True",
        questionText: `[${RUN}] invalid marks`,
        marks: 0,
        bloomLevel: "remember",
        expectedTimeSec: 60,
      },
      mathInstructor.token,
    ),
  "marks",
);
await expectError(
  "Cross-instructor question authoring is rejected",
  () =>
    mut(
      "instructorAssessments:createQuestion",
      {
        classId: mathClass.id,
        questionType: "true_false",
        options: ["True", "False"],
        correctAnswer: "True",
        questionText: `[${RUN}] cross-class`,
        marks: 1,
        bloomLevel: "remember",
        expectedTimeSec: 60,
      },
      csInstructor.token,
    ),
  "class",
);

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------
A.assessments = A.assessments ?? {};
async function ensureStatic() {
  if (A.assessments.mathStatic) return A.assessments.mathStatic;
  const id = await mut(
    "instructorAssessments:createAssessment",
    {
      classId: mathClass.id,
      title: `${RUN} — Static Algebra Paper`,
      description: "Audit static paper with mixed question types.",
      timeLimitMin: 40,
      selectionMode: "static",
    },
    mathInstructor.token,
  );
  for (const qq of mathBank.slice(0, 8)) {
    await mut(
      "instructorAssessments:addQuestionToAssessment",
      { assessmentId: id, questionId: qq.id },
      mathInstructor.token,
    );
  }
  await mut(
    "instructorAssessments:setAssessmentStatus",
    { id, status: "published" },
    mathInstructor.token,
  );
  A.assessments.mathStatic = id;
  save(state);
  step("static assessment published", { id, questions: 8 });
  return id;
}
async function ensureAdaptive() {
  if (A.assessments.mathAdaptive) return A.assessments.mathAdaptive;
  // Adaptive papers require a declared pool of at least 18 questions.
  const blooms = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
  while (mathBank.length < 18) {
    const i = mathBank.length;
    const row = {
      categoryId: mathCategory,
      questionText: `[${RUN}] Math Algebra extra question ${i + 1} (${blooms[i % 6]})`,
      questionType: "true_false",
      options: ["True", "False"],
      correctAnswer: i % 2 === 0 ? "True" : "False",
      marks: 1 + (i % 3),
      bloomLevel: blooms[i % 6],
      expectedTimeSec: 60,
      difficultyLevel: ["easy", "medium", "hard", "expert"][i % 4],
      source: "manual",
    };
    const id = await mut(
      "instructorAssessments:createQuestion",
      { classId: mathClass.id, ...row },
      mathInstructor.token,
    );
    const rec = { id, ...row };
    mathBank.push(rec);
    A.questions[mathClass.id] = mathBank;
    save(state);
  }
  const id = await mut(
    "instructorAssessments:createAssessment",
    {
      classId: mathClass.id,
      title: `${RUN} — Adaptive Algebra Paper`,
      description: "Audit adaptive paper (Bloom ladder).",
      timeLimitMin: 45,
      selectionMode: "adaptive",
      poolSize: mathBank.length,
      displayCount: 6,
    },
    mathInstructor.token,
  );
  for (const qq of mathBank) {
    await mut(
      "instructorAssessments:addQuestionToAssessment",
      { assessmentId: id, questionId: qq.id },
      mathInstructor.token,
    );
  }
  await mut(
    "instructorAssessments:setAssessmentStatus",
    { id, status: "published" },
    mathInstructor.token,
  );
  A.assessments.mathAdaptive = id;
  save(state);
  step("adaptive assessment published", { id, questions: mathBank.length });
  return id;
}

const staticId = await ensureStatic();
const adaptiveId = await ensureAdaptive();

// Assessment rule probes
const emptyDraft = await mut(
  "instructorAssessments:createAssessment",
  {
    classId: mathClass.id,
    title: `${RUN} — Empty Draft (rule probe)`,
    timeLimitMin: 20,
    selectionMode: "static",
  },
  mathInstructor.token,
);
await expectError(
  "Publishing an empty static paper is rejected",
  () =>
    mut(
      "instructorAssessments:setAssessmentStatus",
      { id: emptyDraft, status: "published" },
      mathInstructor.token,
    ),
  "question",
);
A.assessments.emptyDraft = emptyDraft;
save(state);

await expectError(
  "Adding a question to a published paper is rejected",
  () =>
    mut(
      "instructorAssessments:addQuestionToAssessment",
      { assessmentId: staticId, questionId: mathBank[9].id },
      mathInstructor.token,
    ),
  "draft",
);

await expectError(
  "Scheduling an assessment in the past is rejected",
  () =>
    mut(
      "instructorAssessments:scheduleAssessment",
      { id: staticId, scheduledFor: Date.now() - 60_000 },
      mathInstructor.token,
    ),
  "future",
);

// ---------------------------------------------------------------------------
// Save state + summary
// ---------------------------------------------------------------------------
save(state);
log(
  JSON.stringify(
    {
      run: RUN,
      instructors: Object.values(A.instructors).map((i) => i.email),
      classes: Object.values(A.classes).map((c) => c.name),
      students: students.map((s) => ({ email: s.email, id: s.id })),
      questions: { math: mathBank.length, cs: csBank.length },
      assessments: {
        static: staticId,
        adaptive: adaptiveId,
        emptyDraft,
      },
      imageChecks,
      instructorImageSupport,
      errors: report.errors,
    },
    null,
    2,
  ),
);

/**
 * Phase 9 — adaptive branching probe.
 *
 * The main bank has exactly 3 questions per Bloom level at one fixed
 * difficulty, so every student is served the same 9 items regardless of
 * performance. This adds a deeper, mixed-difficulty pool (24 more questions)
 * to the Algebra class, creates a second adaptive assessment, and runs real
 * attempts for five students to observe whether item selection branches.
 */
import { load, mut, q, save, log } from "./lib.mjs";

const state = load();
const cls = state.classes.find((c) => c.name === "TEST — Algebra (Mathematics)");
const instructor = state.instructors.find((i) => i.id === cls.instructorId);
const token = instructor.token;

const BLOOMS = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
const DIFFS = ["easy", "medium", "hard", "expert"];
const MARKS = { remember: 1, understand: 1, apply: 2, analyze: 2, evaluate: 3, create: 3 };
const TIME = { remember: 30, understand: 45, apply: 60, analyze: 90, evaluate: 120, create: 180 };
const TYPES = ["multiple_choice", "true_false", "short_answer"];

const taxonomy = await q("taxonomy:getTaxonomy", {}, state.adminToken);
const tid = taxonomy.categories
  .find((c) => c.name === cls.subject)
  .topics.find((t) => t.name === "Algebra").id;

state.questions[cls.id] = state.questions[cls.id] ?? [];
const newRows = [];
for (let i = 0; i < 24; i++) {
  const bloom = BLOOMS[i % 6];
  const difficulty = DIFFS[i % 4];
  const type = TYPES[i % 3];
  const n = 17 + i;
  const a = 3 + (n % 7);
  const x = 2 + (n % 11);
  const b = 5 + (n % 9);
  const c = a * x + b;
  const suffix = `[D${i + 1}]`;
  let questionText;
  let correctAnswer;
  let options;
  if (type === "true_false") {
    const isTrue = i % 2 === 0;
    questionText = `TEST Algebra: The equation ${a}x + ${b} = ${c} has the solution x = ${isTrue ? x : x + 1}. ${suffix}`;
    correctAnswer = isTrue ? "True" : "False";
  } else if (type === "short_answer") {
    questionText = `TEST Algebra: Solve ${a}x + ${b} = ${c}. Give the exact value of x. ${suffix}`;
    correctAnswer = String(x);
  } else {
    options = [String(x), String(x + 1), String(x - 1), String(x + 2)];
    questionText = `TEST Algebra: Which value of x satisfies ${a}x + ${b} = ${c}? ${suffix}`;
    correctAnswer = String(x);
  }
  const id = await mut(
    "instructorAssessments:createQuestion",
    {
      classId: cls.id,
      categoryId: cls.categoryId,
      topicId: tid,
      typeKey: type,
      questionText,
      questionType: type,
      correctAnswer,
      explanation: `${a}(${x}) + ${b} = ${c}.`,
      marks: MARKS[bloom],
      bloomLevel: bloom,
      difficultyLevel: difficulty,
      expectedTimeSec: TIME[bloom],
      source: "manual",
      ...(options ? { options } : {}),
    },
    token,
  );
  newRows.push({
    id,
    questionText,
    questionType: type,
    options: options ?? null,
    correctAnswer,
    bloomLevel: bloom,
    difficultyLevel: difficulty,
    marks: MARKS[bloom],
    expectedTimeSec: TIME[bloom],
  });
}
state.questions[cls.id].push(...newRows);
save(state);

const assessmentId = await mut(
  "instructorAssessments:createAssessment",
  {
    classId: cls.id,
    title: "TEST — Algebra — Adaptive Branching Probe",
    description: "Deeper mixed-difficulty adaptive pool for branching verification.",
    timeLimitMin: 45,
    selectionMode: "adaptive",
    poolSize: state.questions[cls.id].length,
    displayCount: 9,
  },
  token,
);
for (const row of state.questions[cls.id]) {
  await mut(
    "instructorAssessments:addQuestionToAssessment",
    { assessmentId, questionId: row.id },
    token,
  );
}
await mut("instructorAssessments:setAssessmentStatus", { id: assessmentId, status: "published" }, token);

const keyFor = new Map(state.questions[cls.id].map((r) => [r.questionText, r]));
const rand = (() => {
  let seed = 987654;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
})();

function pCorrect(profile) {
  switch (profile) {
    case "high":
      return 0.93;
    case "average":
      return 0.7;
    case "low":
      return 0.45;
    case "failing":
      return 0.22;
    case "improving":
      return 0.75;
    case "declining":
      return 0.5;
    case "inconsistent":
      return 0.2 + rand() * 0.7;
    case "difficulty_sensitive":
      return 0.55;
    default:
      return 0.6;
  }
}

function wrongAnswer(row) {
  if (row.questionType === "true_false")
    return row.correctAnswer === "True" ? "False" : "True";
  if (row.questionType === "multiple_choice") {
    return (row.options ?? []).find((o) => o !== row.correctAnswer) ?? "None of these";
  }
  return "incorrect answer";
}

const students = state.students.filter((s) => s.classes.includes(cls.id)).slice(0, 5);
const results = [];
for (const student of students) {
  try {
    const { submissionId } = await mut(
      "studentAssessments:startAssessment",
      { assessmentId },
      student.token,
    );
    let guard = 0;
    for (;;) {
      if (guard++ > 30) throw new Error("runaway");
      const view = await q("studentAssessments:getTakeAssessment", { submissionId }, student.token);
      if (!view.currentQuestion) break;
      const key = keyFor.get(view.currentQuestion.questionText);
      if (!key) throw new Error(`unknown item ${view.currentQuestion.questionText.slice(0, 50)}`);
      const correct = rand() < pCorrect(student.profile);
      await mut(
        "studentAssessments:answerAndNext",
        {
          submissionId,
          answer: correct ? key.correctAnswer : wrongAnswer(key),
          responseTimeMs: key.expectedTimeSec * 1000,
        },
        student.token,
      );
    }
    const submitted = await mut("studentAssessments:submitAssessment", { submissionId }, student.token);
    results.push({
      profile: student.profile,
      submissionId,
      score: `${submitted.score}/${submitted.maxScore}`,
      percent: submitted.percent,
      grade: submitted.grade,
    });
  } catch (err) {
    results.push({ profile: student.profile, error: String(err.message).slice(0, 200) });
  }
}

log(JSON.stringify({ assessmentId, pool: state.questions[cls.id].length, results }, null, 2));

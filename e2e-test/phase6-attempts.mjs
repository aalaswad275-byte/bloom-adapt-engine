/**
 * Phase 6 — real examination sessions for one class.
 *
 * Students are started through startAssessment, answer one question at a
 * time through answerAndNext (using the class question key only to choose a
 * correct or incorrect response), and finish with submitAssessment. Scores
 * are therefore graded by the application, not fabricated.
 *
 *   node e2e-test/phase6-attempts.mjs <classIndex>
 */
import { load, mut, q, save, log } from "./lib.mjs";

const classIndex = Number(process.argv[2] ?? 0);
const state = load();
const cls = state.classes[classIndex];
if (!cls) throw new Error(`no class at index ${classIndex}`);
const ids = state.assessments[cls.id];
if (!ids) throw new Error(`assessments missing for ${cls.name}`);

state.attempts = state.attempts ?? {};
state.attempts[cls.id] = state.attempts[cls.id] ?? [];

const keyFor = new Map();
for (const row of state.questions[cls.id]) keyFor.set(row.questionText, row);

const students = state.students.filter((s) => s.classes.includes(cls.id));
if (students.length === 0) throw new Error(`no students in ${cls.name}`);

const rand = (() => {
  let seed = 12345 + classIndex * 97;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
})();

function pCorrect(profile, question, type) {
  const d = question.difficultyLevel;
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
      return type === "static" ? 0.4 : type === "adaptive" ? 0.8 : 0.7;
    case "declining":
      return type === "static" ? 0.85 : 0.5;
    case "inconsistent":
      return 0.2 + rand() * 0.7;
    case "difficulty_sensitive":
      return { easy: 0.95, medium: 0.7, hard: 0.35, expert: 0.15 }[d] ?? 0.5;
    default:
      return 0.6;
  }
}

function wrongAnswer(question) {
  if (question.questionType === "true_false")
    return question.correctAnswer === "True" ? "False" : "True";
  if (question.questionType === "multiple_choice") {
    const options = question.options ?? [];
    const wrong = options.filter((o) => o !== question.correctAnswer);
    return wrong.length > 0 ? wrong[0] : "None of these";
  }
  return "incorrect answer";
}

async function attempt(student, assessmentId, type) {
  const existing = state.attempts[cls.id].find(
    (a) => a.studentId === student.id && a.type === type,
  );
  if (existing) return existing;

  const started = await mut(
    "studentAssessments:startAssessment",
    { assessmentId },
    student.token,
  );
  const submissionId = started.submissionId;
  let earned = 0;
  let total = 0;
  let answered = 0;
  let guard = 0;

  for (;;) {
    if (guard++ > 40) throw new Error(`runaway attempt ${student.email}`);
    const view = await q(
      "studentAssessments:getTakeAssessment",
      { submissionId },
      student.token,
    );
    const current = view.currentQuestion;
    if (!current) break;
    const key = keyFor.get(current.questionText);
    if (!key) throw new Error(`unknown question: ${current.questionText.slice(0, 60)}`);
    const correct = rand() < pCorrect(student.profile, key, type);
    const answer = correct ? key.correctAnswer : wrongAnswer(key);
    const rt = Math.round(
      key.expectedTimeSec * 1000 * (correct ? 0.6 + rand() * 0.6 : 0.35 + rand() * 0.4),
    );
    await mut(
      "studentAssessments:answerAndNext",
      { submissionId, answer, responseTimeMs: rt },
      student.token,
    );
    total += key.marks;
    if (correct) earned += key.marks;
    answered += 1;
  }

  const submitted = await mut(
    "studentAssessments:submitAssessment",
    { submissionId },
    student.token,
  );

  const row = {
    studentId: student.id,
    studentEmail: student.email,
    profile: student.profile,
    type,
    assessmentId,
    submissionId,
    answered,
    expectedEarned: earned,
    expectedTotal: total,
    score: submitted.score ?? null,
    maxScore: submitted.maxScore ?? null,
    percentage: submitted.percent ?? submitted.percentage ?? null,
    grade: submitted.grade ?? null,
    passed: submitted.passed ?? null,
    scoreMatches: submitted.score === earned && submitted.maxScore === total,
  };
  state.attempts[cls.id].push(row);
  save(state);
  return row;
}

const plan = [];
for (const student of students) plan.push({ student, type: "static", id: ids.static });
for (const student of students.slice(0, 1)) plan.push({ student, type: "random", id: ids.random });
for (const student of students.slice(0, 4)) plan.push({ student, type: "adaptive", id: ids.adaptive });
for (const student of students.slice(0, 2)) plan.push({ student, type: "final", id: ids.final });

const results = [];
for (const item of plan) {
  try {
    const row = await attempt(item.student, item.id, item.type);
    results.push({
      type: row.type,
      profile: row.profile,
      answered: row.answered,
      score: `${row.score}/${row.maxScore}`,
      grade: row.grade,
      passed: row.passed,
      scoreMatches: row.scoreMatches,
    });
  } catch (err) {
    results.push({ type: item.type, student: item.student.email, error: String(err.message).slice(0, 250) });
  }
}

log(
  JSON.stringify(
    {
      class: cls.name,
      attempts: results.length,
      mismatches: results.filter((r) => r.scoreMatches === false).length,
      errors: results.filter((r) => r.error).length,
      sample: results,
    },
    null,
    2,
  ),
);

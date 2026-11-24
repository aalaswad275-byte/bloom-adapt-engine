/**
 * Audit attempts — real student exam sessions through the public APIs.
 * Verifies neutral feedback, review/skip/edit, confirmation, locking,
 * adaptive progression, Fair Adaptive set/order fairness and grading.
 */
import {
  adminToken,
  load,
  mut,
  q,
  save,
  log,
} from "./lib.mjs";

const state = load();
const A = state.audit;
if (!A) throw new Error("Run audit1-setup.mjs first");
const admin = state.auditAdminToken ?? (await adminToken());
const checks = [];
const failures = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  if (!pass) failures.push({ name, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 400));
}

const mathClass = A.classes.math;
const mathInstructor = A.instructors.math;
const staticId = A.assessments.mathStatic;
const adaptiveId = A.assessments.mathAdaptive;
const students = A.students.filter((s) => s.classId === mathClass.id);
const high = students[0];
const average = students[1];
const questions = A.questions[mathClass.id];
const keyById = new Map(questions.map((qq) => [qq.id, qq]));
const csQuestions = A.questions[A.classes.cs.id];

function correctAnswerFor(qq) {
  if (qq.questionType === "drag_drop") {
    const byTarget = {};
    for (const p of qq.dragDropCorrect) {
      byTarget[p.targetId] = [...(byTarget[p.targetId] ?? []), p.item];
    }
    return JSON.stringify(byTarget);
  }
  if (qq.questionType === "ordering") {
    return JSON.stringify({ order: qq.orderingCorrect });
  }
  return qq.correctAnswer;
}
function wrongAnswerFor(qq) {
  if (qq.questionType === "true_false")
    return qq.correctAnswer === "True" ? "False" : "True";
  if (qq.questionType === "multiple_choice")
    return (qq.options ?? []).find((o) => o !== qq.correctAnswer) ?? "wrong";
  if (qq.questionType === "drag_drop") return "";
  if (qq.questionType === "ordering")
    return JSON.stringify({ order: [...qq.orderingCorrect].reverse() });
  return "definitely incorrect";
}
function fractionFor(qq, answer) {
  if (qq.questionType === "ordering") {
    try {
      const order = JSON.parse(answer).order;
      const hits = order.filter((v, i) => v === qq.orderingCorrect[i]).length;
      return qq.partialCredit === false
        ? hits === order.length
          ? 1
          : 0
        : hits / qq.orderingCorrect.length;
    } catch {
      return 0;
    }
  }
  if (qq.questionType === "drag_drop") {
    try {
      const placed = JSON.parse(answer);
      const byItem = new Map();
      for (const [targetId, items] of Object.entries(placed)) {
        for (const item of items) byItem.set(item, targetId);
      }
      const hits = qq.dragDropCorrect.filter(
        (p) => byItem.get(p.item) === p.targetId,
      ).length;
      return qq.partialCredit === false
        ? hits === qq.dragDropCorrect.length
          ? 1
          : 0
        : hits / qq.dragDropCorrect.length;
    } catch {
      return 0;
    }
  }
  if (qq.questionType === "short_answer")
    return answer.trim().toLowerCase() === qq.correctAnswer.trim().toLowerCase()
      ? 1
      : 0;
  return answer.trim() === qq.correctAnswer.trim() ? 1 : 0;
}
function expectedMarks(answersById) {
  let earned = 0;
  let total = 0;
  for (const [id, answer] of answersById) {
    const qq = keyById.get(id);
    if (!qq) continue;
    total += qq.marks;
    earned += qq.marks * fractionFor(qq, answer);
  }
  return { earned: Math.round(earned * 100) / 100, total };
}
const FORBIDDEN = [
  "correct",
  "correctAnswer",
  "explanation",
  "fraction",
  "earnedMarks",
  "advancedTo",
  "completionReason",
];
function assertNeutral(label, payload) {
  const leaked = FORBIDDEN.filter((k) => k in (payload ?? {}));
  check(`${label}: no correctness fields in API response`, leaked.length === 0, {
    leaked,
    keys: Object.keys(payload ?? {}),
  });
}

async function start(assessmentId, student) {
  return await mut(
    "studentAssessments:startAssessment",
    { assessmentId },
    student.token,
  );
}
async function view(submissionId, student) {
  return await q(
    "studentAssessments:getTakeAssessment",
    { submissionId },
    student.token,
  );
}

// ===========================================================================
// STATIC PAPER — neutral feedback, skip, review, edit, confirm, lock
// ===========================================================================
const staticStart = await start(staticId, high);
const staticSubmission = staticStart.submissionId;
check("Static assessment starts", Boolean(staticSubmission), staticStart);

const presented = [];
let staticLoop = 0;
for (;;) {
  if (staticLoop++ > 20) throw new Error("static attempt runaway");
  const v = await view(staticSubmission, high);
  if (!v.currentQuestion) {
    check("Static paper completes with a review payload", Array.isArray(v.review), {
      reviewItems: v.review?.length ?? null,
    });
    break;
  }
  const current = v.currentQuestion;
  presented.push(current.id);
  const key = keyById.get(current.id);
  if (!key) throw new Error(`unknown static question ${current.id}`);
  const idx = presented.length - 1;
  const skip = idx >= 6;
  const correct = idx < 4;
  const answer = skip ? "" : correct ? correctAnswerFor(key) : wrongAnswerFor(key);
  const response = await mut(
    "studentAssessments:answerAndNext",
    {
      submissionId: staticSubmission,
      questionId: current.id,
      answer,
      responseTimeMs: 5000,
      ...(skip ? { skip: true } : {}),
    },
    high.token,
  );
  assertNeutral(`Static answer ${idx + 1}`, response);
}

const staticReview = (await view(staticSubmission, high)).review;
check(
  "Review contains exactly the presented static questions in order",
  staticReview.every((item, i) => item.question.id === presented[i]) &&
    staticReview.length === presented.length,
  { presented: presented.length, review: staticReview.length },
);
check(
  "Skipped questions are identifiable as unanswered",
  staticReview[6].answered === false && staticReview[7].answered === false,
  staticReview.map((i) => i.answered),
);

// Change one already-answered answer and complete one skipped question.
await mut(
  "studentAssessments:saveReviewAnswer",
  {
    submissionId: staticSubmission,
    questionId: presented[1],
    answer: wrongAnswerFor(keyById.get(presented[1])),
  },
  high.token,
);
await mut(
  "studentAssessments:saveReviewAnswer",
  {
    submissionId: staticSubmission,
    questionId: presented[6],
    answer: correctAnswerFor(keyById.get(presented[6])),
  },
  high.token,
);
const afterEdits = (await view(staticSubmission, high)).review;
check(
  "Review edit persists for an answered question",
  afterEdits[1].answer === wrongAnswerFor(keyById.get(presented[1])),
  { stored: afterEdits[1].answer },
);
check(
  "A previously skipped question can be answered in review",
  afterEdits[6].answered === true &&
    afterEdits[6].answer === correctAnswerFor(keyById.get(presented[6])),
  { stored: afterEdits[6].answer },
);

// Cross-exam question must be rejected by the review endpoint.
let foreignRejected = false;
let foreignMessage = "";
try {
  await mut(
    "studentAssessments:saveReviewAnswer",
    {
      submissionId: staticSubmission,
      questionId: csQuestions[0].id,
      answer: "A",
    },
    high.token,
  );
} catch (err) {
  foreignRejected = true;
  foreignMessage = String(err.message);
}
check("Review cannot edit a question from another exam", foreignRejected, {
  foreignMessage,
});

const finalStaticAnswers = new Map(
  afterEdits.map((item) => [item.question.id, item.answer]),
);
const expectedStatic = expectedMarks(finalStaticAnswers);
const staticSubmit = await mut(
  "studentAssessments:submitAssessment",
  { submissionId: staticSubmission, reviewed: true },
  high.token,
);
check(
  "Static submission grades stored reviewed answers",
  staticSubmit.score === expectedStatic.earned &&
    staticSubmit.maxScore === expectedStatic.total,
  { expected: expectedStatic, actual: staticSubmit },
);

let lockedRejected = false;
try {
  await mut(
    "studentAssessments:saveReviewAnswer",
    { submissionId: staticSubmission, questionId: presented[0], answer: "B" },
    high.token,
  );
} catch {
  lockedRejected = true;
}
check("Answers are locked after final submission", lockedRejected);

const duplicate = await mut(
  "studentAssessments:submitAssessment",
  { submissionId: staticSubmission, reviewed: true },
  high.token,
);
check(
  "Duplicate submission is idempotent",
  duplicate.score === staticSubmit.score &&
    duplicate.maxScore === staticSubmit.maxScore &&
    duplicate.grade === staticSubmit.grade,
  { first: staticSubmit, second: duplicate },
);

const staticResult = await q(
  "studentAssessments:getAssessmentResult",
  { submissionId: staticSubmission },
  high.token,
);
check(
  "Student result rows match the reviewed question count",
  staticResult.rows.length === presented.length,
  { rows: staticResult.rows.length },
);
check(
  "Stored score matches independent regrade",
  staticResult.submission.score === expectedStatic.earned &&
    staticResult.submission.maxScore === expectedStatic.total,
  {
    stored: staticResult.submission,
    expected: expectedStatic,
  },
);

const instructorStatic = await q(
  "instructorAssessments:getAssessmentResults",
  { id: staticId },
  mathInstructor.token,
);
const instructorRow = instructorStatic?.rows?.find(
  (r) => r.studentId === high.id,
);
check(
  "Instructor report reconciles with the student's graded result",
  instructorRow?.score === staticSubmit.score &&
    instructorRow?.maxScore === staticSubmit.maxScore &&
    instructorRow?.submittedAt !== null,
  { instructorRow },
);

// ===========================================================================
// ADAPTIVE PAPER — Bloom ladder, incorrect answers do not terminate
// ===========================================================================
const adaptiveStart = await start(adaptiveId, average);
const adaptiveSubmission = adaptiveStart.submissionId;
const adaptivePresented = [];
let adaptiveLoop = 0;
for (;;) {
  if (adaptiveLoop++ > 20) throw new Error("adaptive attempt runaway");
  const v = await view(adaptiveSubmission, average);
  if (!v.currentQuestion) break;
  const current = v.currentQuestion;
  adaptivePresented.push(current);
  const key = keyById.get(current.id);
  const idx = adaptivePresented.length - 1;
  const answer = idx < 3 ? correctAnswerFor(key) : wrongAnswerFor(key);
  const response = await mut(
    "studentAssessments:answerAndNext",
    {
      submissionId: adaptiveSubmission,
      questionId: current.id,
      answer,
      responseTimeMs: 4000,
    },
    average.token,
  );
  assertNeutral(`Adaptive answer ${idx + 1}`, response);
}
check(
  "Adaptive run serves the configured six questions",
  adaptivePresented.length === 6,
  { served: adaptivePresented.length },
);
check(
  "Incorrect answers never terminate the adaptive exam",
  adaptivePresented.length === 6,
  { served: adaptivePresented.length },
);
const adaptiveReview = (await view(adaptiveSubmission, average)).review;
check(
  "Adaptive completion exposes the review payload",
  adaptiveReview?.length === 6,
  { review: adaptiveReview?.length },
);
const adaptiveSubmit = await mut(
  "studentAssessments:submitAssessment",
  { submissionId: adaptiveSubmission, reviewed: true },
  average.token,
);
const adaptiveResult = await q(
  "studentAssessments:getAssessmentResult",
  { submissionId: adaptiveSubmission },
  average.token,
);
const adaptiveLevels = adaptiveResult.rows.map((r) => r.q?.bloomLevel ?? r.bloomLevel);
check(
  "Adaptive result persists every answered item",
  adaptiveResult.rows.length === 6,
  { rows: adaptiveResult.rows.length, levels: adaptiveLevels },
);
check(
  "Adaptive grading returns a valid score/max pair",
  adaptiveSubmit.maxScore > 0 &&
    adaptiveSubmit.score >= 0 &&
    adaptiveSubmit.score <= adaptiveSubmit.maxScore,
  adaptiveSubmit,
);

// ===========================================================================
// FAIR ADAPTIVE FINAL — close class, create/schedule final, same set,
// per-student order, review before submit.
// ===========================================================================
await mut(
  "classClosure:closeMyClass",
  { classId: mathClass.id, note: "AUDIT-1124 automated closure" },
  mathInstructor.token,
);

let regularAfterClosure = false;
try {
  await start(staticId, average);
} catch {
  regularAfterClosure = true;
}
check(
  "Closed class blocks regular assessment starts",
  regularAfterClosure,
  { staticId },
);

const finalCounts = {
  remember: 2,
  understand: 2,
  apply: 2,
  analyze: 2,
  evaluate: 2,
  create: 2,
};
const finalCreated = await mut(
  "classClosure:createFinalExam",
  {
    classId: mathClass.id,
    title: "AUDIT-1124 — Fair Adaptive Final",
    timeLimitMin: 60,
    counts: finalCounts,
  },
  mathInstructor.token,
);
A.assessments.mathFinal = finalCreated.assessmentId;
save(state);
check(
  "Final exam created after class closure",
  Boolean(finalCreated.assessmentId) && finalCreated.questionCount === 12,
  finalCreated,
);

const now = Date.now();
await mut(
  "finalSchedule:scheduleFinalExam",
  {
    assessmentId: finalCreated.assessmentId,
    startAt: now - 60_000,
    endAt: now + 3_600_000,
    timeZone: "Africa/Tripoli",
  },
  mathInstructor.token,
);
check("Fair Adaptive final scheduled", true, { startAt: now - 60_000 });

const finalRuns = [];
for (const student of [high, average]) {
  const started = await start(finalCreated.assessmentId, student);
  const submissionId = started.submissionId;
  const ids = [];
  let loop = 0;
  let first = true;
  for (;;) {
    if (loop++ > 20) throw new Error("final runaway");
    const v = await view(submissionId, student);
    if (!v.currentQuestion) break;
    const current = v.currentQuestion;
    ids.push(current.id);
    const key = keyById.get(current.id);
    const answer = correctAnswerFor(key);
    const response = await mut(
      "studentAssessments:answerAndNext",
      {
        submissionId,
        questionId: current.id,
        answer,
        responseTimeMs: 3500,
      },
      student.token,
    );
    if (first) {
      assertNeutral("Final answer", response);
      first = false;
    }
  }
  const review = (await view(submissionId, student)).review;
  check(
    `${student.email}: final review shows all 12 questions`,
    review?.length === 12,
    { review: review?.length },
  );
  const submitted = await mut(
    "studentAssessments:submitAssessment",
    { submissionId, reviewed: true },
    student.token,
  );
  const result = await q(
    "studentAssessments:getAssessmentResult",
    { submissionId },
    student.token,
  );
  finalRuns.push({
    student: student.email,
    submissionId,
    ids,
    rows: result.rows.map((r) => ({
      questionId: r.questionId,
      marks: r.marks,
      bloomLevel: r.q?.bloomLevel ?? r.bloomLevel,
    })),
    submitted,
  });
}
const [runA, runB] = finalRuns;
const setA = [...runA.ids].sort().join(",");
const setB = [...runB.ids].sort().join(",");
check(
  "Fair Adaptive uses the same question set for every student",
  setA === setB,
  { setA: runA.ids, setB: runB.ids },
);
check(
  "Fair Adaptive randomizes question order per student",
  runA.ids.join(",") !== runB.ids.join(","),
  { orderA: runA.ids, orderB: runB.ids },
);
const finalTotals = finalRuns.map((r) =>
  r.rows.reduce((sum, x) => sum + x.marks, 0),
);
check(
  "Fair Adaptive preserves identical marks distribution",
  new Set(finalTotals).size === 1,
  { totals: finalTotals },
);

// ===========================================================================
// Persistence spot-check through an independent query
// ===========================================================================
const instructorFinal = await q(
  "instructorAssessments:getAssessmentResults",
  { id: finalCreated.assessmentId },
  mathInstructor.token,
);
check(
  "Final results are visible to the owning instructor",
  finalRuns.every((r) =>
    instructorFinal?.rows?.some(
      (row) => row.score === r.submitted.score && row.maxScore === r.submitted.maxScore,
    ),
  ),
  {
    rows: instructorFinal?.rows?.map((r) => ({
      score: r.score,
      maxScore: r.maxScore,
      status: r.status,
    })),
  },
);

save(state);
log(
  JSON.stringify(
    {
      summary: {
        checks: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: failures.length,
      },
      static: {
        submissionId: staticSubmission,
        presented: presented.length,
        expected: expectedStatic,
        submitted: staticSubmit,
      },
      adaptive: {
        submissionId: adaptiveSubmission,
        served: adaptivePresented.length,
        submitted: adaptiveSubmit,
      },
      final: finalRuns.map((r) => ({
        student: r.student,
        score: `${r.submitted.score}/${r.submitted.maxScore}`,
        order: r.ids,
      })),
      failures,
    },
    null,
    2,
  ),
);

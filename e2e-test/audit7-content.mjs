import { load, q, mut, act, log, anonymousToken } from "./lib.mjs";

const state = load();
const A = state.audit;
const admin = state.auditAdminToken;
const mathInstructor = A.instructors.math;
const high = A.students.find((s) => s.classId === A.classes.math.id);
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  log(`${pass ? "✓" : "✗"} ${name}`, pass ? "" : JSON.stringify(detail).slice(0, 500));
}
async function capture(name, fn) {
  try {
    const value = await fn();
    return { ok: true, value, name };
  } catch (err) {
    return { ok: false, message: String(err.message), name };
  }
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------
const ai = await capture("generateQuestions", () =>
  act(
    "aiGenerate:generateQuestions",
    {
      classId: A.classes.math.id,
      subject: "Mathematics",
      topic: "Solving one-variable linear equations",
      count: 1,
      bloomLevel: "understand",
      questionType: "multiple_choice",
      difficulty: "easy",
      marks: 1,
      expectedTimeSec: 60,
    },
    mathInstructor.token,
  ),
);
if (ai.ok) {
  const drafts = ai.value?.drafts ?? [];
  check("AI generates at least one draft question", drafts.length >= 1, {
    count: drafts.length,
  });
  check(
    "AI draft is a valid multiple-choice question with an answer",
    drafts.every(
      (d) =>
        d.questionType === "multiple_choice" &&
        Array.isArray(d.options) &&
        d.options.length >= 2 &&
        typeof d.correctAnswer === "string" &&
        d.options.includes(d.correctAnswer),
    ),
    drafts.map((d) => ({
      type: d.questionType,
      options: d.options,
      answer: d.correctAnswer,
    })),
  );
} else {
  log("AI generation unavailable:", ai.message);
  check(
    "AI generation reports a clear configuration/integration error",
    /GEMINI_API_KEY|quota|unavailable|busy|authentication/i.test(ai.message),
    { message: ai.message },
  );
}

// The action has a deliberate cooldown between Gemini calls.
await new Promise((resolve) => setTimeout(resolve, 5_000));
const bulk = await capture("generateBulkQuestions", () =>
  act(
    "aiGenerate:generateBulkQuestions",
    {
      classId: A.classes.math.id,
      subject: "Mathematics",
      topics: ["Linear equations", "Fractions"],
      totalQuestions: 2,
      totalMarks: 2,
      bloomCounts: {
        remember: 1,
        understand: 1,
        apply: 0,
        analyze: 0,
        evaluate: 0,
        create: 0,
      },
      difficultyCounts: { easy: 1, medium: 1, hard: 0, expert: 0 },
      questionType: "multiple_choice",
    },
    mathInstructor.token,
  ),
);
if (bulk.ok) {
  const drafts = bulk.value?.drafts ?? [];
  check("Bulk generation returns the requested number of drafts", drafts.length === 2, {
    count: drafts.length,
  });
  check(
    "Bulk drafts carry the requested Bloom and difficulty targets",
    drafts.filter((d) => d.bloomLevel === "remember").length === 1 &&
      drafts.filter((d) => d.bloomLevel === "understand").length === 1 &&
      drafts.filter((d) => d.difficultyLevel === "easy").length === 1 &&
      drafts.filter((d) => d.difficultyLevel === "medium").length === 1,
    drafts.map((d) => ({ bloom: d.bloomLevel, diff: d.difficultyLevel })),
  );
} else {
  log("Bulk generation unavailable:", bulk.message);
  check(
    "Bulk generation reports a clear configuration/integration error",
    /GEMINI_API_KEY|quota|unavailable|busy|authentication/i.test(bulk.message),
    { message: bulk.message },
  );
}

// ---------------------------------------------------------------------------
// Live final monitoring
// ---------------------------------------------------------------------------
const live = await capture("live dashboard", () =>
  q(
    "finalMonitoring:getFinalExamLiveDashboard",
    { assessmentId: A.assessments.mathFinal },
    mathInstructor.token,
  ),
);
if (live.ok) {
  const rows = live.value?.students ?? [];
  check("Live final dashboard lists the roster", rows.length >= 3, {
    count: rows.length,
  });
  check(
    "Live dashboard reports each final submission's progress",
    rows.every((r) => r.submission && r.submission.questionTotal === 12),
    rows.map((r) => ({
      name: r.name,
      hasSubmission: Boolean(r.submission),
      status: r.submission?.status,
      total: r.submission?.questionTotal,
    })),
  );
  const submitted = rows.find((r) => r.submission?.status === "submitted");
  const submittedStudent = submitted
    ? A.students.find((s) => s.id === submitted.studentId)
    : null;
  if (submitted && submittedStudent) {
    const frame = await capture("frame after submit", () =>
      mut(
        "finalMonitoring:publishAssessmentLiveFrame",
        {
          submissionId: submitted.submission.id,
          frameDataUrl: "data:image/jpeg;base64,AAAA",
          cameraState: "active",
          detectorMode: "face",
          personCount: 1,
          phoneCount: 0,
        },
        submittedStudent.token,
      ),
    );
    check(
      "Completed finals reject new live frames",
      frame.ok && frame.value?.ok === false,
      frame.ok ? frame.value : frame.message,
    );
  }
} else {
  check("Live final monitoring is available to the owning instructor", false, {
    message: live.message,
  });
}

// ---------------------------------------------------------------------------
// Inactive account access
// ---------------------------------------------------------------------------
const suffix = Date.now();
const studentEmail = `audit.1124.suspended.${suffix}@example.test`;
const studentId = await mut(
  "adminPeople:createStudent",
  { name: "AUDIT-1124 Suspended", email: studentEmail },
  admin,
);
const studentToken = await anonymousToken();
await mut("studentAssessments:claimStudent", { email: studentEmail }, studentToken);
await mut(
  "adminPeople:setStudentStatus",
  { id: studentId, status: "inactive" },
  admin,
);
const suspendedStudent = await capture("suspended student access", () =>
  q("studentAssessments:getStudentViewer", {}, studentToken),
);
check(
  "Deactivated students lose student access",
  !suspendedStudent.ok,
  suspendedStudent.ok ? suspendedStudent.value : suspendedStudent.message,
);
await mut("adminPeople:setStudentStatus", { id: studentId, status: "active" }, admin);

const instructorEmail = `audit.1124.suspended.instructor.${suffix}@example.test`;
const instructorId = await mut(
  "adminPeople:createInstructor",
  { name: "AUDIT-1124 Suspended Instructor", email: instructorEmail },
  admin,
);
const instructorToken = await anonymousToken();
await mut(
  "instructorPortal:claimInstructor",
  { email: instructorEmail },
  instructorToken,
);
await mut(
  "adminPeople:setInstructorStatus",
  { id: instructorId, status: "inactive" },
  admin,
);
const suspendedInstructor = await capture("suspended instructor access", () =>
  q("instructorPortal:getInstructorDashboard", {}, instructorToken),
);
check(
  "Deactivated instructors lose instructor access",
  !suspendedInstructor.ok,
  suspendedInstructor.ok ? suspendedInstructor.value : suspendedInstructor.message,
);
await mut(
  "adminPeople:setInstructorStatus",
  { id: instructorId, status: "active" },
  admin,
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

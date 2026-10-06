/**
 * Student assessment access — a signed-in user claims one student record by
 * matching email, joins classes they were invited to by email (creating an
 * enrollment record), takes published assessments from joined classes, and
 * reviews graded results.
 *
 * Security: taking/submitting is restricted to enrolled students (a
 * classEnrollments row must link the student to the assessment's class), and
 * every write re-checks ownership server-side.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { audit, currentUserOf } from "./adminLib";
import {
  ASSESSMENT_BLOOM_MIN,
  ASSESSMENT_POOL_MIN,
  ASSESSMENT_GAMMA,
  ASSESSMENT_DELTA,
  DEFAULT_B_BY_LEVEL,
  NEUTRAL_T,
  gradeOne,
  irtContextFor,
  itemParams,
  ladderCompletionReason,
  presentedCounts,
  recomputeProfile,
  selectNextLadder,
  strainFor,
  toStoredProfile,
  type AnsweredRecord,
  type LadderCompletionReason,
  zeroLevels,
} from "./assessmentAdaptive";
import {
  advanceLadder,
  computeBloomPerformance,
  createLadderState,
  DEFAULT_PASS_THRESHOLD,
  gradeFromPercent,
  percentFromMarks,
  REQUIRED_CREATE_QUESTIONS,
  weakestBloomAreas,
  type LadderState,
} from "../lib/adaptiveLadder";
import { BLOOM_LEVELS, estimateThetaMap, type BloomLevel, type IRTContext } from "../lib/irt";
import {
  ASSESSMENT_PROCTOR_CONFIG,
  type MonitoringConfig,
  type PolicyAction,
  type Severity,
  type ViolationType,
  policyForCount,
  violationSeverity,
} from "../lib/monitoring";

type StudentDoc = Doc<"students">;
type AssessmentDoc = Doc<"instructorAssessments">;
type QuestionDoc = Doc<"instructorQuestions">;
type SubmissionDoc = Doc<"assessmentSubmissions">;

const RANK: Record<PolicyAction, number> = {
  NONE: 0,
  WARNING: 1,
  PAUSE_EXAM: 2,
  TERMINATE_EXAM: 3,
};

/**
 * Proctoring policy for class assessments — one strike warns, two pause,
 * three terminate. Window blur only counts after 10 sustained minutes
 * (ASSESSMENT_PROCTOR_CONFIG); momentary alt-tabs never punish students.
 */
const PROCTOR_CONFIG: MonitoringConfig = ASSESSMENT_PROCTOR_CONFIG;

/** Resolve the student record claimed by the signed-in user (or null). */
export async function myStudentRecord(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<StudentDoc | null> {
  const all = await ctx.db.query("students").collect();
  return all.find((r) => r.userId === userId) ?? null;
}

/** True when an enrollment record links this student to this class. */
async function isEnrolled(
  ctx: QueryCtx,
  classId: Id<"classes">,
  studentId: Id<"students">,
): Promise<boolean> {
  const e = await ctx.db
    .query("classEnrollments")
    .withIndex("by_class_student", (x) =>
      x.eq("classId", classId).eq("studentId", studentId),
    )
    .first();
  return e !== null;
}

// ---------------------------------------------------------------------------
// Claim + class page
// ---------------------------------------------------------------------------

export const getStudentViewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user) return null;
    const claimed = user.role === "student";
    let student: {
      id: string;
      name: string;
      hasIdentityImage: boolean;
      identityImageUrl: string | null;
      faceRegistered: boolean;
    } | null = null;
    if (claimed) {
      const me = await myStudentRecord(ctx, user._id);
      student = me
        ? {
            id: me._id,
            name: me.name,
            hasIdentityImage: me.identityImageId !== undefined,
            identityImageUrl: me.identityImageId
              ? await ctx.storage.getUrl(me.identityImageId)
              : null,
            faceRegistered: me.faceRegisteredAt !== undefined,
          }
        : null;
    }
    return {
      role: user.role ?? null,
      email: user.email ?? null,
      claimed,
      student,
    };
  },
});

/** The signed-in student's profile: details + identity image for /profile. */
export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");
    const enrollments = await ctx.db
      .query("classEnrollments")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    const faceRows = await ctx.db
      .query("faceRegistrations")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    const institution = me.institutionId
      ? await ctx.db.get(me.institutionId)
      : null;
    const center = me.teachingCenterId
      ? await ctx.db.get(me.teachingCenterId)
      : null;
    return {
      name: me.name,
      email: user.email ?? me.email ?? null,
      phone: me.phone ?? null,
      studentIdNumber: me.studentIdNumber ?? null,
      institutionName: institution?.name ?? null,
      teachingCenterName: center?.name ?? null,
      memberSince: me.enrolledAt,
      identityImageUrl: me.identityImageId
        ? await ctx.storage.getUrl(me.identityImageId)
        : null,
      identityImageAt: me.identityImageAt ?? null,
      classesJoined: enrollments.length,
      faceRegisteredAt: me.faceRegisteredAt ?? null,
      faceImageCount: faceRows.length,
      lastFaceCheckAt: me.lastFaceCheckAt ?? null,
      lastFaceCheckStatus: me.lastFaceCheckStatus ?? null,
    };
  },
});

/** Edit the signed-in student's profile details (name and phone). */
export const updateStudentProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    studentIdNumber: v.optional(v.string()),
  },
  handler: async (ctx, { name, phone, studentIdNumber }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const patch: {
      name?: string;
      phone?: string;
      studentIdNumber?: string;
    } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name cannot be empty");
      patch.name = trimmed;
    }
    if (phone !== undefined && phone.trim()) {
      patch.phone = phone.trim();
    }
    if (studentIdNumber !== undefined && studentIdNumber.trim()) {
      patch.studentIdNumber = studentIdNumber.trim();
    }
    if (Object.keys(patch).length === 0)
      throw new Error("Nothing to update");
    await ctx.db.patch(me._id, patch);
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "student_profile_updated",
      entity: "students",
      entityId: me._id,
      newValue: patch,
    });
    return { ok: true as const };
  },
});

/**
 * Link the signed-in user to a student record and grant the "student" role.
 * Matches an unclaimed roster row by email (user email or provided email).
 */
export const claimStudent = mutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const me = await ctx.db.get(userId);
    if (!me) throw new Error("User missing");
    if (me.role === "admin")
      throw new Error("Admins manage students from the admin console.");
    if (me.role === "student") return { role: "student" as const };

    const mail = (email ?? me.email ?? "").toLowerCase();
    const students = await ctx.db.query("students").collect();
    const target = students.find(
      (s) =>
        s.userId === undefined &&
        s.email !== undefined &&
        (s.email ?? "").toLowerCase() === mail &&
        mail !== "",
    );
    if (!target)
      throw new Error(
        "No student record matches your email — ask your instructor to add you with this email.",
      );

    await ctx.db.patch(target._id, { userId });
    await ctx.db.patch(userId, { role: "student" });
    await audit(ctx, { _id: userId, email: me.email }, {
      action: "student.claimed",
      entity: "students",
      entityId: target._id,
      newValue: { userId, role: "student" },
    });
    return { role: "student" as const, studentId: target._id };
  },
});

// ---------------------------------------------------------------------------
// Identity image (required before joining a class or taking an assessment)
// ---------------------------------------------------------------------------

/**
 * Short-lived upload URL for the student's identity image. The client PUTs
 * the file there, then calls saveIdentityImage with the returned storage id.
 */
export const generateIdentityUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Link an uploaded storage file to the student's record as their identity
 * image. Replaces (and deletes) any previous image. Callable repeatedly,
 * e.g. when the first capture looks bad.
 */
export const saveIdentityImage = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    // Make sure the file actually exists in storage before linking it.
    const meta = await ctx.storage.getMetadata(storageId);
    if (!meta) throw new Error("Uploaded image not found");

    const previous = me.identityImageId;
    await ctx.db.patch(me._id, {
      identityImageId: storageId,
      identityImageAt: Date.now(),
    });
    if (previous && previous !== storageId) {
      await ctx.storage.delete(previous);
    }
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "student.identity_image_saved",
      entity: "students",
      entityId: me._id,
      newValue: { storageId },
    });
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// Email-based class joining (no class codes)
// ---------------------------------------------------------------------------

/**
 * Classes whose roster contains a student row with the signed-in user's
 * user has not joined yet. All active classes are open for joining — no
 * class codes and no roster-email requirement. The class instructor info is
 * included so the UI can show what they are joining.
 */
export const getJoinableClasses = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student") return [];
    const me = await myStudentRecord(ctx, user._id);
    if (!me) return [];

    const myEnrollments = await ctx.db
      .query("classEnrollments")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    const joinedIds = new Set(myEnrollments.map((e) => e.classId));

    const allClasses = await ctx.db.query("classes").collect();
    const out = [] as Array<{
      id: Id<"classes">;
      name: string;
      description: string | null;
      instructorName: string | null;
    }>;
    for (const cls of allClasses) {
      if (joinedIds.has(cls._id)) continue; // already joined
      if (cls.status !== "active") continue;
      const instructor = await ctx.db.get(cls.instructorId);
      out.push({
        id: cls._id,
        name: cls.name,
        description: cls.description ?? null,
        instructorName: instructor?.name ?? null,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },
});

/**
 * Join any active class by creating an enrollment record — no class codes,
 * no roster requirement. The student's identity image must already be on
 * file. Duplicate enrollment is prevented by an existing-record check.
 */
export const joinClass = mutation({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");
    if (me.identityImageId === undefined)
      throw new Error(
        "Add your identity image before joining a class.",
      );

    const cls = await ctx.db.get(classId);
    if (!cls) throw new Error("Class not found");
    if (cls.status !== "active")
      throw new Error("This class is not open for joining");

    if (await isEnrolled(ctx, classId, me._id))
      return { joined: true as const, duplicate: true as const };

    await ctx.db.insert("classEnrollments", {
      classId,
      studentId: me._id,
      joinedAt: Date.now(),
    });
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "class.joined",
      entity: "classEnrollments",
      entityId: classId,
      newValue: { classId, studentId: me._id },
    });
    return { joined: true as const, duplicate: false as const };
  },
});

/**
 * The claimed student's enrolled classes with their published assessments.
 * Only classes joined via an enrollment record appear here — being invited
 * (roster email) alone is not enough; those show up in getJoinableClasses
 * until the student clicks "Join Class".
 */
export const getMyClass = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const mySubs = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    const subByAssessment = new Map(
      mySubs.map((s) => [s.assessmentId, s] as const),
    );

    const enrollments = await ctx.db
      .query("classEnrollments")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    enrollments.sort((a, b) => a.joinedAt - b.joinedAt);

    const classes = [] as Array<{
      id: Id<"classes">;
      name: string;
      description: string | null;
      instructorName: string | null;
      joinedAt: number;
      assessments: Array<{
        id: Id<"instructorAssessments">;
        title: string;
        description: string | null;
        timeLimitMin: number;
        questionCount: number;
        totalMarks: number;
        displayCount: number | null;
        poolSize: number | null;
        submissionId: Id<"assessmentSubmissions"> | null;
        submissionStatus: string | null;
        score: number | null;
        maxScore: number | null;
        percentage: number | null;
        submittedAt: number | null;
      }>;
    }>;
    for (const e of enrollments) {
      const cls = await ctx.db.get(e.classId);
      if (!cls) continue;
      const instructor = await ctx.db.get(cls.instructorId);
      const all = await ctx.db
        .query("instructorAssessments")
        .withIndex("by_class", (x) => x.eq("classId", cls._id))
        .collect();
      const published = all
        .filter((a) => a.status === "published")
        .sort((x, y) => y.createdAt - x.createdAt);

      const assessments = [] as NonNullable<
        (typeof classes)[number]["assessments"]
      >;
      for (const a of published) {
        const links = await ctx.db
          .query("assessmentQuestions")
          .withIndex("by_assessment", (x) => x.eq("assessmentId", a._id))
          .collect();
        let questionCount = 0;
        let totalMarks = 0;
        for (const l of links) {
          const q = await ctx.db.get(l.questionId);
          if (q) {
            questionCount += 1;
            totalMarks += q.marks;
          }
        }
        const sub = subByAssessment.get(a._id);
        const pct =
          sub && sub.score !== undefined && (sub.maxScore ?? 0) > 0
            ? ((sub.score ?? 0) / (sub.maxScore ?? 1)) * 100
            : null;
        assessments.push({
          id: a._id,
          title: a.title,
          description: a.description ?? null,
          timeLimitMin: a.timeLimitMin,
          questionCount,
          totalMarks,
          displayCount: a.displayCount ?? null,
          poolSize: a.poolSize ?? null,
          submissionId: sub?._id ?? null,
          submissionStatus: sub?.status ?? null,
          score: sub?.score ?? null,
          maxScore: sub?.maxScore ?? null,
          percentage: pct === null ? null : Math.round(pct * 10) / 10,
          submittedAt: sub?.submittedAt ?? null,
        });
      }
      classes.push({
        id: cls._id,
        name: cls.name,
        description: cls.description ?? null,
        instructorName: instructor?.name ?? null,
        joinedAt: e.joinedAt,
        assessments,
      });
    }

    return {
      student: { id: me._id, name: me.name },
      email: user.email ?? null,
      classes,
    };
  },
});

// ---------------------------------------------------------------------------
// Taking an assessment
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Adaptive engine — AI Adaptive Assessment Model
// ---------------------------------------------------------------------------

/** Shape of one delivered question — answers are never included. */
interface PublicAdaptiveQuestion {
  id: Id<"instructorQuestions">;
  questionText: string;
  questionType: QuestionDoc["questionType"];
  options: string[] | null;
  marks: number;
  bloomLevel: BloomLevel;
  expectedTimeSec: number;
}

function publicQuestionOf(q: QuestionDoc): PublicAdaptiveQuestion {
  return {
    id: q._id,
    questionText: q.questionText,
    questionType: q.questionType,
    options: q.options ?? null,
    marks: q.marks,
    bloomLevel: q.bloomLevel,
    expectedTimeSec: q.expectedTimeSec,
  };
}

/** Assessment-side adaptive context shared by take/answer endpoints. */
interface AdaptiveCtx {
  pool: QuestionDoc[];
  qById: Map<Id<"instructorQuestions">, QuestionDoc>;
  /** Link order — fallback for legacy linear submissions. */
  linkOrder: Id<"instructorQuestions">[];
  assessment: AssessmentDoc;
  /** Questions each student will actually answer. */
  displayCount: number;
}

async function loadAdaptiveCtx(
  ctx: QueryCtx,
  assessmentId: Id<"instructorAssessments">,
): Promise<AdaptiveCtx> {
  const assessment = (await ctx.db.get(assessmentId)) as AssessmentDoc | null;
  if (!assessment) throw new Error("Assessment not found");
  const links = await ctx.db
    .query("assessmentQuestions")
    .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
    .collect();
  links.sort((x, y) => x.order - y.order);
  const pool: QuestionDoc[] = [];
  const linkOrder: Id<"instructorQuestions">[] = [];
  for (const l of links) {
    const q = (await ctx.db.get(l.questionId)) as QuestionDoc | null;
    if (q) {
      pool.push(q);
      linkOrder.push(q._id);
    }
  }
  const qById = new Map(pool.map((q) => [q._id, q] as const));
  const displayCount = Math.max(
    1,
    Math.min(assessment.displayCount ?? pool.length, pool.length),
  );
  return { pool, qById, linkOrder, assessment, displayCount };
}

/** Rebuild the adaptive state from persisted submission data. */
function resolveAdaptiveState(
  sub: SubmissionDoc,
  pool: AdaptiveCtx,
): {
  sequence: Id<"instructorQuestions">[];
  answers: string[];
  responseTimesMs: number[];
  validityFactors: number[];
  theta: Record<BloomLevel, number>;
  presentedByLevel: Record<BloomLevel, number>;
  /** Bloom-ladder state (3 consecutive correct → next level). */
  ladder: LadderState;
  /** Required Create questions for the Create completion rule. */
  createRequired: number;
} {
  const sequence = sub.questionSequence ?? [];
  const answers = sub.answers ?? [];
  const responseTimesMs = sub.responseTimesMs ?? [];
  const validityFactors = sub.validityFactors ?? [];
  const theta = recomputeProfile(
    sequence,
    answers,
    responseTimesMs,
    validityFactors,
    pool.qById,
  );

  // Persisted ladder state. Submissions that predate the ladder engine
  // derive an equivalent state from their stored sequence so a resumed run
  // stays coherent: resume at the last answered question's level with the
  // trailing consecutive-correct streak (capped just below the bound so the
  // next correct answer performs the promotion).
  let ladder: LadderState;
  if (sub.ladderLevel !== undefined) {
    ladder = {
      level: sub.ladderLevel,
      consecutiveCorrect: sub.ladderStreak ?? 0,
      createAnswered: sub.createAnswered ?? 0,
      createCorrect: sub.createCorrect ?? 0,
    };
  } else if (answers.length > 0) {
    const lastIdx = Math.min(answers.length, sequence.length) - 1;
    const lastQ = lastIdx >= 0 ? pool.qById.get(sequence[lastIdx]) : undefined;
    let streak = 0;
    for (let i = lastIdx; i >= 0 && streak < 3; i--) {
      const q = pool.qById.get(sequence[i]);
      if (!q || q.bloomLevel !== lastQ?.bloomLevel) break;
      if (!gradeOne(q, answers[i] ?? "")) break;
      streak += 1;
    }
    ladder = {
      ...createLadderState(lastQ?.bloomLevel ?? "remember"),
      consecutiveCorrect: Math.min(streak, 2),
    };
  } else {
    ladder = createLadderState();
  }

  const createRequired =
    sub.createRequired ??
    Math.min(
      REQUIRED_CREATE_QUESTIONS,
      pool.pool.filter((q) => q.bloomLevel === "create").length,
    );

  return {
    sequence,
    answers,
    responseTimesMs,
    validityFactors,
    theta,
    presentedByLevel: presentedCounts(sequence, pool.qById),
    ladder,
    createRequired,
  };
}

/** The question awaiting an answer (sequence, or legacy link order). */
function pendingQuestionId(
  state: ReturnType<typeof resolveAdaptiveState>,
  pool: AdaptiveCtx,
): Id<"instructorQuestions"> | null {
  const idx = state.answers.length;
  if (state.sequence.length > 0) return state.sequence[idx] ?? null;
  return pool.linkOrder[idx] ?? null;
}

/**
 * Adaptive answer submission — the per-step pipeline of the existing model:
 *   grade → record correctness + response time → T → V (proctoring) →
 *   MAP θ update for the item's Bloom level → behavioral direction →
 *   evaluate remaining candidates → serve the next question → persist the
 *   fixed presented sequence. Questions are never reused.
 */
export const answerAndNext = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    answer: v.string(),
    /** Wall-clock ms between the question being shown and answered. */
    responseTimeMs: v.number(),
  },
  handler: async (ctx, { submissionId, answer, responseTimeMs }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sub = (await ctx.db.get(submissionId)) as SubmissionDoc | null;
    if (!sub || sub.studentId !== me._id)
      throw new Error("Submission not found");
    if (sub.status !== "in_progress")
      throw new Error("This submission was already submitted");

    const pool = await loadAdaptiveCtx(ctx, sub.assessmentId);
    const a = pool.assessment;
    if (a.status !== "published")
      throw new Error("This assessment is no longer open");
    if (!(await isEnrolled(ctx, sub.classId, me._id)))
      throw new Error(
        "You must join this class before taking the assessment.",
      );

    const state = resolveAdaptiveState(sub, pool);
    if (state.answers.length >= pool.displayCount)
      throw new Error("All displayed questions have been answered");
    const currentId = pendingQuestionId(state, pool);
    if (!currentId) throw new Error("No question is currently served");
    const current = pool.qById.get(currentId);
    if (!current) throw new Error("The served question no longer exists");

    const now = Date.now();
    const rtMs = Math.max(0, Math.min(responseTimeMs, 6 * 60 * 60 * 1000));
    const correct = gradeOne(current, answer);

    // T = (RT − E)/(E + ε) — signed, clipped (src/lib/irt/timeStrain).
    const { T } = strainFor(rtMs, current.expectedTimeSec);
    // V reflects the live silent-proctoring risk on this submission.
    const irt = irtContextFor(a, sub, T);

    // The presented question joins the FIXED sequence; a legacy linear
    // submission adopts its current link-order question as its first step.
    const baseSequence =
      state.sequence.length > 0 ? state.sequence : [currentId];
    const answers = [...state.answers, answer];
    const responseTimesMs = [...state.responseTimesMs, rtMs];
    const validityFactors = [...state.validityFactors, irt.V];

    // θ update: MAP over each Bloom level's own answer history (other five
    // levels untouched) — src/lib/irt/ability.updateProfile semantics.
    const theta = recomputeProfile(
      baseSequence,
      answers,
      responseTimesMs,
      validityFactors,
      pool.qById,
    );

    // Bloom-ladder progression: correctness only. The streak grows on a
    // correct answer and resets on an incorrect one, regardless of whether
    // the response was fast, normal, or slow; 3 consecutive correct answers
    // advance the ladder to the next Bloom level. (T still feeds θ, SE, P,
    // item information and selection below — it never affects marks.)
    const step = advanceLadder(state.ladder, correct);
    let ladder = step.state;

    // Stop serving once the run is complete: the display quota is filled,
    // or the Create rule fires (required Create questions completed — all
    // correct → create_mastered → Passed – Grade A at submit; otherwise
    // create_exhausted → fair computed grade).
    let nextId: Id<"instructorQuestions"> | null = null;
    let completionReason: LadderCompletionReason | null = ladderCompletionReason({
      answersCount: answers.length,
      displayCount: pool.displayCount,
      ladder,
      createRequired: state.createRequired,
    });
    if (completionReason === null) {
      // Exhaustion rule: when the current level has no unanswered questions,
      // selection advances the ladder automatically — the run never gets
      // stuck waiting for questions that do not exist.
      const selection = selectNextLadder({
        pool: pool.pool,
        answeredIds: new Set(baseSequence),
        ladder,
        theta,
        irtContext: irt,
      });
      if (selection.next) {
        ladder = selection.ladder; // may have advanced on exhaustion
        nextId = selection.next._id;
      } else {
        completionReason = "pool_exhausted";
      }
    }
    const newSequence = nextId ? [...baseSequence, nextId] : baseSequence;

    await ctx.db.patch(submissionId, {
      answers,
      responseTimesMs,
      validityFactors,
      thetaProfile: toStoredProfile(theta),
      questionSequence: newSequence,
      currentQuestionIndex: answers.length - 1,
      ladderLevel: ladder.level,
      ladderStreak: ladder.consecutiveCorrect,
      createAnswered: ladder.createAnswered,
      createCorrect: ladder.createCorrect,
      completionReason: completionReason ?? undefined,
      currentItemShownAt: nextId ? now : undefined,
    });

    const nextQ = nextId ? pool.qById.get(nextId) : undefined;
    return {
      correct,
      correctAnswer: current.correctAnswer,
      explanation: current.explanation ?? null,
      displayed: answers.length,
      displayCount: pool.displayCount,
      complete: nextId === null,
      completionReason,
      /** Bloom level advanced to this step (streak or exhaustion), if any. */
      advancedTo:
        nextQ && nextQ.bloomLevel !== current.bloomLevel
          ? nextQ.bloomLevel
          : null,
      nextQuestion: nextQ ? publicQuestionOf(nextQ) : null,
    };
  },
});

/**
 * Proctoring ingestion for class assessments — SILENT mode.
 *
 * Violations are recorded on the submission (log + counter + severity-scaled
 * risk score) for the instructor to review; the student never sees warnings,
 * pauses, or terminations. The policy ladder is still computed and stored as
 * `policyAction` so the report can flag serious cases, but it does NOT pause
 * or force-submit the assessment.
 */
export const ingestAssessmentViolations = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    events: v.array(
      v.object({
        type: v.string(),
        confidence: v.number(),
        durationMs: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { submissionId, events }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sub = await ctx.db.get(submissionId);
    if (!sub || sub.studentId !== me._id)
      throw new Error("Submission not found");
    if (sub.status !== "in_progress")
      return { ok: true as const, violationCount: sub.violationCount ?? 0, policyAction: sub.policyAction ?? "NONE", terminated: false };

    const timestamp = Date.now();
    const log = [...(sub.violationLog ?? [])];
    let count = sub.violationCount ?? 0;
    let applied = (sub.policyAction as PolicyAction | undefined) ?? "NONE";

    for (const ev of events) {
      const type = ev.type as ViolationType;
      let severity: Severity;
      try {
        severity = violationSeverity(type);
      } catch {
        continue; // unknown type — ignore (forward compatibility)
      }
      if (severity === "LOW") continue; // LOW severities never count
      // Blur rule: WINDOW_BLUR only counts when it persisted ≥10 minutes
      // (the client engine already debounces; this re-validates server-side).
      if (
        type === "WINDOW_BLUR" &&
        (ev.durationMs === undefined ||
          ev.durationMs < PROCTOR_CONFIG.thresholds.WINDOW_BLUR)
      )
        continue;
      log.push({
        type,
        at: timestamp,
        confidence: ev.confidence,
        durationMs: ev.durationMs,
      });
      count += 1;
      const action = policyForCount(count, PROCTOR_CONFIG);
      if (RANK[action] > RANK[applied]) applied = action;
    }

    // Silent mode: record everything, never interrupt the student.
    await ctx.db.patch(submissionId, {
      violationCount: count,
      violationLog: log,
      policyAction: applied,
      riskScore: Math.min(0.99, 1 - Math.exp(-count / 3)),
    });
    return {
      ok: true as const,
      violationCount: count,
      policyAction: applied,
      terminated: false,
    };
  },
});

/**
 * Open (or resume) a submission for a published assessment. Only students
 * enrolled in the assessment's class may take it: an enrollment record must
 * link the student to the assessment's class. Returns questions without
 * correct answers.
 */
export const startAssessment = mutation({
  args: { assessmentId: v.id("instructorAssessments") },
  handler: async (ctx, { assessmentId }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const a = await ctx.db.get(assessmentId);
    if (!a) throw new Error("Assessment not found");
    // Check order: logged in (above) → identity image → enrollment →
    // assessment open and belonging to the student's class.
    if (me.identityImageId === undefined)
      throw new Error(
        "Add your identity image before starting the assessment.",
      );
    // Server-side enforcement: assessments cannot start until all 7 face
    // poses are registered (client gates are convenience only).
    if (me.faceRegisteredAt === undefined)
      throw new Error(
        "Complete face registration before starting the assessment.",
      );
    if (!(await isEnrolled(ctx, a.classId, me._id)))
      throw new Error(
        "You must join this class before taking the assessment.",
      );
    if (a.status !== "published")
      throw new Error("This assessment is not open");

    const existing = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
      .collect();
    const mine = existing.find((s) => s.studentId === me._id);
    if (mine && mine.status !== "in_progress")
      throw new Error("You have already submitted this assessment");
    if (mine) return { submissionId: mine._id, resumed: true };

    const pool = await loadAdaptiveCtx(ctx, assessmentId);
    if (pool.pool.length === 0)
      throw new Error("This assessment has no questions yet");

    // Adaptive initial selection: with θ₀ = 0 for every level the selector
    // scores every pool candidate under P = 1/(1+exp(-a(θ-b-γT-δV))) with
    // neutral T/V and picks the question whose difficulty best fits the
    // student's initial ability estimate. The Bloom ladder starts at
    // Remember — progression follows the 3-consecutive-correct rule. The
    // chosen question opens the FIXED presented sequence (never re-served,
    // stable across resumes).
    const initialTheta: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    const irt = irtContextFor(pool.assessment, { riskScore: undefined }, NEUTRAL_T);
    const selection = selectNextLadder({
      pool: pool.pool,
      answeredIds: new Set<Id<"instructorQuestions">>(),
      ladder: createLadderState(),
      theta: initialTheta,
      irtContext: irt,
    });
    if (!selection.next)
      throw new Error(
        "Adaptive selection failed — check the assessment's question pool.",
      );
    const createRequired = Math.min(
      REQUIRED_CREATE_QUESTIONS,
      pool.pool.filter((q) => q.bloomLevel === "create").length,
    );

    const id = await ctx.db.insert("assessmentSubmissions", {
      assessmentId,
      classId: a.classId,
      studentId: me._id,
      status: "in_progress",
      startedAt: Date.now(),
      questionSequence: [selection.next._id],
      thetaProfile: initialTheta,
      answers: [],
      responseTimesMs: [],
      validityFactors: [],
      ladderLevel: "remember",
      ladderStreak: 0,
      createAnswered: 0,
      createCorrect: 0,
      createRequired,
      currentItemShownAt: Date.now(),
    });
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "assessment_started",
      entity: "assessmentSubmissions",
      entityId: id,
      newValue: { assessmentId, studentId: me._id, firstQuestion: selection.next._id },
    });
    return { submissionId: id, resumed: false };
  },
});

/**
 * Start the exam clock once identity verification completes. Idempotent:
 * the timestamp is stamped exactly once, so a resumed session keeps the
 * original deadline instead of gaining extra time.
 */
export const startExamTimer = mutation({
  args: { submissionId: v.id("assessmentSubmissions") },
  handler: async (ctx, { submissionId }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sub = await ctx.db.get(submissionId);
    if (!sub || sub.studentId !== me._id)
      throw new Error("Submission not found");
    if (sub.status !== "in_progress")
      return { timerStartedAt: sub.timerStartedAt ?? sub.startedAt };
    if (sub.timerStartedAt === undefined) {
      const now = Date.now();
      await ctx.db.patch(submissionId, { timerStartedAt: now });
      return { timerStartedAt: now };
    }
    return { timerStartedAt: sub.timerStartedAt };
  },
});

/**
 * The in-progress submission state for the adaptive take page: only the
 * CURRENT question is delivered (server-driven, one at a time) — the rest of
 * the pool and all correct answers stay server-side.
 */
export const getTakeAssessment = query({
  args: { submissionId: v.id("assessmentSubmissions") },
  handler: async (ctx, { submissionId }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sub = await ctx.db.get(submissionId);
    if (!sub || sub.studentId !== me._id)
      throw new Error("Submission not found");
    if (sub.status !== "in_progress")
      throw new Error("This submission was already submitted");

    const pool = await loadAdaptiveCtx(ctx, sub.assessmentId);
    const state = resolveAdaptiveState(sub, pool);
    const currentId = pendingQuestionId(state, pool);
    const current = currentId ? pool.qById.get(currentId) : undefined;

    return {
      submission: {
        id: sub._id,
        startedAt: sub.startedAt,
        timerStartedAt: sub.timerStartedAt ?? null,
        displayed: state.answers.length,
        violationCount: sub.violationCount ?? 0,
        policyAction: sub.policyAction ?? "NONE",
        terminatedByPolicy: sub.terminatedByPolicy ?? false,
      },
      assessment: {
        id: pool.assessment._id,
        title: pool.assessment.title,
        description: pool.assessment.description ?? null,
        timeLimitMin: pool.assessment.timeLimitMin,
        adaptive: true,
        displayCount: pool.displayCount,
        poolSize: pool.pool.length,
      },
      /** The question awaiting an answer; null = quota reached, ready to submit. */
      currentQuestion: current ? publicQuestionOf(current) : null,
      /** When the current question was delivered (drives response timing). */
      currentShownAt: sub.currentItemShownAt ?? sub.startedAt,
      /** Bloom coverage achieved so far (student-facing progress). */
      bloomShown: state.presentedByLevel,
      /** Bloom-ladder level currently being served. */
      ladderLevel: state.ladder.level,
      /** Set once the run stopped serving questions (early completion). */
      completionReason: sub.completionReason ?? null,
    };
  },
});

/**
 * Submit for auto-grading. Objective types (MC/TF) are graded exactly;
 * short answers are graded case/whitespace-insensitively. Score is stored
 * as earned/total marks.
 */
export const submitAssessment = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    /**
     * Legacy fallback only — adaptive submissions record every answer
     * server-side via answerAndNext, so grading uses the STORED answers.
     */
    answers: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { submissionId, answers }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sub = await ctx.db.get(submissionId);
    if (!sub || sub.studentId !== me._id)
      throw new Error("Submission not found");
    if (sub.status !== "in_progress")
      throw new Error("This submission was already submitted");

    const a = await ctx.db.get(sub.assessmentId);
    if (!a) throw new Error("Assessment not found");
    if (a.status !== "published")
      throw new Error("This assessment is no longer open");
    // Defense-in-depth: enrollment must still exist at submit time.
    if (!(await isEnrolled(ctx, sub.classId, me._id)))
      throw new Error(
        "You must join this class before taking the assessment.",
      );

    const pool = await loadAdaptiveCtx(ctx, sub.assessmentId);
    // Grade over the STORED presented sequence: adaptive submissions answer
    // only displayCount questions chosen by the model, so sequence position
    // i ↔ answers[i]; legacy linear submissions fall back to link order.
    const state = resolveAdaptiveState(sub, pool);
    const sequence =
      state.sequence.length > 0 ? state.sequence : pool.linkOrder;

    // Answers are recorded per step by answerAndNext — grade from the
    // STORED answers. The argument is only a fallback for legacy linear
    // submissions that never wrote per-step answers, and must never
    // overwrite the stored record (an empty arg would zero the score).
    const storedAnswers = state.answers;
    const finalAnswers =
      storedAnswers.length > 0 ? storedAnswers : (answers ?? []);

    let earned = 0;
    let total = 0;
    const perQuestion: Array<{ questionId: string; earned: number; marks: number }> = [];
    const bloomRows: Array<{
      bloomLevel: BloomLevel;
      correct: boolean;
      marks: number;
      earned: number;
    }> = [];
    for (let i = 0; i < sequence.length; i++) {
      const q = pool.qById.get(sequence[i]);
      if (!q) continue;
      total += q.marks;
      const given = (finalAnswers[i] ?? "").trim();
      const correct = gradeOne(q, given);
      if (correct) earned += q.marks;
      perQuestion.push({
        questionId: q._id,
        earned: correct ? q.marks : 0,
        marks: q.marks,
      });
      bloomRows.push({
        bloomLevel: q.bloomLevel,
        correct,
        marks: q.marks,
        earned: correct ? q.marks : 0,
      });
    }

    // Final score: correctness × question marks ONLY. A correct answer earns
    // its full mark whether the response was fast, normal, or slow; an
    // incorrect answer earns nothing. Response speed never adjusts marks.
    const percent = percentFromMarks(earned, total);
    let grade = gradeFromPercent(percent);
    let passed = percent >= DEFAULT_PASS_THRESHOLD;
    // Create completion rule: when the required Create questions are all
    // correct, the assessment completes as Passed – Grade A.
    if (sub.completionReason === "create_mastered") {
      passed = true;
      grade = "A";
    }

    // Weak Bloom area(s): lowest earned performance per Bloom level over the
    // presented sequence — response speed is never used for weakness.
    const weakest = weakestBloomAreas(computeBloomPerformance(bloomRows));

    await ctx.db.patch(submissionId, {
      status: "submitted",
      answers: finalAnswers,
      score: earned,
      maxScore: total,
      submittedAt: Date.now(),
      autoGraded: true,
      grade,
      passed,
      weakestBloomAreas: weakest,
    });
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "assessment_submitted",
      entity: "assessmentSubmissions",
      entityId: submissionId,
      newValue: { score: earned, maxScore: total, grade, passed },
    });
    return {
      score: earned,
      maxScore: total,
      percent,
      grade,
      passed,
      weakestBloomAreas: weakest,
    };
  },
});

/** A graded submission with per-question correctness for the student. */
export const getMyResult = query({
  args: { submissionId: v.id("assessmentSubmissions") },
  handler: async (ctx, { submissionId }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sub = await ctx.db.get(submissionId);
    if (!sub || sub.studentId !== me._id)
      throw new Error("Submission not found");
    if (sub.status === "in_progress" || sub.answers === undefined)
      throw new Error("Not submitted yet");

    const a = await ctx.db.get(sub.assessmentId);
    const pool = await loadAdaptiveCtx(ctx, sub.assessmentId);
    // Mirror submit-time grading: stored presented sequence for adaptive
    // submissions, link order for legacy linear ones.
    const state = resolveAdaptiveState(sub, pool);
    const sequence =
      state.sequence.length > 0 ? state.sequence : pool.linkOrder;

    const items = [] as Array<{
      questionText: string;
      type: string;
      bloomLevel: BloomLevel;
      yourAnswer: string;
      correctAnswer: string;
      correct: boolean;
      marks: number;
    }>;
    for (let i = 0; i < sequence.length; i++) {
      const q = pool.qById.get(sequence[i]);
      if (!q) continue;
      const given = sub.answers[i] ?? "";
      const correct = gradeOne(q, given.trim());
      items.push({
        questionText: q.questionText,
        type: q.questionType,
        bloomLevel: q.bloomLevel,
        yourAnswer: given,
        correctAnswer: q.correctAnswer,
        correct,
        marks: q.marks,
      });
    }

    return {
      assessment: { id: a?._id ?? null, title: a?.title ?? "(deleted)" },
      submittedAt: sub.submittedAt ?? null,
      score: sub.score ?? 0,
      maxScore: sub.maxScore ?? 0,
      grade: sub.grade ?? null,
      passed: sub.passed ?? null,
      completionReason: sub.completionReason ?? null,
      weakestBloomAreas: sub.weakestBloomAreas ?? [],
      items,
    };
  },
});

/**
 * Student-facing assessment result with the full per-question adaptive
 * diagnostic data. Unlike getMyResult (legacy simple items) this returns
 * every stored field the report needs so every number in the results page
 * can be computed client-side from the student's actual responses.
 *
 *   P       = 1 / (1 + exp(-a * (θ − b − γT − δV)))
 *   ItemInformation = a² · P · (1 − P)
 *   T       = (RT − E) / (E + ε)        signed, never abs()
 *   V       = validityFactor            ∈ [0, 1]
 *
 * Requires the submission to be finished (status === "submitted" or
 * "graded"). Returns null while the exam is still in progress so the
 * take page keeps showing the live exam.
 */
export const getAssessmentResult = query({
  args: { submissionId: v.id("assessmentSubmissions") },
  handler: async (ctx, { submissionId }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");

    const sub = await ctx.db.get(submissionId);
    if (!sub || sub.studentId !== me._id)
      throw new Error("Submission not found");
    if (sub.status === "in_progress")
      throw new Error("Submission is still in progress");

    const a = await ctx.db.get(sub.assessmentId);
    if (!a) throw new Error("Assessment not found");

    const pool = await loadAdaptiveCtx(ctx, sub.assessmentId);
    const state = resolveAdaptiveState(sub, pool);
    const sequence =
      state.sequence.length > 0 ? state.sequence : pool.linkOrder;

    // Per-question rows, aligned by sequence position. The submitted answer,
    // response time (ms) and validity factor live at the same index as the
    // presented question, so the client can reconstruct P / information /
    // signed T / V / and per-level θ for each item.
    const graded = [] as Array<{
      q: QuestionDoc;
      given: string;
      correct: boolean;
      responseTimeMs: number;
      validityFactor: number;
    }>;
    for (let i = 0; i < sequence.length; i++) {
      const q = pool.qById.get(sequence[i]);
      if (!q) continue;
      const given = sub.answers?.[i] ?? "";
      graded.push({
        q,
        given,
        correct: gradeOne(q, given.trim()),
        responseTimeMs: sub.responseTimesMs?.[i] ?? 0,
        validityFactor: sub.validityFactors?.[i] ?? 0,
      });
    }

    // Replay MAP estimation after every step — exactly what the live adaptive
    // pipeline recomputed on each answer — so the client can chart how θ
    // changed after each question (thetaBefore → thetaAfter per row).
    const seq = graded.map((g) => g.q._id);
    const thetaHistory = [] as Array<Record<BloomLevel, number>>;
    for (let step = 1; step <= graded.length; step++) {
      thetaHistory.push(
        recomputeProfile(
          seq.slice(0, step),
          graded.slice(0, step).map((g) => g.given),
          graded.slice(0, step).map((g) => g.responseTimeMs),
          graded.slice(0, step).map((g) => g.validityFactor),
          pool.qById,
        ),
      );
    }

    // Final per-level MAP standard error (posterior SD) from the same model
    // (src/lib/irt/engine.estimateThetaMap); unanswered levels keep the
    // prior SD. SE shrinks as more items are answered at that level.
    const finalSe = zeroLevels();
    for (const level of BLOOM_LEVELS) {
      const levelRows = graded.filter((g) => g.q.bloomLevel === level);
      const est = estimateThetaMap(
        levelRows.map((g) => (g.correct ? 1 : 0)),
        levelRows.map((g) => {
          const { a, b } = itemParams(g.q);
          return {
            a,
            b,
            ctx: {
              gamma: ASSESSMENT_GAMMA,
              delta: ASSESSMENT_DELTA,
              T: strainFor(g.responseTimeMs, g.q.expectedTimeSec).T,
              V: g.validityFactor,
            },
          };
        }),
        0,
        1,
      );
      finalSe[level] = est.standardError;
    }

    const presented = presentedCounts(sequence, pool.qById);
    const rows = graded.map((g, i) => ({
      questionId: g.q._id,
      questionText: g.q.questionText,
      type: g.q.questionType,
      bloomLevel: g.q.bloomLevel,
      targetLevel: g.q.bloomLevel,
      expectedTimeSec: g.q.expectedTimeSec,
      a: g.q.discriminationA ?? 1.0,
      b: g.q.difficultyB ?? DEFAULT_B_BY_LEVEL[g.q.bloomLevel],
      marks: g.q.marks,
      correctAnswer: g.q.correctAnswer,
      yourAnswer: g.given,
      correct: g.correct,
      responseTimeMs: g.responseTimeMs,
      validityFactor: g.validityFactor,
      thetaBefore:
        thetaHistory[i - 1] ??
        ({ remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 } as Record<BloomLevel, number>),
      thetaAfter: thetaHistory[i],
      standardError: finalSe,
      presented,
    }));

    return {
      assessment: {
        id: a._id,
        title: a.title,
        description: a.description ?? null,
        timeLimitMin: a.timeLimitMin,
        adaptive: true,
        displayCount: a.displayCount ?? 0,
        poolSize: a.poolSize ?? 0,
        gamma: ASSESSMENT_GAMMA,
        delta: ASSESSMENT_DELTA,
      },
      submission: {
        id: sub._id,
        status: sub.status,
        startedAt: sub.startedAt,
        submittedAt: sub.submittedAt ?? null,
        score: sub.score ?? 0,
        maxScore: sub.maxScore ?? 0,
        violationCount: sub.violationCount ?? 0,
        policyAction: sub.policyAction ?? "NONE",
        grade: sub.grade ?? null,
        passed: sub.passed ?? null,
        completionReason: sub.completionReason ?? null,
        weakestBloomAreas: sub.weakestBloomAreas ?? [],
      },
      thetaProfile: sub.thetaProfile ?? zeroLevels(),
      presentedByLevel: presentedCounts(sequence, pool.qById),
      rows,
    };
  },
});

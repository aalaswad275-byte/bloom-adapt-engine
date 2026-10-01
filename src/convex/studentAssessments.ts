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
  ASSESSMENT_PROCTOR_CONFIG,
  type MonitoringConfig,
  type PolicyAction,
  type Severity,
  type ViolationType,
  policyForCount,
  violationSeverity,
} from "../lib/monitoring";

type StudentDoc = Doc<"students">;

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
async function myStudentRecord(
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

/**
 * Move the one-question-at-a-time cursor for an in-progress submission.
 * Students see one question at a time; the cursor is server-held so it
 * survives reloads and cannot be used to skip around freely.
 */
export const setCurrentQuestion = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    questionIndex: v.number(),
  },
  handler: async (ctx, { submissionId, questionIndex }) => {
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
    if (questionIndex < 0)
      throw new Error("Invalid question index");
    // Upper bound is validated against the assessment's question count.
    const links = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", sub.assessmentId))
      .collect();
    if (questionIndex >= links.length)
      throw new Error("Invalid question index");
    await ctx.db.patch(submissionId, { currentQuestionIndex: questionIndex });
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

    const id = await ctx.db.insert("assessmentSubmissions", {
      assessmentId,
      classId: a.classId,
      studentId: me._id,
      status: "in_progress",
      startedAt: Date.now(),
    });
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "assessment_started",
      entity: "assessmentSubmissions",
      entityId: id,
      newValue: { assessmentId, studentId: me._id },
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

/** The in-progress submission: questions (answers stripped) + saved answers. */
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

    const a = await ctx.db.get(sub.assessmentId);
    if (!a) throw new Error("Assessment not found");

    const links = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", sub.assessmentId))
      .collect();
    links.sort((x, y) => x.order - y.order);
    const questions = [] as Array<{
      id: Id<"instructorQuestions">;
      questionText: string;
      questionType: string;
      options: string[] | null;
      marks: number;
    }>;
    for (const l of links) {
      const q = await ctx.db.get(l.questionId);
      if (q)
        questions.push({
          id: q._id,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.options ?? null,
          marks: q.marks,
        });
    }

    return {
      submission: {
        id: sub._id,
        startedAt: sub.startedAt,
        answers: sub.answers ?? [],
        currentQuestionIndex: sub.currentQuestionIndex ?? 0,
        violationCount: sub.violationCount ?? 0,
        policyAction: sub.policyAction ?? "NONE",
        terminatedByPolicy: sub.terminatedByPolicy ?? false,
      },
      assessment: {
        id: a._id,
        title: a.title,
        description: a.description ?? null,
        timeLimitMin: a.timeLimitMin,
      },
      questions,
    };
  },
});

/** Save one answer (by question position) into the in-progress submission. */
export const saveAnswer = mutation({
  args: {
    submissionId: v.id("assessmentSubmissions"),
    questionIndex: v.number(),
    answer: v.string(),
  },
  handler: async (ctx, { submissionId, questionIndex, answer }) => {
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

    const answers = [...(sub.answers ?? [])];
    if (questionIndex < 0)
      throw new Error("Invalid question index");
    while (answers.length <= questionIndex) answers.push("");
    answers[questionIndex] = answer;
    await ctx.db.patch(submissionId, { answers });
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
    answers: v.array(v.string()),
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

    const links = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", sub.assessmentId))
      .collect();
    links.sort((x, y) => x.order - y.order);

    let earned = 0;
    let total = 0;
    const perQuestion: Array<{ questionId: string; earned: number; marks: number }> = [];
    for (let i = 0; i < links.length; i++) {
      const q = await ctx.db.get(links[i].questionId);
      if (!q) continue;
      total += q.marks;
      const given = (answers[i] ?? "").trim();
      const correct =
        q.questionType === "short_answer"
          ? given.toLowerCase() === q.correctAnswer.trim().toLowerCase()
          : given === q.correctAnswer;
      if (correct) earned += q.marks;
      perQuestion.push({
        questionId: q._id,
        earned: correct ? q.marks : 0,
        marks: q.marks,
      });
    }

    await ctx.db.patch(submissionId, {
      status: "submitted",
      answers,
      score: earned,
      maxScore: total,
      submittedAt: Date.now(),
      autoGraded: true,
    });
    await audit(ctx, { _id: user._id, email: user.email }, {
      action: "assessment_submitted",
      entity: "assessmentSubmissions",
      entityId: submissionId,
      newValue: { score: earned, maxScore: total },
    });
    return { score: earned, maxScore: total };
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
    const links = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", sub.assessmentId))
      .collect();
    links.sort((x, y) => x.order - y.order);

    const items = [] as Array<{
      questionText: string;
      type: string;
      yourAnswer: string;
      correctAnswer: string;
      correct: boolean;
      marks: number;
    }>;
    for (let i = 0; i < links.length; i++) {
      const q = await ctx.db.get(links[i].questionId);
      if (!q) continue;
      const given = sub.answers[i] ?? "";
      const correct =
        q.questionType === "short_answer"
          ? given.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
          : given === q.correctAnswer;
      items.push({
        questionText: q.questionText,
        type: q.questionType,
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
      items,
    };
  },
});

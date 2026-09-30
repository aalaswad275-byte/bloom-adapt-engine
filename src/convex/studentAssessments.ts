/**
 * Student assessment access — a signed-in user claims one student record by
 * matching email, sees their class, takes published assessments from their
 * class, and reviews graded results.
 *
 * Security: taking/submitting is restricted to roster members (the claimed
 * student row must carry the class's classId), and every write re-checks
 * ownership server-side.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { audit, currentUserOf } from "./adminLib";

type StudentDoc = Doc<"students">;

/** Resolve the student record claimed by the signed-in user (or null). */
async function myStudentRecord(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<StudentDoc | null> {
  const all = await ctx.db.query("students").collect();
  return all.find((r) => r.userId === userId) ?? null;
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
    let student: { id: string; name: string } | null = null;
    if (claimed) {
      const me = await myStudentRecord(ctx, user._id);
      student = me ? { id: me._id, name: me.name } : null;
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

/** The claimed student's class with its published assessments. */
export const getMyClass = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "student")
      throw new Error("Student access required");
    const me = await myStudentRecord(ctx, user._id);
    if (!me) throw new Error("No student record linked to this account");
    if (me.classId === undefined)
      return { student: { id: me._id, name: me.name }, classInfo: null, assessments: [] };

    const cls = await ctx.db.get(me.classId);
    if (!cls)
      return { student: { id: me._id, name: me.name }, classInfo: null, assessments: [] };

    const instructor = await ctx.db.get(cls.instructorId);
    const all = await ctx.db
      .query("instructorAssessments")
      .withIndex("by_class", (x) => x.eq("classId", cls._id))
      .collect();
    const published = all
      .filter((a) => a.status === "published")
      .sort((x, y) => y.createdAt - x.createdAt);

    const mySubs = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_student", (x) => x.eq("studentId", me._id))
      .collect();
    const subByAssessment = new Map(
      mySubs.map((s) => [s.assessmentId, s] as const),
    );

    const assessments = [] as Array<{
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

    return {
      student: { id: me._id, name: me.name },
      classInfo: {
        id: cls._id,
        name: cls.name,
        description: cls.description ?? null,
        instructorName: instructor?.name ?? null,
      },
      assessments,
    };
  },
});

// ---------------------------------------------------------------------------
// Taking an assessment
// ---------------------------------------------------------------------------

/**
 * Open (or resume) a submission for a published assessment. Only students
 * enrolled in the assessment's class may take it. Returns questions without
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
    if (a.status !== "published")
      throw new Error("This assessment is not open");
    if (me.classId === undefined || me.classId !== a.classId)
      throw new Error("This assessment is not assigned to your class");

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

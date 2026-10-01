/**
 * Instructor assessment management — instructors author questions and
 * assessments for their own classes, publish them to their roster, and view
 * submissions and results.
 *
 * Ownership: every function re-verifies that the signed-in instructor owns
 * the class (and therefore the question/assessment) via requireOwnedClass.
 * Assessments can only be assigned to students enrolled in their class —
 * enforced by construction (submissions open only for roster members).
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { audit, currentUserOf } from "./adminLib";
import { requireOwnedClass } from "./instructorPortal";

type QuestionDoc = Doc<"instructorQuestions">;
type SubmissionDoc = Doc<"assessmentSubmissions">;

/** Bloom's Taxonomy level validator for question args. */
const bloomArg = v.union(
  v.literal("remember"),
  v.literal("understand"),
  v.literal("apply"),
  v.literal("analyze"),
  v.literal("evaluate"),
  v.literal("create"),
);

const BLOOM_KEYS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

/** Verify the caller owns this question (class ownership implies it). */
async function requireOwnedQuestion(
  ctx: QueryCtx,
  questionId: Id<"instructorQuestions">,
) {
  const q = await ctx.db.get(questionId);
  if (!q) throw new Error("Question not found");
  const { me } = await requireOwnedClass(ctx, q.classId);
  return { q, me };
}

/** Verify the caller owns this assessment (class ownership implies it). */
async function requireOwnedAssessment(
  ctx: QueryCtx,
  assessmentId: Id<"instructorAssessments">,
) {
  const a = await ctx.db.get(assessmentId);
  if (!a) throw new Error("Assessment not found");
  const { me, cls } = await requireOwnedClass(ctx, a.classId);
  return { a, me, cls };
}

/** Question ids linked to an assessment, in order. */
async function questionIdsOf(
  ctx: QueryCtx,
  assessmentId: Id<"instructorAssessments">,
): Promise<Id<"instructorQuestions">[]> {
  const links = await ctx.db
    .query("assessmentQuestions")
    .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
    .collect();
  links.sort((x, y) => x.order - y.order);
  return links.map((l) => l.questionId);
}

/** Load question docs for an assessment (drops deleted questions). */
async function questionsOfAssessment(
  ctx: QueryCtx,
  assessmentId: Id<"instructorAssessments">,
): Promise<QuestionDoc[]> {
  const ids = await questionIdsOf(ctx, assessmentId);
  const out: QuestionDoc[] = [];
  for (const id of ids) {
    const q = await ctx.db.get(id);
    if (q) out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Questions CRUD
// ---------------------------------------------------------------------------

export const listQuestions = query({
  args: {
    classId: v.id("classes"),
    search: v.optional(v.string()),
    bloomLevel: v.optional(bloomArg),
  },
  handler: async (ctx, { classId, search, bloomLevel }) => {
    await requireOwnedClass(ctx, classId);
    const q = (search ?? "").trim().toLowerCase();
    const rows = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_class", (x) => x.eq("classId", classId))
      .collect();
    return rows
      .filter(
        (r) =>
          (!bloomLevel || r.bloomLevel === bloomLevel) &&
          (!q ||
            r.questionText.toLowerCase().includes(q) ||
            (r.explanation ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getQuestion = query({
  args: { id: v.id("instructorQuestions") },
  handler: async (ctx, { id }) => {
    const { q } = await requireOwnedQuestion(ctx, id);
    return q;
  },
});

export const createQuestion = mutation({
  args: {
    classId: v.id("classes"),
    questionText: v.string(),
    questionType: v.union(
      v.literal("multiple_choice"),
      v.literal("true_false"),
      v.literal("short_answer"),
    ),
    options: v.optional(v.array(v.string())),
    correctAnswer: v.string(),
    explanation: v.optional(v.string()),
    marks: v.number(),
    bloomLevel: bloomArg,
    /** Expected answer time in seconds (10s–2h). */
    expectedTimeSec: v.number(),
    topic: v.optional(v.string()),
    source: v.optional(v.union(v.literal("manual"), v.literal("ai"))),
  },
  handler: async (ctx, args) => {
    const { me } = await requireOwnedClass(ctx, args.classId);
    if (args.marks <= 0) throw new Error("Marks must be positive");
    if (args.expectedTimeSec < 10 || args.expectedTimeSec > 7200)
      throw new Error("Expected answer time must be between 10s and 2h");
    if (args.questionType === "multiple_choice") {
      const opts = args.options ?? [];
      if (opts.length < 2)
        throw new Error("Multiple-choice questions need at least 2 options");
      if (!opts.includes(args.correctAnswer))
        throw new Error("Correct answer must be one of the options");
    }
    if (args.questionType === "true_false" &&
        !["True", "False"].includes(args.correctAnswer))
      throw new Error("True/False answer must be True or False");

    const id = await ctx.db.insert("instructorQuestions", {
      classId: args.classId,
      instructorId: me._id,
      questionText: args.questionText,
      questionType: args.questionType,
      options:
        args.questionType === "true_false"
          ? ["True", "False"]
          : args.questionType === "multiple_choice"
            ? args.options
            : undefined,
      correctAnswer: args.correctAnswer,
      explanation: args.explanation,
      marks: args.marks,
      bloomLevel: args.bloomLevel,
      expectedTimeSec: args.expectedTimeSec,
      topic: args.topic,
      source: args.source ?? "manual",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_question.created",
      entity: "instructorQuestions",
      entityId: id,
      newValue: { classId: args.classId, type: args.questionType, bloom: args.bloomLevel },
    });
    return id;
  },
});

export const updateQuestion = mutation({
  args: {
    id: v.id("instructorQuestions"),
    fields: v.object({
      questionText: v.optional(v.string()),
      options: v.optional(v.array(v.string())),
      correctAnswer: v.optional(v.string()),
      explanation: v.optional(v.string()),
      marks: v.optional(v.number()),
      bloomLevel: v.optional(bloomArg),
      expectedTimeSec: v.optional(v.number()),
      topic: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, fields }) => {
    const { q, me } = await requireOwnedQuestion(ctx, id);
    if (fields.marks !== undefined && fields.marks <= 0)
      throw new Error("Marks must be positive");
    if (fields.expectedTimeSec !== undefined &&
        (fields.expectedTimeSec < 10 || fields.expectedTimeSec > 7200))
      throw new Error("Expected answer time must be between 10s and 2h");
    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_question.updated",
      entity: "instructorQuestions",
      entityId: id,
      previousValue: { text: q.questionText, marks: q.marks },
      newValue: fields,
    });
  },
});

export const deleteQuestion = mutation({
  args: { id: v.id("instructorQuestions") },
  handler: async (ctx, { id }) => {
    const { q, me } = await requireOwnedQuestion(ctx, id);
    // Detach from any assessments that reference it.
    const links = await ctx.db
      .query("assessmentQuestions")
      .filter((x) => x.eq(x.field("questionId"), id))
      .collect();
    for (const link of links) await ctx.db.delete(link._id);
    await ctx.db.delete(id);
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_question.deleted",
      entity: "instructorQuestions",
      entityId: id,
      previousValue: { text: q.questionText },
    });
  },
});

// ---------------------------------------------------------------------------
// Assessments CRUD
// ---------------------------------------------------------------------------

/** Assessment row + computed stats for the instructor list view. */
export const listAssessments = query({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const { cls } = await requireOwnedClass(ctx, classId);
    const roster = await ctx.db
      .query("students")
      .withIndex("by_class", (x) => x.eq("classId", classId))
      .collect();
    const rosterIds = new Set(roster.map((r) => r._id));

    const rows = await ctx.db
      .query("instructorAssessments")
      .withIndex("by_class", (x) => x.eq("classId", classId))
      .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);

    const out = [];
    for (const a of rows) {
      const qs = await questionsOfAssessment(ctx, a._id);
      const subs = await ctx.db
        .query("assessmentSubmissions")
        .withIndex("by_assessment", (x) => x.eq("assessmentId", a._id))
        .collect();
      const valid = subs.filter((s) => rosterIds.has(s.studentId));
      const maxTotal = qs.reduce((sum, q) => sum + q.marks, 0);
      const submitted = valid.filter((s) => s.status !== "in_progress");
      const gradedScores = valid
        .filter((s) => s.score !== undefined && (s.maxScore ?? 0) > 0)
        .map((s) => ((s.score ?? 0) / (s.maxScore ?? 1)) * 100);
      out.push({
        id: a._id,
        title: a.title,
        description: a.description ?? null,
        status: a.status,
        timeLimitMin: a.timeLimitMin,
        questionCount: qs.length,
        totalMarks: maxTotal,
        createdAt: a.createdAt,
        submissions: submitted.length,
        rosterSize: roster.length,
        avgPct:
          gradedScores.length > 0
            ? gradedScores.reduce((x, y) => x + y, 0) / gradedScores.length
            : null,
      });
    }
    return { className: cls.name, assessments: out };
  },
});

export const getAssessment = query({
  args: { id: v.id("instructorAssessments") },
  handler: async (ctx, { id }) => {
    const { a } = await requireOwnedAssessment(ctx, id);
    const questions = await questionsOfAssessment(ctx, id);
    return { assessment: a, questions };
  },
});

export const createAssessment = mutation({
  args: {
    classId: v.id("classes"),
    title: v.string(),
    description: v.optional(v.string()),
    timeLimitMin: v.optional(v.number()),
  },
  handler: async (ctx, { classId, title, description, timeLimitMin }) => {
    const { me } = await requireOwnedClass(ctx, classId);
    if (!title.trim()) throw new Error("Title is required");
    if (timeLimitMin !== undefined && timeLimitMin < 0)
      throw new Error("Time limit cannot be negative");
    const id = await ctx.db.insert("instructorAssessments", {
      classId,
      instructorId: me._id,
      title: title.trim(),
      description,
      timeLimitMin: timeLimitMin ?? 0,
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.created",
      entity: "instructorAssessments",
      entityId: id,
      newValue: { title, classId },
    });
    return id;
  },
});

export const updateAssessment = mutation({
  args: {
    id: v.id("instructorAssessments"),
    fields: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      timeLimitMin: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, fields }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    if (a.status !== "draft")
      throw new Error("Only draft assessments can be edited");
    if (fields.timeLimitMin !== undefined && fields.timeLimitMin < 0)
      throw new Error("Time limit cannot be negative");
    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.updated",
      entity: "instructorAssessments",
      entityId: id,
      previousValue: { title: a.title, timeLimitMin: a.timeLimitMin },
      newValue: fields,
    });
  },
});

export const deleteAssessment = mutation({
  args: { id: v.id("instructorAssessments") },
  handler: async (ctx, { id }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    const links = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", id))
      .collect();
    for (const l of links) await ctx.db.delete(l._id);
    const subs = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", id))
      .collect();
    for (const s of subs) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.deleted",
      entity: "instructorAssessments",
      entityId: id,
      previousValue: { title: a.title, status: a.status },
    });
  },
});

/** Publish (roster can see + take) or close/unpublish an assessment. */
export const setAssessmentStatus = mutation({
  args: {
    id: v.id("instructorAssessments"),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("closed"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    if (status === "published") {
      const qs = await questionsOfAssessment(ctx, id);
      if (qs.length === 0)
        throw new Error("Add at least one question before publishing");
    }
    await ctx.db.patch(id, {
      status,
      publishedAt: status === "published" ? Date.now() : a.publishedAt,
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: `instructor_assessment.${status}`,
      entity: "instructorAssessments",
      entityId: id,
      previousValue: { status: a.status },
      newValue: { status },
    });
  },
});

// ---------------------------------------------------------------------------
// Assessment composition (attach/remove questions)
// ---------------------------------------------------------------------------

export const addQuestionToAssessment = mutation({
  args: {
    assessmentId: v.id("instructorAssessments"),
    questionId: v.id("instructorQuestions"),
  },
  handler: async (ctx, { assessmentId, questionId }) => {
    const { a } = await requireOwnedAssessment(ctx, assessmentId);
    if (a.status !== "draft")
      throw new Error("Questions can only be changed on draft assessments");
    const q = await ctx.db.get(questionId);
    if (!q) throw new Error("Question not found");
    if (q.classId !== a.classId)
      throw new Error("Question belongs to a different class");
    const existing = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
      .collect();
    if (existing.some((l) => l.questionId === questionId))
      throw new Error("Question already added to this assessment");
    const order = existing.length;
    await ctx.db.insert("assessmentQuestions", {
      assessmentId,
      questionId,
      order,
    });
    await ctx.db.patch(assessmentId, { updatedAt: Date.now() });
  },
});

export const removeQuestionFromAssessment = mutation({
  args: {
    assessmentId: v.id("instructorAssessments"),
    questionId: v.id("instructorQuestions"),
  },
  handler: async (ctx, { assessmentId, questionId }) => {
    const { a } = await requireOwnedAssessment(ctx, assessmentId);
    if (a.status !== "draft")
      throw new Error("Questions can only be changed on draft assessments");
    const links = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", assessmentId))
      .collect();
    const link = links.find((l) => l.questionId === questionId);
    if (!link) return;
    await ctx.db.delete(link._id);
    // Re-pack ordering.
    const rest = links
      .filter((l) => l._id !== link._id)
      .sort((x, y) => x.order - y.order);
    for (let i = 0; i < rest.length; i++)
      await ctx.db.patch(rest[i]._id, { order: i });
    await ctx.db.patch(assessmentId, { updatedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Submissions + results (instructor view)
// ---------------------------------------------------------------------------

export const getAssessmentResults = query({
  args: { id: v.id("instructorAssessments") },
  handler: async (ctx, { id }) => {
    const { a } = await requireOwnedAssessment(ctx, id);
    const roster = await ctx.db
      .query("students")
      .withIndex("by_class", (x) => x.eq("classId", a.classId))
      .collect();
    const questions = await questionsOfAssessment(ctx, id);
    const maxTotal = questions.reduce((sum, q) => sum + q.marks, 0);

    const subs = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", id))
      .collect();
    const byStudent = new Map<Id<"students">, SubmissionDoc>();
    for (const s of subs) byStudent.set(s.studentId, s);

    const rows = roster.map((st) => {
      const s = byStudent.get(st._id);
      const pct =
        s && s.score !== undefined && (s.maxScore ?? 0) > 0
          ? ((s.score ?? 0) / (s.maxScore ?? 1)) * 100
          : null;
      return {
        studentId: st._id,
        studentName: st.name,
        studentEmail: st.email ?? null,
        status: s?.status ?? null,
        startedAt: s?.startedAt ?? null,
        submittedAt: s?.submittedAt ?? null,
        score: s?.score ?? null,
        maxScore: s?.maxScore ?? null,
        percentage: pct === null ? null : Math.round(pct * 10) / 10,
        violationCount: s?.violationCount ?? 0,
        terminatedByPolicy: s?.terminatedByPolicy ?? false,
        policyAction: s?.policyAction ?? null,
        riskScore: s?.riskScore ?? null,
        violationLog: (s?.violationLog ?? []).map((e) => ({
          type: e.type,
          at: e.at,
          confidence: e.confidence,
          durationMs: e.durationMs ?? null,
        })),
      };
    });
    rows.sort((x, y) => {
      if (x.percentage === null && y.percentage === null) return 0;
      if (x.percentage === null) return 1;
      if (y.percentage === null) return -1;
      return y.percentage - x.percentage;
    });

    const submittedRows = rows.filter((r) => r.status !== null);
    const pctScores = rows
      .map((r) => r.percentage)
      .filter((v): v is number => v !== null);

    // Per-Bloom performance: re-grade each submission's answers against the
    // question list, bucketing marks earned/possible by Bloom level.
    const bloomAgg = new Map<string, { earned: number; total: number; n: number }>();
    for (const s of subs) {
      if (s.status === "in_progress" || s.answers === undefined) continue;
      const perBloom = new Map<string, { earned: number; total: number }>();
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const given = (s.answers[i] ?? "").trim();
        const correct =
          q.questionType === "short_answer"
            ? given.toLowerCase() === q.correctAnswer.trim().toLowerCase()
            : given === q.correctAnswer;
        const b = perBloom.get(q.bloomLevel) ?? { earned: 0, total: 0 };
        b.total += q.marks;
        if (correct) b.earned += q.marks;
        perBloom.set(q.bloomLevel, b);
      }
      for (const [level, b] of perBloom) {
        const agg = bloomAgg.get(level) ?? { earned: 0, total: 0, n: 0 };
        agg.earned += b.earned;
        agg.total += b.total;
        agg.n += 1;
        bloomAgg.set(level, agg);
      }
    }
    const bloomPerformance = BLOOM_KEYS.map((level) => {
      const agg = bloomAgg.get(level);
      return {
        bloom: level,
        students: agg?.n ?? 0,
        pct:
          agg && agg.total > 0
            ? Math.round((agg.earned / agg.total) * 1000) / 10
            : null,
      };
    }).filter((x) => x.students > 0);

    return {
      assessment: {
        id: a._id,
        title: a.title,
        status: a.status,
        timeLimitMin: a.timeLimitMin,
        questionCount: questions.length,
        maxTotal,
      },
      rows,
      bloomPerformance,
      stats: {
        rosterSize: roster.length,
        submitted: submittedRows.length,
        avgPct:
          pctScores.length > 0
            ? Math.round(
                (pctScores.reduce((x, y) => x + y, 0) / pctScores.length) * 10,
              ) / 10
            : null,
        highest: pctScores.length > 0 ? Math.max(...pctScores) : null,
        lowest: pctScores.length > 0 ? Math.min(...pctScores) : null,
      },
    };
  },
});

/** Class context used by the AI question generator (topics, size, name). */
export const getClassContext = query({
  args: { classId: v.id("classes") },
  handler: async (ctx, { classId }) => {
    const { cls } = await requireOwnedClass(ctx, classId);
    const qs = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_class", (x) => x.eq("classId", classId))
      .collect();
    const topics = [
      ...new Set(qs.map((q) => q.topic).filter((t): t is string => !!t)),
    ];
    return {
      className: cls.name,
      description: cls.description ?? null,
      topics,
      questionCount: qs.length,
    };
  },
});

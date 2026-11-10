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
import {
  ASSESSMENT_POOL_MIN,
  DEFAULT_B_BY_LEVEL,
  evaluatePool,
  gradeOne,
  normalizeSequence,
  randomPoolErrors,
  randomTotal,
  validateDisplayCount,
} from "./assessmentAdaptive";
import { answerFormatOf, resolveClassification } from "./taxonomy";
import { normalizeBloomLabels, resolveBloomLabels } from "../lib/irt";
import { DIFFICULTY_B, difficultyLevelFromB } from "../lib/difficulty";
import type { DifficultyLevel } from "../lib/difficulty";

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

/** Difficulty band validator for question args. */
const difficultyArg = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
  v.literal("expert"),
);

/** Authored band when present, otherwise derived from the 2PL difficulty. */
function difficultyOf(q: QuestionDoc): DifficultyLevel {
  return (
    q.difficultyLevel ??
    difficultyLevelFromB(q.difficultyB ?? DEFAULT_B_BY_LEVEL[q.bloomLevel])
  );
}

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

/** Questions the instructor attached to an assessment (drops deleted ones). */
async function attachedQuestionsOf(
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

/** Every question held by the class question bank. */
async function bankQuestionsOf(
  ctx: QueryCtx,
  classId: Id<"classes">,
): Promise<QuestionDoc[]> {
  return await ctx.db
    .query("instructorQuestions")
    .withIndex("by_class", (x) => x.eq("classId", classId))
    .collect();
}

type AssessmentMode = "adaptive" | "static" | "random" | "final";

/** Selection strategy of an assessment (legacy rows default to adaptive). */
function modeOf(a: Doc<"instructorAssessments">): AssessmentMode {
  return a.selectionMode ?? "adaptive";
}

/**
 * Which assessment panel an assessment belongs to. The static panel holds
 * traditional fixed papers (instructor order or a random draw); the adaptive
 * panel holds the AI/IRT model.
 */
function typeOf(a: Doc<"instructorAssessments">): "static" | "adaptive" {
  return modeOf(a) === "adaptive" ? "adaptive" : "static";
}

/**
 * The pool an assessment selects its questions from.
 *
 * Adaptive and static assessments select from the questions the instructor
 * attached. Random-mode assessments involve no manual selection: they draw
 * straight from the class question bank. Attaching questions to a random
 * assessment is optional and narrows the draw to that curated subset.
 */
async function resolvePool(
  ctx: QueryCtx,
  a: Doc<"instructorAssessments">,
): Promise<{ questions: QuestionDoc[]; fromBank: boolean }> {
  const attached = await attachedQuestionsOf(ctx, a._id);
  if (attached.length > 0 || (a.selectionMode ?? "adaptive") !== "random")
    return { questions: attached, fromBank: false };
  return { questions: await bankQuestionsOf(ctx, a.classId), fromBank: true };
}

/**
 * Validate the adaptive-configuration pair (pool size + display count).
 * Pool minimum (18) and per-Bloom coverage are enforced at publish time
 * against the actual attached questions; this checks the declared shape.
 */
function validateAdaptiveConfig(
  poolSize: number,
  displayCount: number,
): void {
  if (!Number.isInteger(poolSize) || poolSize < ASSESSMENT_POOL_MIN) {
    throw new Error(
      `Question pool size must be a whole number of at least ${ASSESSMENT_POOL_MIN}.`,
    );
  }
  const err = validateDisplayCount(poolSize, displayCount);
  if (err) throw new Error(err);
}

/**
 * Normalize a random-mode draw configuration: a whole count per Bloom level
 * (0 allowed) with at least one question drawn in total. Only the six
 * canonical levels are ever stored.
 */
function normalizeRandomCounts(
  input: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const level of BLOOM_KEYS) {
    const raw = input?.[level] ?? 0;
    if (!Number.isFinite(raw) || raw < 0)
      throw new Error(
        `Questions drawn at random per Bloom level must be 0 or more ("${level}").`,
      );
    out[level] = Math.floor(raw);
  }
  if (randomTotal(out) < 1)
    throw new Error("Set at least one question to be drawn at random.");
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
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r, difficultyLevel: difficultyOf(r) }));
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
    /** Classification (admin-managed taxonomy). The class subject supplies
     *  the default category, so the form can suggest it automatically. */
    categoryId: v.optional(v.id("questionCategories")),
    topicId: v.optional(v.id("questionTopics")),
    typeKey: v.optional(v.string()),
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
    /** Instructor-facing difficulty band (optional; derived from b when
     *  omitted). */
    difficultyLevel: v.optional(difficultyArg),
    /** 2PL difficulty b for the adaptive selector (optional; derived from
     *  the difficulty band or the Bloom level when omitted). */
    difficultyB: v.optional(v.number()),
    /** 2PL discrimination a (optional; defaults to 1.0). */
    discriminationA: v.optional(v.number()),
    topic: v.optional(v.string()),
    source: v.optional(v.union(v.literal("manual"), v.literal("ai"))),
  },
  handler: async (ctx, args) => {
    const { me, cls } = await requireOwnedClass(ctx, args.classId);
    if (args.marks <= 0) throw new Error("Marks must be positive");
    if (args.expectedTimeSec < 10 || args.expectedTimeSec > 7200)
      throw new Error("Expected answer time must be between 10s and 2h");
    if (args.discriminationA !== undefined &&
        (args.discriminationA <= 0 || args.discriminationA > 4))
      throw new Error("Discrimination a must be in (0, 4]");
    if (args.difficultyB !== undefined &&
        (args.difficultyB < -3 || args.difficultyB > 3))
      throw new Error("Difficulty b must be within [-3, 3]");
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

    const classification = await resolveClassification(ctx, {
      categoryId: args.categoryId ?? cls.categoryId,
      categoryName: cls.subject,
      topicId: args.topicId,
      topicName: args.topic,
      typeKey: args.typeKey,
      answerFormat: answerFormatOf(args.questionType),
      allowNewTopic: false,
    });

    const id = await ctx.db.insert("instructorQuestions", {
      classId: args.classId,
      instructorId: me._id,
      categoryId: classification.category._id,
      topicId: classification.topic?._id,
      typeKey: classification.typeDef.key,
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
      difficultyLevel: args.difficultyLevel,
      difficultyB:
        args.difficultyB ??
        (args.difficultyLevel ? DIFFICULTY_B[args.difficultyLevel] : undefined),
      discriminationA: args.discriminationA,
      topic: classification.topic?.name,
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
      categoryId: v.optional(v.id("questionCategories")),
      topicId: v.optional(v.id("questionTopics")),
      typeKey: v.optional(v.string()),
      questionText: v.optional(v.string()),
      options: v.optional(v.array(v.string())),
      correctAnswer: v.optional(v.string()),
      explanation: v.optional(v.string()),
      marks: v.optional(v.number()),
      bloomLevel: v.optional(bloomArg),
      expectedTimeSec: v.optional(v.number()),
      difficultyLevel: v.optional(difficultyArg),
      difficultyB: v.optional(v.number()),
      discriminationA: v.optional(v.number()),
      topic: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, fields }) => {
    const { q, me } = await requireOwnedQuestion(ctx, id);
    const cls = await ctx.db.get(q.classId);
    if (fields.marks !== undefined && fields.marks <= 0)
      throw new Error("Marks must be positive");
    if (fields.expectedTimeSec !== undefined &&
        (fields.expectedTimeSec < 10 || fields.expectedTimeSec > 7200))
      throw new Error("Expected answer time must be between 10s and 2h");
    if (fields.discriminationA !== undefined &&
        (fields.discriminationA <= 0 || fields.discriminationA > 4))
      throw new Error("Discrimination a must be in (0, 4]");
    if (fields.difficultyB !== undefined &&
        (fields.difficultyB < -3 || fields.difficultyB > 3))
      throw new Error("Difficulty b must be within [-3, 3]");
    // Moving a question to a different band re-stamps its representative b so
    // the adaptive selector follows the label — unless the caller passed an
    // explicit b.
    const b = fields.difficultyB ??
      (fields.difficultyLevel !== undefined &&
      fields.difficultyLevel !== difficultyOf(q)
        ? DIFFICULTY_B[fields.difficultyLevel]
        : undefined);
    const topicArgs =
      fields.topicId !== undefined
        ? { topicId: fields.topicId }
        : fields.topic !== undefined
          ? { topicName: fields.topic }
          : q.topicId
            ? { topicId: q.topicId }
            : { topicName: q.topic };
    const classification = await resolveClassification(ctx, {
      categoryId: fields.categoryId ?? q.categoryId ?? cls?.categoryId,
      categoryName: fields.categoryId ? undefined : cls?.subject,
      ...topicArgs,
      typeKey: fields.typeKey ?? q.typeKey,
      answerFormat: answerFormatOf(q.questionType),
      allowNewTopic: false,
    });

    await ctx.db.patch(id, {
      ...fields,
      categoryId: classification.category._id,
      topicId: classification.topic?._id,
      typeKey: classification.typeDef.key,
      topic: classification.topic?.name,
      ...(b !== undefined ? { difficultyB: b } : {}),
      updatedAt: Date.now(),
    });
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

    const bankSize = (await bankQuestionsOf(ctx, classId)).length;

    const out = [];
    for (const a of rows) {
      const { questions: qs, fromBank } = await resolvePool(ctx, a);
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
        poolSize: a.poolSize ?? null,
        displayCount: a.displayCount ?? null,
        /** Which panel owns it: "static" (fixed paper) or "adaptive" (AI). */
        assessmentType: typeOf(a),
        /** "adaptive" ladder, "static" fixed order, or "random" draw. */
        selectionMode: modeOf(a),
        /** Per-level random draw counts (null unless random mode). */
        randomCounts: a.randomCounts ?? null,
        /** Random mode: the pool is the whole class bank, not a curated set. */
        poolFromBank: fromBank,
        /** Size of the class question bank (random draws come from here). */
        bankPool: bankSize,
        /** Resolved names, so the edit dialog can prefill every level. */
        bloomLabels: resolveBloomLabels(a.bloomLabels),
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
    const { questions, fromBank } = await resolvePool(ctx, a);
    const attached = await attachedQuestionsOf(ctx, id);
    return {
      assessment: a,
      /** Panel + strategy, with legacy rows resolved to a concrete mode. */
      assessmentType: typeOf(a),
      selectionMode: modeOf(a),
      /** The pool this assessment selects from. */
      questions,
      /** Curated subset the instructor attached (empty = whole bank). */
      attached,
      poolFromBank: fromBank,
    };
  },
});

export const createAssessment = mutation({
  args: {
    classId: v.id("classes"),
    title: v.string(),
    description: v.optional(v.string()),
    timeLimitMin: v.optional(v.number()),
    /** Adaptive model: declared pool size (≥ 18). */
    poolSize: v.optional(v.number()),
    /** Adaptive model: questions each student will answer (≤ pool). */
    displayCount: v.optional(v.number()),
    /** Instructor-chosen Bloom level names; omitted = taxonomy defaults. */
    bloomLabels: v.optional(v.record(v.string(), v.string())),
    /**
     * "adaptive" (default) = AI/IRT model; "static" = attached questions in
     * the instructor's order; "random" = per-level draw from the bank.
     */
    selectionMode: v.optional(
      v.union(
        v.literal("adaptive"),
        v.literal("static"),
        v.literal("random"),
      ),
    ),
    /** Random mode: questions to draw at random from each Bloom level. */
    randomCounts: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (ctx, { classId, title, description, timeLimitMin, poolSize, displayCount, bloomLabels, selectionMode, randomCounts }) => {
    const { me, cls } = await requireOwnedClass(ctx, classId);
    if (cls.closedAt !== undefined)
      throw new Error(
        "This class is closed — reopen it before adding new assessments.",
      );
    if (!title.trim()) throw new Error("Title is required");
    if (timeLimitMin !== undefined && timeLimitMin < 0)
      throw new Error("Time limit cannot be negative");
    const mode = selectionMode ?? "adaptive";
    // Random mode derives the per-student question count from the draw, so the
    // adaptive pool/display pair does not apply.
    const counts = mode === "random" ? normalizeRandomCounts(randomCounts) : undefined;
    if (mode === "adaptive") {
      if (poolSize !== undefined && displayCount !== undefined)
        validateAdaptiveConfig(poolSize, displayCount);
      else if (poolSize !== undefined || displayCount !== undefined)
        throw new Error("Set both pool size and displayed questions together");
    }
    if (mode === "static" && (poolSize !== undefined || displayCount !== undefined))
      throw new Error(
        "Static assessments don't use a pool size — attach the questions they should contain.",
      );
    const customLabels = normalizeBloomLabels(bloomLabels);
    // Static papers carry no adaptive configuration: their length is whatever
    // the instructor attached (or the random draw they configured).
    const configFields = counts
      ? {
          displayCount: randomTotal(counts),
          randomCounts: counts,
          assessmentType: "static" as const,
        }
      : mode === "static"
        ? { assessmentType: "static" as const }
        : { poolSize, displayCount, assessmentType: "adaptive" as const };
    const id = await ctx.db.insert("instructorAssessments", {
      classId,
      instructorId: me._id,
      title: title.trim(),
      description,
      timeLimitMin: timeLimitMin ?? 0,
      ...configFields,
      selectionMode: mode,
      ...(customLabels ? { bloomLabels: customLabels } : {}),
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.created",
      entity: "instructorAssessments",
      entityId: id,
      newValue: { title, classId, poolSize, displayCount },
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
      poolSize: v.optional(v.number()),
      displayCount: v.optional(v.number()),
      /** Full level → name map; names equal to the taxonomy default are dropped. */
      bloomLabels: v.optional(v.record(v.string(), v.string())),
      /** "adaptive", "static" or "random" — switching re-derives the config. */
      selectionMode: v.optional(
        v.union(
          v.literal("adaptive"),
          v.literal("static"),
          v.literal("random"),
        ),
      ),
      /** Random mode: questions to draw at random from each Bloom level. */
      randomCounts: v.optional(v.record(v.string(), v.number())),
    }),
  },
  handler: async (ctx, { id, fields }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    if (a.status !== "draft")
      throw new Error("Only draft assessments can be edited");
    if (fields.timeLimitMin !== undefined && fields.timeLimitMin < 0)
      throw new Error("Time limit cannot be negative");
    // `undefined` removes the field, so resetting every name to the taxonomy
    // default clears the overrides instead of storing a redundant copy.
    const { bloomLabels, selectionMode, randomCounts, ...rest } = fields;
    const mode = selectionMode ?? a.selectionMode ?? "adaptive";

    // Random mode: the drawn total IS the number of questions per student, so
    // displayCount follows the counts and the adaptive pool knob is dropped.
    // Static mode carries no pool config at all; adaptive keeps its pair.
    let modeFields: {
      selectionMode: AssessmentMode;
      assessmentType: "static" | "adaptive";
      randomCounts?: Record<string, number>;
      displayCount?: number;
      poolSize?: number;
    };
    if (mode === "random") {
      const counts = normalizeRandomCounts(randomCounts ?? a.randomCounts);
      modeFields = {
        selectionMode: mode,
        assessmentType: "static",
        randomCounts: counts,
        displayCount: randomTotal(counts),
        poolSize: undefined,
      };
    } else if (mode === "static") {
      modeFields = {
        selectionMode: mode,
        assessmentType: "static",
        randomCounts: undefined,
        displayCount: undefined,
        poolSize: undefined,
      };
    } else {
      const poolSize = rest.poolSize ?? a.poolSize;
      const displayCount = rest.displayCount ?? a.displayCount;
      if (poolSize !== undefined && displayCount !== undefined)
        validateAdaptiveConfig(poolSize, displayCount);
      modeFields = {
        selectionMode: mode,
        assessmentType: "adaptive",
        randomCounts: undefined,
        poolSize,
        displayCount,
      };
    }

    await ctx.db.patch(id, {
      ...rest,
      ...modeFields,
      ...(bloomLabels !== undefined
        ? { bloomLabels: normalizeBloomLabels(bloomLabels) ?? undefined }
        : {}),
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.updated",
      entity: "instructorAssessments",
      entityId: id,
      previousValue: { title: a.title, timeLimitMin: a.timeLimitMin, poolSize: a.poolSize, displayCount: a.displayCount },
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
      const { questions: qs, fromBank } = await resolvePool(ctx, a);
      const mode = modeOf(a);
      if (mode === "random") {
        // Random mode: no manual selection — the pool is the class question
        // bank (or the attached subset). The only requirement is that every
        // requested draw can be satisfied from it.
        if (qs.length === 0)
          throw new Error(
            "This class has no questions yet — add questions to the bank before publishing a random assessment.",
          );
        const errors = randomPoolErrors(qs, a.randomCounts);
        if (errors.length > 0)
          throw new Error(
            fromBank
              ? errors.join(" ")
              : `${errors.join(" ")} Your ${qs.length} attached questions limit the draw — remove them to draw from the whole class bank.`,
          );
      } else if (mode === "static" || mode === "final") {
        // Traditional / final paper: whatever is attached, served to the
        // roster. No pool minimum and no Bloom coverage requirement.
        if (qs.length === 0)
          throw new Error(
            mode === "final"
              ? "The final exam has no questions attached."
              : "Attach at least one question before publishing a static assessment.",
          );
      } else {
        // Adaptive model publish gate: the pool must satisfy the configured
        // size and Bloom-coverage requirements before students see it.
        const report = evaluatePool(qs);
        if (!report.valid) throw new Error(report.errors.join(" "));
        const poolSize = a.poolSize ?? qs.length;
        const displayCount = a.displayCount ?? qs.length;
        validateAdaptiveConfig(poolSize, displayCount);
        if (qs.length !== poolSize) {
          throw new Error(
            `Pool size mismatch: ${qs.length} questions attached but the configured pool size is ${poolSize}. Attach exactly ${poolSize} questions.`,
          );
        }
        if (displayCount > qs.length) {
          throw new Error(
            `Displayed questions (${displayCount}) cannot exceed the pool (${qs.length}).`,
          );
        }
      }
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

/**
 * Fill a draft adaptive assessment's pool from the class question bank.
 *
 * The target is the configured pool size, split as evenly as possible across
 * the six Bloom levels with at least three questions per level. Existing
 * attachments are kept and only the gaps are filled, so manual choices are
 * never discarded. Returns the number added plus any levels still short.
 */
export const autoFillAssessmentQuestions = mutation({
  args: { assessmentId: v.id("instructorAssessments") },
  handler: async (ctx, { assessmentId }) => {
    const { a } = await requireOwnedAssessment(ctx, assessmentId);
    if (a.status !== "draft")
      throw new Error("Questions can only be changed on draft assessments");
    if (modeOf(a) !== "adaptive")
      throw new Error(
        "Fill Automatically is only available for adaptive assessments.",
      );

    const attached = await attachedQuestionsOf(ctx, assessmentId);
    const attachedIds = new Set(attached.map((q) => q._id));
    const available = (await bankQuestionsOf(ctx, a.classId)).filter(
      (q) => !attachedIds.has(q._id),
    );

    const targetSize = Math.max(
      ASSESSMENT_POOL_MIN,
      a.poolSize ?? ASSESSMENT_POOL_MIN,
    );
    const baseQuota = Math.floor(targetSize / BLOOM_KEYS.length);
    let extra = targetSize % BLOOM_KEYS.length;
    const quotaByLevel = new Map<string, number>();
    for (const level of BLOOM_KEYS) {
      quotaByLevel.set(level, baseQuota + (extra > 0 ? 1 : 0));
      if (extra > 0) extra -= 1;
    }

    const attachedByLevel = new Map<string, number>();
    for (const q of attached)
      attachedByLevel.set(
        q.bloomLevel,
        (attachedByLevel.get(q.bloomLevel) ?? 0) + 1,
      );

    const availableByLevel = new Map<string, QuestionDoc[]>();
    for (const q of available) {
      const rows = availableByLevel.get(q.bloomLevel) ?? [];
      rows.push(q);
      availableByLevel.set(q.bloomLevel, rows);
    }

    // Never exceed the configured pool: publish requires an exact match.
    let room = Math.max(0, targetSize - attached.length);
    const picks: QuestionDoc[] = [];
    const missing: Record<string, number> = {};
    for (const level of BLOOM_KEYS) {
      const need = Math.max(
        0,
        (quotaByLevel.get(level) ?? 0) -
          (attachedByLevel.get(level) ?? 0),
      );
      if (need === 0) continue;
      const candidates = availableByLevel.get(level) ?? [];
      const take = Math.min(need, candidates.length, room);
      picks.push(...candidates.slice(0, take));
      room -= take;
      if (need > take) missing[level] = need - take;
    }

    for (let i = 0; i < picks.length; i++) {
      await ctx.db.insert("assessmentQuestions", {
        assessmentId,
        questionId: picks[i]._id,
        order: attached.length + i,
      });
    }
    if (picks.length > 0)
      await ctx.db.patch(assessmentId, { updatedAt: Date.now() });

    return {
      added: picks.length,
      total: attached.length + picks.length,
      target: targetSize,
      missing,
    };
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
    const { questions } = await resolvePool(ctx, a);
    const qById = new Map(questions.map((q) => [q._id, q] as const));
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

    // Per-Bloom performance: re-grade each submission's answers against ITS
    // OWN presented sequence (adaptive), falling back to link order for
    // legacy linear submissions. Bucketing by Bloom level per submission.
    const bloomAgg = new Map<string, { earned: number; total: number; n: number }>();
    for (const s of subs) {
      if (s.status === "in_progress" || s.answers === undefined) continue;
      const { sequence } = normalizeSequence(s, questions.map((q) => q._id));
      const perBloom = new Map<string, { earned: number; total: number }>();
      for (let i = 0; i < sequence.length; i++) {
        const q = qById.get(sequence[i]);
        if (!q) continue;
        const given = (s.answers[i] ?? "").trim();
        const correct = gradeOne(q, given);
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
        poolSize: a.poolSize ?? null,
        displayCount: a.displayCount ?? null,
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

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
  gradeAnswer,
  normalizeSequence,
  randomPoolErrors,
  randomTotal,
  validateDisplayCount,
} from "./assessmentAdaptive";
import { answerFormatOf, resolveClassification } from "./taxonomy";
import { normalizeBloomLabels, resolveBloomLabels } from "../lib/irt";
import { formatDragDropAnswer, normalizeDragDropConfig } from "../lib/dragDrop";
import {
  DIFFICULTY_B,
  DIFFICULTY_LEVELS,
  difficultyLevelFromB,
} from "../lib/difficulty";
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

/**
 * Union of rostered and actively enrolled students for a class. Mirrors the
 * dashboard's membership rule so counts agree across the instructor UI.
 */
async function classMembersOf(ctx: QueryCtx, classId: Id<"classes">) {
  const roster = await ctx.db
    .query("students")
    .withIndex("by_class", (x) => x.eq("classId", classId))
    .collect();
  const enrollments = await ctx.db
    .query("classEnrollments")
    .withIndex("by_class", (x) => x.eq("classId", classId))
    .collect();
  const ids = new Set(roster.map((r) => r._id));
  for (const e of enrollments) ids.add(e.studentId);
  return { ids, roster };
}

/** Academic year label derived from a class creation timestamp (Sep–Aug). */
function academicYearOf(ts: number): string {
  const d = new Date(ts);
  const start = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}\u2013${start + 1}`;
}

/** Question count per Bloom level, in taxonomy order. */
function bloomDistributionOf(qs: QuestionDoc[]) {
  return BLOOM_KEYS.map((level) => ({
    level,
    count: qs.filter((q) => q.bloomLevel === level).length,
  }));
}

/** Question count per difficulty band (Easy → Expert). */
function difficultyDistributionOf(qs: QuestionDoc[]) {
  return DIFFICULTY_LEVELS.map((level) => ({
    level,
    count: qs.filter((q) => difficultyOf(q) === level).length,
  }));
}

/** Whether a submitted attempt counts as a pass (falls back to 50%). */
function passedOf(s: SubmissionDoc): boolean | null {
  if (s.status === "in_progress") return null;
  if (s.passed !== undefined) return s.passed;
  if (s.score === undefined || !s.maxScore) return null;
  return s.score / s.maxScore >= 0.5;
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
      v.literal("drag_drop"),
    ),
    options: v.optional(v.array(v.string())),
    correctAnswer: v.string(),
    dragDropTargets: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          hint: v.optional(v.string()),
        }),
      ),
    ),
    dragDropCorrect: v.optional(
      v.array(v.object({ targetId: v.string(), item: v.string() })),
    ),
    partialCredit: v.optional(v.boolean()),
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
    const dragConfig =
      args.questionType === "drag_drop"
        ? normalizeDragDropConfig({
            items: args.options,
            targets: args.dragDropTargets,
            correct: args.dragDropCorrect,
            partialCredit: args.partialCredit,
          })
        : null;
    const correctAnswer = dragConfig
      ? formatDragDropAnswer(dragConfig)
      : args.correctAnswer;

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
          : args.questionType === "multiple_choice" || args.questionType === "drag_drop"
            ? (dragConfig?.items ?? args.options)
            : undefined,
      correctAnswer,
      dragDropTargets: dragConfig?.targets,
      dragDropCorrect: dragConfig?.correct,
      partialCredit: dragConfig?.partialCredit,
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
      dragDropTargets: v.optional(
        v.array(
          v.object({
            id: v.string(),
            label: v.string(),
            hint: v.optional(v.string()),
          }),
        ),
      ),
      dragDropCorrect: v.optional(
        v.array(v.object({ targetId: v.string(), item: v.string() })),
      ),
      partialCredit: v.optional(v.boolean()),
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

    const dragConfig =
      q.questionType === "drag_drop" &&
      (fields.options !== undefined ||
        fields.dragDropTargets !== undefined ||
        fields.dragDropCorrect !== undefined ||
        fields.partialCredit !== undefined)
        ? normalizeDragDropConfig({
            items: fields.options ?? q.options,
            targets: fields.dragDropTargets ?? q.dragDropTargets,
            correct: fields.dragDropCorrect ?? q.dragDropCorrect,
            partialCredit: fields.partialCredit ?? q.partialCredit,
          })
        : null;

    await ctx.db.patch(id, {
      ...fields,
      ...(dragConfig
        ? {
            options: dragConfig.items,
            correctAnswer: formatDragDropAnswer(dragConfig),
            dragDropTargets: dragConfig.targets,
            dragDropCorrect: dragConfig.correct,
            partialCredit: dragConfig.partialCredit,
          }
        : {}),
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
    const { me, cls } = await requireOwnedClass(ctx, classId);
    const { ids: rosterIds, roster } = await classMembersOf(ctx, classId);

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
      const inProgress = valid.filter(
        (s) => s.status === "in_progress",
      ).length;
      const gradedScores = valid
        .filter((s) => s.score !== undefined && (s.maxScore ?? 0) > 0)
        .map((s) => ((s.score ?? 0) / (s.maxScore ?? 1)) * 100);
      const passCount = submitted.filter((s) => passedOf(s) === true).length;
      const failCount = submitted.filter((s) => passedOf(s) === false).length;
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
        /** Question distribution across the six Bloom levels. */
        bloomDistribution: bloomDistributionOf(qs),
        /** Question distribution across the four difficulty bands. */
        difficultyDistribution: difficultyDistributionOf(qs),
        totalMarks: maxTotal,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        publishedAt: a.publishedAt ?? null,
        scheduledFor: a.scheduledFor ?? null,
        archivedAt: a.archivedAt ?? null,
        /** Completed (submitted/graded) attempts. */
        submissions: submitted.length,
        /** Attempts currently being taken. */
        inProgress,
        passCount,
        failCount,
        rosterSize: rosterIds.size,
        avgPct:
          gradedScores.length > 0
            ? gradedScores.reduce((x, y) => x + y, 0) / gradedScores.length
            : null,
      });
    }
    return {
      className: cls.name,
      /** Class context shown in the workspace header. */
      classInfo: {
        id: cls._id,
        name: cls.name,
        subject: cls.subject ?? null,
        categoryId: cls.categoryId ?? null,
        academicYear: academicYearOf(cls.createdAt),
        createdAt: cls.createdAt,
        closedAt: cls.closedAt ?? null,
        studentCount: rosterIds.size,
        instructorName: me.name,
        instructorEmail: me.email ?? null,
      },
      assessments: out,
    };
  },
});

export const getAssessment = query({
  args: { id: v.id("instructorAssessments") },
  handler: async (ctx, { id }) => {
    // A direct URL to another instructor's assessment resolves to null — no
    // data is returned and the page can explain that it is unavailable.
    const owned = await requireOwnedAssessment(ctx, id).catch(() => null);
    if (!owned) return null;
    const { a, me, cls } = owned;
    const { questions, fromBank } = await resolvePool(ctx, a);
    const attached = await attachedQuestionsOf(ctx, id);
    const { ids: memberIds } = await classMembersOf(ctx, a.classId);
    const subs = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", id))
      .collect();
    const valid = subs.filter((s) => memberIds.has(s.studentId));
    const completed = valid.filter((s) => s.status !== "in_progress");
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
      bloomDistribution: bloomDistributionOf(questions),
      difficultyDistribution: difficultyDistributionOf(questions),
      totalMarks: questions.reduce((sum, q) => sum + q.marks, 0),
      classInfo: {
        id: cls._id,
        name: cls.name,
        subject: cls.subject ?? null,
        categoryId: cls.categoryId ?? null,
        academicYear: academicYearOf(cls.createdAt),
        studentCount: memberIds.size,
        instructorName: me.name,
        closedAt: cls.closedAt ?? null,
      },
      participation: {
        enrolled: memberIds.size,
        inProgress: valid.filter((s) => s.status === "in_progress").length,
        completed: completed.length,
        notStarted: Math.max(0, memberIds.size - valid.length),
        passed: completed.filter((s) => passedOf(s) === true).length,
        failed: completed.filter((s) => passedOf(s) === false).length,
      },
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
     * the instructor's order; "random" = per-level draw from the bank;
     * "final" = one shared set served in a per-student shuffled order.
     */
    selectionMode: v.optional(
      v.union(
        v.literal("adaptive"),
        v.literal("static"),
        v.literal("random"),
        v.literal("final"),
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
    if (
      (mode === "static" || mode === "final") &&
      (poolSize !== undefined || displayCount !== undefined)
    )
      throw new Error(
        "Fixed papers don't use a pool size — attach the questions they should contain.",
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
      : mode === "static" || mode === "final"
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
      /** "adaptive", "static", "random" or "final" — re-derives the config. */
      selectionMode: v.optional(
        v.union(
          v.literal("adaptive"),
          v.literal("static"),
          v.literal("random"),
          v.literal("final"),
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
    } else if (mode === "static" || mode === "final") {
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
    // Existing results are never destroyed by a delete: archive instead.
    const attempts = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", id))
      .collect();
    if (attempts.length > 0)
      throw new Error(
        "This assessment has student attempts. Close it and archive it instead of deleting, so results are preserved.",
      );
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

/**
 * Shared publication gate: an assessment may only become visible to the
 * roster once its paper (or adaptive pool) is complete and valid.
 */
async function assertPublishable(
  ctx: QueryCtx,
  a: Doc<"instructorAssessments">,
) {
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
    if (a.status === "archived")
      throw new Error(
        "This assessment is archived — restore it before changing its status.",
      );
    if (status === "published") await assertPublishable(ctx, a);
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

/**
 * Schedule an assessment to open at a future moment. Scheduling publishes a
 * draft in the same step (after the publish gate passes), so the roster can
 * see it on their list with a countdown; starts are refused until it opens.
 */
export const scheduleAssessment = mutation({
  args: {
    id: v.id("instructorAssessments"),
    /** Epoch ms; null clears the schedule (opens immediately). */
    scheduledFor: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { id, scheduledFor }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    if (a.status === "archived")
      throw new Error("Restore this archived assessment before scheduling it.");
    if (a.status === "closed")
      throw new Error(
        "This assessment is completed — reopen it as a draft before scheduling a new window.",
      );
    if (scheduledFor !== null) {
      if (!Number.isFinite(scheduledFor) || scheduledFor <= 0)
        throw new Error("Choose a valid date and time.");
      if (scheduledFor <= Date.now())
        throw new Error("Choose a future date and time for the assessment.");
    }
    const publishing = a.status === "draft";
    if (publishing) await assertPublishable(ctx, a);
    await ctx.db.patch(id, {
      scheduledFor: scheduledFor ?? undefined,
      ...(publishing
        ? { status: "published" as const, publishedAt: Date.now() }
        : {}),
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.scheduled",
      entity: "instructorAssessments",
      entityId: id,
      previousValue: { status: a.status, scheduledFor: a.scheduledFor ?? null },
      newValue: {
        status: publishing ? "published" : a.status,
        scheduledFor,
      },
    });
  },
});

/**
 * Archive a finished assessment. Archived papers keep their questions and
 * results but leave the active workspace list. In-progress attempts are
 * protected: they must finish (or be abandoned) first.
 */
export const archiveAssessment = mutation({
  args: { id: v.id("instructorAssessments") },
  handler: async (ctx, { id }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    if (a.status === "archived") return;
    const subs = await ctx.db
      .query("assessmentSubmissions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", id))
      .collect();
    if (subs.some((s) => s.status === "in_progress"))
      throw new Error(
        "Students are still taking this assessment — close it and wait for their attempts to finish before archiving.",
      );
    if (a.status === "published" && subs.length > 0)
      throw new Error(
        "Completed assessments are archived after closing them. Close this assessment first to protect its results.",
      );
    await ctx.db.patch(id, {
      status: "archived",
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.archived",
      entity: "instructorAssessments",
      entityId: id,
      previousValue: { status: a.status },
    });
  },
});

/** Restore an archived assessment to draft (questions and results intact). */
export const restoreAssessment = mutation({
  args: { id: v.id("instructorAssessments") },
  handler: async (ctx, { id }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    if (a.status !== "archived") throw new Error("This assessment is not archived.");
    await ctx.db.patch(id, {
      status: "draft",
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.restored",
      entity: "instructorAssessments",
      entityId: id,
      newValue: { status: "draft" },
    });
  },
});

/** Copy an assessment (settings + attached questions) as a new draft. */
export const duplicateAssessment = mutation({
  args: { id: v.id("instructorAssessments") },
  handler: async (ctx, { id }) => {
    const { a, me } = await requireOwnedAssessment(ctx, id);
    const now = Date.now();
    const base = a.title.trim();
    const title = `${base.slice(0, 110)} (copy)`;
    const newId = await ctx.db.insert("instructorAssessments", {
      classId: a.classId,
      instructorId: me._id,
      title,
      description: a.description,
      timeLimitMin: a.timeLimitMin,
      poolSize: a.poolSize,
      displayCount: a.displayCount,
      bloomLabels: a.bloomLabels,
      assessmentType: a.assessmentType,
      selectionMode: a.selectionMode,
      randomCounts: a.randomCounts,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    const links = await ctx.db
      .query("assessmentQuestions")
      .withIndex("by_assessment", (x) => x.eq("assessmentId", id))
      .collect();
    links.sort((x, y) => x.order - y.order);
    for (let i = 0; i < links.length; i++) {
      await ctx.db.insert("assessmentQuestions", {
        assessmentId: newId,
        questionId: links[i].questionId,
        order: i,
      });
    }
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "instructor_assessment.duplicated",
      entity: "instructorAssessments",
      entityId: newId,
      previousValue: { sourceId: id, title: a.title },
    });
    return newId;
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
 * Fill a draft assessment from the class question bank.
 *
 * Requirements (all optional):
 *  - `count`         total questions the paper should end up with
 *  - `bloomCounts`   exact per-level targets (overrides `count`)
 *  - `difficultyMix` relative weights per difficulty band
 *
 * Existing attachments are kept and only the gaps are filled, so manual
 * choices are never discarded and the same question can never be attached
 * twice. Without requirements an adaptive assessment fills to its configured
 * pool size, balanced across the six levels (the original behaviour).
 */
export const autoFillAssessmentQuestions = mutation({
  args: {
    assessmentId: v.id("instructorAssessments"),
    /** Target number of questions on the paper (existing + added). */
    count: v.optional(v.number()),
    /** Exact number of questions per Bloom level (overrides `count`). */
    bloomCounts: v.optional(v.record(v.string(), v.number())),
    /** Relative weights per difficulty band: easy|medium|hard|expert. */
    difficultyMix: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (
    ctx,
    { assessmentId, count, bloomCounts, difficultyMix },
  ) => {
    const { a } = await requireOwnedAssessment(ctx, assessmentId);
    if (a.status !== "draft")
      throw new Error("Questions can only be changed on draft assessments");

    const attached = await attachedQuestionsOf(ctx, assessmentId);
    const attachedIds = new Set(attached.map((q) => q._id));
    const available = (await bankQuestionsOf(ctx, a.classId)).filter(
      (q) => !attachedIds.has(q._id),
    );

    // ---- Targets: per-level quotas + paper size --------------------------
    const quotaByLevel = new Map<string, number>();
    const bloomGiven =
      bloomCounts !== undefined &&
      BLOOM_KEYS.some((level) => (bloomCounts[level] ?? 0) > 0);
    let targetSize: number;
    if (bloomGiven) {
      targetSize = 0;
      for (const level of BLOOM_KEYS) {
        const raw = bloomCounts?.[level] ?? 0;
        if (!Number.isFinite(raw) || raw < 0)
          throw new Error(
            `Questions per Bloom level must be 0 or more ("${level}").`,
          );
        const n = Math.floor(raw);
        quotaByLevel.set(level, n);
        targetSize += n;
      }
      if (targetSize < 1)
        throw new Error("Choose at least one question to add.");
    } else if (count !== undefined) {
      if (!Number.isInteger(count) || count < 1)
        throw new Error("Choose how many questions the paper should contain.");
      targetSize = count;
      const base = Math.floor(targetSize / BLOOM_KEYS.length);
      let extra = targetSize % BLOOM_KEYS.length;
      for (const level of BLOOM_KEYS) {
        quotaByLevel.set(level, base + (extra > 0 ? 1 : 0));
        if (extra > 0) extra -= 1;
      }
    } else if (modeOf(a) === "adaptive") {
      targetSize = Math.max(
        ASSESSMENT_POOL_MIN,
        a.poolSize ?? ASSESSMENT_POOL_MIN,
      );
      const base = Math.floor(targetSize / BLOOM_KEYS.length);
      let extra = targetSize % BLOOM_KEYS.length;
      for (const level of BLOOM_KEYS) {
        quotaByLevel.set(level, base + (extra > 0 ? 1 : 0));
        if (extra > 0) extra -= 1;
      }
    } else {
      throw new Error(
        "Set how many questions to add before filling a fixed paper automatically.",
      );
    }

    const attachedByLevel = new Map<string, number>();
    for (const q of attached)
      attachedByLevel.set(
        q.bloomLevel,
        (attachedByLevel.get(q.bloomLevel) ?? 0) + 1,
      );

    // ---- Difficulty preference ------------------------------------------
    const weights = new Map<DifficultyLevel, number>();
    let weightSum = 0;
    for (const level of DIFFICULTY_LEVELS) {
      const raw = difficultyMix?.[level] ?? 0;
      const w = Number.isFinite(raw) && raw > 0 ? raw : 0;
      weights.set(level, w);
      weightSum += w;
    }
    const difficultyTarget = new Map<DifficultyLevel, number>();
    for (const level of DIFFICULTY_LEVELS) {
      difficultyTarget.set(
        level,
        weightSum > 0 ? (targetSize * (weights.get(level) ?? 0)) / weightSum : 0,
      );
    }
    const difficultyPicked = new Map<DifficultyLevel, number>();

    /** Pick up to `need` questions of one Bloom level, honouring the mix. */
    const pickForLevel = (level: string, need: number): QuestionDoc[] => {
      const candidates = available.filter(
        (q) => q.bloomLevel === level && !picks.includes(q),
      );
      if (weightSum === 0) return candidates.slice(0, need);
      const picked: QuestionDoc[] = [];
      while (picked.length < need && candidates.length > 0) {
        let bestIndex = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < candidates.length; i++) {
          const d = difficultyOf(candidates[i]);
          // Largest unmet share first; easier band breaks ties.
          const unmet =
            (difficultyTarget.get(d) ?? 0) - (difficultyPicked.get(d) ?? 0);
          const score = unmet * 100 - DIFFICULTY_LEVELS.indexOf(d);
          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }
        const chosen = candidates.splice(bestIndex, 1)[0];
        picked.push(chosen);
        const d = difficultyOf(chosen);
        difficultyPicked.set(d, (difficultyPicked.get(d) ?? 0) + 1);
      }
      return picked;
    };

    // Never exceed the target: a full pool must match its declared size.
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
      const take = Math.min(need, room);
      const chosen = pickForLevel(level, take);
      picks.push(...chosen);
      room -= chosen.length;
      if (need > chosen.length) missing[level] = need - chosen.length;
    }

    // A plain total-count request is a size, not a per-level contract: when a
    // level runs dry, fill the remaining slots from any other level so the
    // paper still reaches its requested length. Explicit per-level counts are
    // never silently re-balanced.
    if (!bloomGiven && room > 0) {
      const leftover = available.filter((q) => !picks.includes(q));
      const extra = leftover.slice(0, room);
      picks.push(...extra);
      room -= extra.length;
      if (attached.length + picks.length >= targetSize) {
        for (const key of Object.keys(missing)) delete missing[key];
      }
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
    const owned = await requireOwnedAssessment(ctx, id).catch(() => null);
    if (!owned) return null;
    const { a } = owned;
    // Rostered students plus everyone who joined the class, so no member is
    // missing from participation statistics.
    const { ids: memberIds, roster: rosterRows } = await classMembersOf(
      ctx,
      a.classId,
    );
    const roster: Doc<"students">[] = [];
    for (const sid of memberIds) {
      const st = rosterRows.find((r) => r._id === sid) ?? (await ctx.db.get(sid));
      if (st) roster.push(st);
    }
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
        passed: s ? passedOf(s) : null,
        grade: s?.grade ?? null,
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
    const inProgress = rows.filter((r) => r.status === "in_progress").length;
    const notStarted = rows.filter((r) => r.status === null).length;
    const passedCount = rows.filter((r) => r.passed === true).length;
    const failedCount = rows.filter((r) => r.passed === false).length;

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
        const graded = gradeAnswer(q, given);
        const b = perBloom.get(q.bloomLevel) ?? { earned: 0, total: 0 };
        b.total += q.marks;
        b.earned += q.marks * graded.fraction;
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
        inProgress,
        notStarted,
        completed: submittedRows.filter((r) => r.status !== "in_progress").length,
        passed: passedCount,
        failed: failedCount,
        passRate:
          passedCount + failedCount > 0
            ? Math.round(
                (passedCount / (passedCount + failedCount)) * 1000,
              ) / 10
            : null,
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

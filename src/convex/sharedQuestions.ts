/**
 * Shared question bank — reusable questions that are not bound to a class.
 *
 * Sharing model:
 *   • every shared question carries `share` (absent/true = shared,
 *     false = private);
 *   • a shared row is visible to instructors who teach the same subject
 *     (or the same topic) as the row, plus always to its owner;
 *   • a class-bank question can be published to the bank in one click
 *     (`setBankQuestionShare`), which links the class row to a shared row
 *     through `sharedQuestionId`; toggling the link off makes the shared row
 *     private, which removes it from the bank while the class copy stays.
 *
 * Ownership: only the owner (or an admin) can change the share flag, edit or
 * delete a shared question. Admins manage every row.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { audit, currentUserOf } from "./adminLib";
import { requireOwnedClass } from "./instructorPortal";

type SharedDoc = Doc<"sharedQuestions">;
type BankDoc = Doc<"instructorQuestions">;

/** Bloom's Taxonomy level validator. */
const bloomArg = v.union(
  v.literal("remember"),
  v.literal("understand"),
  v.literal("apply"),
  v.literal("analyze"),
  v.literal("evaluate"),
  v.literal("create"),
);

/** Difficulty band validator. */
const difficultyArg = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
  v.literal("expert"),
);

/** Question type validator. */
const questionTypeArg = v.union(
  v.literal("multiple_choice"),
  v.literal("true_false"),
  v.literal("short_answer"),
);

// ---------------------------------------------------------------------------
// Caller + scope helpers
// ---------------------------------------------------------------------------

type Caller = {
  user: Doc<"users">;
  isAdmin: boolean;
  me: Doc<"instructors"> | null;
  /** Every instructor record linked to this account (normally one). */
  instructors: Doc<"instructors">[];
  /** Subjects taught by this account's classes. */
  subjects: string[];
};

/** Resolve the signed-in instructor/admin, or null for students/guests. */
async function callerOf(ctx: QueryCtx): Promise<Caller | null> {
  const user = await currentUserOf(ctx);
  if (!user) return null;
  const isAdmin = user.role === "admin";
  if (!isAdmin && user.role !== "instructor") return null;

  const all = await ctx.db.query("instructors").collect();
  const instructors = all.filter((r) => r.userId === user._id);
  const me = instructors[0] ?? null;

  const subjects: string[] = [];
  for (const inst of instructors) {
    const classes = await ctx.db
      .query("classes")
      .withIndex("by_instructor", (x) => x.eq("instructorId", inst._id))
      .collect();
    for (const c of classes) {
      const subject = (c.subject ?? "").trim();
      if (subject && !subjects.includes(subject)) subjects.push(subject);
    }
  }
  subjects.sort((a, b) => a.localeCompare(b));
  return { user, isAdmin, me, instructors, subjects };
}

/** The classes this caller can act on (admins get none — they have no roster). */
async function classesOf(ctx: QueryCtx, caller: Caller) {
  const out: Array<{
    id: Id<"classes">;
    name: string;
    subject: string | null;
    closedAt: number | null;
  }> = [];
  for (const inst of caller.instructors) {
    const rows = await ctx.db
      .query("classes")
      .withIndex("by_instructor", (x) => x.eq("instructorId", inst._id))
      .collect();
    for (const c of rows) {
      out.push({
        id: c._id,
        name: c.name,
        subject: c.subject?.trim() || null,
        closedAt: c.closedAt ?? null,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** A shared question belongs to a subject scope when its subject OR its
 *  topic matches one of the scope labels (case-insensitive). */
function inScope(row: SharedDoc, scope: string[]): boolean {
  if (scope.length === 0) return false;
  const wanted = new Set(scope.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const subject = (row.subject ?? "").trim().toLowerCase();
  const topic = (row.topic ?? "").trim().toLowerCase();
  return (subject !== "" && wanted.has(subject)) || (topic !== "" && wanted.has(topic));
}

/** Owner check that tolerates platform rows (no owner instructor). */
function isOwnerOf(caller: Caller, row: SharedDoc): boolean {
  if (!row.ownerInstructorId) return false;
  return caller.instructors.some((i) => i._id === row.ownerInstructorId);
}

/** True when the caller may edit/delete/share-toggle this shared row. */
function canManage(caller: Caller, row: SharedDoc): boolean {
  return caller.isAdmin || isOwnerOf(caller, row);
}

/** Throws unless the caller may manage this shared row. */
function assertCanManage(caller: Caller, row: SharedDoc): void {
  if (!canManage(caller, row)) {
    throw new Error("Only the instructor who created this question can change it");
  }
}

/** Persist an audit row for a shared-question action. */
async function logShared(
  ctx: MutationCtx,
  caller: Caller,
  action: string,
  entityId: string,
  detail: string,
  values?: { previousValue?: unknown; newValue?: unknown },
): Promise<void> {
  await audit(ctx, caller.user, {
    action,
    entity: "sharedQuestions",
    entityId,
    detail,
    previousValue: values?.previousValue,
    newValue: values?.newValue,
  });
}

/** Normalize a free-text field: trimmed, or undefined when empty. */
function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Validate a question shape shared by create/update/publish. */
function validateQuestionShape(input: {
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options?: string[];
  correctAnswer: string;
}): { options: string[] | undefined; correctAnswer: string } {
  if (input.questionType === "multiple_choice") {
    const options = (input.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) {
      throw new Error("Multiple-choice questions need at least 2 options");
    }
    if (!options.includes(input.correctAnswer.trim())) {
      throw new Error("Correct answer must be one of the options");
    }
    return { options, correctAnswer: input.correctAnswer.trim() };
  }
  if (input.questionType === "true_false") {
    return { options: ["True", "False"], correctAnswer: input.correctAnswer.trim() };
  }
  return { options: undefined, correctAnswer: input.correctAnswer.trim() };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type SharedQuestionCard = {
  _id: Id<"sharedQuestions">;
  subject: string;
  topic: string | null;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options: string[] | null;
  correctAnswer: string;
  explanation: string | null;
  marks: number;
  bloomLevel: SharedDoc["bloomLevel"];
  difficultyLevel: SharedDoc["difficultyLevel"] | null;
  expectedTimeSec: number;
  ownerInstructorId: string | null;
  ownerName: string;
  status: "active" | "archived";
  share: boolean;
  createdAt: number;
  updatedAt: number;
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  importedClassIds: string[];
};

export type SharedQuestionsContext = {
  role: "instructor" | "admin";
  classes: Array<{ id: string; name: string; subject: string | null; closedAt: number | null }>;
  mySubjects: string[];
  subjects: string[];
  topics: string[];
  forcedSubject: string | null;
  questions: SharedQuestionCard[];
};

/**
 * The single source of truth for the Shared Questions page: the caller's
 * role, their classes, the subject scope of the selected class, and every
 * sharing-visible row.
 */
export const getSharedQuestionsContext = query({
  args: {
    classId: v.optional(v.id("classes")),
    mineOnly: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SharedQuestionsContext | null> => {
    const caller = await callerOf(ctx);
    if (!caller) return null;

    const classes = await classesOf(ctx, caller);
    const selectedClass = args.classId
      ? classes.find((c) => c.id === args.classId) ?? null
      : null;
    const classSubject = selectedClass?.subject ?? "";
    const scope = classSubject ? [classSubject] : caller.subjects;

    // Which of the caller's classes have already imported each shared row.
    const importedBy = new Map<string, string[]>();
    for (const cls of classes) {
      const rows = await ctx.db
        .query("instructorQuestions")
        .withIndex("by_class", (x) => x.eq("classId", cls.id))
        .collect();
      for (const row of rows) {
        if (!row.sharedQuestionId) continue;
        const list = importedBy.get(row.sharedQuestionId) ?? [];
        if (!list.includes(cls.id)) list.push(cls.id);
        importedBy.set(row.sharedQuestionId, list);
      }
    }

    const rows = await ctx.db.query("sharedQuestions").collect();
    const cards: SharedQuestionCard[] = [];
    for (const row of rows) {
      if (row.status === "archived" && !args.includeArchived) continue;
      const owner = isOwnerOf(caller, row);
      if (!caller.isAdmin && !owner) {
        if (row.share === false) continue;
        if (!inScope(row, scope)) continue;
      }
      if (args.mineOnly && !owner) continue;
      cards.push({
        _id: row._id,
        subject: row.subject,
        topic: row.topic ?? null,
        questionText: row.questionText,
        questionType: row.questionType,
        options: row.options ?? null,
        correctAnswer: row.correctAnswer,
        explanation: row.explanation ?? null,
        marks: row.marks,
        bloomLevel: row.bloomLevel,
        difficultyLevel: row.difficultyLevel ?? null,
        expectedTimeSec: row.expectedTimeSec,
        ownerInstructorId: row.ownerInstructorId ?? null,
        ownerName: row.ownerName,
        status: row.status,
        share: row.share !== false,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isOwner: owner,
        canEdit: canManage(caller, row),
        canDelete: canManage(caller, row),
        importedClassIds: importedBy.get(row._id) ?? [],
      });
    }

    cards.sort((a, b) => {
      const s = a.subject.localeCompare(b.subject);
      if (s !== 0) return s;
      const t = (a.topic ?? "").localeCompare(b.topic ?? "");
      if (t !== 0) return t;
      return b.createdAt - a.createdAt;
    });

    const subjects = [...new Set(cards.map((c) => c.subject))].sort((a, b) =>
      a.localeCompare(b),
    );
    const topics = [
      ...new Set(cards.map((c) => (c.topic ?? "").trim() || "General")),
    ].sort((a, b) => {
      if (a === "General") return 1;
      if (b === "General") return -1;
      return a.localeCompare(b);
    });

    return {
      role: caller.isAdmin ? "admin" : "instructor",
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        subject: c.subject,
        closedAt: c.closedAt,
      })),
      mySubjects: caller.subjects,
      subjects,
      topics,
      forcedSubject: classSubject || null,
      questions: cards,
    };
  },
});

/**
 * Share state of every question in a class question bank, keyed by the
 * class-bank question id. Drives the per-question toggle in the class
 * Question Bank.
 */
export const getClassShareStates = query({
  args: { classId: v.id("classes") },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      questionId: string;
      sharedQuestionId: string | null;
      share: boolean;
      canToggle: boolean;
      ownerName: string | null;
    }>
  > => {
    const caller = await callerOf(ctx);
    if (!caller) return [];

    // Instructors may only read their own class; admins audit any class.
    if (!caller.isAdmin) {
      await requireOwnedClass(ctx, args.classId);
    }

    const rows = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_class", (x) => x.eq("classId", args.classId))
      .collect();

    const out: Array<{
      questionId: string;
      sharedQuestionId: string | null;
      share: boolean;
      canToggle: boolean;
      ownerName: string | null;
    }> = [];

    for (const row of rows) {
      let shared: SharedDoc | null = null;
      if (row.sharedQuestionId) shared = await ctx.db.get(row.sharedQuestionId);
      out.push({
        questionId: row._id,
        sharedQuestionId: row.sharedQuestionId ?? null,
        share: shared ? shared.share !== false : false,
        canToggle: shared ? canManage(caller, shared) : true,
        ownerName: shared?.ownerName ?? null,
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Share / private
// ---------------------------------------------------------------------------

/** Toggle a class-bank question between shared and private. */
export const setBankQuestionShare = mutation({
  args: {
    questionId: v.id("instructorQuestions"),
    share: v.boolean(),
  },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");

    const question = await ctx.db.get(args.questionId);
    if (!question) throw new Error("Question not found");
    const cls = await ctx.db.get(question.classId);
    if (!cls) throw new Error("Class not found");
    if (!caller.isAdmin) {
      if (!caller.me || cls.instructorId !== caller.me._id) {
        throw new Error("You do not own this question");
      }
    }

    const now = Date.now();
    let shared: SharedDoc | null = question.sharedQuestionId
      ? await ctx.db.get(question.sharedQuestionId)
      : null;
    if (shared) assertCanManage(caller, shared);

    if (args.share) {
      const subject = (cls.subject ?? "").trim();
      if (!shared) {
        if (!subject) {
          throw new Error(
            "Set this class's subject before sharing its questions with the bank.",
          );
        }
        const owner = await ctx.db.get(cls.instructorId);
        const { options, correctAnswer } = validateQuestionShape({
          questionType: question.questionType,
          options: question.options,
          correctAnswer: question.correctAnswer,
        });
        const sharedId = await ctx.db.insert("sharedQuestions", {
          subject,
          topic: optionalText(question.topic),
          questionText: question.questionText,
          questionType: question.questionType,
          options,
          correctAnswer,
          explanation: question.explanation,
          marks: question.marks,
          bloomLevel: question.bloomLevel,
          difficultyLevel: question.difficultyLevel,
          expectedTimeSec: question.expectedTimeSec,
          difficultyB: question.difficultyB,
          discriminationA: question.discriminationA,
          ownerInstructorId: cls.instructorId,
          ownerName: owner?.name ?? "Instructor",
          status: "active",
          share: true,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.patch(question._id, { sharedQuestionId: sharedId, updatedAt: now });
        await logShared(
          ctx,
          caller,
          "sharedQuestions.publish",
          sharedId,
          `Published class question to the shared bank (${subject})`,
          { newValue: { share: true, questionId: question._id } },
        );
        return { share: true, sharedQuestionId: sharedId };
      }

      if (shared.share === false || shared.status === "archived") {
        await ctx.db.patch(shared._id, {
          share: true,
          status: "active",
          updatedAt: now,
        });
        await logShared(
          ctx,
          caller,
          "sharedQuestions.share_toggle",
          shared._id,
          "Question shared with the bank",
          {
            previousValue: { share: shared.share !== false },
            newValue: { share: true },
          },
        );
      }
      if (!question.sharedQuestionId) {
        await ctx.db.patch(question._id, { sharedQuestionId: shared._id, updatedAt: now });
      }
      return { share: true, sharedQuestionId: shared._id };
    }

    // Private: keep the link (so it can be shared again) but hide the row.
    if (shared && shared.share !== false) {
      await ctx.db.patch(shared._id, { share: false, updatedAt: now });
      await logShared(
        ctx,
        caller,
        "sharedQuestions.share_toggle",
        shared._id,
        "Question made private (removed from the shared bank)",
        {
          previousValue: { share: true },
          newValue: { share: false },
        },
      );
    }
    return { share: false, sharedQuestionId: shared?._id ?? null };
  },
});

/** Flip the share flag on a shared-bank row directly. */
export const setSharedQuestionShare = mutation({
  args: {
    id: v.id("sharedQuestions"),
    share: v.boolean(),
  },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");

    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Shared question not found");
    assertCanManage(caller, row);

    const current = row.share !== false;
    if (current === args.share) return { id: row._id, share: current };

    const now = Date.now();
    await ctx.db.patch(row._id, { share: args.share, updatedAt: now });
    await logShared(
      ctx,
      caller,
      "sharedQuestions.share_toggle",
      row._id,
      args.share ? "Question shared with the bank" : "Question made private",
      { previousValue: { share: current }, newValue: { share: args.share } },
    );
    return { id: row._id, share: args.share };
  },
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const createSharedQuestion = mutation({
  args: {
    subject: v.string(),
    topic: v.optional(v.string()),
    questionText: v.string(),
    questionType: questionTypeArg,
    options: v.optional(v.array(v.string())),
    correctAnswer: v.string(),
    explanation: v.optional(v.string()),
    marks: v.number(),
    bloomLevel: bloomArg,
    difficultyLevel: v.optional(difficultyArg),
    expectedTimeSec: v.number(),
    share: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");

    const subject = args.subject.trim();
    if (!subject) throw new Error("Subject is required");
    if (!args.questionText.trim()) throw new Error("Question text is required");
    if (!args.correctAnswer.trim()) throw new Error("Correct answer is required");

    const { options, correctAnswer } = validateQuestionShape(args);
    const now = Date.now();
    const id = await ctx.db.insert("sharedQuestions", {
      subject,
      topic: optionalText(args.topic),
      questionText: args.questionText.trim(),
      questionType: args.questionType,
      options,
      correctAnswer,
      explanation: optionalText(args.explanation),
      marks: Math.max(1, Math.round(args.marks) || 1),
      bloomLevel: args.bloomLevel,
      difficultyLevel: args.difficultyLevel,
      expectedTimeSec: Math.max(10, Math.round(args.expectedTimeSec) || 60),
      ownerInstructorId: caller.isAdmin ? undefined : caller.me?._id,
      ownerName: caller.isAdmin ? "Admin" : caller.me?.name ?? "Instructor",
      createdByUserId: caller.user._id,
      status: "active",
      share: args.share !== false,
      createdAt: now,
      updatedAt: now,
    });

    await logShared(
      ctx,
      caller,
      "sharedQuestions.create",
      id,
      `Created shared question in "${subject}"`,
      { newValue: { subject, share: args.share !== false } },
    );
    return { id };
  },
});

export const updateSharedQuestion = mutation({
  args: {
    id: v.id("sharedQuestions"),
    fields: v.object({
      subject: v.string(),
      topic: v.optional(v.string()),
      questionText: v.string(),
      questionType: questionTypeArg,
      options: v.optional(v.array(v.string())),
      correctAnswer: v.string(),
      explanation: v.optional(v.string()),
      marks: v.number(),
      bloomLevel: bloomArg,
      difficultyLevel: v.optional(difficultyArg),
      expectedTimeSec: v.number(),
      share: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");

    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Shared question not found");
    assertCanManage(caller, row);

    const fields = args.fields;
    const subject = fields.subject.trim();
    if (!subject) throw new Error("Subject is required");
    if (!fields.questionText.trim()) throw new Error("Question text is required");
    if (!fields.correctAnswer.trim()) throw new Error("Correct answer is required");

    const { options, correctAnswer } = validateQuestionShape({
      questionType: fields.questionType,
      options: fields.options,
      correctAnswer: fields.correctAnswer,
    });

    const share = fields.share ?? (row.share !== false);
    const now = Date.now();
    await ctx.db.patch(row._id, {
      subject,
      topic: optionalText(fields.topic),
      questionText: fields.questionText.trim(),
      questionType: fields.questionType,
      options,
      correctAnswer,
      explanation: optionalText(fields.explanation),
      marks: Math.max(1, Math.round(fields.marks) || 1),
      bloomLevel: fields.bloomLevel,
      difficultyLevel: fields.difficultyLevel,
      expectedTimeSec: Math.max(10, Math.round(fields.expectedTimeSec) || 60),
      share,
      updatedAt: now,
    });

    await logShared(
      ctx,
      caller,
      "sharedQuestions.update",
      row._id,
      `Updated shared question in "${subject}"`,
      {
        previousValue: { subject: row.subject, share: row.share !== false },
        newValue: { subject, share },
      },
    );
    return { id: row._id };
  },
});

export const setSharedQuestionArchived = mutation({
  args: {
    id: v.id("sharedQuestions"),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");

    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Shared question not found");
    assertCanManage(caller, row);

    const status = args.archived ? ("archived" as const) : ("active" as const);
    if (row.status === status) return { id: row._id };

    await ctx.db.patch(row._id, { status, updatedAt: Date.now() });
    await logShared(
      ctx,
      caller,
      args.archived ? "sharedQuestions.archive" : "sharedQuestions.restore",
      row._id,
      args.archived ? "Archived shared question" : "Restored shared question",
      { previousValue: { status: row.status }, newValue: { status } },
    );
    return { id: row._id };
  },
});

/** Delete a shared row. Class banks that imported it keep their copy — only
 *  the link is detached. */
export const deleteSharedQuestion = mutation({
  args: { id: v.id("sharedQuestions") },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");

    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Shared question not found");
    assertCanManage(caller, row);

    const imports = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_shared", (x) => x.eq("sharedQuestionId", args.id))
      .collect();
    const now = Date.now();
    for (const imp of imports) {
      await ctx.db.patch(imp._id, {
        sharedQuestionId: undefined,
        source: "manual",
        updatedAt: now,
      });
    }

    await ctx.db.delete(row._id);
    await logShared(
      ctx,
      caller,
      "sharedQuestions.delete",
      row._id,
      `Deleted shared question from "${row.subject}"`,
      { previousValue: { subject: row.subject, detachedImports: imports.length } },
    );
    return { detachedImports: imports.length };
  },
});

/** Copy a shared question into a class question bank (by reference). */
export const importSharedQuestion = mutation({
  args: {
    sharedQuestionId: v.id("sharedQuestions"),
    classId: v.id("classes"),
  },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");
    const { me, cls } = await requireOwnedClass(ctx, args.classId);

    const shared = await ctx.db.get(args.sharedQuestionId);
    if (!shared) throw new Error("Shared question not found");
    if (shared.status === "archived") throw new Error("This question is archived");
    if (shared.share === false && !canManage(caller, shared)) {
      throw new Error("This question is private");
    }
    if (!canManage(caller, shared)) {
      const subject = (cls.subject ?? "").trim();
      const scope = subject ? [subject] : caller.subjects;
      if (!inScope(shared, scope)) {
        throw new Error("This question belongs to a subject you do not teach");
      }
    }

    const existing = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_shared", (x) => x.eq("sharedQuestionId", args.sharedQuestionId))
      .collect();
    if (existing.some((r) => r.classId === args.classId)) {
      return { alreadyImported: true };
    }

    const now = Date.now();
    await ctx.db.insert("instructorQuestions", {
      classId: args.classId,
      instructorId: me._id,
      questionText: shared.questionText,
      questionType: shared.questionType,
      options: shared.options,
      correctAnswer: shared.correctAnswer,
      explanation: shared.explanation,
      marks: shared.marks,
      bloomLevel: shared.bloomLevel,
      difficultyLevel: shared.difficultyLevel,
      expectedTimeSec: shared.expectedTimeSec,
      difficultyB: shared.difficultyB,
      discriminationA: shared.discriminationA,
      source: "shared",
      sharedQuestionId: shared._id,
      topic: shared.topic,
      createdAt: now,
      updatedAt: now,
    });

    await audit(ctx, caller.user, {
      action: "sharedQuestions.import",
      entity: "classes",
      entityId: args.classId,
      detail: `Imported shared question into ${cls.name}`,
      newValue: { sharedQuestionId: shared._id },
    });
    return { alreadyImported: false };
  },
});

/** Set the subject a class uses for shared-question scoping. */
export const setClassSubject = mutation({
  args: {
    classId: v.id("classes"),
    subject: v.string(),
  },
  handler: async (ctx, args) => {
    const caller = await callerOf(ctx);
    if (!caller) throw new Error("Instructor access required");
    if (!caller.isAdmin) await requireOwnedClass(ctx, args.classId);

    const cls = await ctx.db.get(args.classId);
    if (!cls) throw new Error("Class not found");

    const subject = args.subject.trim().slice(0, 60);
    if (!subject) throw new Error("Enter a subject");
    await ctx.db.patch(args.classId, { subject });
    await audit(ctx, caller.user, {
      action: "classes.set_subject",
      entity: "classes",
      entityId: args.classId,
      previousValue: { subject: cls.subject ?? null },
      newValue: { subject },
      detail: `Set class subject to "${subject}"`,
    });
    return { subject };
  },
});

/** Small helper kept for callers that need a question doc by id. */
export async function bankQuestionOf(
  ctx: QueryCtx,
  id: Id<"instructorQuestions">,
): Promise<BankDoc | null> {
  return await ctx.db.get(id);
}

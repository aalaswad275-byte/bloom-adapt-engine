/**
 * Shared question bank — reusable questions that are not bound to a class.
 *
 * Visibility & permissions
 *   • Instructors see only questions whose subject matches a subject they
 *     teach (the selected class's subject first). They may create their own
 *     shared questions and edit/delete only those.
 *   • Admins see and manage every shared question (add, edit, delete, archive).
 *
 * Import semantics
 *   Importing creates ONE class-pool entry (`instructorQuestions`) that keeps
 *   a `sharedQuestionId` reference. Importing the same shared question into a
 *   class again returns that same entry — never a second copy. Later edits to
 *   the shared question are synced into every imported entry, so classes keep
 *   a single source of truth. Deleting a shared question detaches imports,
 *   leaving their last content intact so published assessments never break.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { audit, currentUserOf } from "./adminLib";
import { DIFFICULTY_B } from "../lib/difficulty";

type SharedDoc = Doc<"sharedQuestions">;
type ClassDoc = Doc<"classes">;

const bloomArg = v.union(
  v.literal("remember"),
  v.literal("understand"),
  v.literal("apply"),
  v.literal("analyze"),
  v.literal("evaluate"),
  v.literal("create"),
);

const difficultyArg = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
  v.literal("expert"),
);

const questionTypeArg = v.union(
  v.literal("multiple_choice"),
  v.literal("true_false"),
  v.literal("short_answer"),
);

type Viewer =
  | {
      role: "admin";
      user: Doc<"users">;
      instructorId: null;
      name: string;
    }
  | {
      role: "instructor";
      user: Doc<"users">;
      instructorId: Id<"instructors">;
      name: string;
    };

/** Normalized comparison key for subjects/topics. */
function keyOf(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/** Resolve the caller and enforce instructor-or-admin access. */
async function resolveViewer(ctx: QueryCtx): Promise<Viewer> {
  const user = await currentUserOf(ctx);
  if (!user) throw new Error("Sign in required");
  if (user.role === "admin") {
    return {
      role: "admin",
      user,
      instructorId: null,
      name: user.name?.trim() || "Admin",
    };
  }
  if (user.role !== "instructor")
    throw new Error("Instructor or admin access required");
  const all = await ctx.db.query("instructors").collect();
  const me = all.find((i) => i.userId === user._id);
  if (!me)
    throw new Error("No instructor profile linked to this account");
  return {
    role: "instructor",
    user,
    instructorId: me._id,
    name: me.name,
  };
}

/** Classes owned by an instructor. */
async function classesOf(
  ctx: QueryCtx,
  instructorId: Id<"instructors">,
): Promise<ClassDoc[]> {
  const rows = await ctx.db
    .query("classes")
    .withIndex("by_instructor", (q) => q.eq("instructorId", instructorId))
    .collect();
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function canManage(viewer: Viewer, q: SharedDoc): boolean {
  if (viewer.role === "admin") return true;
  return q.ownerInstructorId === viewer.instructorId;
}

/** Normalize + validate authored question content. */
function normalizeContent(input: {
  subject: string;
  topic?: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  marks: number;
  bloomLevel: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  difficultyLevel?: "easy" | "medium" | "hard" | "expert";
  expectedTimeSec: number;
  difficultyB?: number;
  discriminationA?: number;
}) {
  const subject = input.subject.trim();
  if (!subject) throw new Error("Subject is required");
  if (subject.length > 60) throw new Error("Subject is too long (max 60)");
  const questionText = input.questionText.trim();
  if (!questionText) throw new Error("Question text is required");
  if (input.marks <= 0) throw new Error("Marks must be positive");
  if (input.expectedTimeSec < 10 || input.expectedTimeSec > 7200)
    throw new Error("Expected answer time must be between 10s and 2h");
  if (
    input.discriminationA !== undefined &&
    (input.discriminationA <= 0 || input.discriminationA > 4)
  )
    throw new Error("Discrimination a must be in (0, 4]");
  if (
    input.difficultyB !== undefined &&
    (input.difficultyB < -3 || input.difficultyB > 3)
  )
    throw new Error("Difficulty b must be within [-3, 3]");

  let options: string[] | undefined;
  const correctAnswer = input.correctAnswer.trim();
  if (!correctAnswer) throw new Error("Correct answer is required");
  if (input.questionType === "multiple_choice") {
    options = (input.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (options.length < 2)
      throw new Error("Multiple-choice questions need at least 2 options");
    if (!options.includes(correctAnswer))
      throw new Error("Correct answer must be one of the options");
  } else if (input.questionType === "true_false") {
    options = ["True", "False"];
    if (correctAnswer !== "True" && correctAnswer !== "False")
      throw new Error("True/False answer must be True or False");
  }

  return {
    subject: subject.slice(0, 60),
    topic: input.topic?.trim().slice(0, 80) || undefined,
    questionText: questionText.slice(0, 4000),
    questionType: input.questionType,
    options,
    correctAnswer,
    explanation: input.explanation?.trim() || undefined,
    marks: input.marks,
    bloomLevel: input.bloomLevel,
    difficultyLevel: input.difficultyLevel,
    expectedTimeSec: input.expectedTimeSec,
    difficultyB:
      input.difficultyB ??
      (input.difficultyLevel ? DIFFICULTY_B[input.difficultyLevel] : undefined),
    discriminationA: input.discriminationA,
  };
}

/** Fields synced into imported class-pool entries when a shared row changes. */
type SyncedContent = {
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options: string[] | undefined;
  correctAnswer: string;
  explanation: string | undefined;
  marks: number;
  bloomLevel: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  difficultyLevel: "easy" | "medium" | "hard" | "expert" | undefined;
  expectedTimeSec: number;
  difficultyB: number | undefined;
  discriminationA: number | undefined;
  topic: string | undefined;
};

async function syncImports(
  ctx: MutationCtx,
  sharedQuestionId: Id<"sharedQuestions">,
  content: SyncedContent,
) {
  const imports = await ctx.db
    .query("instructorQuestions")
    .withIndex("by_shared", (q) => q.eq("sharedQuestionId", sharedQuestionId))
    .collect();
  for (const row of imports) {
    await ctx.db.patch(row._id, { ...content, updatedAt: Date.now() });
  }
  return imports.length;
}

/** Public subject/topic/class context for the Shared Questions page. */
export const getSharedQuestionsContext = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx);
    const classes =
      viewer.role === "instructor"
        ? await classesOf(ctx, viewer.instructorId)
        : [];
    const rows = await ctx.db.query("sharedQuestions").collect();
    const visible = rows.filter(
      (q) => q.status === "active" || canManage(viewer, q),
    );

    const subjects = [...new Set(visible.map((q) => q.subject.trim()))].sort(
      (a, b) => a.localeCompare(b),
    );
    const topics = [
      ...new Set(
        visible
          .map((q) => q.topic?.trim() ?? "")
          .filter((t) => t.length > 0),
      ),
    ].sort((a, b) => a.localeCompare(b));

    return {
      role: viewer.role,
      viewerName: viewer.name,
      canManageAll: viewer.role === "admin",
      classes: classes.map((c) => ({
        id: c._id,
        name: c.name,
        subject: c.subject ?? null,
        closedAt: c.closedAt ?? null,
      })),
      /** Subjects the instructor teaches (from class subjects). */
      mySubjects: [
        ...new Set(
          classes
            .map((c) => c.subject?.trim() ?? "")
            .filter((s) => s.length > 0),
        ),
      ].sort((a, b) => a.localeCompare(b)),
      subjects,
      topics,
      total: visible.length,
    };
  },
});

/**
 * List shared questions visible to the caller.
 *
 * Instructors: if `classId` is supplied and that class has a subject, only
 * questions in that subject are returned. Without a class subject, the scope
 * is the union of the instructor's class subjects. Legacy instructors with no
 * class subjects see the whole active bank (so the feature is usable before
 * they set a subject).
 */
export const listSharedQuestions = query({
  args: {
    classId: v.optional(v.id("classes")),
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    search: v.optional(v.string()),
    mineOnly: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await resolveViewer(ctx);

    let forcedSubjectKey: string | null = null;
    let allowedSubjects: Set<string> | null = null;
    let classes: ClassDoc[] = [];
    const importedBy = new Map<string, Id<"classes">[]>();

    if (viewer.role === "instructor") {
      classes = await classesOf(ctx, viewer.instructorId);
      if (args.classId) {
        const cls = classes.find((c) => c._id === args.classId);
        if (!cls)
          throw new Error("You can only browse shared questions for your own classes");
        if (cls.subject?.trim()) forcedSubjectKey = keyOf(cls.subject);
      }
      if (!forcedSubjectKey) {
        const subjects = new Set(
          classes
            .map((c) => keyOf(c.subject))
            .filter((s) => s.length > 0),
        );
        if (subjects.size > 0) allowedSubjects = subjects;
      }
      // Track which of this instructor's classes already imported each row.
      for (const cls of classes) {
        const bank = await ctx.db
          .query("instructorQuestions")
          .withIndex("by_class", (q) => q.eq("classId", cls._id))
          .collect();
        for (const row of bank) {
          if (!row.sharedQuestionId) continue;
          const list = importedBy.get(row.sharedQuestionId) ?? [];
          list.push(cls._id);
          importedBy.set(row.sharedQuestionId, list);
        }
      }
    }

    const wantTopic = keyOf(args.topic);
    const query = keyOf(args.search);
    const rows = await ctx.db.query("sharedQuestions").collect();

    const questions = rows
      .filter((q) => {
        if (q.status === "archived") {
          // Archived rows are owner/admin-only and opt-in.
          if (!args.includeArchived) return false;
          if (!canManage(viewer, q)) return false;
        }
        // "My questions" is a cross-subject management scope: owners always
        // find their own rows even after they stop teaching that subject.
        if (viewer.role === "instructor" && args.mineOnly) {
          if (q.ownerInstructorId !== viewer.instructorId) return false;
        } else {
          if (forcedSubjectKey && keyOf(q.subject) !== forcedSubjectKey)
            return false;
          if (
            !forcedSubjectKey &&
            allowedSubjects &&
            !allowedSubjects.has(keyOf(q.subject))
          )
            return false;
          if (args.subject && keyOf(q.subject) !== keyOf(args.subject))
            return false;
        }
        if (wantTopic && keyOf(q.topic) !== wantTopic) return false;
        if (query) {
          const haystack = `${q.questionText} ${q.topic ?? ""} ${q.explanation ?? ""} ${q.subject}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const s = a.subject.localeCompare(b.subject);
        if (s !== 0) return s;
        const t = keyOf(a.topic).localeCompare(keyOf(b.topic));
        if (t !== 0) return t;
        return b.updatedAt - a.updatedAt;
      })
      .map((q) => ({
        ...q,
        isOwner:
          viewer.role === "instructor" &&
          q.ownerInstructorId === viewer.instructorId,
        canEdit: canManage(viewer, q),
        canDelete: canManage(viewer, q),
        importedClassIds: importedBy.get(q._id) ?? [],
      }));

    return {
      role: viewer.role,
      questions,
      forcedSubject:
        classes.find((c) => c._id === args.classId)?.subject ?? null,
      classes: classes.map((c) => ({
        id: c._id,
        name: c.name,
        subject: c.subject ?? null,
        closedAt: c.closedAt ?? null,
      })),
    };
  },
});

/** Fetch one shared question (subject-scoped for instructors). */
export const getSharedQuestion = query({
  args: { id: v.id("sharedQuestions") },
  handler: async (ctx, { id }) => {
    const viewer = await resolveViewer(ctx);
    const q = await ctx.db.get(id);
    if (!q) throw new Error("Shared question not found");

    if (viewer.role === "instructor" && !canManage(viewer, q)) {
      if (q.status !== "active") throw new Error("Shared question not found");
      const classes = await classesOf(ctx, viewer.instructorId);
      const subjects = new Set(
        classes.map((c) => keyOf(c.subject)).filter((s) => s.length > 0),
      );
      if (subjects.size > 0 && !subjects.has(keyOf(q.subject)))
        throw new Error("This question belongs to a subject you do not teach");
    }
    return {
      ...q,
      canEdit: canManage(viewer, q),
      isOwner:
        viewer.role === "instructor" &&
        q.ownerInstructorId === viewer.instructorId,
    };
  },
});

/** Create a shared question (instructor-owned, or platform-wide for admins). */
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
    difficultyB: v.optional(v.number()),
    discriminationA: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await resolveViewer(ctx);
    const content = normalizeContent(args);
    const now = Date.now();
    const id = await ctx.db.insert("sharedQuestions", {
      ...content,
      ownerInstructorId:
        viewer.role === "instructor" ? viewer.instructorId : undefined,
      ownerName: viewer.name,
      createdByUserId: viewer.user._id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, viewer.user, {
      action: "shared_question.created",
      entity: "sharedQuestions",
      entityId: id,
      newValue: {
        subject: content.subject,
        topic: content.topic,
        by: viewer.name,
        role: viewer.role,
      },
    });
    return id;
  },
});

/** Edit a shared question — owner instructor or any admin. */
export const updateSharedQuestion = mutation({
  args: {
    id: v.id("sharedQuestions"),
    fields: v.object({
      subject: v.optional(v.string()),
      topic: v.optional(v.string()),
      questionText: v.optional(v.string()),
      options: v.optional(v.array(v.string())),
      correctAnswer: v.optional(v.string()),
      explanation: v.optional(v.string()),
      marks: v.optional(v.number()),
      bloomLevel: v.optional(bloomArg),
      difficultyLevel: v.optional(difficultyArg),
      expectedTimeSec: v.optional(v.number()),
      difficultyB: v.optional(v.number()),
      discriminationA: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, fields }) => {
    const viewer = await resolveViewer(ctx);
    const q = await ctx.db.get(id);
    if (!q) throw new Error("Shared question not found");
    if (!canManage(viewer, q))
      throw new Error(
        "You can only edit shared questions you created (admins can edit all)",
      );

    // Re-stamp b when the band moves and no explicit b was supplied.
    const difficultyB =
      fields.difficultyB ??
      (fields.difficultyLevel !== undefined &&
      fields.difficultyLevel !== q.difficultyLevel
        ? DIFFICULTY_B[fields.difficultyLevel]
        : q.difficultyB);

    const content = normalizeContent({
      subject: fields.subject ?? q.subject,
      topic: fields.topic !== undefined ? fields.topic : q.topic,
      questionText: fields.questionText ?? q.questionText,
      questionType: q.questionType,
      options: fields.options ?? q.options,
      correctAnswer: fields.correctAnswer ?? q.correctAnswer,
      explanation:
        fields.explanation !== undefined ? fields.explanation : q.explanation,
      marks: fields.marks ?? q.marks,
      bloomLevel: fields.bloomLevel ?? q.bloomLevel,
      difficultyLevel:
        fields.difficultyLevel !== undefined
          ? fields.difficultyLevel
          : q.difficultyLevel,
      expectedTimeSec: fields.expectedTimeSec ?? q.expectedTimeSec,
      difficultyB,
      discriminationA:
        fields.discriminationA !== undefined
          ? fields.discriminationA
          : q.discriminationA,
    });

    await ctx.db.patch(id, { ...content, updatedAt: Date.now() });
    // Only the class-pool question fields are synced — shared-bank metadata
    // (subject, ownership, status) does not exist on `instructorQuestions`.
    const synced = await syncImports(ctx, id, {
      questionText: content.questionText,
      questionType: content.questionType,
      options: content.options,
      correctAnswer: content.correctAnswer,
      explanation: content.explanation,
      marks: content.marks,
      bloomLevel: content.bloomLevel,
      difficultyLevel: content.difficultyLevel,
      expectedTimeSec: content.expectedTimeSec,
      difficultyB: content.difficultyB,
      discriminationA: content.discriminationA,
      topic: content.topic,
    });
    await audit(ctx, viewer.user, {
      action: "shared_question.updated",
      entity: "sharedQuestions",
      entityId: id,
      previousValue: { text: q.questionText, subject: q.subject },
      newValue: { ...content, syncedImports: synced },
    });
    return { syncedImports: synced };
  },
});

/** Archive / restore a shared question — owner instructor or any admin. */
export const setSharedQuestionArchived = mutation({
  args: { id: v.id("sharedQuestions"), archived: v.boolean() },
  handler: async (ctx, { id, archived }) => {
    const viewer = await resolveViewer(ctx);
    const q = await ctx.db.get(id);
    if (!q) throw new Error("Shared question not found");
    if (!canManage(viewer, q))
      throw new Error("You can only archive your own shared questions");
    await ctx.db.patch(id, {
      status: archived ? "archived" : "active",
      updatedAt: Date.now(),
    });
    await audit(ctx, viewer.user, {
      action: archived
        ? "shared_question.archived"
        : "shared_question.restored",
      entity: "sharedQuestions",
      entityId: id,
      previousValue: { status: q.status },
    });
    return { status: archived ? ("archived" as const) : ("active" as const) };
  },
});

/** Delete a shared question — owner instructor or any admin. */
export const deleteSharedQuestion = mutation({
  args: { id: v.id("sharedQuestions") },
  handler: async (ctx, { id }) => {
    const viewer = await resolveViewer(ctx);
    const q = await ctx.db.get(id);
    if (!q) return { detachedImports: 0 };
    if (!canManage(viewer, q))
      throw new Error(
        "You can only delete shared questions you created (admins can delete all)",
      );

    // Keep class pools working: detach the reference, keep the last content.
    const imports = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_shared", (x) => x.eq("sharedQuestionId", id))
      .collect();
    for (const row of imports) {
      await ctx.db.patch(row._id, {
        sharedQuestionId: undefined,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.delete(id);
    await audit(ctx, viewer.user, {
      action: "shared_question.deleted",
      entity: "sharedQuestions",
      entityId: id,
      previousValue: { subject: q.subject, text: q.questionText },
      newValue: { detachedImports: imports.length, by: viewer.name },
    });
    return { detachedImports: imports.length };
  },
});

/**
 * Import a shared question into a class question pool by reference.
 * Idempotent: a class can hold at most one pool entry per shared question.
 */
export const importSharedQuestion = mutation({
  args: {
    sharedQuestionId: v.id("sharedQuestions"),
    classId: v.id("classes"),
  },
  handler: async (ctx, { sharedQuestionId, classId }) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.role !== "instructor")
      throw new Error("Only instructors can import questions into a class");

    const cls = await ctx.db.get(classId);
    if (!cls || cls.instructorId !== viewer.instructorId)
      throw new Error("You can only import into your own classes");
    if (cls.closedAt !== undefined)
      throw new Error(
        "This class is closed — reopen it before importing questions.",
      );

    const q = await ctx.db.get(sharedQuestionId);
    if (!q) throw new Error("Shared question not found");
    if (q.status !== "active")
      throw new Error("This shared question is archived");
    if (cls.subject?.trim() && keyOf(cls.subject) !== keyOf(q.subject))
      throw new Error(
        `This class is ${cls.subject.trim()} — only ${cls.subject.trim()} shared questions can be imported.`,
      );

    const bank = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_class", (x) => x.eq("classId", classId))
      .collect();
    const existing = bank.find((r) => r.sharedQuestionId === sharedQuestionId);

    const content: SyncedContent = {
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      marks: q.marks,
      bloomLevel: q.bloomLevel,
      difficultyLevel: q.difficultyLevel,
      expectedTimeSec: q.expectedTimeSec,
      difficultyB: q.difficultyB,
      discriminationA: q.discriminationA,
      topic: q.topic,
    };

    if (existing) {
      return { questionId: existing._id, alreadyImported: true };
    }

    const now = Date.now();
    const questionId = await ctx.db.insert("instructorQuestions", {
      classId,
      instructorId: viewer.instructorId,
      ...content,
      source: "shared",
      sharedQuestionId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, viewer.user, {
      action: "shared_question.imported",
      entity: "instructorQuestions",
      entityId: questionId,
      newValue: {
        classId,
        sharedQuestionId,
        className: cls.name,
        subject: q.subject,
      },
    });
    return { questionId, alreadyImported: false };
  },
});

/** Set (or clear) the subject of a class the caller can access. */
export const setClassSubject = mutation({
  args: { classId: v.id("classes"), subject: v.string() },
  handler: async (ctx, { classId, subject }) => {
    const viewer = await resolveViewer(ctx);
    const cls = await ctx.db.get(classId);
    if (!cls) throw new Error("Class not found");
    if (viewer.role === "instructor" && cls.instructorId !== viewer.instructorId)
      throw new Error("You can only change the subject of your own classes");

    const clean = subject.trim().slice(0, 60);
    await ctx.db.patch(classId, { subject: clean || undefined });
    await audit(ctx, viewer.user, {
      action: "class.subject_set",
      entity: "classes",
      entityId: classId,
      previousValue: { subject: cls.subject ?? null },
      newValue: { subject: clean || null },
    });
    return { subject: clean || null };
  },
});

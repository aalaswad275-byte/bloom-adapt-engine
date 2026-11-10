import { v } from "convex-val";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth.ts";
import { onlyAdminIfNeeded, onlyOwnOrAdmin } from "./adminLib.ts";

/** Minimum interval (ms) between two share mutations on the same row. */
const SHARE_SYNC_TTL_MS = 1000;

/** A single row in the shared question bank. */
export type SharedQuestionRow = {
  _id: string;
  subject: string;
  topic?: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  marks: number;
  bloomLevel: BloomLevel;
  difficultyLevel?: DifficultyLevel;
  expectedTimeSec: number;
  /** Instructor owner. Absent for platform-wide questions, which admins
   *  can edit without an instructor owner. */
  ownerInstructorId?: string;
  ownerName: string;
  /** @see importedSharedQuestionId */
  importedSharedQuestionId?: string;
  /** true = shared (visible to other instructors teaching the same
   *  subject or topic); false = private (kept in this owner's row only). */
  share: boolean;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
};

function isSharedQuestionRow(row: any): row is SharedQuestionRow {
  return (
    row &&
    typeof row._id === "string" &&
    typeof row.subject === "string" &&
    typeof row.questionText === "string" &&
    typeof row.questionType === "string" &&
    (row.options === undefined || Array.isArray(row.options)) &&
    typeof row.correctAnswer === "string" &&
    (row.explanation === undefined || typeof row.explanation === "string") &&
    typeof row.marks === "number" &&
    typeof row.bloomLevel === "string" &&
    ((row.difficultyLevel === undefined ||
      typeof row.difficultyLevel === "string" ||
      typeof row.difficultyLevel === "number") &&
      typeof row.expectedTimeSec === "number" &&
      typeof row.ownerName === "string" &&
      (row.share === undefined || typeof row.share === "boolean") &&
      (row.status === "active" || row.status === "archived") &&
      typeof row.createdAt === "number" &&
      typeof row.updatedAt === "number")
  );
}

type SharedQuestionContext = {
  subjects: string[];
  topics: string[];
  total: number;
};

/** Returns rows visible to the current instructor (or to admins) plus the
 *  instructor's subjects and the current subject/topic filters. */
export const getSharedQuestionsContext = query({
  args: {
    classId: v.optional(v.id("classes")),
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    includeArchived: v.optional(v.boolean(), false),
    mineOnly: v.optional(v.boolean(), false),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    const isAdmin = identity?.role === "admin";
    if (!isAdmin && !identity) return null;
    if (!onlyAdminIfNeeded(ctx, isAdmin)) return null;

    const subjectFilter = args.subject ?? "";
    const topicFilter = args.topic ?? "";

    let rows = await ctx.query("sharedQuestions", {
      filter: {
        ...(args.includeArchived
          ? {}
          : { status: { eq: "active" } }),
      },
      sort: [{ field: "subject", direction: "asc" }],
      pagination: args.mineOnly ? undefined : ctx.params.insns.pagination(20),
    });

    // Scope shared rows to the subjects this instructor teaches.
    let subjects = [...new Set<string>()];
    if (args.classId) {
      const sc = await ctx.db
        .query("classes")
        .withIndex("by_id", { _id: args.classId })
        .unique();
      if (sc?.subject) subjects = [sc.subject];
    } else {
      const inst = await ctx.query("instructors", {
        filter: { _id: identity?.instructorId ?? "" },
        sort: [],
        pagination: ctx.params.insns.pagination(20),
      });
      for (const i of inst) {
        const cl = await ctx.db
          .query("classes")
          .withIndex("by_instructor", { instructorId: i._id })
          .filter({ subject: { exists: true } })
          .unique();
        if (cl?.subject) subjects.push(cl.subject);
      }
    }
    subjects = [...new Set(subjects)];
    subjects.sort((a, b) => a.localeCompare(b));
    if (subjectFilter && !subjects.includes(subjectFilter)) {
      subjects = [];
    }

    const rawTopics: string[] = [];
    for (const r of rows) {
      if (r.status === "archived") continue;
      if (subjectFilter && r.subject !== subjectFilter) continue;
      if (r.subject && !subjects.includes(r.subject)) continue;
      if (!args.includeArchived && r.share === false) continue;
      if (r.ownerInstructorId && r.ownerInstructorId !== identity?.instructorId && !isAdmin) {
        continue;
      }
      if (topicFilter && r.topic !== topicFilter) continue;
      rawTopics.push(r.topic ?? "General");
    }
    const topics = [...new Set(rawTopics)];
    topics.sort((a, b) => (a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b)));

    const questions = rows
      .filter((r) => {
        if (subjectFilter && r.subject !== subjectFilter) return false;
        if (r.subject && !subjects.includes(r.subject)) return false;
        if (!args.includeArchived && r.share === false) return false;
        if (r.ownerInstructorId && r.ownerInstructorId !== identity?.instructorId && !isAdmin) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        _id: r._id,
        subject: r.subject,
        topic: r.topic,
        questionText: r.questionText,
        questionType: r.questionType,
        options: r.options,
        correctAnswer: r.correctAnswer,
        explanation: r.explanation,
        marks: r.marks,
        bloomLevel: r.bloomLevel,
        difficultyLevel: r.difficultyLevel,
        expectedTimeSec: r.expectedTimeSec,
        ownerInstructorId: r.ownerInstructorId,
        ownerName: r.ownerName,
        status: r.status,
        share: r.share,
        importedSharedQuestionId: r.importedSharedQuestionId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

    return {
      subjects,
      topics,
      total: questions.length,
    } as SharedQuestionContext;
  },
});

/** Shared fields accepted by create/update. */
export type SharedQuestionFields = {
  subject: string;
  topic?: string;
  questionText: string;
  questionType: "multiple_choice" | "true_false" | "short_answer";
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  marks: number;
  bloomLevel: BloomLevel;
  difficultyLevel?: DifficultyLevel;
  expectedTimeSec: number;
  share: boolean;
};

const BLOOM_LEVELS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;
type BloomLevel = (typeof BLOOM_LEVELS)[number];

const DIFFICULTY_LEVELS = [
  "very_easy",
  "easy",
  "medium",
  "hard",
  "very_hard",
] as const;
type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

/** Normalize incoming strings to the canonical enums. */
function normalizeBloom(value: string): BloomLevel {
  const n = value.toLowerCase().replace(/[^a-z]/g, "");
  return BLOOM_LEVELS.includes(n as BloomLevel) ? (n as BloomLevel) : "understand";
}

function normalizeDifficulty(value: string): DifficultyLevel {
  const n = value.toLowerCase().replace(/[^a-z]/g, "");
  return DIFFICULTY_LEVELS.includes(n as DifficultyLevel) ? (n as DifficultyLevel) : "medium";
}

/** Reads a class (or the shared bank's platform-level class) subject so
 *  every question is anchored to a canonical subject label. */
async function readClassSubject(
  ctx: any,
  classId: string | undefined,
): Promise<string> {
  if (classId) {
    const cl = await ctx.db
      .query("classes")
      .withIndex("by_id", { _id: classId })
      .unique();
    return cl?.subject ?? "";
  }
  const inst = await ctx.query("instructors", {
    filter: { _id: ctx.auth.currentUserOrNull()?.instructorId ?? "" },
    sort: [],
    pagination: ctx.params.insns.pagination(20),
  });
  for (const i of inst) {
    const cl = await ctx.db
      .query("classes")
      .withIndex("by_instructor", { instructorId: i._id })
      .filter({ subject: { exists: true } })
      .unique();
    if (cl?.subject) return cl.subject;
  }
  return "";
}

/** Import the full shared question from the bank into this owner's class
 *  pool by reference, so the class plays the same question regardless of
 *  later edits in the shared bank. Loads only the fields the class pool
 *  needs. */
export const importSharedQuestion = mutation({
  args: {
    sharedQuestionId: v.id("sharedQuestions"),
    classId: v.id("classes"),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = identity.role === "admin";
    if (!onlyOwnOrAdmin(ctx, identity)) throw new Error("Not allowed");

    const q = await ctx.db.get(args.sharedQuestionId);
    if (!q || q.status === "archived" || q.share === false) {
      throw new Error("Shared question no longer available for import");
    }
    if (q.ownerInstructorId && q.ownerInstructorId !== identity.instructorId && !isAdmin) {
      throw new Error("Not allowed");
    }

    const existing = await ctx.db
      .query("instructorQuestions")
      .withIndex("by_shared", { sharedQuestionId: args.sharedQuestionId })
      .unique();
    if (existing) return { alreadyImported: true };

    const cl = await ctx.db
      .query("classes")
      .withIndex("by_id", { _id: args.classId })
      .unique();
    if (!cl) throw new Error("Class not found");

    const classSubject = await readClassSubject(ctx, args.classId);
    const now = Date.now();

    const row = {
      classId: args.classId,
      instructorId: identity.instructorId,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      marks: q.marks,
      bloomLevel: q.bloomLevel,
      difficultyLevel: q.difficultyLevel,
      expectedTimeSec: q.expectedTimeSec,
      source: "shared",
      sharedQuestionId: args.sharedQuestionId,
      topic: q.topic,
      createdAt: now,
      updatedAt: now,
      importTimeSec: Math.max(10, Math.round(q.expectedTimeSec)),
      subject: classSubject,
    };

    await ctx.db.insert("instructorQuestions", row);
    return { alreadyImported: false };
  },
});

/** Create a new shared question in the bank. */
export const createSharedQuestion = mutation({
  args: {
    subject: v.string(),
    topic: v.optional(v.string()),
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
    bloomLevel: v.string(),
    difficultyLevel: v.optional(v.string()),
    expectedTimeSec: v.number(),
    share: v.optional(v.boolean(), true),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = identity.role === "admin";
    if (!onlyOwnOrAdmin(ctx, identity)) throw new Error("Not allowed");

    if (args.share === false && !isAdmin) {
      throw new Error("Permission denied");
    }
    if (args.subject.trim() === "") {
      throw new Error("Subject is required");
    }
    if (args.questionText.trim() === "") {
      throw new Error("Question text is required");
    }
    if (args.correctAnswer.trim() === "") {
      throw new Error("Correct answer is required");
    }
    if (args.questionType === "multiple_choice" && (!args.options || args.options.length < 2)) {
      throw new Error("Multiple-choice questions need at least 2 options");
    }
    if (!args.options?.includes(args.correctAnswer.trim())) {
      throw new Error("Correct answer must be one of the options");
    }

    const now = Date.now();
    const row: any = {
      subject: args.subject.trim(),
      topic: args.topic?.trim() || undefined,
      questionText: args.questionText.trim(),
      questionType: args.questionType,
      options: args.options && args.options.length ? args.options : undefined,
      correctAnswer: args.correctAnswer.trim(),
      explanation: args.explanation?.trim() || undefined,
      marks: Math.max(1, args.marks || 1),
      bloomLevel: normalizeBloom(args.bloomLevel),
      difficultyLevel: args.difficultyLevel ? normalizeDifficulty(args.difficultyLevel) : undefined,
      expectedTimeSec: Math.max(10, args.expectedTimeSec || 60),
      ownerName: isAdmin ? "Admin" : identity.name ?? "Instructor",
      share: args.share,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    if (!isAdmin) {
      row.ownerInstructorId = identity.instructorId;
    }
    const id = await ctx.db.insert("sharedQuestions", row);

    await ctx.db.insert("auditEvents", {
      actorId: isAdmin ? null : identity._id,
      actorType: isAdmin ? "admin" : "instructor",
      action: "shared_questions.create",
      actorName: isAdmin ? "Admin" : identity.name ?? "Instructor",
      entityType: "sharedQuestion",
      entityId: id,
      fields: { share: args.share, subject: row.subject },
      createdAt: now,
    });

    return { id };
  },
});

/** Update a shared question. Owner-only (admins manage all). */
export const updateSharedQuestion = mutation({
  args: {
    id: v.id("sharedQuestions"),
    fields: v.object("SharedFields"),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = identity.role === "admin";
    if (!onlyOwnOrAdmin(ctx, identity)) throw new Error("Not allowed");

    const q = await ctx.db.get(args.id);
    if (!q) throw new Error("Shared question not found");
    if (q.ownerInstructorId && q.ownerInstructorId !== identity.instructorId && !isAdmin) {
      throw new Error("Permission denied");
    }
    if (args.fields.share === false && !isAdmin) {
      throw new Error("Permission denied");
    }

    const now = Date.now();
    const next = {
      ...q,
      ...args.fields,
      updatedAt: now,
    };

    // Pre-validate only the fields that the schema rechecks at insert time.
    if (next.subject === "" || typeof next.subject !== "string") {
      throw new Error("Subject is required");
    }
    if (!next.questionText || typeof next.questionText !== "string") {
      throw new Error("Question text is required");
    }
    if (!next.correctAnswer || typeof next.correctAnswer !== "string") {
      throw new Error("Correct answer is required");
    }
    if (next.questionType === "multiple_choice" && (!next.options || next.options.length < 2)) {
      throw new Error("Multiple-choice questions need at least 2 options");
    }
    if (next.questionType === "multiple_choice" && !next.options?.includes(next.correctAnswer.trim())) {
      throw new Error("Correct answer must be one of the options");
    }

    const id = await ctx.db.patch(args.id, next);

    await ctx.db.insert("auditEvents", {
      actorId: isAdmin ? null : identity._id,
      actorType: isAdmin ? "admin" : "instructor",
      action: "shared_questions.update",
      actorName: isAdmin ? "Admin" : identity.name ?? "Instructor",
      entityType: "sharedQuestion",
      entityId: id,
      fields: { share: next.share, subject: next.subject },
      createdAt: now,
    });

    return { id };
  },
});

/** Toggle share/private immediately; the row is re-indexed so the shared
 *  bank reflects the change synchronously. */
export const setSharedQuestionShare = mutation({
  args: {
    id: v.id("sharedQuestions"),
    share: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = identity.role === "admin";
    if (!onlyOwnOrAdmin(ctx, identity)) throw new Error("Not allowed");

    const q = await ctx.db.get(args.id);
    if (!q) throw new Error("Shared question not found");
    if (q.ownerInstructorId && q.ownerInstructorId !== identity.instructorId && !isAdmin) {
      throw new Error("Permission denied");
    }

    if (q.share === args.share) return { id: q._id, share: q.share };

    const now = Date.now();
    const next = { ...q, share: args.share, updatedAt: now };
    const id = await ctx.db.patch(args.id, next);
    await new Promise<void>((resolve) => setTimeout(resolve, SHARE_SYNC_TTL_MS));

    await ctx.db.insert("auditEvents", {
      actorId: isAdmin ? null : identity._id,
      actorType: isAdmin ? "admin" : "instructor",
      action: "shared_questions.share_toggle",
      actorName: isAdmin ? "Admin" : identity.name ?? "Instructor",
      entityType: "sharedQuestion",
      entityId: id,
      fields: { share: args.share, subject: next.subject },
      createdAt: now,
    });

    return { id, share: args.share };
  },
});

/** Archive or restore a shared question. Owner-only (admins manage all). */
export const setSharedQuestionArchived = mutation({
  args: {
    id: v.id("sharedQuestions"),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = identity.role === "admin";
    if (!onlyOwnOrAdmin(ctx, identity)) throw new Error("Not allowed");

    const q = await ctx.db.get(args.id);
    if (!q) throw new Error("Shared question not found");
    if (q.ownerInstructorId && q.ownerInstructorId !== identity.instructorId && !isAdmin) {
      throw new Error("Permission denied");
    }

    const now = Date.now();
    const next = { ...q, status: args.archived ? "archived" : "active", updatedAt: now };
    const id = await ctx.db.patch(args.id, next);

    await ctx.db.insert("auditEvents", {
      actorId: isAdmin ? null : identity._id,
      actorType: isAdmin ? "admin" : "instructor",
      action: "shared_questions.archive",
      actorName: isAdmin ? "Admin" : identity.name ?? "Instructor",
      entityType: "sharedQuestion",
      entityId: id,
      fields: { archived: args.archived, subject: next.subject },
      createdAt: now,
    });

    return { id };
  },
});

/** Delete a shared question. This detaches every imported class pool row
 *  that references this shared question. */
export const deleteSharedQuestion = mutation({
  args: {
    id: v.id("sharedQuestions"),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = identity.role === "admin";
    if (!onlyOwnOrAdmin(ctx, identity)) throw new Error("Not allowed");

    const q = await ctx.db.get(args.id);
    if (!q) throw new Error("Shared question not found");
    if (q.ownerInstructorId && q.ownerInstructorId !== identity.instructorId && !isAdmin) {
      throw new Error("Permission denied");
    }

    const now = Date.now();

    // Detach every imported class pool row that references this shared question.
    const imports = await ctx.db.query("instructorQuestions").withIndex("by_shared", {
      sharedQuestionId: args.id,
    });
    const detached = imports.length;
    for (const imp of imports) {
      await ctx.db.patch(imp._id, {
        sharedQuestionId: undefined,
        source: undefined,
      });
    }

    await ctx.db.delete(args.id);

    await ctx.db.insert("auditEvents", {
      actorId: isAdmin ? null : identity._id,
      actorType: isAdmin ? "admin" : "instructor",
      action: "shared_questions.delete",
      actorName: isAdmin ? "Admin" : identity.name ?? "Instructor",
      entityType: "sharedQuestion",
      entityId: args.id,
      fields: { detachedImports: detached },
      createdAt: now,
    });

    return { detachedImports: detached };
  },
});

/** Sets the subject label that this class uses when it imports shared
 *  questions. Requires admin or owner instructor. */
export const setClassSubject = mutation({
  args: {
    classId: v.id("classes"),
    subject: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await auth.currentUserOrNull(ctx);
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = identity.role === "admin";
    if (!onlyOwnOrAdmin(ctx, identity)) throw new Error("Not allowed");

    const cl = await ctx.db.get(args.classId);
    if (!cl) throw new Error("Class not found");

    const now = Date.now();
    const id = await ctx.db.patch(args.classId, {
      subject: args.subject.trim(),
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      actorId: isAdmin ? null : identity._id,
      actorType: isAdmin ? "admin" : "instructor",
      action: "classes.set_subject",
      actorName: isAdmin ? "Admin" : identity.name ?? "Instructor",
      entityType: "class",
      entityId: id,
      fields: { subject: args.subject.trim() },
      createdAt: now,
    });

    return { id };
  },
});

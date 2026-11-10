/**
 * Question taxonomy — the admin-managed classification vocabulary used by the
 * class Question Bank, the Shared Question bank, the exam composer and the
 * reports.
 *
 *   category (subject)  →  topics (sub-categories)  →  question types
 *
 * Nothing in the UI hardcodes subjects or topics: every list is read from
 * these tables, so administrators can add, rename, reorder and retire values
 * without a deploy. The built-in six question types are seeded as `isSystem`
 * rows and can be archived, never deleted.
 *
 * The helpers at the bottom (`resolveClassification` & friends) are the single
 * validation path for question writes, which is what keeps the vocabulary
 * consistent across class creation, question creation, sharing, importing and
 * reporting.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { audit, currentUserOf, requireAdmin } from "./adminLib";

type CategoryDoc = Doc<"questionCategories">;
type TopicDoc = Doc<"questionTopics">;
type TypeDoc = Doc<"questionTypeDefs">;
type AnswerFormat = TypeDoc["answerFormat"];

const STATUS = v.union(v.literal("active"), v.literal("archived"));
const ANSWER_FORMAT = v.union(
  v.literal("multiple_choice"),
  v.literal("true_false"),
  v.literal("text"),
);

/** Normalize a display name into its lookup key. */
export function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Answer format implied by a stored `questionType`. */
export function answerFormatOf(questionType: string): AnswerFormat {
  if (questionType === "multiple_choice") return "multiple_choice";
  if (questionType === "true_false") return "true_false";
  return "text";
}

/** The type key stored for a question that was never classified explicitly. */
export function defaultTypeKeyFor(answerFormat: AnswerFormat): string {
  return answerFormat === "multiple_choice"
    ? "multiple_choice"
    : answerFormat === "true_false"
      ? "true_false"
      : "short_answer";
}

/** Every type definition shipped with the system. */
const SYSTEM_TYPES: Array<{
  key: string;
  label: string;
  answerFormat: AnswerFormat;
  sortOrder: number;
}> = [
  { key: "multiple_choice", label: "Multiple Choice", answerFormat: "multiple_choice", sortOrder: 10 },
  { key: "true_false", label: "True / False", answerFormat: "true_false", sortOrder: 20 },
  { key: "short_answer", label: "Short Answer", answerFormat: "text", sortOrder: 30 },
  { key: "essay", label: "Essay", answerFormat: "text", sortOrder: 40 },
  { key: "programming", label: "Programming", answerFormat: "text", sortOrder: 50 },
  { key: "math_problem", label: "Mathematical Problem", answerFormat: "text", sortOrder: 60 },
];

/** Starter categories + sub-categories (administrators can change them). */
const DEFAULT_CATEGORIES: Array<{ name: string; topics: string[] }> = [
  {
    name: "Mathematics",
    topics: ["Algebra", "Geometry", "Calculus", "Trigonometry", "Statistics", "Probability"],
  },
  {
    name: "English",
    topics: ["Grammar", "Reading Comprehension", "Vocabulary", "Writing", "Literature"],
  },
  {
    name: "Physics",
    topics: ["Mechanics", "Electricity & Magnetism", "Thermodynamics", "Optics", "Waves"],
  },
  {
    name: "Chemistry",
    topics: ["Organic Chemistry", "Inorganic Chemistry", "Physical Chemistry", "Stoichiometry"],
  },
  {
    name: "Computer Science",
    topics: ["C++", "Java", "Python", "Data Structures", "Algorithms", "Databases", "Operating Systems"],
  },
  { name: "Biology", topics: ["Cell Biology", "Genetics", "Ecology", "Human Anatomy"] },
  { name: "History", topics: ["Modern History", "Ancient History", "World Wars"] },
  { name: "Geography", topics: ["Physical Geography", "Human Geography", "Cartography"] },
  { name: "Business", topics: ["Accounting", "Economics", "Marketing", "Management"] },
];

// ---------------------------------------------------------------------------
// Lookups (shared with every module that writes a question)
// ---------------------------------------------------------------------------

async function categoryByKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<CategoryDoc | null> {
  const rows = await ctx.db
    .query("questionCategories")
    .withIndex("by_key", (q) => q.eq("key", key))
    .collect();
  // Prefer the active row if an archived duplicate ever exists.
  return rows.find((r) => r.status === "active") ?? rows[0] ?? null;
}

async function topicByKey(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"questionCategories">,
  key: string,
): Promise<TopicDoc | null> {
  const rows = await ctx.db
    .query("questionTopics")
    .withIndex("by_category_key", (q) =>
      q.eq("categoryId", categoryId).eq("key", key),
    )
    .collect();
  return rows.find((r) => r.status === "active") ?? rows[0] ?? null;
}

async function typeByKey(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<TypeDoc | null> {
  return await ctx.db
    .query("questionTypeDefs")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
}

/** Resolve a category by id or by name; null when it does not exist. */
export async function findCategory(
  ctx: QueryCtx | MutationCtx,
  ref: { categoryId?: Id<"questionCategories">; name?: string },
): Promise<CategoryDoc | null> {
  if (ref.categoryId) return await ctx.db.get(ref.categoryId);
  const name = (ref.name ?? "").trim();
  if (!name) return null;
  return await categoryByKey(ctx, normalizeKey(name));
}

/**
 * Resolve the category a subject label belongs to. A label may name a top-level
 * category ("English") or one of its topics ("C++" → Computer Science), which
 * is how a class keeps a familiar subject name while sharing the right pool.
 */
export async function findCategoryForSubject(
  ctx: QueryCtx | MutationCtx,
  subject: string,
): Promise<{ category: CategoryDoc; topic: TopicDoc | null } | null> {
  const key = normalizeKey(subject);
  if (!key) return null;
  const direct = await categoryByKey(ctx, key);
  if (direct) return { category: direct, topic: null };

  const topics = await ctx.db
    .query("questionTopics")
    .withIndex("by_key", (q) => q.eq("key", key))
    .collect();
  const active = topics.filter((t) => t.status === "active");
  const candidates = active.length > 0 ? active : topics;
  if (candidates.length === 0) return null;
  const category = await ctx.db.get(candidates[0].categoryId);
  if (!category) return null;
  return { category, topic: candidates[0] };
}

export type Classification = {
  category: CategoryDoc;
  topic: TopicDoc | null;
  typeDef: TypeDoc;
};

/**
 * Validate (and where allowed, fill in) the classification of a question.
 *
 * `answerFormat` is the stored `questionType`; when no `typeKey` is supplied
 * the matching built-in type is used, so legacy callers keep working.
 */
export async function resolveClassification(
  ctx: MutationCtx,
  input: {
    categoryId?: Id<"questionCategories">;
    categoryName?: string;
    topicId?: Id<"questionTopics">;
    topicName?: string;
    typeKey?: string;
    answerFormat: AnswerFormat;
    /** Create the topic when the instructor typed a new one for this category. */
    allowNewTopic?: boolean;
    /** Allow archived values (admins editing old rows). */
    allowArchived?: boolean;
  },
): Promise<Classification> {
  const { categoryId, categoryName, topicId, topicName, allowArchived } = input;

  const category = await findCategory(ctx, { categoryId, name: categoryName });
  if (!category) {
    throw new Error(
      categoryName
        ? `"${categoryName.trim()}" is not a known subject — ask an administrator to add it to the question taxonomy.`
        : "Choose a subject/category for this question.",
    );
  }
  if (category.status !== "active" && !allowArchived) {
    throw new Error(
      `The subject "${category.name}" is archived — pick an active subject instead.`,
    );
  }

  // ---- topic (optional, must belong to the chosen category) ----
  let topic: TopicDoc | null = null;
  const cleanTopic = (topicName ?? "").trim();
  if (topicId) {
    const byId = await ctx.db.get(topicId);
    if (!byId || byId.categoryId !== category._id) {
      throw new Error("The selected topic does not belong to this subject.");
    }
    topic = byId;
  } else if (cleanTopic) {
    topic = await topicByKey(ctx, category._id, normalizeKey(cleanTopic));
    if (!topic && input.allowNewTopic) {
      const now = Date.now();
      const siblings = await ctx.db
        .query("questionTopics")
        .withIndex("by_category", (q) => q.eq("categoryId", category._id))
        .collect();
      const id = await ctx.db.insert("questionTopics", {
        categoryId: category._id,
        name: cleanTopic,
        key: normalizeKey(cleanTopic),
        status: "active",
        sortOrder: (siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0) || 0) + 10,
        createdAt: now,
        updatedAt: now,
      });
      topic = await ctx.db.get(id);
    } else if (!topic) {
      throw new Error(
        `"${cleanTopic}" is not a topic of ${category.name} — pick one from the list or ask an administrator to add it.`,
      );
    }
  }
  if (topic && topic.status !== "active" && !allowArchived) {
    throw new Error(`The topic "${topic.name}" is archived — pick another one.`);
  }

  // ---- type ----
  const wantedKey = (input.typeKey ?? "").trim() || defaultTypeKeyFor(input.answerFormat);
  let typeDef = await typeByKey(ctx, wantedKey);
  if (!typeDef) {
    if (input.typeKey) throw new Error(`Unknown question type "${wantedKey}".`);
    typeDef = await typeByKey(ctx, defaultTypeKeyFor(input.answerFormat));
  }
  if (!typeDef) {
    throw new Error(
      "The question taxonomy has no type definitions — ask an administrator to restore the defaults.",
    );
  }
  if (typeDef.status !== "active" && !allowArchived) {
    throw new Error(`The question type "${typeDef.label}" is archived — pick another one.`);
  }
  if (typeDef.answerFormat !== input.answerFormat) {
    throw new Error(
      `"${typeDef.label}" questions are answered as ${
        typeDef.answerFormat === "text" ? "free text" : typeDef.answerFormat.replace("_", " ")
      } — choose a matching answer format.`,
    );
  }
  return { category, topic, typeDef };
}

// ---------------------------------------------------------------------------
// Reading the taxonomy
// ---------------------------------------------------------------------------

export type TopicView = {
  id: Id<"questionTopics">;
  name: string;
  key: string;
  status: "active" | "archived";
  sortOrder: number;
};

export type CategoryView = {
  id: Id<"questionCategories">;
  name: string;
  key: string;
  description: string | null;
  status: "active" | "archived";
  sortOrder: number;
  topics: TopicView[];
};

export type QuestionTypeView = {
  id: Id<"questionTypeDefs">;
  key: string;
  label: string;
  answerFormat: AnswerFormat;
  status: "active" | "archived";
  sortOrder: number;
  isSystem: boolean;
};

export type Taxonomy = {
  categories: CategoryView[];
  types: QuestionTypeView[];
  canManage: boolean;
};

/**
 * The classification vocabulary for the current user. Archived rows are only
 * returned to administrators (and only when they ask), so instructors cannot
 * accidentally pick retired values.
 */
export const getTaxonomy = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Taxonomy> => {
    const user = await currentUserOf(ctx);
    if (!user) throw new Error("Sign in to load the question taxonomy");
    const canManage = user.role === "admin";
    const includeArchived = canManage && args.includeArchived === true;

    const categories = await ctx.db.query("questionCategories").collect();
    const topics = await ctx.db.query("questionTopics").collect();
    const types = await ctx.db.query("questionTypeDefs").collect();

    const topicsByCategory = new Map<string, TopicDoc[]>();
    for (const t of topics) {
      const list = topicsByCategory.get(t.categoryId) ?? [];
      list.push(t);
      topicsByCategory.set(t.categoryId, list);
    }

    return {
      canManage,
      categories: categories
        .filter((c) => includeArchived || c.status === "active")
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((c) => ({
          id: c._id,
          name: c.name,
          key: c.key,
          description: c.description ?? null,
          status: c.status,
          sortOrder: c.sortOrder,
          topics: (topicsByCategory.get(c._id) ?? [])
            .filter((t) => includeArchived || t.status === "active")
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            .map((t) => ({
              id: t._id,
              name: t.name,
              key: t.key,
              status: t.status,
              sortOrder: t.sortOrder,
            })),
        })),
      types: types
        .filter((t) => includeArchived || t.status === "active")
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
        .map((t) => ({
          id: t._id,
          key: t.key,
          label: t.label,
          answerFormat: t.answerFormat,
          status: t.status,
          sortOrder: t.sortOrder,
          isSystem: t.isSystem === true,
        })),
    };
  },
});

// ---------------------------------------------------------------------------
// Admin management
// ---------------------------------------------------------------------------

async function assertUniqueCategory(
  ctx: MutationCtx,
  key: string,
  exceptId?: Id<"questionCategories">,
) {
  const existing = await categoryByKey(ctx, key);
  if (existing && existing._id !== exceptId) {
    throw new Error(`A category named "${existing.name}" already exists.`);
  }
}

export const createCategory = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Category name is required");
    const key = normalizeKey(name);
    await assertUniqueCategory(ctx, key);
    const all = await ctx.db.query("questionCategories").collect();
    const now = Date.now();
    const id = await ctx.db.insert("questionCategories", {
      name,
      key,
      description: args.description?.trim() || undefined,
      status: "active",
      sortOrder: all.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 10,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, admin, {
      action: "taxonomy.category_created",
      entity: "questionCategories",
      entityId: id,
      newValue: { name },
    });
    return id;
  },
});

export const updateCategory = mutation({
  args: {
    id: v.id("questionCategories"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(STATUS),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Category not found");
    const name = args.name !== undefined ? args.name.trim() : row.name;
    if (!name) throw new Error("Category name is required");
    const key = normalizeKey(name);
    await assertUniqueCategory(ctx, key, args.id);
    await ctx.db.patch(args.id, {
      name,
      key,
      description:
        args.description !== undefined
          ? args.description.trim() || undefined
          : row.description,
      status: args.status ?? row.status,
      sortOrder: args.sortOrder ?? row.sortOrder,
      updatedAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "taxonomy.category_updated",
      entity: "questionCategories",
      entityId: args.id,
      previousValue: { name: row.name, status: row.status },
      newValue: { name, status: args.status ?? row.status },
    });
    return { id: args.id };
  },
});

/** Renaming or archiving a category keeps existing questions valid. */
export const deleteCategory = mutation({
  args: { id: v.id("questionCategories") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Category not found");

    const [classes, bank, shared] = await Promise.all([
      ctx.db.query("classes").collect(),
      ctx.db.query("instructorQuestions").withIndex("by_category", (q) => q.eq("categoryId", args.id)).collect(),
      ctx.db.query("sharedQuestions").withIndex("by_category", (q) => q.eq("categoryId", args.id)).collect(),
    ]);
    const inUse =
      classes.filter((c) => c.categoryId === args.id).length + bank.length + shared.length;
    if (inUse > 0) {
      throw new Error(
        `"${row.name}" is still used by ${inUse} class/question record${inUse === 1 ? "" : "s"} — archive it instead of deleting.`,
      );
    }
    const topics = await ctx.db
      .query("questionTopics")
      .withIndex("by_category", (q) => q.eq("categoryId", args.id))
      .collect();
    for (const t of topics) await ctx.db.delete(t._id);
    await ctx.db.delete(args.id);
    await audit(ctx, admin, {
      action: "taxonomy.category_deleted",
      entity: "questionCategories",
      entityId: args.id,
      previousValue: { name: row.name, topics: topics.length },
    });
    return { deleted: true };
  },
});

export const createTopic = mutation({
  args: { categoryId: v.id("questionCategories"), name: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Category not found");
    const name = args.name.trim();
    if (!name) throw new Error("Topic name is required");
    const key = normalizeKey(name);
    const existing = await topicByKey(ctx, args.categoryId, key);
    if (existing) throw new Error(`"${existing.name}" already exists in ${category.name}.`);
    const siblings = await ctx.db
      .query("questionTopics")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
    const now = Date.now();
    const id = await ctx.db.insert("questionTopics", {
      categoryId: args.categoryId,
      name,
      key,
      status: "active",
      sortOrder: siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 10,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, admin, {
      action: "taxonomy.topic_created",
      entity: "questionTopics",
      entityId: id,
      newValue: { category: category.name, name },
    });
    return id;
  },
});

export const updateTopic = mutation({
  args: {
    id: v.id("questionTopics"),
    name: v.optional(v.string()),
    status: v.optional(STATUS),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Topic not found");
    const name = args.name !== undefined ? args.name.trim() : row.name;
    if (!name) throw new Error("Topic name is required");
    const key = normalizeKey(name);
    const existing = await topicByKey(ctx, row.categoryId, key);
    if (existing && existing._id !== args.id) {
      throw new Error(`"${existing.name}" already exists in this category.`);
    }
    await ctx.db.patch(args.id, {
      name,
      key,
      status: args.status ?? row.status,
      sortOrder: args.sortOrder ?? row.sortOrder,
      updatedAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "taxonomy.topic_updated",
      entity: "questionTopics",
      entityId: args.id,
      previousValue: { name: row.name, status: row.status },
      newValue: { name, status: args.status ?? row.status },
    });
    return { id: args.id };
  },
});

export const deleteTopic = mutation({
  args: { id: v.id("questionTopics") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Topic not found");
    const bank = await ctx.db
      .query("instructorQuestions")
      .filter((q) => q.eq(q.field("topicId"), args.id))
      .collect();
    const shared = await ctx.db
      .query("sharedQuestions")
      .filter((q) => q.eq(q.field("topicId"), args.id))
      .collect();
    const inUse = bank.length + shared.length;
    if (inUse > 0) {
      throw new Error(
        `"${row.name}" is used by ${inUse} question${inUse === 1 ? "" : "s"} — archive it instead of deleting.`,
      );
    }
    await ctx.db.delete(args.id);
    await audit(ctx, admin, {
      action: "taxonomy.topic_deleted",
      entity: "questionTopics",
      entityId: args.id,
      previousValue: { name: row.name },
    });
    return { deleted: true };
  },
});

export const createQuestionType = mutation({
  args: {
    label: v.string(),
    key: v.optional(v.string()),
    answerFormat: ANSWER_FORMAT,
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const label = args.label.trim();
    if (!label) throw new Error("Type label is required");
    const key = (args.key?.trim() || label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) throw new Error("Type key is required");
    const existing = await typeByKey(ctx, key);
    if (existing) throw new Error(`A question type with key "${key}" already exists.`);
    const all = await ctx.db.query("questionTypeDefs").collect();
    const now = Date.now();
    const id = await ctx.db.insert("questionTypeDefs", {
      key,
      label,
      answerFormat: args.answerFormat,
      status: "active",
      sortOrder: all.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 10,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, admin, {
      action: "taxonomy.type_created",
      entity: "questionTypeDefs",
      entityId: id,
      newValue: { key, label, answerFormat: args.answerFormat },
    });
    return id;
  },
});

export const updateQuestionType = mutation({
  args: {
    id: v.id("questionTypeDefs"),
    label: v.optional(v.string()),
    answerFormat: v.optional(ANSWER_FORMAT),
    status: v.optional(STATUS),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Question type not found");
    const label = args.label !== undefined ? args.label.trim() : row.label;
    if (!label) throw new Error("Type label is required");
    if (row.isSystem && args.answerFormat !== undefined && args.answerFormat !== row.answerFormat) {
      throw new Error(
        `"${row.label}" is a built-in type — its answer format cannot be changed.`,
      );
    }
    await ctx.db.patch(args.id, {
      label,
      answerFormat: args.answerFormat ?? row.answerFormat,
      status: args.status ?? row.status,
      sortOrder: args.sortOrder ?? row.sortOrder,
      updatedAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "taxonomy.type_updated",
      entity: "questionTypeDefs",
      entityId: args.id,
      previousValue: { label: row.label, status: row.status },
      newValue: { label, status: args.status ?? row.status },
    });
    return { id: args.id };
  },
});

export const deleteQuestionType = mutation({
  args: { id: v.id("questionTypeDefs") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Question type not found");
    if (row.isSystem) {
      throw new Error(`"${row.label}" is a built-in type — archive it instead of deleting.`);
    }
    const bank = await ctx.db
      .query("instructorQuestions")
      .filter((q) => q.eq(q.field("typeKey"), row.key))
      .collect();
    const shared = await ctx.db
      .query("sharedQuestions")
      .filter((q) => q.eq(q.field("typeKey"), row.key))
      .collect();
    const inUse = bank.length + shared.length;
    if (inUse > 0) {
      throw new Error(
        `"${row.label}" is used by ${inUse} question${inUse === 1 ? "" : "s"} — archive it instead of deleting.`,
      );
    }
    await ctx.db.delete(args.id);
    await audit(ctx, admin, {
      action: "taxonomy.type_deleted",
      entity: "questionTypeDefs",
      entityId: args.id,
      previousValue: { key: row.key, label: row.label },
    });
    return { deleted: true };
  },
});

// ---------------------------------------------------------------------------
// Seeding + backfill
// ---------------------------------------------------------------------------

/**
 * Idempotently install the starter taxonomy (six question types, nine
 * subjects with their topics). Safe to run repeatedly; existing rows keep
 * their names, status and ordering.
 */
export const seedDefaultTaxonomy = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    let categoriesCreated = 0;
    let topicsCreated = 0;
    let typesCreated = 0;

    for (const t of SYSTEM_TYPES) {
      const existing = await typeByKey(ctx, t.key);
      if (existing) continue;
      await ctx.db.insert("questionTypeDefs", {
        ...t,
        status: "active",
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      });
      typesCreated += 1;
    }

    let order = 0;
    for (const c of DEFAULT_CATEGORIES) {
      order += 10;
      let category = await categoryByKey(ctx, normalizeKey(c.name));
      if (!category) {
        const id = await ctx.db.insert("questionCategories", {
          name: c.name,
          key: normalizeKey(c.name),
          status: "active",
          sortOrder: order,
          createdAt: now,
          updatedAt: now,
        });
        category = (await ctx.db.get(id))!;
        categoriesCreated += 1;
      }
      let topicOrder = 0;
      for (const topicName of c.topics) {
        topicOrder += 10;
        const existing = await topicByKey(ctx, category._id, normalizeKey(topicName));
        if (existing) continue;
        await ctx.db.insert("questionTopics", {
          categoryId: category._id,
          name: topicName,
          key: normalizeKey(topicName),
          status: "active",
          sortOrder: topicOrder,
          createdAt: now,
          updatedAt: now,
        });
        topicsCreated += 1;
      }
    }

    await audit(ctx, admin, {
      action: "taxonomy.seeded",
      entity: "questionCategories",
      detail: `Taxonomy seed: ${categoriesCreated} categories, ${topicsCreated} topics, ${typesCreated} types created`,
    });
    return { categoriesCreated, topicsCreated, typesCreated };
  },
});

/**
 * Attach taxonomy references to records created before the taxonomy existed:
 * classes resolve their `subject` to a category (creating one when the label
 * is new), and every question gets a category, topic and type key. Idempotent.
 */
export const backfillTaxonomy = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    let categoriesCreated = 0;
    let classesLinked = 0;
    let bankLinked = 0;
    let sharedLinked = 0;

    /** Category for a subject label, creating one when nothing matches. */
    const categoryFor = async (label: string) => {
      const match = await findCategoryForSubject(ctx, label);
      if (match) return { category: match.category, topic: match.topic };
      const key = normalizeKey(label);
      const existing = await categoryByKey(ctx, key);
      if (existing) return { category: existing, topic: null };
      const all = await ctx.db.query("questionCategories").collect();
      const id = await ctx.db.insert("questionCategories", {
        name: label.trim(),
        key,
        status: "active",
        sortOrder: all.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 10,
        createdAt: now,
        updatedAt: now,
      });
      categoriesCreated += 1;
      return { category: (await ctx.db.get(id))!, topic: null };
    };

    /** Topic row for a name inside a category, creating it when missing. */
    const topicFor = async (
      categoryId: Id<"questionCategories">,
      name: string | undefined,
    ) => {
      const clean = (name ?? "").trim();
      if (!clean) return null;
      const existing = await topicByKey(ctx, categoryId, normalizeKey(clean));
      if (existing) return existing;
      const siblings = await ctx.db
        .query("questionTopics")
        .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
        .collect();
      const id = await ctx.db.insert("questionTopics", {
        categoryId,
        name: clean,
        key: normalizeKey(clean),
        status: "active",
        sortOrder: siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 10,
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.get(id);
    };

    for (const cls of await ctx.db.query("classes").collect()) {
      const label = (cls.subject ?? "").trim();
      if (!label) continue;
      const { category } = await categoryFor(label);
      // Link the category and canonicalize the label's casing so every list
      // shows one spelling of the subject ("english" → "English").
      const canonical = category.name;
      const needsWork = !cls.categoryId || cls.subject !== canonical;
      if (!needsWork) continue;
      await ctx.db.patch(cls._id, {
        categoryId: category._id,
        subject: canonical,
      });
      classesLinked += 1;
    }

    for (const q of await ctx.db.query("instructorQuestions").collect()) {
      if (q.categoryId && q.typeKey) continue;
      const cls = await ctx.db.get(q.classId);
      const label = (cls?.subject ?? "").trim();
      if (!label) continue;
      const { category } = await categoryFor(label);
      const topic = await topicFor(category._id, q.topic);
      await ctx.db.patch(q._id, {
        categoryId: category._id,
        topicId: topic?._id,
        typeKey: q.typeKey ?? defaultTypeKeyFor(answerFormatOf(q.questionType)),
      });
      bankLinked += 1;
    }

    for (const row of await ctx.db.query("sharedQuestions").collect()) {
      const label = (row.subject ?? "").trim();
      if (!label) continue;
      const { category } = await categoryFor(label);
      const topic = row.topicId ? null : await topicFor(category._id, row.topic);
      const needsWork =
        !row.categoryId ||
        !row.typeKey ||
        row.subject !== category.name ||
        (topic !== null && row.topicId === undefined);
      if (!needsWork) continue;
      await ctx.db.patch(row._id, {
        categoryId: category._id,
        subject: category.name,
        topicId: row.topicId ?? topic?._id,
        typeKey: row.typeKey ?? defaultTypeKeyFor(answerFormatOf(row.questionType)),
      });
      sharedLinked += 1;
    }

    await audit(ctx, admin, {
      action: "taxonomy.backfilled",
      entity: "questionCategories",
      detail: `Linked ${classesLinked} classes, ${bankLinked} bank questions and ${sharedLinked} shared questions`,
    });
    return { categoriesCreated, classesLinked, bankLinked, sharedLinked };
  },
});

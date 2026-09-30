/**
 * Class management — an instructor's teaching group. Students enroll into a
 * class via `students.classId`. All functions are admin-gated and audited.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { aggregateSessions, audit, requireAdmin } from "./adminLib";
import type { Id } from "./_generated/dataModel";

const classFields = {
  name: v.string(),
  instructorId: v.id("instructors"),
  institutionId: v.optional(v.id("institutions")),
  teachingCenterId: v.optional(v.id("teachingCenters")),
  description: v.optional(v.string()),
};

/** List classes (search + instructor/status filters) with roster counts. */
export const listClasses = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    instructorId: v.optional(v.id("instructors")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const instrId = args.instructorId;
    let rows;
    if (instrId) {
      rows = await ctx.db
        .query("classes")
        .withIndex("by_instructor", (x) => x.eq("instructorId", instrId))
        .collect();
    } else {
      rows = await ctx.db.query("classes").collect();
    }
    const q = (args.search ?? "").trim().toLowerCase();
    const out = [];
    for (const c of rows) {
      if (args.status && c.status !== args.status) continue;
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !(c.description ?? "").toLowerCase().includes(q)
      )
        continue;
      const students = await ctx.db
        .query("students")
        .withIndex("by_class", (x) => x.eq("classId", c._id))
        .collect();
      const sessions = await ctx.db.query("examSessions").collect();
      const classSessions = sessions.filter((s) =>
        students.some((st) => st._id === s.studentId),
      );
      out.push({
        ...c,
        studentCount: students.length,
        activeStudents: students.filter((s) => s.status === "active").length,
        avgScore: aggregateSessions(classSessions).avgScore,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getClass = query({
  args: { id: v.id("classes") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    return await ctx.db.get(id);
  },
});

export const createClass = mutation({
  args: classFields,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const id = await ctx.db.insert("classes", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "class.created",
      entity: "classes",
      entityId: id,
      newValue: args,
    });
    return id;
  },
});

export const updateClass = mutation({
  args: { id: v.id("classes"), fields: v.object(classFields) },
  handler: async (ctx, { id, fields }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Class not found");
    await ctx.db.patch(id, fields);
    await audit(ctx, admin, {
      action: "class.updated",
      entity: "classes",
      entityId: id,
      previousValue: prev,
      newValue: fields,
    });
  },
});

export const setClassStatus = mutation({
  args: {
    id: v.id("classes"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { id, status }) => {
    const admin = await requireAdmin(ctx);
    const cls = await ctx.db.get(id);
    if (!cls) throw new Error("Class not found");
    await ctx.db.patch(id, { status });
    await audit(ctx, admin, {
      action: status === "active" ? "class.activated" : "class.deactivated",
      entity: "classes",
      entityId: id,
      previousValue: { status: cls.status },
      newValue: { status },
    });
  },
});

/** Delete a class — roster members keep their history, just lose the link. */
export const deleteClass = mutation({
  args: { id: v.id("classes") },
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Class not found");
    const roster = await ctx.db
      .query("students")
      .withIndex("by_class", (x) => x.eq("classId", id))
      .collect();
    for (const s of roster) await ctx.db.patch(s._id, { classId: undefined });
    await ctx.db.delete(id);
    await audit(ctx, admin, {
      action: "class.deleted",
      entity: "classes",
      entityId: id,
      previousValue: prev,
    });
  },
});

/** Dropdown options for class pickers (admin forms). */
export const classOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("classes").collect();
    const instructorNames = new Map<string, string>();
    for (const i of await ctx.db.query("instructors").collect())
      instructorNames.set(i._id, i.name);
    return rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        value: c._id,
        label: c.name,
        instructorId: c.instructorId,
        instructorLabel: instructorNames.get(c.instructorId) ?? "",
      }));
  },
});

/** Auto-derive org links for a class from its instructor. */
export async function classOrgDefaults(
  institutionId: Id<"institutions"> | undefined,
  teachingCenterId: Id<"teachingCenters"> | undefined,
) {
  return { institutionId, teachingCenterId };
}

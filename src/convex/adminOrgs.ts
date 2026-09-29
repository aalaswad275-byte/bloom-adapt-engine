/**
 * Admin CRUD for the org hierarchy: institutions, teaching centers,
 * government facilities. Every mutation requires the admin role and writes
 * an audit row (create/update/delete/status with previous→new values).
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { aggregateSessions, audit, requireAdmin } from "./adminLib";

type InstitutionDoc = Doc<"institutions">;

const institutionFields = {
  name: v.string(),
  type: v.union(
    v.literal("university"),
    v.literal("institute"),
    v.literal("teaching_center"),
    v.literal("government_facility"),
    v.literal("training_center"),
    v.literal("other"),
  ),
  description: v.optional(v.string()),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  website: v.optional(v.string()),
  contactPerson: v.optional(v.string()),
};

/** List institutions (search + status filter + counts, server-side). */
export const listInstitutions = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, { search, status }) => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("institutions").collect();
    const q = (search ?? "").trim().toLowerCase();
    const rows = all
      .filter(
        (i) =>
          (!status || i.status === status) &&
          (!q ||
            i.name.toLowerCase().includes(q) ||
            (i.city ?? "").toLowerCase().includes(q) ||
            (i.contactPerson ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    // Per-institution counts (students, centers, instructors) + perf summary.
    const out = [];
    for (const inst of rows) {
      const students = await ctx.db
        .query("students")
        .withIndex("by_institution", (x) => x.eq("institutionId", inst._id))
        .collect();
      const centers = await ctx.db
        .query("teachingCenters")
        .withIndex("by_institution", (x) => x.eq("institutionId", inst._id))
        .collect();
      const instructors = await ctx.db
        .query("instructors")
        .withIndex("by_institution", (x) => x.eq("institutionId", inst._id))
        .collect();
      const { avgScore } = aggregateSessions(
        await sessionsOfInstitution(ctx, inst._id),
      );
      out.push({
        ...inst,
        studentCount: students.length,
        activeStudents: students.filter((s) => s.status === "active").length,
        centerCount: centers.length,
        instructorCount: instructors.length,
        avgScore,
      });
    }
    return out;
  },
});

async function sessionsOfInstitution(
  ctx: Parameters<Parameters<typeof query>[0]["handler"]>[0],
  institutionId: Id<"institutions">,
) {
  const direct = await ctx.db
    .query("examSessions")
    .withIndex("by_institution", (q) => q.eq("institutionId", institutionId))
    .collect();
  const students = await ctx.db
    .query("students")
    .withIndex("by_institution", (x) => x.eq("institutionId", institutionId))
    .collect();
  const out = [...direct];
  for (const st of students) {
    if (st.userId) {
      const byUser = await ctx.db
        .query("examSessions")
        .withIndex("by_user", (q) => q.eq("userId", st.userId))
        .collect();
      out.push(...byUser.filter((s) => s.studentId === undefined));
    }
  }
  return out;
}

export const getInstitution = query({
  args: { id: v.id("institutions") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const inst = await ctx.db.get(id);
    if (!inst) return null;
    const centers = await ctx.db
      .query("teachingCenters")
      .withIndex("by_institution", (x) => x.eq("institutionId", id))
      .collect();
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_institution", (x) => x.eq("institutionId", id))
      .collect();
    const students = await ctx.db
      .query("students")
      .withIndex("by_institution", (x) => x.eq("institutionId", id))
      .collect();
    return { institution: inst, centers, instructors, students };
  },
});

export const createInstitution = mutation({
  args: institutionFields,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const id = await ctx.db.insert("institutions", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "institution.created",
      entity: "institutions",
      entityId: id,
      newValue: args,
    });
    return id;
  },
});

export const updateInstitution = mutation({
  args: { id: v.id("institutions"), fields: institutionFields },
  handler: async (ctx, { id, fields }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Institution not found");
    await ctx.db.patch(id, fields);
    await audit(ctx, admin, {
      action: "institution.updated",
      entity: "institutions",
      entityId: id,
      previousValue: prev,
      newValue: fields,
    });
  },
});

export const setInstitutionStatus = mutation({
  args: {
    id: v.id("institutions"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { id, status }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Institution not found");
    await ctx.db.patch(id, { status });
    await audit(ctx, admin, {
      action: status === "active" ? "institution.activated" : "institution.deactivated",
      entity: "institutions",
      entityId: id,
      previousValue: { status: prev.status },
      newValue: { status },
    });
  },
});

export const deleteInstitution = mutation({
  args: { id: v.id("institutions") },
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Institution not found");
    // Block deletion while children reference the institution.
    const centers = await ctx.db
      .query("teachingCenters")
      .withIndex("by_institution", (x) => x.eq("institutionId", id))
      .collect();
    const students = await ctx.db
      .query("students")
      .withIndex("by_institution", (x) => x.eq("institutionId", id))
      .collect();
    if (centers.length > 0 || students.length > 0) {
      throw new Error(
        "Cannot delete: the institution still has teaching centers or students. Reassign them first.",
      );
    }
    await ctx.db.delete(id);
    await audit(ctx, admin, {
      action: "institution.deleted",
      entity: "institutions",
      entityId: id,
      previousValue: prev,
    });
  },
});

// ---------------------------------------------------------------------------
// Teaching centers
// ---------------------------------------------------------------------------

const centerFields = {
  name: v.string(),
  institutionId: v.id("institutions"),
  description: v.optional(v.string()),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  contactInfo: v.optional(v.string()),
  manager: v.optional(v.string()),
};

export const listTeachingCenters = query({
  args: {
    institutionId: v.optional(v.id("institutions")),
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, { institutionId, search, status }) => {
    await requireAdmin(ctx);
    const rows = institutionId
      ? await ctx.db
          .query("teachingCenters")
          .withIndex("by_institution", (x) => x.eq("institutionId", institutionId))
          .collect()
      : await ctx.db.query("teachingCenters").collect();
    const q = (search ?? "").trim().toLowerCase();
    const filtered = rows
      .filter(
        (c) =>
          (!status || c.status === status) &&
          (!q || c.name.toLowerCase().includes(q) || (c.city ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    const out = [];
    for (const c of filtered) {
      const inst = await ctx.db.get(c.institutionId);
      const students = await ctx.db
        .query("students")
        .withIndex("by_center", (x) => x.eq("teachingCenterId", c._id))
        .collect();
      const instructors = await ctx.db
        .query("instructors")
        .withIndex("by_center", (x) => x.eq("teachingCenterId", c._id))
        .collect();
      out.push({
        ...c,
        institutionName: inst?.name ?? "(deleted)",
        studentCount: students.length,
        instructorCount: instructors.length,
      });
    }
    return out;
  },
});

export const getTeachingCenter = query({
  args: { id: v.id("teachingCenters") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const center = await ctx.db.get(id);
    if (!center) return null;
    const institution = await ctx.db.get(center.institutionId);
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_center", (x) => x.eq("teachingCenterId", id))
      .collect();
    const students = await ctx.db
      .query("students")
      .withIndex("by_center", (x) => x.eq("teachingCenterId", id))
      .collect();
    return { center, institution, instructors, students };
  },
});

export const createTeachingCenter = mutation({
  args: centerFields,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const inst = await ctx.db.get(args.institutionId);
    if (!inst) throw new Error("Parent institution not found");
    const id = await ctx.db.insert("teachingCenters", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "teaching_center.created",
      entity: "teachingCenters",
      entityId: id,
      newValue: args,
    });
    return id;
  },
});

export const updateTeachingCenter = mutation({
  args: { id: v.id("teachingCenters"), fields: centerFields },
  handler: async (ctx, { id, fields }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Teaching center not found");
    await ctx.db.patch(id, fields);
    await audit(ctx, admin, {
      action: "teaching_center.updated",
      entity: "teachingCenters",
      entityId: id,
      previousValue: prev,
      newValue: fields,
    });
  },
});

export const setTeachingCenterStatus = mutation({
  args: {
    id: v.id("teachingCenters"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { id, status }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Teaching center not found");
    await ctx.db.patch(id, { status });
    await audit(ctx, admin, {
      action: status === "active" ? "teaching_center.activated" : "teaching_center.deactivated",
      entity: "teachingCenters",
      entityId: id,
      previousValue: { status: prev.status },
      newValue: { status },
    });
  },
});

export const deleteTeachingCenter = mutation({
  args: { id: v.id("teachingCenters") },
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Teaching center not found");
    const students = await ctx.db
      .query("students")
      .withIndex("by_center", (x) => x.eq("teachingCenterId", id))
      .collect();
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_center", (x) => x.eq("teachingCenterId", id))
      .collect();
    if (students.length > 0 || instructors.length > 0) {
      throw new Error(
        "Cannot delete: the center still has students or instructors. Reassign them first.",
      );
    }
    await ctx.db.delete(id);
    await audit(ctx, admin, {
      action: "teaching_center.deleted",
      entity: "teachingCenters",
      entityId: id,
      previousValue: prev,
    });
  },
});

// ---------------------------------------------------------------------------
// Government facilities
// ---------------------------------------------------------------------------

const facilityFields = {
  name: v.string(),
  sector: v.optional(v.string()),
  department: v.optional(v.string()),
  description: v.optional(v.string()),
  location: v.optional(v.string()),
  contactPerson: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  headcount: v.optional(v.number()),
};

export const listGovernmentFacilities = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, { search, status }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("governmentFacilities").collect();
    const q = (search ?? "").trim().toLowerCase();
    const filtered = rows
      .filter(
        (f) =>
          (!status || f.status === status) &&
          (!q ||
            f.name.toLowerCase().includes(q) ||
            (f.sector ?? "").toLowerCase().includes(q) ||
            (f.department ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    const out = [];
    for (const f of filtered) {
      const students = await ctx.db
        .query("students")
        .withIndex("by_facility", (x) => x.eq("governmentFacilityId", f._id))
        .collect();
      out.push({ ...f, personnelCount: students.length });
    }
    return out;
  },
});

export const getGovernmentFacility = query({
  args: { id: v.id("governmentFacilities") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const facility = await ctx.db.get(id);
    if (!facility) return null;
    const students = await ctx.db
      .query("students")
      .withIndex("by_facility", (x) => x.eq("governmentFacilityId", id))
      .collect();
    return { facility, students };
  },
});

export const createGovernmentFacility = mutation({
  args: facilityFields,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const id = await ctx.db.insert("governmentFacilities", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "government_facility.created",
      entity: "governmentFacilities",
      entityId: id,
      newValue: args,
    });
    return id;
  },
});

export const updateGovernmentFacility = mutation({
  args: { id: v.id("governmentFacilities"), fields: facilityFields },
  handler: async (ctx, { id, fields }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Facility not found");
    await ctx.db.patch(id, fields);
    await audit(ctx, admin, {
      action: "government_facility.updated",
      entity: "governmentFacilities",
      entityId: id,
      previousValue: prev,
      newValue: fields,
    });
  },
});

export const setGovernmentFacilityStatus = mutation({
  args: {
    id: v.id("governmentFacilities"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { id, status }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Facility not found");
    await ctx.db.patch(id, { status });
    await audit(ctx, admin, {
      action: status === "active" ? "government_facility.activated" : "government_facility.deactivated",
      entity: "governmentFacilities",
      entityId: id,
      previousValue: { status: prev.status },
      newValue: { status },
    });
  },
});

export const deleteGovernmentFacility = mutation({
  args: { id: v.id("governmentFacilities") },
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Facility not found");
    const students = await ctx.db
      .query("students")
      .withIndex("by_facility", (x) => x.eq("governmentFacilityId", id))
      .collect();
    if (students.length > 0) {
      throw new Error(
        "Cannot delete: the facility still has personnel/students assigned. Reassign them first.",
      );
    }
    await ctx.db.delete(id);
    await audit(ctx, admin, {
      action: "government_facility.deleted",
      entity: "governmentFacilities",
      entityId: id,
      previousValue: prev,
    });
  },
});

/** Simple option lists for form dropdowns. */
export const orgOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const institutions = await ctx.db.query("institutions").collect();
    const centers = await ctx.db.query("teachingCenters").collect();
    const facilities = await ctx.db.query("governmentFacilities").collect();
    const instructors = await ctx.db.query("instructors").collect();
    return {
      institutions: institutions.map((i) => ({ value: i._id, label: i.name })),
      centers: centers.map((c) => ({
        value: c._id,
        label: c.name,
        institutionId: c.institutionId,
      })),
      facilities: facilities.map((f) => ({ value: f._id, label: f.name })),
      instructors: instructors.map((i) => ({ value: i._id, label: i.name })),
    };
  },
});

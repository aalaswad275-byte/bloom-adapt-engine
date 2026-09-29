/**
 * Admin CRUD + paginated listings for instructors and students, plus the
 * system-wide paginated results feed. All guarded by requireAdmin and
 * audit-logged.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { aggregateSessions, audit, gradeFor, performanceLevel, requireAdmin, sessionScorePct } from "./adminLib";

type StudentDoc = Doc<"students">;
type InstructorDoc = Doc<"instructors">;

// ---------------------------------------------------------------------------
// Instructors
// ---------------------------------------------------------------------------

const instructorFields = {
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  institutionId: v.optional(v.id("institutions")),
  teachingCenterId: v.optional(v.id("teachingCenters")),
  governmentFacilityId: v.optional(v.id("governmentFacilities")),
  specialization: v.optional(v.string()),
};

export const listInstructors = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    institutionId: v.optional(v.id("institutions")),
    teachingCenterId: v.optional(v.id("teachingCenters")),
  },
  handler: async (ctx, { search, status, institutionId, teachingCenterId }) => {
    await requireAdmin(ctx);
    let rows: InstructorDoc[];
    if (institutionId) {
      rows = await ctx.db
        .query("instructors")
        .withIndex("by_institution", (x) => x.eq("institutionId", institutionId))
        .collect();
    } else if (teachingCenterId) {
      rows = await ctx.db
        .query("instructors")
        .withIndex("by_center", (x) => x.eq("teachingCenterId", teachingCenterId))
        .collect();
    } else {
      rows = await ctx.db.query("instructors").collect();
    }
    const q = (search ?? "").trim().toLowerCase();
    return rows
      .filter(
        (i) =>
          (!status || i.status === status) &&
          (!q || i.name.toLowerCase().includes(q) || (i.email ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500);
  },
});

export const getInstructor = query({
  args: { id: v.id("instructors") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    return await ctx.db.get(id);
  },
});

export const createInstructor = mutation({
  args: instructorFields,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const id = await ctx.db.insert("instructors", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, admin, {
      action: "instructor.created",
      entity: "instructors",
      entityId: id,
      newValue: args,
    });
    return id;
  },
});

export const updateInstructor = mutation({
  args: { id: v.id("instructors"), fields: instructorFields },
  before: undefined,
  handler: async (ctx, { id, fields }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Instructor not found");
    await ctx.db.patch(id, fields);
    await audit(ctx, admin, {
      action: "instructor.updated",
      entity: "instructors",
      entityId: id,
      previousValue: prev,
      newValue: fields,
    });
  },
});

export const setInstructorStatus = mutation({
  args: {
    id: v.id("instructors"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { id, status }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.examSessionsHack;
    const instructor = await ctx.db.get(id);
    if (!instructor) throw new Error("Instructor not found");
    void prev;
    await ctx.db.patch(id, { status });
    await audit(ctx, admin, {
      action: status === "active" ? "instructor.activated" : "instructor.deactivated",
      entity: "instructors",
      entityId: id,
      previousValue: { status: instructor.status },
      newValue: { status },
    });
  },
});

export const deleteInstructor = mutation({
  args: { const id: v.id("instructors") },
  handler: (ctx, { id }) => doDeleteInstructor(ctx, id),
});

async function doDeleteInstructor(
  ctx: Parameters<Parameters<typeof mutation>[0]["handler"]>[0],
  id: Parameters<typeof String>[0] extends never ? never : any,
): Promise<void> {
  const admin = await requireAdmin(ctx);
  const prev = await ctx.db.get(id);
  if (!prev) throw new Error("Instructor not found");
  // Unassign students rather than blocking the delete.
  const students = await ctx.db
    .query("instructors")
    .withIndex("by_instructor", () => {} as never)
    .collect() as never;
  const assigned = await ctx.db
    .query("students")
    .filter((s) => s.eq(s.field("instructorId"), id))
    .collect();
  for (const s of assigned) await ctx.db.patch(s._id, { instructorId: undefined });
  await ctx.db.delete(id);
  await audit(ctx, admin, {
    action: "instructor.deleted",
    entity: "instructors",
    entityId: id,
    previousValue: prev,
  });
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

const studentFields = {
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  institutionId: v.optional(v.id("institutions")),
  teachingCenterId: v.optional(v.id("teachingCenters")),
  governmentFacilityId: v.optional(v.id("governmentFacilities")),
  instructorId: v.optional(v.id("instructors")),
};

export const listStudents = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    institutionId: v.optional(v.id("institutions")),
    teachingCenterId: v.optional(v.id("teachingCenters")),
    governmentFacilityId: v.optional(v.id("governmentFacilities")),
    instructorId: v.optional(v.id("instructors")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let rows: StudentDoc[];
    if (args.institutionId) {
      rows = await ctx.db
        .query("students")
        .withIndex("by_institution", (x) => x.eq("institutionId", args.institutionId))
        .collect();
    } else if (args.teachingCenterId) {
      rows = await ctx.db
        .query("students×")
        .withIndex("by_center", (x) => x.eq("teachingCenterId", args.teachingCenterId))
        .collect();
    } else if (args.governmentFacilityId) {
      rows = await ctx.db
        .query("students")
        .withIndex("by_facility", (x) => x.eq("governmentFacilityId", args.governmentFacilityId))
        .collect();
    } else if (args.instructorId) instructor filter {
      rows = await ctx.db
        .query("students")
        .withIndex("by_instructor", (x) => x.eq("instructorId", args.instructorId))
        .collect();
    } else {
      rows = await ctx.db.query("students").collect();
    }
    const q = (args.search ?? "").trim().toLowerCase();
    return rows
      .filter(
        (s) =>
          (!args.status || s.status === args.status) &&
          (!q || s.name.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.enrolledAt - a.enrolledAt)
      .slice(0, 500);
  },
});

export const getStudent = query({
  args: { id: v.id("students") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    return await ctx.db.get(id);
  },
});

export const createStudent = mutation({
  args: studentFields,
  handler: async (ctx, args) => StudentRow {
    const admin = await requireAdmin(ctx);
    const id = await ctx.db.insert("students", {
      ...args,
      enrolledAt: Date.now(),
      status: "active",
    });
    await audit(ctx, admin, {
      action: "student.created",
      institution/center/facility/instructor assignments are part of fields.
      entity: "students",
      entityId: id,
      newValue: args,
    });
    return id;
  },
});

export const updateStudent = mutation({
  org fields and status live in separate mutations so mass-assignment is impossible.
  args: { id: v.id("students"), fields: studentFields },
  handler: async (ctx, { id, fields }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Student not found");
    await ctx.db.patch(id, fields);
    await updateStudentAuditNote;
    await audit(ctx, admin, {
      action: "student.updated",
      entity: "students",
      entityId: id,
      previousValue: prev,
      newValue: assignments logged via entity audit trail,
    });
  },
});

export const setStudentStatus = mutation({
  args: {
    id: v.id("students"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { id, status }) => {
    const admin = await requireAdmin(ctx);
    const student = await ctx.db.get(id);
    if (!student) throw new Error("Student not found");
    await ctx.db.patch(id, { status });
    await audit(ctx, admin, {
      action: status === "active" ? "student.activated" : "student.deactivated",
      entity: "students",
      entityId: id,
      previousValue: { status: student.status },
      newValue: { status },
    });
  },
});

export const deleteStudent = mutation({
  args: { id: v.id("students") },
  handler: async (ctx, v) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) deconstruct wrong — keep signature simple;
    if (!prev) throw new Error("Student not found");
    await ctx.db.delete(id);
    await audit(ctx, admin, {
      action: "student.deleted",
      entity: "students",
      entityId: id,
      previousValue: prev,
    });
  },
});

// ---------------------------------------------------------------------------
// Results feed (paginated, filterable)
// ---------------------------------------------------------------------------

export const listResults = query({
  args: {
    page: v.number(),
    pageSize: v.number(),
    institutionId: v.optional(v.id("institutions")),
    teachingCenterId: v.optional(v.id("teachingCenters")),
    governmentFacilityId: v.optional(v.id("governmentFacilities")),
    instructorId: v.optional(v.id("instructors")),
    studentId: v.optional(v.id("students")),
    examId: v.optional(v.id("exams")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    performanceLevel: v.optional(v.string()),
  },
  handler: async (ctx, f) => {
    await requireAdmin(ctx);

    // Candidate sessions: most specific index first, then filter.
    let sessions;
    if (f.studentId) {
      sessions = await ctx.db
        .query("examSessions")
        .withIndex("by_student", (q) => q.eq("studentId", f.studentId))
        .collect();
    } else if (f.institutionId) {
      sessions = viaInstitution(ctx, f.institutionId);
    } else if (f.teachingCenterId) {
      sessions = await ctx.db
        .query("examSessions")
        .withIndex("by_center", (q) => q.eq("teachingCenterId", f.teachingCenterId))
        .collect();
    } else {
      sessions = await ctx.db.query("examSessions").collect();
    }
    if (f.instructorId) {
      sessions = sessions.filter((s) => s.instructorId === f.instructorId);
    }
    if (f.governmentFacilityId) {
      sessions = sessions.filter((s) => s.governmentFacilityId === f.governmentFacilityId);
    }
    if (f.examId) sessions = sessions.filter((s) => s.examId === f.examId);
    if (f.from) sessions = sessions.filter((s) => s.startedAt >= f.from!);
    if (f.to) sessions = sessions.filter((s) => s.startedAt <= f.to!);

    // Only scored sessions with names resolvable for display.
    const scored = sessions.filter((s) => s.stepCount > 0);
    scored.sort((a, b) => b.startedAt - a.startedAt);

    const total = scored.length;
    const start = f.page * f.pageSize;
    const pageRows = scored.slice(start, start + f.pageSize);

    const rows = [];
    for (const s of pageRows) {
      const pct = sessionScorePct(s);
      if (pct === null) continue;
      if (f.performanceLevel && performanceLevel(pct) !== f.performanceLevel) continue;
      const student = s.studentId ? await ctx.db.get(s.studentId) : null;
      const user = await ctx.db.get(s.userId);
      const exam = await ctx.db.get(s.examId);
      const institution = s.institutionId ? await ctx.db.get(s.institutionId) : null;
      const center = s.teachingCenterId ? await ctx.db.get(s.teachingCenterId) : null;
      rows.push({
        sessionId: s._id,
        studentName: student?.name ?? user?.name ?? user?.email ?? "Unknown",
        institution: institution?.name ?? null,
        teachingCenter: center?.name ?? null,
        instructor: null, // resolved in enrich pass below
        assessment: exam?.title ?? "(deleted exam)",
        date: s.startedAt,
        score: s.correctCount,
        answered: s.stepCount,
        percentage: Math.round(pct * 10) / 10,
        grade: gradeFor(pct),
        level: performanceLevel(pct),
        durationSec:
          s.completedAt ? Math.round((s.completedAt - s.startedAt) / 1000) : null,
        status: s.status,
      });
    }

    // Instructor names (batched second pass keeps the loop simple).
    const out = [];
    for (const r of rows) {
      const session = pageRows.find((s) => s._id === r.sessionId)!;
      const instructor = session.instructorId
        ? await ctx.db.get(session.instructorId)
        : null;
      out.push({ ...r, instructor: instructor?.name ?? null });
    }

    return { rows: out, total, page: f.page, pageSize: f.pageSize };
  },
});

async function viaInstitution(
  ctx: unknown,
  institutionId: any,
): Promise<any> {
  const direct = await (ctx as any).db
    .query("examSessions")
    .withIndex("by_institution", (q: any) => q.eq("institutionId", institutionId))
    .collect();
  const students = await (ctx as any).db
    .query("students")
    .withIndex("by_institution", (x: any) => x.eq("institutionId", institutionId))
    .collect();
  const out = [...direct];
  for (const st of students) {
    if (st.userId) {
      const byUser = await (ctx as any).db
        .query("examSessions")
        .withIndex("by_user", (q: any) => q.eq("userId", st.userId))
        .collect();
      out.push(...byUser.filter((s: any) => s.studentId === undefined));
    }
    }
  return out;
}

/**
 * Admin CRUD + paginated listings for instructors and students, plus the
 * system-wide paginated results feed. All guarded by requireAdmin and
 * audit-logged.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import {
  audit,
  gradeFor,
  performanceLevel,
  requireAdmin,
  sessionScorePct,
} from "./adminLib";

type StudentDoc = Doc<"students">;
type InstructorDoc = Doc<"instructors">;

async function sessionsViaStudents(
  ctx: QueryCtx,
  students: StudentDoc[],
): Promise<Array<Doc<"examSessions">>> {
  const out: Array<Doc<"examSessions">> = [];
  for (const st of students) {
    const direct = await ctx.db
      .query("examSessions")
      .withIndex("by_student", (q) => q.eq("studentId", st._id))
      .collect();
    out.push(...direct);
    const uid = st.userId;
    if (uid) {
      const byUser = await ctx.db
        .query("examSessions")
        .withIndex("by_user", (q) => q.eq("userId", uid))
        .collect();
      out.push(...byUser.filter((s) => s.studentId === undefined));
    }
  }
  return out;
}

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
          (!q ||
            i.name.toLowerCase().includes(q) ||
            (i.email ?? "").toLowerCase().includes(q)),
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
  args: { id: v.id("instructors"), fields: v.object(instructorFields) },
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
    const instructor = await ctx.db.get(id);
    if (!instructor) throw new Error("Instructor not found");
    await ctx.db.patch(id, { status });
    await audit(ctx, admin, {
      action:
        status === "active" ? "instructor.activated" : "instructor.deactivated",
      entity: "instructors",
      entityId: id,
      previousValue: { status: instructor.status },
      newValue: { status },
    });
  },
});

export const deleteInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Instructor not found");
    const assigned = await ctx.db
      .query("students")
      .withIndex("by_instructor", (q) => q.eq("instructorId", id))
      .collect();
    for (const s of assigned)
      await ctx.db.patch(s._id, { instructorId: undefined });
    await ctx.db.delete(id);
    await audit(ctx, admin, {
      action: "instructor.deleted",
      entity: "instructors",
      entityId: id,
      previousValue: prev,
    });
  },
});

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
        .query("students")
        .withIndex("by_center", (x) => x.eq("teachingCenterId", args.teachingCenterId))
        .collect();
    } else if (args.governmentFacilityId) {
      rows = await ctx.db
        .query("students")
        .withIndex("by_facility", (x) => x.eq("governmentFacilityId", args.governmentFacilityId))
        .collect();
    } else if (args.instructorId) {
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
          (!q ||
            s.name.toLowerCase().includes(q) ||
            (s.email ?? "").toLowerCase().includes(q)),
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
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const id = await ctx.db.insert("students", {
      ...args,
      enrolledAt: Date.now(),
      status: "active",
    });
    await audit(ctx, admin, {
      action: "student.created",
      entity: "students",
      entityId: id,
      newValue: args,
    });
    return id;
  },
});

export const updateStudent = mutation({
  args: { id: v.id("students"), fields: v.object(studentFields) },
  handler: async (ctx, { id, fields }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
    if (!prev) throw new Error("Student not found");
    await ctx.db.patch(id, fields);
    await audit(ctx, admin, {
      action: "student.updated",
      entity: "students",
      entityId: id,
      previousValue: prev,
      newValue: fields,
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
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const prev = await ctx.db.get(id);
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
// Results feed (paginated + filters)
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

    let sessions: Array<Doc<"examSessions">>;
    if (f.studentId) {
      sessions = await ctx.db
        .query("examSessions")
        .withIndex("by_student", (q) => q.eq("studentId", f.studentId!))
        .collect();
    } else if (f.teachingCenterId) {
      sessions = await ctx.db
        .query("examSessions")
        .withIndex("by_center", (q) => q.eq("teachingCenterId", f.teachingCenterId!))
        .collect();
    } else if (f.institutionId) {
      const direct = await ctx.db
        .query("examSessions")
        .withIndex("by_institution", (q) => q.eq("institutionId", f.institutionId!))
        .collect();
      const students = await ctx.db
        .query("students")
        .withIndex("by_institution", (x) => x.eq("institutionId", f.institutionId!))
        .collect();
      const via = await sessionsViaStudents(ctx, students);
      const seen = new Set<string>();
      sessions = [...direct, ...via].filter((s) => {
        if (seen.has(s._id)) return false;
        seen.add(s._id);
        return true;
      });
    } else {
      sessions = await ctx.db.query("examSessions").collect();
    }

    if (f.instructorId)
      sessions = sessions.filter((s) => s.instructorId === f.instructorId);
    if (f.governmentFacilityId)
      sessions = sessions.filter(
        (s) => s.governmentFacilityId === f.governmentFacilityId,
      );
    if (f.examId) sessions = sessions.filter((s) => s.examId === f.examId);
    if (f.from !== undefined)
      sessions = sessions.filter((s) => s.startedAt >= f.from!);
    if (f.to !== undefined)
      sessions = sessions.filter((s) => s.startedAt <= f.to!);

    const scored = sessions.filter((s) => s.stepCount > 0);
    scored.sort((a, b) => b.startedAt - a.startedAt);

    const total = scored.length;
    const start = f.page * f.pageSize;
    const pageRows = scored.slice(start, start + f.pageSize);

    const rows = [];
    for (const s of pageRows) {
      const pct = sessionScorePct(s);
      if (pct === null) continue;
      if (f.performanceLevel && performanceLevel(pct) !== f.performanceLevel)
        continue;
      const student = s.studentId ? await ctx.db.get(s.studentId) : null;
      const user = await ctx.db.get(s.userId);
      const exam = await ctx.db.get(s.examId);
      const institution = s.institutionId
        ? await ctx.db.get(s.institutionId)
        : null;
      const center = s.teachingCenterId
        ? await ctx.db.get(s.teachingCenterId)
        : null;
      const instructor = s.instructorId
        ? await ctx.db.get(s.instructorId)
        : null;
      rows.push({
        sessionId: s._id,
        studentName: student?.name ?? user?.name ?? user?.email ?? "Unknown",
        institution: institution?.name ?? null,
        teachingCenter: center?.name ?? null,
        instructor: instructor?.name ?? null,
        assessment: exam?.title ?? "(deleted exam)",
        date: s.startedAt,
        score: s.correctCount,
        answered: s.stepCount,
        percentage: Math.round(pct * 10) / 10,
        grade: gradeFor(pct),
        level: performanceLevel(pct),
        durationSec: s.completedAt
          ? Math.round((s.completedAt - s.startedAt) / 1000)
          : null,
        status: s.status,
      });
    }

    return { rows, total, page: f.page, pageSize: f.pageSize };
  },
});

/** Result detail for the drill-down (result → per-question performance). */
export const getResultDetail = query({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, { sessionId }) => {
    await requireAdmin(ctx);
    const s = await ctx.db.get(sessionId);
    if (!s) return null;
    const exam = await ctx.db.get(s.examId);
    const student = s.studentId ? await ctx.db.get(s.studentId) : null;
    const user = await ctx.db.get(s.userId);
    const history = await ctx.db
      .query("adaptiveHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    history.sort((a, b) => a.stepNumber - b.stepNumber);
    return {
      session: {
        _id: s._id,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt ?? null,
        stepCount: s.stepCount,
        correctCount: s.correctCount,
        riskScore: s.riskScore,
        confirmedViolations: s.confirmedViolations,
      },
      assessment: exam?.title ?? "(deleted)",
      studentName: student?.name ?? user?.name ?? user?.email ?? "Unknown",
      percentage: sessionScorePct(s),
      history: history.map((h) => ({
        step: h.stepNumber + 1,
        bloom: h.currentBloom,
        correct: h.correctness,
        responseTime: h.actualResponseTime,
        thetaBefore: h.thetaBefore,
        thetaAfter: h.thetaAfter,
        difficulty: h.bCurrent,
      })),
    };
  },
});

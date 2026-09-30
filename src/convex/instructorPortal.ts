/**
 * Instructor portal — role-gated workspace. Instructors claim the
 * "instructor" role, manage their classes and roster, and see per-class and
 * per-student performance. All queries/mutations verify the signed-in user
 * owns the records they touch.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  aggregateSessions,
  audit,
  currentUserOf,
  sessionScorePct,
  trendByMonth,
} from "./adminLib";

/** Resolve the instructor record linked to the signed-in user (or null). */
async function myInstructorRecord(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"instructors"> | null> {
  const all = await ctx.db.query("instructors").collect();
  const me = all.find((r) => r.userId === userId);
  return me ?? null;
}

// ---------------------------------------------------------------------------
// Viewer + claim (bootstrap "login" for instructors)
// ---------------------------------------------------------------------------

export const getInstructorViewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user) return null;
    const claimed = user.role === "instructor";
    let instructor: { id: string; name: string } | null = null;
    if (claimed) {
      const me = await myInstructorRecord(ctx, user._id);
      instructor = me ? { id: me._id, name: me.name } : null;
    }
    return {
      role: user.role ?? null,
      email: user.email ?? null,
      claimed,
      instructor,
    };
  },
});

/**
 * Link the signed-in user to an instructor record and grant the
 * "instructor" role. Allowed when an unclaimed instructor record matches the
 * email, or (first-instructor bootstrap) when no instructor is claimed yet.
 */
export const claimInstructor = mutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const me = await ctx.db.get(userId);
    if (!me) throw new Error("User missing");
    if (me.role === "admin")
      throw new Error("Admins manage instructors from the admin console.");
    if (me.role === "instructor") return { role: "instructor" as const };

    const instructors = await ctx.db.query("instructors").collect();
    const mail = (email ?? me.email ?? "").toLowerCase();
    const claimed = instructors.filter((i) => i.userId !== undefined);
    const target =
      instructors.find(
        (i) =>
          i.userId === undefined &&
          (i.email ?? "").toLowerCase() === mail &&
          mail !== "",
      ) ??
      (claimed.length === 0
        ? instructors.find((i) => i.userId === undefined)
        : undefined);
    if (!target)
      throw new Error(
        "No unclaimed instructor profile matches your email — ask an admin to create one.",
      );

    await ctx.db.patch(target._id, { userId });
    await ctx.db.patch(userId, { role: "instructor" });
    await audit(ctx, { _id: userId, email: me.email }, {
      action: "instructor.claimed",
      entity: "instructors",
      entityId: target._id,
      newValue: { userId, role: "instructor" },
    });
    return { role: "instructor" as const, instructorId: target._id };
  },
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const getInstructorDashboard = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "instructor")
      throw new Error("Instructor access required");
    const me = await myInstructorRecord(ctx, user._id);
    if (!me) throw new Error("No instructor profile linked to this account");

    const classes = await ctx.db
      .query("classes")
      .withIndex("by_instructor", (q) => q.eq("instructorId", me._id))
      .collect();
    const allSessions = await ctx.db.query("examSessions").collect();

    const out = [];
    for (const c of classes) {
      const roster = await ctx.db
        .query("students")
        .withIndex("by_class", (q) => q.eq("classId", c._id))
        .collect();
      const sessions = allSessions.filter((s) =>
        roster.some((r) => r._id === s.studentId),
      );
      const stats = aggregateSessions(sessions);
      const scores = sessions
        .map(sessionScorePct)
        .filter((v): v is number => v !== null);
      out.push({
        id: c._id,
        name: c.name,
        description: c.description ?? null,
        status: c.status,
        createdAt: c.createdAt,
        studentCount: roster.length,
        activeStudents: roster.filter((r) => r.status === "active").length,
        completedAssessments: stats.completed,
        avgScore: stats.avgScore,
        passRate: stats.passRate,
        completionRate: stats.completionRate,
        trend: trendByMonth(sessions),
        distribution: [
          { name: "Excellent (85+)", value: scores.filter((s) => s >= 85).length },
          { name: "Good (70-84)", value: scores.filter((s) => s >= 70 && s < 85).length },
          { name: "Average (55-69)", value: scores.filter((s) => s >= 55 && s < 70).length },
          { name: "Below (<55)", value: scores.filter((s) => s < 55).length },
        ],
        students: roster
          .map((r) => {
            const st = sessions.filter((s) => s.studentId === r._id);
            const stStats = aggregateSessions(st);
            const stScores = st
              .map(sessionScorePct)
              .filter((v): v is number => v !== null);
            return {
              id: r._id,
              name: r.name,
              email: r.email ?? null,
              status: r.status,
              enrolledAt: r.enrolledAt,
              assessments: st.length,
              avgScore: stStats.avgScore,
              lastScore: stScores.length ? stScores[stScores.length - 1] : null,
            };
          })
          .sort((a, b) => b.enrolledAt - a.enrolledAt),
      });
    }

    return {
      instructor: {
        id: me._id,
        name: me.name,
        email: me.email ?? null,
        specialization: me.specialization ?? null,
      },
      classes: out,
      totals: {
        classes: classes.length,
        students: out.reduce((a, c) => a + c.studentCount, 0),
        assessments: out.reduce((a, c) => a + c.completedAssessments, 0),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Class + roster management (ownership-checked)
// ---------------------------------------------------------------------------

async function requireOwnedClass(ctx: QueryCtx, classId: Id<"classes">) {
  const user = await currentUserOf(ctx);
  if (!user || user.role !== "instructor")
    throw new Error("Instructor access required");
  const me = await myInstructorRecord(ctx, user._id);
  if (!me) throw new Error("No instructor profile linked to this account");
  const cls = await ctx.db.get(classId);
  if (!cls || cls.instructorId !== me._id)
    throw new Error("You do not own this class");
  return { user, me, cls };
}

export const createMyClass = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, { name, description }) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "instructor")
      throw new Error("Instructor access required");
    const me = await myInstructorRecord(ctx, user._id);
    if (!me) throw new Error("No instructor profile linked to this account");
    const id = await ctx.db.insert("classes", {
      name,
      instructorId: me._id,
      institutionId: me.institutionId,
      teachingCenterId: me.teachingCenterId,
      description,
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, user, {
      action: "class.created",
      entity: "classes",
      entityId: id,
      newValue: { name, by: me.name },
    });
    return id;
  },
});

export const createMyStudent = mutation({
  args: {
    classId: v.id("classes"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, { classId, name, email, phone }) => {
    const { me } = await requireOwnedClass(ctx, classId);
    const id = await ctx.db.insert("students", {
      name,
      email,
      phone,
      institutionId: me.institutionId,
      teachingCenterId: me.teachingCenterId,
      instructorId: me._id,
      classId,
      enrolledAt: Date.now(),
      status: "active",
    });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "student.created",
      entity: "students",
      entityId: id,
      newValue: { name, classId },
    });
    return id;
  },
});

export const addStudentToMyClass = mutation({
  args: { classId: v.id("classes"), studentId: v.id("students") },
  handler: async (ctx, { classId, studentId }) => {
    const { me } = await requireOwnedClass(ctx, classId);
    const st = await ctx.db.get(studentId);
    if (!st) throw new Error("Student not found");
    await ctx.db.patch(studentId, { classId, instructorId: me._id });
    await audit(ctx, { _id: me.userId, email: me.email } as never, {
      action: "student.enrolled",
      entity: "students",
      entityId: studentId,
      newValue: { classId, instructorId: me._id },
    });
  },
});

export const removeStudentFromMyClass = mutation({
  args: { classId: v.id("classes"), studentId: v.id("students") },
  handler: async (ctx, { classId, studentId }) => {
    const { user } = await requireOwnedClass(ctx, classId);
    await ctx.db.patch(studentId, { classId: undefined });
    await audit(ctx, user, {
      action: "student.unenrolled",
      entity: "students",
      entityId: studentId,
      previousValue: { classId },
    });
  },
});

// ---------------------------------------------------------------------------
// Demo seed (admin-triggered, idempotent)
// ---------------------------------------------------------------------------

export const seedInstructorDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user || user.role !== "admin")
      throw new Error("Admin access required");

    const existing = await ctx.db
      .query("classes")
      .filter((q) => q.eq(q.field("name"), "Algorithms — Section A"))
      .collect();
    if (existing.length > 0) return { seeded: false };

    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const me = instructors.find((i) => i.name === "Dr. Omar Nasser");
    if (!me) return { seeded: false, reason: "seed admin demo org data first" };

    const rng = (() => {
      let s = 777001 >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
    })();
    const DAY = 86_400_000;
    const now = Date.now();

    const classIds: Array<Id<"classes">> = [];
    for (const d of [
      { name: "Algorithms — Section A", description: "Mon/Wed morning cohort" },
      { name: "Algorithms — Section B", description: "Tue/Thu evening cohort" },
    ]) {
      classIds.push(
        await ctx.db.insert("classes", {
          name: d.name,
          instructorId: me._id,
          institutionId: me.institutionId,
          teachingCenterId: me.teachingCenterId,
          description: d.description,
          status: "active",
          createdAt: now - 20 * DAY,
        }),
      );
    }

    const rosterNames = [
      "Amina Haddad", "Yosef Levi", "Lina Nasser", "Sara Peretz",
      "Omar Khalil", "Dani Azulay", "Maya Mansour", "Noah Cohen",
    ];
    let idx = 0;
    for (const classId of classIds) {
      const n = idx === 0 ? 5 : 3;
      for (let k = 0; k < n; k++) {
        await ctx.db.insert("students", {
          name: rosterNames[idx * 5 + k] ?? `Student ${idx}-${k}`,
          email: `s${idx}${k}@edu.example`,
          phone: `054-${3000000 + Math.floor(rng() * 6999999)}`,
          institutionId: me.institutionId,
          teachingCenterId: me.teachingCenterId,
          instructorId: me._id,
          classId,
          enrolledAt: now - Math.floor(rng() * 40) * DAY,
          status: "active",
        });
      }
      idx++;
    }

    await audit(ctx, user, {
      action: "instructor.demo_seeded",
      entity: "classes",
      entityId: classIds[0],
      detail: "2 classes + 8 students seeded for instructor demo",
    });
    return { seeded: true, classes: classIds.length };
  },
});

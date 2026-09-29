/**
 * Admin analytics — dashboard, performance dashboards, audit, bootstrap.
 * Split into small sections; helpers live in adminPerfLib.ts.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  aggregateSessions,
  audit,
  currentUserOf,
  gradeFor,
  monthKey,
  performanceLevel,
  requireAdmin,
  sessionScorePct,
  trendByMonth,
} from "./adminLib";
import {
  byExam,
  distributionOf,
  examIdsOf,
  perStudentRows,
  sessionsForInstitution,
  sessionsForStudents,
} from "./adminPerfLib";

type SessionDoc = Doc<"examSessions">;

// ---------------------------------------------------------------------------
// Admin bootstrap + viewer
// ---------------------------------------------------------------------------

/** Grant the admin role (self-claim allowed only when no admin exists). */
export const claimAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .collect();
    const me = await ctx.db.get(userId);
    if (!me) throw new Error("User missing");
    if (me.role !== "admin") {
      if (existing.length > 0)
        throw new Error("An admin already exists; ask them to grant access.");
      await ctx.db.patch(userId, { role: "admin" });
    }
    await audit(ctx, { _id: userId, email: me.email }, {
      action: "admin.claimed",
      entity: "users",
      entityId: userId,
      newValue: { role: "admin" },
    });
    return { role: "admin" as const };
  },
});

/** Current viewer role (client gating; no throw). */
export const getAdminViewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOf(ctx);
    if (!user) return null;
    return { role: user.role ?? null, email: user.email ?? null };
  },
});

// ---------------------------------------------------------------------------
// Dashboard summary + recent activity
// ---------------------------------------------------------------------------

export const getAdminDashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const institutions = await ctx.db.query("institutions").collect();
    const centers = await ctx.db.query("teachingCenters").collect();
    const facilities = await ctx.db.query("governmentFacilities").collect();
    const instructors = await ctx.db.query("instructors").collect();
    const students = await ctx.db.query("students").collect();
    const sessions = await ctx.db.query("examSessions").collect();
    const exams = await ctx.db.query("exams").collect();

    const stats = aggregateSessions(sessions);

    const instAvg = institutions.map((i) => {
      const ss = sessions.filter(
        (s) =>
          s.institutionId === i._id ||
          students.some(
            (st) => st._id === s.studentId && st.institutionId === i._id,
          ),
      );
      return aggregateSessions(ss).avgScore;
    }).filter((v): v is number => v !== null);

    return {
      counts: {
        institutions: institutions.length,
        teachingCenters: centers.length,
        governmentFacilities: facilities.length,
        instructors: instructors.length,
        students: students.length,
        assessments: exams.length,
        completedAssessments: stats.completed,
        activeStudents: students.filter((s) => s.status === "active").length,
      },
      performance: {
        avgScore: stats.avgScore,
        passRate: stats.passRate,
        completionRate: stats.completionRate,
        avgInstitutionPerformance:
          instAvg.length > 0
            ? instAvg.reduce((a, b) => a + b, 0) / instAvg.length
            : null,
      },
      charts: {
        studentsByInstitution: institutions.map((i) => ({
          name: i.name,
          value: students.filter((s) => s.institutionId === i._id).length,
        })),
        studentsByCenter: centers.map((c) => ({
          name: c.name,
          value: students.filter((s) => s.teachingCenterId === c._id).length,
        })),
        studentsByFacility: facilities.map((f) => ({
          name: f.name,
          value: students.filter((s) => s.governmentFacilityId === f._id).length,
        })),
        activeVsInactive: [
          { name: "Active", value: students.filter((s) => s.status === "active").length },
          { name: "Inactive", value: students.filter((s) => s.status === "inactive").length },
        ],
        enrollmentOverTime: (() => {
          const b = new Map<string, number>();
          for (const s of students) {
            const k = monthKey(s.enrolledAt);
            b.set(k, (b.get(k) ?? 0) + 1);
          }
          return [...b.entries()]
            .sort(([a], [c]) => a.localeCompare(c))
            .map(([month, n]) => ({ month, enrolled: n }));
        })(),
        performanceTrend: trendByMonth(sessions),
      },
      recent: {
        students: [...students]
          .sort((a, b) => b.enrolledAt - a.enrolledAt)
          .slice(0, 5)
          .map((s) => ({ id: s._id, name: s.name, at: s.enrolledAt })),
        instructors: [...instructors]
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 5)
          .map((i) => ({ id: i._id, name: i.name, at: i.createdAt })),
        institutions: [...institutions]
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 5)
          .map((i) => ({ id: i._id, name: i.name, at: i.createdAt })),
        assessments: [...exams]
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 5)
          .map((e) => ({ id: e._id, name: e.title, at: e.createdAt })),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Institution / center / facility performance
// ---------------------------------------------------------------------------

export const getInstitutionPerformance = query({
  args: { id: v.id("institutions") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const institution = await ctx.db.get(id);
    if (!institution) return null;
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
    const sessions = await sessionsForInstitution(ctx, id);
    const stats = aggregateSessions(sessions);
    const scores = sessions
      .map(sessionScorePct)
      .filter((v): v is number => v !== null);

    const rows = perStudentRows(students, sessions, aggregateSessions);
    const scored = rows.filter(
      (r): r is { id: Id<"students">; name: string; assessments: number; avgScore: number } =>
        r.avgScore !== null,
    );
    const ranked = [...scored].sort((a, b) => b.avgScore - a.avgScore);

    return {
      institution,
      summary: {
        totalStudents: students.length,
        totalInstructors: instructors.length,
        totalAssessments: examIdsOf(sessions),
        completedAssessments: stats.completed,
        averageScore: stats.avgScore,
        passRate: stats.passRate,
        completionRate: stats.completionRate,
        highest: ranked[0] ?? null,
        lowest: ranked[ranked.length - 1] ?? null,
      },
      charts: {
        trend: trendByMonth(sessions),
        distribution: distributionOf(scores),
        byInstructor: instructors.map((i) => ({
          name: i.name,
          avgScore: aggregateSessions(
            sessions.filter((s) => s.instructorId === i._id),
          ).avgScore,
        })),
        byCenter: centers.map((c) => ({
          name: c.name,
          avgScore: aggregateSessions(
            sessions.filter((s) => s.teachingCenterId === c._id),
          ).avgScore,
        })),
        byAssessment: await byExam(ctx, sessions),
        passFail: [
          { name: "Pass", value: scores.filter((s) => s >= 50).length },
          { name: "Fail", value: scores.filter((s) => s < 50).length },
        ],
      },
      studentTable: rows,
    };
  },
});

export const getTeachingCenterPerformance = query({
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
    const sessions = await sessionsForStudents(ctx, students);
    const stats = aggregateSessions(sessions);
    return {
      center,
      institution,
      summary: {
        totalStudents: students.length,
        totalInstructors: instructors.length,
        totalAssessments: examIdsOf(sessions),
        averageScore: stats.avgScore,
        passRate: stats.passRate,
        completionRate: stats.completionRate,
      },
      trend: trendByMonth(sessions),
      instructors: instructors.map((i) => ({
        id: i._id,
        name: i.name,
        avgScore: aggregateSessions(
          sessions.filter((s) => s.instructorId === i._id),
        ).avgScore,
      })),
      students: perStudentRows(students, sessions, aggregateSessions),
    };
  },
});

export const getFacilityPerformance = query({
  args: { id: v.id("governmentFacilities") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const facility = await ctx.db.get(id);
    if (!facility) return null;
    const students = await ctx.db
      .query("students")
      .withIndex("by_facility", (x) => x.eq("governmentFacilityId", id))
      .collect();
    const sessions = await sessionsForStudents(ctx, students);
    const stats = aggregateSessions(sessions);
    return {
      facility,
      summary: {
        totalPersonnel: students.length,
        completedAssessments: stats.completed,
        averageScore: stats.avgScore,
        passRate: stats.passRate,
        completionRate: stats.completionRate,
      },
      trend: trendByMonth(sessions),
      individuals: perStudentRows(students, sessions, aggregateSessions),
    };
  },
});

// ---------------------------------------------------------------------------
// Student + instructor performance
// ---------------------------------------------------------------------------

export const getStudentPerformance = query({
  args: { id: v.id("students") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const student = await ctx.db.get(id);
    if (!student) return null;
    const sessions = await sessionsForStudents(ctx, [student]);
    const stats = aggregateSessions(sessions);
    const scores = sessions
      .map(sessionScorePct)
      .filter((v): v is number => v !== null);

    const history = [];
    for (const s of sessions) {
      const exam = await ctx.db.get(s.examId);
      const pct = sessionScorePct(s);
      history.push({
        sessionId: s._id,
        assessment: exam?.title ?? "(deleted)",
        date: s.startedAt,
        score: s.correctCount,
        answered: s.stepCount,
        percentage: pct !== null ? Math.round(pct * 10) / 10 : null,
        grade: pct !== null ? gradeFor(pct) : null,
        level: pct !== null ? performanceLevel(pct) : null,
        durationSec: s.completedAt
          ? Math.round((s.completedAt - s.startedAt) / 1000)
          : null,
        status: s.status,
      });
    }
    history.sort((a, b) => a.date - b.date);

    // Adaptive-engine analytics from the most recent session.
    const latest = [...sessions].sort((a, b) => b.startedAt - a.startedAt)[0];
    let adaptive: {
      sessionId: string;
      thetaProfile: SessionDoc["thetaProfile"];
      progression: Array<{ step: number; bloom: string; theta: number; difficulty: number; correct: number }>;
      improvement: number | null;
    } | null = null;
    if (latest) {
      const rows = await ctx.db
        .query("adaptiveHistory")
        .withIndex("by_session", (q) => q.eq("sessionId", latest._id))
        .collect();
      rows.sort((a, b) => a.stepNumber - b.stepNumber);
      const first = rows[0]?.thetaBefore ?? null;
      const last = rows[rows.length - 1]?.thetaAfter ?? null;
      adaptive = {
        sessionId: latest._id,
        thetaProfile: latest.thetaProfile,
        progression: rows.map((h) => ({
          step: h.stepNumber + 1,
          bloom: h.currentBloom,
          theta: h.thetaAfter,
          difficulty: h.bCurrent,
          correct: h.correctness,
        })),
        improvement: first !== null && last !== null ? last - first : null,
      };
    }

    return {
      student,
      institution: student.institutionId ? await ctx.db.get(student.institutionId) : null,
      center: student.teachingCenterId ? await ctx.db.get(student.teachingCenterId) : null,
      facility: student.governmentFacilityId
        ? await ctx.db.get(student.governmentFacilityId)
        : null,
      instructor: student.instructorId ? await ctx.db.get(student.instructorId) : null,
      summary: {
        overallAverage: stats.avgScore,
        assessments: sessions.length,
        completed: stats.completed,
        highest: scores.length ? Math.max(...scores) : null,
        lowest: scores.length ? Math.min(...scores) : null,
        improvementPct: scores.length >= 2 ? scores[scores.length - 1] - scores[0] : null,
        avgDurationSec: stats.avgDurationSec,
        currentLevel: scores.length ? performanceLevel(scores[scores.length - 1]) : null,
      },
      scoreHistory: history.map((h) => ({ date: h.date, score: h.percentage, label: h.assessment })),
      history,
      adaptive,
    };
  },
});

export const getInstructorPerformance = query({
  args: { id: v.id("instructors") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const instructor = await ctx.db.get(id);
    if (!instructor) return null;
    const students = await ctx.db
      .query("students")
      .withIndex("by_instructor", (x) => x.eq("instructorId", id))
      .collect();
    const sessions = await sessionsForStudents(ctx, students);
    const stats = aggregateSessions(sessions);
    return {
      instructor,
      institution: instructor.institutionId
        ? await ctx.db.get(instructor.institutionId)
        : null,
      center: instructor.teachingCenterId
        ? await ctx.db.get(instructor.teachingCenterId)
        : null,
      summary: {
        students: students.length,
        assessments: examIdsOf(sessions),
        avgStudentScore: stats.avgScore,
        passRate: stats.passRate,
        completionRate: stats.completionRate,
      },
      trend: trendByMonth(sessions),
      byAssessment: await byExam(ctx, sessions),
      students: perStudentRows(students, sessions, aggregateSessions),
    };
  },
});

// ---------------------------------------------------------------------------
// System analytics, assessments, audit list
// ---------------------------------------------------------------------------

export const listAdminAssessments = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const exams = await ctx.db.query("exams").collect();
    const sessions = await ctx.db.query("examSessions").collect();
    const out = [];
    for (const e of [...exams].sort((a, b) => b.createdAt - a.createdAt)) {
      const ss = sessions.filter((s) => s.examId === e._id);
      const stats = aggregateSessions(ss);
      const inst = e.institutionId ? await ctx.db.get(e.institutionId) : null;
      out.push({
        id: e._id,
        title: e.title,
        institution: inst?.name ?? null,
        totalQuestions: e.totalQuestions,
        attempts: ss.length,
        completed: stats.completed,
        avgScore: stats.avgScore,
        passRate: stats.passRate,
        createdAt: e.createdAt,
      });
    }
    return out;
  },
});

export const getSystemAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [institutions, centers, sessions] = await Promise.all([
      ctx.db.query("institutions").collect(),
      ctx.db.query("teachingCenters").collect(),
      ctx.db.query("examSessions").collect(),
    ]);
    const stats = aggregateSessions(sessions);
    const scores = sessions
      .map(sessionScorePct)
      .filter((v): v is number => v !== null);
    return {
      metrics: {
        averageScore: stats.avgScore,
        medianScore: medianOf(scores),
        passRate: stats.passRate,
        completionRate: stats.completionRate,
        activeLearners: new Set(
          sessions.filter((s) => s.stepCount > 0).map((s) => s.studentId ?? s.userId),
        ).size,
        attempts: sessions.length,
      },
      charts: {
        trend: trendByMonth(sessions),
        institutionComparison: institutions.map((i) => ({
          name: i.name,
          avgScore: aggregateSessions(
            sessions.filter((s) => s.institutionId === i._id),
          ).avgScore,
        })),
        centerComparison: centers.map((c) => ({
          name: c.name,
          avgScore: aggregateSessions(
            sessions.filter((s) => s.teachingCenterId === c._id),
          ).avgScore,
        })),
        distribution: distributionOf(scores),
        monthlyCompletions: (() => {
          const b = new Map<string, number>();
          for (const s of sessions) {
            if (s.status !== "completed") continue;
            const k = monthKey(s.completedAt ?? s.startedAt);
            b.set(k, (b.get(k) ?? 0) + 1);
          }
          return [...b.entries()]
            .sort(([a], [c]) => a.localeCompare(c))
            .map(([month, n]) => ({ month, completed: n }));
        })(),
      },
    };
  },
});

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const listAuditLogs = query({
  args: { search: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { search, limit }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit ?? 200);
    const q = (search ?? "").trim().toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        r.action.toLowerCase().includes(q) ||
        (r.entity ?? "").toLowerCase().includes(q) ||
        (r.actorEmail ?? "").toLowerCase().includes(q),
    );
  },
});

// ---------------------------------------------------------------------------
// Demo seed: REAL linked rows (idempotent)
// ---------------------------------------------------------------------------

const FIRST = ["Amina", "Yosef", "Lina", "Omar", "Sara", "Dani", "Maya", "Noah", "Rana", "Sami", "Hana", "Ziv"];
const LAST = ["Haddad", "Levi", "Nasser", "Peretz", "Khalil", "Azulay", "Mansour", "Cohen"];

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const seedAdminDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const existing = await ctx.db
      .query("institutions")
      .filter((q) => q.eq(q.field("name"), "Northfield University"))
      .collect();
    if (existing.length > 0) return { seeded: false };

    const rng = makeRng(20260929);
    const now = Date.now();
    const DAY = 86_400_000;

    // --- Institutions ---
    const instDefs = [
      { name: "Northfield University", type: "university" as const, city: "Haifa", region: "North" },
      { name: "Galilee Institute of Technology", type: "institute" as const, city: "Acre", region: "North" },
      { name: "Ministry of Labor Training Division", type: "government_facility" as const, city: "Jerusalem", region: "Center" },
    ];
    const institutions: Array<Id<"institutions">> = [];
    for (const def of instDefs) {
      const id = await ctx.db.insert("institutions", {
        ...def,
        description: `${def.type.replace(/_/g, " ")} in the assessment program`,
        address: `${1 + Math.floor(rng() * 90)} Main Street`,
        phone: `04-${8000000 + Math.floor(rng() * 999999)}`,
        email: `info@${def.name.toLowerCase().replace(/[^a-z]+/g, "")}.edu`,
        contactPerson: `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`,
        status: "active",
        createdAt: now - Math.floor(30 + rng() * 60) * DAY,
      });
      institutions.push(id);
    }

    // --- Teaching centers ---
    const centerDefs = [
      { name: "CS Learning Center", instIdx: 0 },
      { name: "Engineering Skills Hub", instIdx: 0 },
      { name: "Tech Access Center", instIdx: 1 },
    ];
    const centers: Array<Id<"teachingCenters">> = [];
    for (const c of centerDefs) {
      const id = await ctx.db.insert("teachingCenters", {
        name: c.name,
        institutionId: institutions[c.instIdx],
        description: "On-campus teaching center",
        city: instDefs[c.instIdx].city,
        contactInfo: "03-555-0100",
        manager: `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`,
        status: "active",
        createdAt: now - Math.floor(20 + rng() * 30) * DAY,
      });
      centers.push(id);
    }

    // --- Government facility ---
    const facilityId = await ctx.db.insert("governmentFacilities", {
      name: "National Employment Service \u2014 Training Wing",
      sector: "Labor & Social Affairs",
      department: "Vocational Training",
      location: "Jerusalem",
      contactPerson: `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`,
      phone: "02-555-0140",
      email: "training@nes.gov",
      headcount: 40,
      status: "active",
      createdAt: now - 45 * DAY,
    });

    // --- Instructors ---
    const instructorDefs = [
      { name: "Dr. Rana Haddad", specialization: "Data Structures", instIdx: 0, centerIdx: 0 },
      { name: "Dr. Omar Nasser", specialization: "Algorithms", instIdx: 0, centerIdx: 1 },
      { name: "Eng. Maya Cohen", specialization: "Programming Fundamentals", instIdx: 1, centerIdx: 2 },
    ];
    const instructorIds: Array<Id<"instructors">> = [];
    for (const def of instructorDefs) {
      const id = await ctx.db.insert("instructors", {
        name: def.name,
        email: `${def.name.toLowerCase().replace(/[^a-z]+/g, ".")}@edu.example`,
        phone: `050-${1000000 + Math.floor(rng() * 8999999)}`,
        institutionId: institutions[def.instIdx],
        teachingCenterId: centers[def.centerIdx],
        specialization: def.specialization,
        status: "active",
        createdAt: now - Math.floor(10 + rng() * 15) * DAY,
      });
      instructorIds.push(id);
    }

    // --- Students ---
    const studentIds: Array<{ id: Id<"students">; instIdx: number }> = [];
    for (let i = 0; i < 14; i++) {
      const instIdx = i < 6 ? 0 : i < 10 ? 1 : 2;
      const centerIdx = instIdx === 0 ? i % 2 : instIdx === 1 ? 2 : undefined;
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;
      const id = await ctx.db.insert("students", {
        name,
        email: `student${i + 1}@edu.example`,
        phone: `052-${2000000 + Math.floor(rng() * 7999999)}`,
        institutionId: institutions[instIdx],
        teachingCenterId: centerIdx !== undefined ? centers[centerIdx] : undefined,
        governmentFacilityId: instIdx === 2 ? facilityId : undefined,
        instructorId: instructorIds[instIdx === 2 ? 2 : instIdx],
        enrolledAt: now - Math.floor(rng() * 90) * DAY,
        status: i === 13 ? "inactive" : "active",
      });
      studentIds.push({ id, instIdx });
    }

    // --- Exam link + sessions with real score rows ---
    const exam = (await ctx.db.query("exams").collect())[0];
    if (!exam) return { seeded: false, reason: "no exam exists" };
    if (!exam.institutionId) {
      await ctx.db.patch(exam._id, {
        institutionId: institutions[0],
        instructorId: instructorIds[0],
      });
    }

    const bloomPool = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;
    for (const st of studentIds) {
      const nSessions = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < nSessions; k++) {
        const startedAt = now - Math.floor(rng() * 120) * DAY;
        const skill = 0.45 + rng() * 0.45;
        const answered = 14;
        const correct = Math.max(0, Math.min(answered, Math.round(answered * skill + (rng() - 0.5) * 2)));
        const durationMs = Math.floor((12 + rng() * 18) * 60_000);
        const theta = (skill - 0.5) * 4;
        const sessionId = await ctx.db.insert("examSessions", {
          userId: admin._id,
          examId: exam._id,
          status: "completed",
          startedAt,
          completedAt: startedAt + durationMs,
          stepCount: answered,
          diagnosticFailures: 0,
          correctCount: correct,
          totalResponseTimeMs: durationMs,
          riskScore: 0,
          confirmedViolations: 0,
          institutionId: institutions[st.instIdx],
          governmentFacilityId: st.instIdx === 2 ? facilityId : undefined,
          instructorId: instructorIds[st.instIdx === 2 ? 2 : st.instIdx],
          studentId: st.id,
          thetaProfile: {
            remember: theta, understand: theta, apply: theta,
            analyze: theta, evaluate: theta, create: theta,
          },
          standardErrors: {
            remember: 0.4, understand: 0.4, apply: 0.4,
            analyze: 0.4, evaluate: 0.4, create: 0.4,
          },
        });
        for (let step = 0; step < answered; step++) {
          const ok = rng() < skill;
          await ctx.db.insert("adaptiveHistory", {
            sessionId,
            userId: admin._id,
            stepNumber: step,
            currentQuestionId: exam._id as unknown as Id<"questions">,
            currentBloom: bloomPool[step % 6],
            thetaBefore: theta + (step / answered) * 0.5 - 0.25,
            thetaAfter: theta + ((step + 1) / answered) * 0.5 - 0.25,
            standardError: 0.4,
            aCurrent: 1,
            bCurrent: -1 + (step / answered) * 2,
            response: ok ? "correct" : "incorrect",
            correctness: ok ? 1 : 0,
            actualResponseTime: 15_000 + Math.floor(rng() * 30_000),
            expectedTime: 45_000,
            TValue: 0,
            VValue: 0,
            gamma: 0.35,
            delta: 0.25,
            effectiveDifficulty: 0,
            predictedProbability: 0.5,
            itemInformation: 1,
            behavioralSignal: ok ? "CORRECT_FAST" : "INCORRECT_SLOW",
            adaptiveAction: "demo data row",
            difficultyChange: "STABLE",
            bloomTransition: "SAME",
            timestamp: startedAt + step * 60_000,
          });
        }
      }
    }

    await audit(ctx, admin, {
      action: "admin.demo_seeded",
      entity: "institutions",
      entityId: institutions[0],
      detail: "demo org hierarchy + sessions seeded",
    });
    return {
      seeded: true,
      institutions: institutions.length,
      centers: centers.length,
      instructors: instructorIds.length,
      students: studentIds.length,
    };
  },
});
// END_MARKER

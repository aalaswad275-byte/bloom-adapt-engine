import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Research-grade schema for the Bloom's Taxonomy-Integrated Adaptive IRT
 * system (v1: single-user model testing + integrity monitoring).
 *
 * The adaptive_history table is the research backbone: every row carries the
 * complete state needed to reconstruct WHY each question was selected.
 */

const bloomLevel = v.union(
  v.literal("remember"),
  v.literal("understand"),
  v.literal("apply"),
  v.literal("analyze"),
  v.literal("evaluate"),
  v.literal("create"),
);

const questionType = v.union(
  v.literal("multiple_choice"),
  v.literal("true_false"),
  v.literal("fill_in_blank"),
  v.literal("matching"),
  v.literal("short_answer"),
  v.literal("essay"),
  v.literal("programming"),
  v.literal("code_output"),
  v.literal("case_study"),
  v.literal("diagram"),
  v.literal("image_based"),
);

const behavioralSignal = v.union(
  v.literal("CORRECT_FAST"),
  v.literal("CORRECT_SLOW"),
  v.literal("INCORRECT_FAST"),
  v.literal("INCORRECT_SLOW"),
  v.literal("NEUTRAL"),
);

export default defineSchema(
  {
    ...authTables,

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(v.string()), // "student" | "instructor" | "admin" (v1: single user)
    }).index("email", ["email"]),

    // ---------------- Question bank ----------------
    questions: defineTable({
      questionText: v.string(),
      questionType,
      bloomLevel,
      topic: v.string(),
      learningOutcome: v.optional(v.string()),
      /** 2PL discrimination a. */
      discriminationA: v.number(),
      /** 2PL difficulty b. */
      difficultyB: v.number(),
      /** Expected (allocated) time in seconds, feeds E_t in the strain model. */
      expectedTime: v.number(),
      marks: v.number(),
      /** Canonical correct answer; format depends on questionType. */
      correctAnswer: v.string(),
      options: v.optional(v.array(v.string())),
      explanation: v.string(),
      /** Extensible descriptor for the visual-mismatch model. */
      visualFeatures: v.optional(v.any()),
      source: v.union(v.literal("manual"), v.literal("seed"), v.literal("ai_generated")),
      active: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_bloom", ["bloomLevel"])
      .index("by_topic", ["topic"])
      .index("by_active", ["active"]),

    // ---------------- Exams ----------------
    exams: defineTable({
      title: v.string(),
      description: v.optional(v.string()),
      /** Total number of questions the adaptive engine will deliver. */
      totalQuestions: v.number(),
      /** Target Bloom distribution (sums to ~1). */
      bloomDistribution: v.object({
        remember: v.number(),
        understand: v.number(),
        apply: v.number(),
        analyze: v.number(),
        evaluate: v.number(),
        create: v.number(),
      }),
      /** Mandatory minimum coverage per level (must never be violated). */
      mandatoryMinimums: v.object({
        remember: v.number(),
        understand: v.number(),
        apply: v.number(),
        analyze: v.number(),
        evaluate: v.number(),
        create: v.number(),
      }),
      /** Adaptive model parameters — configurable, stored per exam. */
      gamma: v.number(),
      delta: v.number(),
      targetProbability: v.number(),
      weights: v.object({
        w1: v.number(),
        w2: v.number(),
        w3: v.number(),
        w4: v.number(),
        w5: v.number(),
        w6: v.number(),
      }),
      difficultyRange: v.object({ min: v.number(), max: v.number() }),
      timeStrainClip: v.object({ low: v.number(), high: v.number() }),
      /** Org link — demo seed assigns exams to the seed institution. */
      institutionId: v.optional(v.id("institutions")),
      /** Owning instructor (creator) when the assessment is instructor-made. */
      instructorId: v.optional(v.id("instructors")),
      /** Integrity settings. */
      violationThreshold: v.number(),
      monitoringEnabled: v.boolean(),
      /**
       * Unified monitoring engine configuration — thresholds (grace periods),
       * confidence floor, policy ladder, phone policy. Config-driven so
       * detection behavior changes without touching engine logic.
       */
      monitoringConfig: v.optional(
        v.object({
          minConfidence: v.number(),
          thresholds: v.record(v.string(), v.number()),
          warnViolations: v.number(),
          pauseViolations: v.number(),
          maxViolations: v.number(),
          identityVerificationEnabled: v.boolean(),
          phoneMode: v.union(v.literal("any_visible"), v.literal("in_use_only")),
        }),
      ),
      showDebugPanel: v.boolean(), // expose theta/a/b/T/V/P (admin-gated)
      active: v.boolean(),
      createdAt: v.number(),
    }).index("by_active", ["active"]),

    // ---------------- Sessions ----------------
    examSessions: defineTable({
      userId: v.id("users"),
      examId: v.id("exams"),
      status: v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("terminated"),
      ),
      /** Termination reason when status = terminated. */
      terminationReason: v.optional(v.string()),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
      /** Current six-dimensional theta profile (theta per Bloom level). */
      thetaProfile: v.object({
        remember: v.number(),
        understand: v.number(),
        apply: v.number(),
        analyze: v.number(),
        evaluate: v.number(),
        create: v.number(),
      }),
      standardErrors: v.object({
        remember: v.number(),
        understand: v.number(),
        apply: v.number(),
        analyze: v.number(),
        evaluate: v.number(),
        create: v.number(),
      }),
      /** How many steps have been delivered so far. */
      stepCount: v.number(),
      /** Currently served question (awaiting response). */
      currentQuestionId: v.optional(v.id("questions")),
      /** Last item's parameters, for Delta_b and behavior tracking. */
      lastBloomLevel: v.optional(bloomLevel),
      lastDifficultyB: v.optional(v.number()),
      /** Diagnostics: pending verification level + consecutive failures. */
      diagnosticLevel: v.optional(bloomLevel),
      diagnosticFailures: v.number(),
      /** Cumulative exam statistics. */
      correctCount: v.number(),
      totalResponseTimeMs: v.number(),
      /** Aggregated integrity state (separate subsystem). */
      riskScore: v.number(),
      /** Unified violation counter across browser + vision event types. */
      confirmedViolations: v.number(),
      /** Highest PolicyAction applied so far (WARNING < PAUSE < TERMINATE). */
      policyAction: v.optional(v.string()),
      /** Violations observed by the client but not yet acknowledged server-side. */
      pendingClientViolations: v.optional(v.number()),
      /** Org links for admin analytics (assigned at session start). */
      institutionId: v.optional(v.id("institutions")),
      teachingCenterId: v.optional(v.id("teachingCenters")),
      governmentFacilityId: v.optional(v.id("governmentFacilities")),
      instructorId: v.optional(v.id("instructors")),
      studentId: v.optional(v.id("students")),
    })
      .index("by_user", ["userId"])
      .index("by_exam", ["examId"])
      .index("by_status", ["status"])
      .index("by_student", ["studentId"])
      .index("by_institution", ["institutionId"])
      .index("by_instructor", ["instructorId"])
      .index("by_center", ["teachingCenterId"]),

    // ---------------- Per-item context records ----------------
    studentResponses: defineTable({
      sessionId: v.id("examSessions"),
      questionId: v.id("questions"),
      userId: v.id("users"),
      stepNumber: v.number(),
      submittedAnswer: v.string(),
      isCorrect: v.boolean(),
      manual: v.boolean(),
      marks: v.number(),
      answeredAt: v.number(),
    })
      .index("by_session", ["sessionId"])
      .index("by_user", ["userId"]),

    timeMeasurements: defineTable({
      sessionId: v.id("examSessions"),
      questionId: v.id("questions"),
      stepNumber: v.number(),
      actualResponseTimeMs: v.number(),
      expectedTimeSec: v.number(),
      timeDifferenceMs: v.number(),
      /** Signed normalized strain (RT - E)/(E + eps), clipped, sign preserved. */
      normalizedTimeStrain: v.number(),
    }).index("by_session", ["sessionId"]),

    visualInteractions: defineTable({
      sessionId: v.id("examSessions"),
      questionId: v.id("questions"),
      stepNumber: v.number(),
      gazeDeviation: v.number(),
      attentionToQuestion: v.number(),
      abnormalInteraction: v.number(),
      /** Normalized mismatch in [0,1]. */
      visualMismatch: v.number(),
    }).index("by_session", ["sessionId"]),

    // ---------------- THE research table ----------------
    adaptiveHistory: defineTable({
      sessionId: v.id("examSessions"),
      userId: v.id("users"),
      stepNumber: v.number(),
      currentQuestionId: v.id("questions"),
      nextQuestionId: v.optional(v.id("questions")),
      currentBloom: bloomLevel,
      nextBloom: v.optional(bloomLevel),
      thetaBefore: v.number(),
      thetaAfter: v.number(),
      standardError: v.number(),
      aCurrent: v.number(),
      bCurrent: v.number(),
      aNext: v.optional(v.number()),
      bNext: v.optional(v.number()),
      response: v.string(),
      correctness: v.number(), // 0/1
      actualResponseTime: v.number(),
      expectedTime: v.number(),
      TValue: v.number(),
      VValue: v.number(),
      gamma: v.number(),
      delta: v.number(),
      effectiveDifficulty: v.number(),
      predictedProbability: v.number(),
      itemInformation: v.number(),
      behavioralSignal,
      adaptiveAction: v.string(),
      difficultyChange: v.string(), // "UP" | "STABLE_OR_UP" | "DIAGNOSTIC" | "DOWN" | "FIRST" | "SKIP"
      bloomTransition: v.string(), // "SAME" | "HIGHER" | "PREREQUISITE" | "FIRST" | "SKIP"
      selectionScore: v.optional(v.number()),
      /** Ranked candidate summaries for full reproducibility. */
      candidates: v.optional(v.array(v.object({
        questionId: v.id("questions"),
        utility: v.number(),
        probability: v.number(),
        information: v.number(),
        bloomLevel: bloomLevel,
        eligible: v.boolean(),
        reason: v.optional(v.string()),
      }))),
      timestamp: v.number(),
    })
      .index("by_session", ["sessionId"])
      .index("by_user", ["userId"]),

    // ---------------- Admin module: institutions & org hierarchy ----------------
    institutions: defineTable({
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
      status: v.union(v.literal("active"), v.literal("inactive")),
      createdAt: v.number(),
    }).index("by_status", ["status"]),

    teachingCenters: defineTable({
      name: v.string(),
      institutionId: v.id("institutions"),
      description: v.optional(v.string()),
      address: v.optional(v.string()),
      city: v.optional(v.string()),
      contactInfo: v.optional(v.string()),
      manager: v.optional(v.string()),
      status: v.union(v.literal("active"), v.literal("inactive")),
      createdAt: v.number(),
    })
      .index("by_institution", ["institutionId"])
      .index("by_status", ["status"]),

    governmentFacilities: defineTable({
      name: v.string(),
      sector: v.optional(v.string()),
      department: v.optional(v.string()),
      description: v.optional(v.string()),
      location: v.optional(v.string()),
      contactPerson: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      headcount: v.optional(v.number()),
      status: v.union(v.literal("active"), v.literal("inactive")),
      createdAt: v.number(),
    }).index("by_status", ["status"]),

    /** Instructor org profile (one per user; v1 demo people are user-less). */
    instructors: defineTable({
      userId: v.optional(v.id("users")),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      institutionId: v.optional(v.id("institutions")),
      teachingCenterId: v.optional(v.id("teachingCenters")),
      governmentFacilityId: v.optional(v.id("governmentFacilities")),
      specialization: v.optional(v.string()),
      status: v.union(v.literal("active"), v.literal("inactive")),
      createdAt: v.number(),
    })
      .index("by_institution", ["institutionId"])
      .index("by_center", ["teachingCenterId"])
      .index("by_facility", ["governmentFacilityId"])
      .index("by_status", ["status"]),

    /** A class is an instructor's teaching group; students enroll into it. */
    classes: defineTable({
      name: v.string(),
      instructorId: v.id("instructors"),
      institutionId: v.optional(v.id("institutions")),
      teachingCenterId: v.optional(v.id("teachingCenters")),
      description: v.optional(v.string()),
      status: v.union(v.literal("active"), v.literal("inactive")),
      createdAt: v.number(),
    })
      .index("by_instructor", ["instructorId"])
      .index("by_institution", ["institutionId"])
      .index("by_status", ["status"]),

    // ---------------- Instructor assessment management ----------------
    /** A question authored by an instructor and owned by a class. */
    instructorQuestions: defineTable({
      classId: v.id("classes"),
      instructorId: v.id("instructors"),
      questionText: v.string(),
      questionType: v.union(
        v.literal("multiple_choice"),
        v.literal("true_false"),
        v.literal("short_answer"),
      ),
      /** Options for MC/TF; TF uses ["True", "False"]. */
      options: v.optional(v.array(v.string())),
      /** Canonical correct answer (must be one of options for MC/TF). */
      correctAnswer: v.string(),
      explanation: v.optional(v.string()),
      marks: v.number(),
      /** Bloom's Taxonomy level targeted by this question. */
      bloomLevel: bloomLevel,
      /** Expected answer time in seconds (feeds pacing analytics). */
      expectedTimeSec: v.number(),
      /** True when produced by the AI generator (before/after edit). */
      source: v.optional(v.union(
        v.literal("manual"),
        v.literal("ai"),
      )),
      topic: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_class", ["classId"])
      .index("by_instructor", ["instructorId"])
      .index("by_bloom", ["bloomLevel"]),

    /** An instructor-built assessment assigned to exactly one class. */
    instructorAssessments: defineTable({
      classId: v.id("classes"),
      instructorId: v.id("instructors"),
      title: v.string(),
      description: v.optional(v.string()),
      /** Minutes; 0 = untimed. */
      timeLimitMin: v.number(),
      /** draft | published | closed */
      status: v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("closed"),
      ),
      publishedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_class", ["classId"])
      .index("by_instructor", ["instructorId"]),

    /** Assessment → question link with ordering. */
    assessmentQuestions: defineTable({
      assessmentId: v.id("instructorAssessments"),
      questionId: v.id("instructorQuestions"),
      order: v.number(),
    })
      .index("by_assessment", ["assessmentId"]),

    /** One student's submission for an assessment. */
    assessmentSubmissions: defineTable({
      assessmentId: v.id("instructorAssessments"),
      classId: v.id("classes"),
      studentId: v.id("students"),
      /** in_progress | submitted | graded */
      status: v.union(
        v.literal("in_progress"),
        v.literal("submitted"),
        v.literal("graded"),
      ),
      /** Array index = position in the assessment's question list. */
      answers: v.optional(v.array(v.string())),
      startedAt: v.number(),
      submittedAt: v.optional(v.number()),
      score: v.optional(v.number()),
      maxScore: v.optional(v.number()),
      autoGraded: v.optional(v.boolean()),
    })
      .index("by_assessment", ["assessmentId"])
      .index("by_student", ["studentId"])
      .index("by_class", ["classId"]),

    /**
     * Enrollment record created when a student actively joins a class
     * (their email must match a roster email added by the instructor).
     * Uniqueness of (classId, studentId) is enforced by a check in joinClass;
     * the by_class_student index powers duplicate lookups.
     */
    classEnrollments: defineTable({
      classId: v.id("classes"),
      studentId: v.id("students"),
      joinedAt: v.number(),
    })
      .index("by_class", ["classId"])
      .index("by_student", ["studentId"])
      .index("by_class_student", ["classId", "studentId"]),

    /** Student org profile (one per user; v1 demo people are user-less). */
    students: defineTable({
      userId: v.optional(v.id("users")),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      institutionId: v.optional(v.id("institutions")),
      teachingCenterId: v.optional(v.id("teachingCenters")),
      governmentFacilityId: v.optional(v.id("governmentFacilities")),
      instructorId: v.optional(v.id("instructors")),
      classId: v.optional(v.id("classes")),
      /** Identity/profile image in Convex file storage; required before
       *  joining a class or taking an assessment. */
      identityImageId: v.optional(v.id("_storage")),
      identityImageAt: v.optional(v.number()),
      enrolledAt: v.number(),
      status: v.union(v.literal("active"), v.literal("inactive")),
    })
      .index("by_institution", ["institutionId"])
      .index("by_center", ["teachingCenterId"])
      .index("by_facility", ["governmentFacilityId"])
      .index("by_instructor", ["instructorId"])
      .index("by_class", ["classId"])
      .index("by_status", ["status"]),
    /**
     * Every violation AND recovery event across both detection lanes.
     * Browser events and CV events share this table but carry their lane in
     * `source` so admins can filter; `durationMs` records how long the
     * condition persisted before firing (or before recovery).
     */
    monitoringEvents: defineTable({
      sessionId: v.id("examSessions"),
      userId: v.id("users"),
      timestamp: v.number(),
      type: v.string(), // ViolationType
      source: v.optional(v.string()), // browser | vision | camera
      kind: v.optional(v.string()), // violation | recovery | raw
      confidence: v.number(),
      severity: v.string(),
      /** Persistence duration before the violation fired (ms). */
      durationMs: v.optional(v.number()),
      /** Question step number at the time of the event. */
      stepNumber: v.optional(v.number()),
      detail: v.optional(v.string()),
      screenshotPath: v.optional(v.string()),
      videoPath: v.optional(v.string()),
    })
      .index("by_session", ["sessionId"])
      .index("by_session_type", ["sessionId", "type"]),

    integrityIncidents: defineTable({
      sessionId: v.id("examSessions"),
      userId: v.id("users"),
      type: v.string(),
      confirmedAt: v.number(),
      evidenceCount: v.number(),
      detail: v.optional(v.string()),
    }).index("by_session", ["sessionId"]),

    warnings: defineTable({
      sessionId: v.id("examSessions"),
      userId: v.id("users"),
      timestamp: v.number(),
      message: v.string(),
      eventType: v.optional(v.string()),
      severity: v.string(),
    }).index("by_session", ["sessionId"]),

    // ---------------- Audit ----------------
    auditLogs: defineTable({
      userId: v.optional(v.id("users")),
      action: v.string(),
      detail: v.optional(v.string()),
      timestamp: v.number(),
      /** Structured admin audit fields. */
      actorEmail: v.optional(v.string()),
      entity: v.optional(v.string()),
      entityId: v.optional(v.string()),
      previousValue: v.optional(v.string()),
      newValue: v.optional(v.string()),
    }).index("by_timestamp", ["timestamp"]),
  },
  { schemaValidation: true },
);

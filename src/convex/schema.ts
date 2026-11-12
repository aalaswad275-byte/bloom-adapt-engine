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

const difficultyLevel = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
  v.literal("expert"),
);

/** One drop zone in a drag-and-drop question. */
const dragDropTarget = v.object({
  id: v.string(),
  label: v.string(),
  hint: v.optional(v.string()),
});

/** The authored correct placement of one draggable item. */
const dragDropPlacement = v.object({
  targetId: v.string(),
  item: v.string(),
});

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

    /** Social account links — allows one user to sign in via multiple
     *  providers (email/password, Google, Apple) without creating duplicates. */
    socialAccounts: defineTable({
      userId: v.id("users"),
      provider: v.string(), // "google" | "apple"
      providerId: v.string(), // The provider's unique user ID
      providerEmail: v.optional(v.string()), // Email from the provider
      createdAt: v.number(),
    }).index("by_provider", ["provider", "providerId"])
      .index("by_user", ["userId"]),




    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(v.string()), // "student" | "instructor" | "admin" (v1: single user)
      // Password auth fields
      password: v.optional(v.string()), // SHA-256 hash of password
      _passwordResetToken: v.optional(v.string()),
      _passwordResetExpiry: v.optional(v.number()),
    }).index("email", ["email"]),

    // ---------------- Question taxonomy (admin-managed) ----------------
    /**
     * The question classification vocabulary. Everything the question forms
     * offer is read from these three tables, so administrators can add, rename
     * and retire values without a deploy:
     *
     *   category (subject)  →  topics (sub-categories)  →  question types
     *
     * Classes reference a category (`classes.categoryId`), and the Shared
     * Question bank is scoped by it, which is what keeps unrelated subjects
     * out of an instructor's view.
     */
    questionCategories: defineTable({
      name: v.string(),
      /** Normalized lowercase name; the lookup key for de-duplication. */
      key: v.string(),
      description: v.optional(v.string()),
      status: v.union(v.literal("active"), v.literal("archived")),
      sortOrder: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_key", ["key"])
      .index("by_status", ["status"]),

    questionTopics: defineTable({
      categoryId: v.id("questionCategories"),
      name: v.string(),
      key: v.string(),
      status: v.union(v.literal("active"), v.literal("archived")),
      sortOrder: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_category", ["categoryId"])
      .index("by_category_key", ["categoryId", "key"])
      .index("by_key", ["key"]),

    questionTypeDefs: defineTable({
      /** Stable identifier stored on questions (`typeKey`). */
      key: v.string(),
      label: v.string(),
      /** How the answer is captured and auto-graded. */
      answerFormat: v.union(
        v.literal("multiple_choice"),
        v.literal("true_false"),
        v.literal("text"),
        v.literal("drag_drop"),
      ),
      status: v.union(v.literal("active"), v.literal("archived")),
      sortOrder: v.number(),
      /** Built-in types can be archived but never deleted. */
      isSystem: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

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
      /** Subject taught in this class (e.g. "English", "Physics"). Drives
       *  which Shared Questions an instructor sees for this class. */
      subject: v.optional(v.string()),
      /** Canonical taxonomy category behind `subject`. Set whenever the
       *  subject is chosen from the admin-managed list; scoping prefers it. */
      categoryId: v.optional(v.id("questionCategories")),
      status: v.union(v.literal("active"), v.literal("inactive")),
      /** Instructor-owned closure: set when the class is finalized for its
       *  final exam. Closed classes accept no new regular assessments and no
       *  roster changes; only the final exam stays open. */
      closedAt: v.optional(v.number()),
      /** Optional instructor note recorded with the closure. */
      closureNote: v.optional(v.string()),
      /** The final exam generated at closure (one shared paper per class). */
      finalAssessmentId: v.optional(v.id("instructorAssessments")),
      createdAt: v.number(),
    })
      .index("by_instructor", ["instructorId"])
      .index("by_institution", ["institutionId"])
      .index("by_status", ["status"]),

    // ---------------- Shared question bank ----------------
    /**
     * A reusable question that is NOT bound to a class. Instructors browse
     * the shared bank (scoped to the subjects they teach), import entries
     * into a class pool by reference, and manage the ones they own. Admins
     * can view, add, edit, delete and archive every row.
     */
    sharedQuestions: defineTable({
      // Classification fields (categoryId/topicId/typeKey) are declared with
      // the rest of the row below.
      /** Human-readable subject (e.g. "English", "Physics"). */
      subject: v.string(),
      /** Canonical category/topic/type references (admin-managed taxonomy). */
      categoryId: v.optional(v.id("questionCategories")),
      topicId: v.optional(v.id("questionTopics")),
      typeKey: v.optional(v.string()),
      topic: v.optional(v.string()),
      questionText: v.string(),
      questionType: v.union(
        v.literal("multiple_choice"),
        v.literal("true_false"),
        v.literal("short_answer"),
        v.literal("drag_drop"),
      ),
      /** Options for MC/TF; TF uses ["True", "False"]. Drag-and-drop uses
       *  them as the draggable items. */
      options: v.optional(v.array(v.string())),
      correctAnswer: v.string(),
      /** Drag-and-drop drop zones and the authored item→zone mapping. */
      dragDropTargets: v.optional(v.array(dragDropTarget)),
      dragDropCorrect: v.optional(v.array(dragDropPlacement)),
      /** Award proportional marks for correct placements (default true). */
      partialCredit: v.optional(v.boolean()),
      explanation: v.optional(v.string()),
      marks: v.number(),
      bloomLevel: bloomLevel,
      difficultyLevel: v.optional(difficultyLevel),
      expectedTimeSec: v.number(),
      difficultyB: v.optional(v.number()),
      discriminationA: v.optional(v.number()),
      /** Instructor owner; absent for admin/platform-wide questions. */
      ownerInstructorId: v.optional(v.id("instructors")),
      /** Display name of the author ("Admin" for platform questions). */
      ownerName: v.string(),
      createdByUserId: v.optional(v.id("users")),
      /** Set on import rows produced from shared questions. */
      importedSharedQuestionId: v.optional(v.id("sharedQuestions")),
      /** Whether this shared question is visible to other instructors.
       *  true/absent = shared (default on create), false = private (never
       *  shown in the shared bank, but kept in this owner's question bank). */
      share: v.optional(v.boolean()),
      /** Archived rows stay visible to their owner and admins only. */
      status: v.union(v.literal("active"), v.literal("archived")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_subject", ["subject"])
      .index("by_category", ["categoryId"])
      .index("by_owner", ["ownerInstructorId"]),

    // ---------------- Instructor assessment management ----------------
    /** A question authored by an instructor and owned by a class. */
    instructorQuestions: defineTable({
      classId: v.id("classes"),
      instructorId: v.id("instructors"),
      /** Canonical category/topic/type references (admin-managed taxonomy).
       *  `topic` keeps the display name for backwards compatibility. */
      categoryId: v.optional(v.id("questionCategories")),
      topicId: v.optional(v.id("questionTopics")),
      /** Pedagogical question type (`questionTypeDefs.key`). `questionType`
       *  stays the answer format so grading and delivery are unaffected. */
      typeKey: v.optional(v.string()),
      questionText: v.string(),
      questionType: v.union(
        v.literal("multiple_choice"),
        v.literal("true_false"),
        v.literal("short_answer"),
        v.literal("drag_drop"),
      ),
      /** Options for MC/TF; TF uses ["True", "False"]. Drag-and-drop uses
       *  them as the draggable items. */
      options: v.optional(v.array(v.string())),
      /** Canonical correct answer (must be one of options for MC/TF). */
      correctAnswer: v.string(),
      /** Drag-and-drop drop zones and the authored item→zone mapping. */
      dragDropTargets: v.optional(v.array(dragDropTarget)),
      dragDropCorrect: v.optional(v.array(dragDropPlacement)),
      /** Award proportional marks for correct placements (default true). */
      partialCredit: v.optional(v.boolean()),
      explanation: v.optional(v.string()),
      marks: v.number(),
      /** Bloom's Taxonomy level targeted by this question. */
      bloomLevel: bloomLevel,
      /** Coarse instructor-facing difficulty band (absent on legacy rows). */
      difficultyLevel: v.optional(difficultyLevel),
      /** Expected answer time in seconds (feeds pacing analytics). */
      expectedTimeSec: v.number(),
      /** 2PL difficulty b for the adaptive selector (default derived from
       *  the Bloom level when unset). */
      difficultyB: v.optional(v.number()),
      /** 2PL discrimination a (default 1.0 when unset). */
      discriminationA: v.optional(v.number()),
      /** True when produced by the AI generator, authored manually, or
       *  imported by reference from the shared question bank. */
      source: v.optional(v.union(
        v.literal("manual"),
        v.literal("ai"),
        v.literal("shared"),
      )),
      /** Set on class-pool entries imported from the shared bank. The pool
       *  entry is the only materialized copy per class; re-importing returns
       *  the same row and shared edits are synced into it. */
      sharedQuestionId: v.optional(v.id("sharedQuestions")),
      topic: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_class", ["classId"])
      .index("by_instructor", ["instructorId"])
      .index("by_bloom", ["bloomLevel"])
      .index("by_shared", ["sharedQuestionId"])
      .index("by_category", ["categoryId"]),

    /** An instructor-built assessment assigned to exactly one class. */
    instructorAssessments: defineTable({
      classId: v.id("classes"),
      instructorId: v.id("instructors"),
      title: v.string(),
      description: v.optional(v.string()),
      /** Minutes; 0 = untimed. */
      timeLimitMin: v.number(),
      /** Adaptive model: declared question pool size (≥ 18, ≥3 per Bloom). */
      poolSize: v.optional(v.number()),
      /** Adaptive model: questions actually displayed to each student
       *  (≤ poolSize); the rest of the pool feeds the adaptive selector. */
      displayCount: v.optional(v.number()),
      /** Instructor-chosen display names for the six Bloom levels, keyed by
       *  the canonical level id. Absent keys — and an absent field entirely —
       *  fall back to the taxonomy defaults (Remember, Understand, …). */
      bloomLabels: v.optional(v.record(v.string(), v.string())),
      /** Which assessment panel this belongs to. "static" = a traditional
       *  fixed paper; "adaptive" = the AI/IRT model. Derived from
       *  selectionMode on write; legacy rows without it fall back to the
       *  selectionMode (random → static, otherwise adaptive). */
      assessmentType: v.optional(
        v.union(v.literal("static"), v.literal("adaptive")),
      ),
      /** How each student's questions are chosen. "adaptive" = the IRT Bloom
       *  ladder serves one question at a time; "static" = the attached
       *  questions served in the instructor's order; "random" = a fixed
       *  random draw per Bloom level, drawn once at start from the class
       *  question bank (attaching questions narrows the draw — manual
       *  selection is never required). */
      selectionMode: v.optional(
        v.union(
          v.literal("adaptive"),
          v.literal("static"),
          v.literal("random"),
          /** Class final exam: one fixed question set shared by the whole
           *  roster, served to each student in their own shuffled order. */
          v.literal("final"),
        ),
      ),
      /** Random mode: how many questions to draw at random from each Bloom
       *  level, keyed by the canonical level id. Absent key = 0. The sum is
       *  the number of questions every student answers (mirrored into
       *  displayCount). */
      randomCounts: v.optional(v.record(v.string(), v.number())),
      /** draft | published | closed | archived */
      status: v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("closed"),
        v.literal("archived"),
      ),
      /** When the paper opens to the roster. Published assessments refuse
       *  starts until this moment; absent = open immediately. */
      scheduledFor: v.optional(v.number()),
      publishedAt: v.optional(v.number()),
      /** Set when the instructor archives a completed assessment. Archived
       *  papers keep their submissions and results but leave the active list. */
      archivedAt: v.optional(v.number()),
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
      /** Exam-clock start — stamped when identity verification completes. */
      timerStartedAt: v.optional(v.number()),
      submittedAt: v.optional(v.number()),
      score: v.optional(v.number()),
      maxScore: v.optional(v.number()),
      autoGraded: v.optional(v.boolean()),
      /** Proctoring cursor — students see one question at a time. */
      currentQuestionIndex: v.optional(v.number()),
      /** Adaptive model: the FIXED sequence of presented questions
       *  (questionSequence[i] was answered by answers[i]).answers may be
       *  shorter than the sequence while the current question is pending. */
      questionSequence: v.optional(v.array(v.id("instructorQuestions"))),
      /** Adaptive model: per-Bloom ability profile (θ per level). */
      thetaProfile: v.optional(
        v.object({
          remember: v.number(),
          understand: v.number(),
          apply: v.number(),
          analyze: v.number(),
          evaluate: v.number(),
          create: v.number(),
        }),
      ),
      /** Response time (ms) per presented question, aligned with answers. */
      responseTimesMs: v.optional(v.array(v.number())),
      /** Validity/mismatch factor V ∈ [0,1] per answer (proctoring-derived). */
      validityFactors: v.optional(v.array(v.number())),
      /** Legacy adaptive diagnostic state (post incorrect-fast verification). */
      diagnosticLevel: v.optional(bloomLevel),
      diagnosticFailures: v.optional(v.number()),
      /** Bloom-ladder state: current level + consecutive-correct streak. */
      ladderLevel: v.optional(bloomLevel),
      ladderStreak: v.optional(v.number()),
      /** Create completion rule counters (required Create questions). */
      createAnswered: v.optional(v.number()),
      createCorrect: v.optional(v.number()),
      createRequired: v.optional(v.number()),
      /** Why the run stopped serving questions: quota | create_mastered |
       *  create_exhausted | pool_exhausted. */
      completionReason: v.optional(v.string()),
      /** Final results written at submit (marks-only grading). */
      grade: v.optional(v.string()),
      passed: v.optional(v.boolean()),
      weakestBloomAreas: v.optional(v.array(bloomLevel)),
      /** When the currently served question was delivered (V window start). */
      currentItemShownAt: v.optional(v.number()),
      /** Unified proctoring violation counter (WARNING→PAUSE→TERMINATE). */
      violationCount: v.optional(v.number()),
      /** Compact per-type audit trail written by ingestAssessmentViolations. */
      violationLog: v.optional(
        v.array(
          v.object({
            type: v.string(),
            at: v.number(),
            confidence: v.number(),
            durationMs: v.optional(v.number()),
          }),
        ),
      ),
      /** Highest policy action reached (report-only; silent proctoring). */
      policyAction: v.optional(v.string()),
      /** True when the policy ladder force-submitted this submission. */
      terminatedByPolicy: v.optional(v.boolean()),
      /** Aggregate proctoring risk in [0,1) for instructor review. */
      riskScore: v.optional(v.number()),
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
      /** Editable institution-facing student ID shown on rosters/results. */
      studentIdNumber: v.optional(v.string()),
      /** Facial verification: multi-pose registration + pre-assessment checks. */
      faceRegisteredAt: v.optional(v.number()),
      lastFaceCheckAt: v.optional(v.number()),
      lastFaceCheckStatus: v.optional(
        v.union(v.literal("passed"), v.literal("failed")),
      ),
      enrolledAt: v.number(),
      status: v.union(v.literal("active"), v.literal("inactive")),
    })
      .index("by_institution", ["institutionId"])
      .index("by_center", ["teachingCenterId"])
      .index("by_facility", ["governmentFacilityId"])
      .index("by_instructor", ["instructorId"])
      .index("by_class", ["classId"])
      .index("by_status", ["status"]),
    /** Multi-pose facial registration: one row per captured pose. The
     *  128-d descriptor is stored so verification can compare a live frame
     *  against every registered angle without re-processing the images. */
    faceRegistrations: defineTable({
      studentId: v.id("students"),
      storageId: v.id("_storage"),
      /** Pose key from FACE_POSES (e.g. "center", "slight_left"). */
      pose: v.string(),
      /** 128-d face descriptor computed at capture time. */
      embedding: v.array(v.number()),
      capturedAt: v.number(),
    })
      .index("by_student", ["studentId"]),
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

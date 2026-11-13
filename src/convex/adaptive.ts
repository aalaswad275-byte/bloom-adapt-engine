/**
 * Adaptive assessment pipeline — the research workflow (spec §25/§26):
 *
 *   respond → capture RT → T_t → capture visual interaction → V_i,t →
 *   retrieve theta_{t,c} → b_eff → P_{i,t,c} → observe X → update theta_c →
 *   item information → behavioral classification → diagnostic strategy →
 *   candidates → Bloom/difficulty constraints → utility ranking →
 *   select next item → store adaptive history
 *
 * All math lives in src/lib/irt (single source of truth); this file is the
 * transactional orchestration + persistence layer.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { legacyExamSessionState } from "../lib/sessionState";

import {
  BLOOM_LEVELS,
  DEFAULT_ABILITY_CONFIG,
  calculateEffectiveDifficulty,
  calculateItemInformation,
  calculateProbability,
  calculateTimeStrain,
  calculateVisualMismatch,
  classifyBehavior,
  classifyTimeStrain,
  estimateThetaMap,
  gradeAnswer,
  selectNextQuestion,
  type BloomLevel,
  type CandidateItem,
  type IRTContext,
  type QuestionType,
  type SelectionInput,
  type TimeStrainClass,
} from "../lib/irt";

type QuestionDoc = Doc<"questions">;
type SessionDoc = Doc<"examSessions">;
type ExamDoc = Doc<"exams">;

type LevelMap = Record<BloomLevel, number>;

function zeroLevels(): LevelMap {
  return { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 };
}

function toLevelMap(obj: {
  remember: number; understand: number; apply: number;
  analyze: number; evaluate: number; create: number;
}): LevelMap {
  return {
    remember: obj.remember, understand: obj.understand, apply: obj.apply,
    analyze: obj.analyze, evaluate: obj.evaluate, create: obj.create,
  };
}

async function requireUserId(ctx: { db: unknown; auth: unknown }): Promise<
  Id<"users">
> {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}

function toCandidateItem(q: QuestionDoc): CandidateItem {
  return {
    id: q._id,
    bloomLevel: q.bloomLevel,
    topic: q.topic,
    learningOutcome: q.learningOutcome ?? null,
    a: q.discriminationA,
    b: q.difficultyB,
    expectedTime: q.expectedTime,
    marks: q.marks,
  };
}

/** Public shape of a question during an ACTIVE exam (no answer leakage). */
function publicQuestion(q: QuestionDoc) {
  return {
    _id: q._id,
    questionText: q.questionText,
    questionTextAr: q.questionTextAr ?? null,
    instructionsEn: q.instructionsEn ?? null,
    instructionsAr: q.instructionsAr ?? null,
    questionType: q.questionType,
    topic: q.topic,
    marks: q.marks,
    expectedTime: q.expectedTime,
    options: q.options ?? null,
    optionsAr: q.optionsAr ?? null,
  };
}

/** Full question shape — only for finished sessions / results views. */
function fullQuestion(q: QuestionDoc) {
  return { ...q };
}

interface HistoryRow extends Doc<"adaptiveHistory"> {}

async function loadHistory(ctx: any, sessionId: Id<"examSessions">): Promise<HistoryRow[]> {
  const rows = await ctx.db
    .query("adaptiveHistory")
    .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
    .collect();
  rows.sort((a: HistoryRow, b: HistoryRow) => a.stepNumber - b.stepNumber);
  return rows;
}

/**
 * Choose the next question for a session using the full selector input.
 * Returns the selection result; caller persists state.
 */
async function chooseNext(
  ctx: any,
  session: SessionDoc,
  exam: ExamDoc,
  extraAnsweredIds: Array<Id<"questions">> = [],
): Promise<ReturnType<typeof selectNextQuestion>> {
  const history = await loadHistory(ctx, session._id);
  const answeredIds = new Set<Id<"questions">>([
    ...history.map((h) => h.currentQuestionId),
    ...extraAnsweredIds,
  ]);

  // Bloom distribution counts from the research table (authoritative).
  const counts = zeroLevels();
  for (const h of history) counts[h.currentBloom] += 1;

  const allQuestions = await ctx.db
    .query("questions")
    .withIndex("by_active", (q: any) => q.eq("active", true))
    .collect();

  const candidates = (allQuestions as QuestionDoc[])
    .filter((q) => !answeredIds.has(q._id))
    .map(toCandidateItem);

  // Learning-outcome coverage: uncovered outcomes get selection priority.
  const historyQuestions = new Map<Id<"questions">, QuestionDoc>();
  for (const h of history) {
    if (!historyQuestions.has(h.currentQuestionId)) {
      const q = await ctx.db.get(h.currentQuestionId);
      if (q) historyQuestions.set(h.currentQuestionId, q as QuestionDoc);
    }
  }
  const coveredOutcomes = new Set<string>();
  for (const q of historyQuestions.values()) {
    if (q.learningOutcome) coveredOutcomes.add(q.learningOutcome);
  }
  const outcomePriorities: Record<string, number> = {};
  for (const c of candidates) {
    if (c.learningOutcome && !coveredOutcomes.has(c.learningOutcome)) {
      outcomePriorities[c.learningOutcome] = 1;
    }
  }

  // Last ANSWERED item drives the behavioral tendency for the next pick.
  // Skipped items (correctness -1) carry no response evidence and are
  // ignored for behavior/IRT context — though they still consumed a slot.
  const lastRow =
    [...history].reverse().find((h) => h.correctness >= 0) ?? null;
  const last = lastRow
    ? {
        bloomLevel: lastRow.currentBloom,
        b: lastRow.bCurrent,
        correctness: (lastRow.correctness >= 0.5 ? 1 : 0) as 0 | 1,
        strainClass: classifyTimeStrain(lastRow.TValue) as TimeStrainClass,
      }
    : null;

  const irtContext: IRTContext = {
    gamma: exam.gamma,
    delta: exam.delta,
    T: lastRow ? lastRow.TValue : 0,
    V: lastRow ? lastRow.VValue : 0,
  };

  const input: SelectionInput = {
    studentProfile: toLevelMap(session.thetaProfile),
    candidates,
    examConfig: {
      targetProbability: exam.targetProbability,
      weights: exam.weights,
      distributionPressure: 1.2,
      exposurePenalty: 0.35,
    },
    last,
    irtContext,
    bloom: {
      targets: toLevelMap(exam.bloomDistribution),
      counts,
      totalAnswered: session.stepCount,
      totalPlanned: exam.totalQuestions,
      mandatoryMinimums: toLevelMap(exam.mandatoryMinimums),
    },
    exposureCounts: {},
    answeredIds,
    diagnostic: {
      level: (session.diagnosticLevel ?? null) as BloomLevel | null,
      failures: session.diagnosticFailures,
    },
    outcomePriorities,
    difficultyRange: { min: exam.difficultyRange.min, max: exam.difficultyRange.max },
  };

  return selectNextQuestion(input);
}

// ---------------------------------------------------------------------------
// Start a session: initial six-dimensional profile + first question
// ---------------------------------------------------------------------------

export const startSession = mutation({
  args: { examId: v.id("exams") },
  handler: async (ctx, args): Promise<{ sessionId: Id<"examSessions">; resumed: boolean }> => {
    const userId = await requireUserId(ctx);
    const exam = await ctx.db.get(args.examId);
    if (!exam) throw new Error("Exam not found");

    // Refresh/resume must reopen the SAME active (or policy-paused) session,
    // with all recorded answers intact. Never close a live session merely
    // because the runner page was reloaded.
    const existing = await ctx.db
      .query("examSessions")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const resumable = existing
      .filter(
        (s) =>
          s.examId === args.examId &&
          (s.status === "active" || s.status === "paused"),
      )
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (resumable) return { sessionId: resumable._id, resumed: true };

    const now = Date.now();

    const sessionId = await ctx.db.insert("examSessions", {
      userId,
      examId: args.examId,
      status: "active",
      startedAt: now,
      thetaProfile: zeroLevels(), // theta_0,c = 0 (configurable via ability config)
      standardErrors: {
        remember: DEFAULT_ABILITY_CONFIG.priorSd,
        understand: DEFAULT_ABILITY_CONFIG.priorSd,
        apply: DEFAULT_ABILITY_CONFIG.priorSd,
        analyze: DEFAULT_ABILITY_CONFIG.priorSd,
        evaluate: DEFAULT_ABILITY_CONFIG.priorSd,
        create: DEFAULT_ABILITY_CONFIG.priorSd,
      },
      stepCount: 0,
      diagnosticFailures: 0,
      correctCount: 0,
      totalResponseTimeMs: 0,
      riskScore: 0,
      confirmedViolations: 0,
    });

    const session = (await ctx.db.get(sessionId)) as SessionDoc;
    const selection = await chooseNext(ctx, session, exam);
    if (selection.selected) {
      await ctx.db.patch(sessionId, {
        currentQuestionId: selection.selected.item.id as Id<"questions">,
      });
    } else {
      await ctx.db.patch(sessionId, {
        status: "completed",
        completedAt: now,
        terminationReason: "no_questions_available",
      });
    }

    return { sessionId, resumed: false };
  },
});

// ---------------------------------------------------------------------------
// Respond: the complete adaptive pipeline for one item
// ---------------------------------------------------------------------------

export const respond = mutation({
  args: {
    sessionId: v.id("examSessions"),
    /** The question being answered — makes network retries idempotent. */
    questionId: v.optional(v.id("questions")),
    answer: v.string(),
    responseTimeMs: v.number(),
    interaction: v.object({
      gazeDeviation: v.number(),
      attentionToQuestion: v.number(),
      abnormalInteraction: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");

    // A retry can arrive after the server committed the response and moved on
    // (or completed/terminated the session). Return the stored research row
    // for that exact question instead of grading a different question with it.
    if (args.questionId !== undefined && args.questionId !== session.currentQuestionId) {
      const history = await loadHistory(ctx, session._id);
      const stored = history.find(
        (row) => row.currentQuestionId === args.questionId,
      );
      if (!stored) throw new Error("This answer does not match the current question");
      const answered = (await ctx.db.get(args.questionId)) as QuestionDoc | null;
      if (!answered) throw new Error("The answered question no longer exists");
      const responseRow = (
        await ctx.db
          .query("studentResponses")
          .withIndex("by_session", (q) => q.eq("sessionId", session._id))
          .collect()
      ).find((row) => row.questionId === args.questionId);
      const current = session.currentQuestionId
        ? ((await ctx.db.get(session.currentQuestionId)) as QuestionDoc | null)
        : null;
      return {
        alreadyAnswered: true as const,
        correctness: stored.correctness === 1,
        manual: responseRow?.manual === true,
        correctAnswer: answered.correctAnswer,
        correctAnswerAr: answered.correctAnswerAr ?? null,
        options: answered.options ?? null,
        optionsAr: answered.optionsAr ?? null,
        explanation: answered.explanation,
        predictedProbability: stored.predictedProbability,
        effectiveDifficulty: stored.effectiveDifficulty,
        T: stored.TValue,
        V: stored.VValue,
        thetaBefore: stored.thetaBefore,
        thetaAfter: stored.thetaAfter,
        standardError: stored.standardError,
        itemInformation: stored.itemInformation,
        behavioralSignal: stored.behavioralSignal,
        interpretation: stored.adaptiveAction,
        adaptiveAction: stored.adaptiveAction,
        difficultyChange: stored.difficultyChange,
        bloomTransition: stored.bloomTransition,
        selectionNote: "Answer already saved — continuing your session.",
        bloomProfile: toLevelMap(session.thetaProfile),
        nextQuestion:
          current && session.status === "active" ? publicQuestion(current) : null,
        sessionComplete:
          session.status === "completed" || session.status === "terminated",
        terminated: session.status === "terminated",
      };
    }

    if (session.status !== "active") throw new Error("Session is not active");

    const exam = (await ctx.db.get(session.examId)) as ExamDoc;
    const question = session.currentQuestionId
      ? ((await ctx.db.get(session.currentQuestionId)) as QuestionDoc | null)
      : null;
    if (!question) throw new Error("No question is currently served");
    if (session.stepCount >= exam.totalQuestions) {
      throw new Error("Exam already complete");
    }
    if (args.answer.trim().length === 0) {
      throw new Error("Please enter an answer before submitting.");
    }

    const now = Date.now();
    const stepNumber = session.stepCount; // 0-based index of this step

    // ---- 1. Capture response time → T_t (signed, clipped) ----
    const actualMs = Math.max(0, args.responseTimeMs);
    const T = calculateTimeStrain(actualMs / 1000, question.expectedTime, {
      epsilon: 1e-6,
      clipLow: exam.timeStrainClip.low,
      clipHigh: exam.timeStrainClip.high,
      normalBand: 0.15,
    });
    const strainClass = classifyTimeStrain(T);

    // ---- 2. Capture visual interaction → V_i,t (normalized [0,1]) ----
    const V = calculateVisualMismatch({
      gazeDeviation: clamp01(args.interaction.gazeDeviation),
      attentionToQuestion: clamp01(args.interaction.attentionToQuestion),
      abnormalInteraction: clamp01(args.interaction.abnormalInteraction),
    });

    // ---- 3. Retrieve theta_{t,c} for THIS item's Bloom level ----
    const bloom = question.bloomLevel;
    const thetaBefore = toLevelMap(session.thetaProfile)[bloom];
    const seBefore = toLevelMap(session.standardErrors)[bloom];

    // ---- 4. Grade the answer → observed response X ----
    const { correct: xCorrect, manual } = gradeAnswer(
      question.questionType as QuestionType,
      [question.correctAnswer, question.correctAnswerAr].filter(
        (answer): answer is string => typeof answer === "string" && answer.trim() !== "",
      ),
      args.answer,
    );

    // ---- 5. Effective difficulty + P under the proposed model ----
    const irtContext: IRTContext = {
      gamma: exam.gamma,
      delta: exam.delta,
      T,
      V,
    };
    const bEff = calculateEffectiveDifficulty(question.difficultyB, irtContext);
    const P = calculateProbability(thetaBefore, question.discriminationA, question.difficultyB, irtContext);

    // ---- 6. Update ONLY theta_c via MAP over this level's full history ----
    // Skipped items (correctness -1) carry no evidence and are excluded.
    const history = await loadHistory(ctx, session._id);
    const answeredLevelHistory = history.filter(
      (h) => h.currentBloom === bloom && h.correctness >= 0,
    );
    const levelRecords = [
      ...answeredLevelHistory
        .map((h) => ({
          response: (h.correctness >= 0.5 ? 1 : 0) as 0 | 1,
          a: 0, // filled below from the item lookup
          b: h.bCurrent,
          ctx: { gamma: exam.gamma, delta: exam.delta, T: h.TValue, V: h.VValue } as IRTContext,
        })),
    ];
    // Attach discriminators by joining history to questions.
    for (let i = 0; i < levelRecords.length; i++) {
      const q = await ctx.db.get(answeredLevelHistory[i].currentQuestionId);
      levelRecords[i].a = q ? (q as QuestionDoc).discriminationA : 1;
    }
    levelRecords.push({ response: xCorrect, a: question.discriminationA, b: question.difficultyB, ctx: irtContext });

    const est = estimateThetaMap(
      levelRecords.map((r) => r.response),
      levelRecords.map((r) => ({ a: r.a, b: r.b, ctx: r.ctx })),
      DEFAULT_ABILITY_CONFIG.priorMean,
      DEFAULT_ABILITY_CONFIG.priorSd,
    );
    const thetaAfter = est.theta;

    // ---- 7. Item information ----
    const info = calculateItemInformation(thetaBefore, question.discriminationA, P);

    // ---- 8. Behavioral classification ----
    const behavior = classifyBehavior(xCorrect, strainClass, bloom);

    // ---- 9. Diagnostic state machine ----
    let diagnosticLevel = (session.diagnosticLevel ?? null) as BloomLevel | null;
    let diagnosticFailures = session.diagnosticFailures;
    if (behavior.signal === "INCORRECT_FAST") {
      // Enter (or continue) diagnostic verification at this Bloom level.
      if (diagnosticLevel !== bloom) diagnosticFailures = 0;
      diagnosticLevel = bloom;
    } else if (diagnosticLevel === bloom && xCorrect === 1) {
      // Pending verification answered correctly: isolated careless error.
      diagnosticLevel = null;
      diagnosticFailures = 0;
    } else {
      // No pending verification, or strategy switched (e.g. INCORRECT_SLOW
      // moves to remediation instead of verification).
      diagnosticLevel = null;
      diagnosticFailures = 0;
    }

    // ---- 10. Adaptive action / transition labels for the research log ----
    const lastB = session.lastDifficultyB ?? question.difficultyB;
    const isFirst = session.stepCount === 0;
    const difficultyChange = isFirst
      ? "FIRST"
      : behavior.difficultyDirection;
    const prevBloom = session.lastBloomLevel ?? null;
    const bloomTransition = isFirst
      ? "FIRST"
      : prevBloom && BLOOM_LEVELS.indexOf(bloom) > BLOOM_LEVELS.indexOf(prevBloom)
        ? "HIGHER"
        : prevBloom && BLOOM_LEVELS.indexOf(bloom) < BLOOM_LEVELS.indexOf(prevBloom)
          ? "PREREQUISITE"
          : "SAME";

    // ---- 11. Select next question (constraints + utility ranking) ----
    const provisionalSession: SessionDoc = {
      ...session,
      thetaProfile: {
        ...toLevelMap(session.thetaProfile),
        [bloom]: thetaAfter,
      } as LevelMap & { [k: string]: number } as SessionDoc["thetaProfile"],
      standardErrors: {
        ...toLevelMap(session.standardErrors),
        [bloom]: est.standardError,
      } as SessionDoc["standardErrors"],
      stepCount: session.stepCount + 1,
      lastBloomLevel: bloom,
      lastDifficultyB: question.difficultyB,
      diagnosticLevel: diagnosticLevel ?? undefined,
      diagnosticFailures,
      correctCount: session.correctCount + (xCorrect === 1 ? 1 : 0),
      totalResponseTimeMs: session.totalResponseTimeMs + actualMs,
    };

    let nextQuestionId: Id<"questions"> | undefined;
    let selectionNote = selection_note_no_next();
    let selectionScore: number | undefined;
    let candidatesForLog:
      | Array<{
          questionId: Id<"questions">;
          utility: number;
          probability: number;
          information: number;
          bloomLevel: BloomLevel;
          eligible: boolean;
          reason?: string;
        }>
      | undefined;

    if (session.stepCount + 1 < exam.totalQuestions) {
      // The current response is persisted AFTER selection, so explicitly
      // exclude it from this pick. Otherwise a small Bloom pool can serve the
      // same question twice and a retry can be counted as a second answer.
      const selection = await chooseNext(ctx, provisionalSession, exam, [
        question._id,
      ]);
      selectionNote = selection.note;
      if (selection.selected) {
        nextQuestionId = selection.selected.item.id as Id<"questions">;
        selectionScore = selection.selected.utility;
      }
      candidatesForLog = selection.ranked.slice(0, 10).map((r) => ({
        questionId: r.item.id as Id<"questions">,
        utility: r.utility,
        probability: r.probability,
        information: r.information,
        bloomLevel: r.item.bloomLevel,
        eligible: r.eligible,
        reason: r.ineligibilityReason ?? undefined,
      }));
    }

    // ---- 12. Persist the complete research record ----
    await ctx.db.insert("studentResponses", {
      sessionId: session._id,
      questionId: question._id,
      userId,
      stepNumber,
      submittedAnswer: args.answer,
      isCorrect: xCorrect === 1,
      manual: manual === true,
      marks: question.marks,
      answeredAt: now,
    });

    await ctx.db.insert("timeMeasurements", {
      sessionId: session._id,
      questionId: question._id,
      stepNumber,
      actualResponseTimeMs: actualMs,
      expectedTimeSec: question.expectedTime,
      timeDifferenceMs: actualMs - question.expectedTime * 1000,
      normalizedTimeStrain: T,
    });

    await ctx.db.insert("visualInteractions", {
      sessionId: session._id,
      questionId: question._id,
      stepNumber,
      gazeDeviation: clamp01(args.interaction.gazeDeviation),
      attentionToQuestion: clamp01(args.interaction.attentionToQuestion),
      abnormalInteraction: clamp01(args.interaction.abnormalInteraction),
      visualMismatch: V,
    });

    await ctx.db.insert("adaptiveHistory", {
      sessionId: session._id,
      userId,
      stepNumber,
      currentQuestionId: question._id,
      nextQuestionId: nextQuestionId ?? undefined,
      currentBloom: bloom,
      nextBloom: nextQuestionId
        ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc | null)?.bloomLevel
        : undefined,
      thetaBefore,
      thetaAfter,
      standardError: est.standardError,
      aCurrent: question.discriminationA,
      bCurrent: question.difficultyB,
      aNext: nextQuestionId
        ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc | null)?.discriminationA
        : undefined,
      bNext: nextQuestionId
        ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc | null)?.difficultyB
        : undefined,
      response: args.answer,
      correctness: xCorrect,
      actualResponseTime: actualMs,
      expectedTime: question.expectedTime * 1000,
      TValue: T,
      VValue: V,
      gamma: exam.gamma,
      delta: exam.delta,
      effectiveDifficulty: bEff,
      predictedProbability: P,
      itemInformation: info,
      behavioralSignal: behavior.signal,
      adaptiveAction: behavior.rationale,
      difficultyChange,
      bloomTransition,
      selectionScore: selectionScore ?? undefined,
      candidates: candidatesForLog,
      timestamp: now,
    });

    // ---- 13. Update the session ----
    // Grading is assessment, not proctoring. An answer — correct or incorrect —
    // can never terminate or pause a session, including when a violation was
    // already recorded by the monitoring subsystem. Only monitoring.ingestEvents
    // may apply the configured violation policy; this mutation can only advance
    // the run or complete the planned question count.
    const isComplete = session.stepCount + 1 >= exam.totalQuestions;

    await ctx.db.patch(session._id, {
      thetaProfile: {
        remember: toLevelMap(session.thetaProfile).remember,
        understand: toLevelMap(session.thetaProfile).understand,
        apply: toLevelMap(session.thetaProfile).apply,
        analyze: toLevelMap(session.thetaProfile).analyze,
        evaluate: toLevelMap(session.thetaProfile).evaluate,
        create: toLevelMap(session.thetaProfile).create,
        [bloom]: thetaAfter,
      } as LevelMap as unknown as SessionDoc["thetaProfile"],
      standardErrors: {
        ...toLevelMap(session.standardErrors),
        [bloom]: est.standardError,
      } as LevelMap as unknown as SessionDoc["standardErrors"],
      stepCount: session.stepCount + 1,
      currentQuestionId: nextQuestionId,
      lastBloomLevel: bloom,
      lastDifficultyB: question.difficultyB,
      diagnosticLevel: diagnosticLevel ?? undefined,
      diagnosticFailures,
      correctCount: session.correctCount + (xCorrect === 1 ? 1 : 0),
      totalResponseTimeMs: session.totalResponseTimeMs + actualMs,
      status: isComplete ? "completed" : "active",
      completedAt: isComplete ? now : undefined,
    });

    const nextQuestionDoc = nextQuestionId
      ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc)
      : null;

    return {
      correctness: xCorrect === 1,
      manual,
      correctAnswer: question.correctAnswer,
      correctAnswerAr: question.correctAnswerAr ?? null,
      options: question.options ?? null,
      optionsAr: question.optionsAr ?? null,
      explanation: question.explanation,
      predictedProbability: P,
      effectiveDifficulty: bEff,
      T,
      V,
      thetaBefore,
      thetaAfter,
      standardError: est.standardError,
      itemInformation: info,
      behavioralSignal: behavior.signal,
      interpretation: behavior.interpretation,
      adaptiveAction: behavior.rationale,
      difficultyChange,
      bloomTransition,
      selectionNote,
      bloomProfile: toLevelMap(provisionalSession.thetaProfile),
      nextQuestion: nextQuestionDoc && !isComplete ? publicQuestion(nextQuestionDoc) : null,
      sessionComplete: isComplete,
      terminated: false,
    };
  },
});

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Skip the currently served question.
 *
 * A skip is NOT a response: it carries no evidence, so θ is never updated,
 * no behavioral case is classified, and the item is excluded from ability
 * estimation. The skip is still logged in adaptive history (marked SKIPPED)
 * and the item can never be re-served in this session. The step still counts
 * toward the exam's planned question count.
 */
export const skipQuestion = mutation({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not your session");
    if (session.status !== "active") throw new Error("Session is not active");

    const exam = (await ctx.db.get(session.examId)) as ExamDoc;
    const question = session.currentQuestionId
      ? ((await ctx.db.get(session.currentQuestionId)) as QuestionDoc | null)
      : null;
    if (!question) throw new Error("No question is currently served");
    if (session.stepCount >= exam.totalQuestions) {
      throw new Error("Exam already complete");
    }

    const now = Date.now();
    const stepNumber = session.stepCount;

    // ---- Persist the skip FIRST so chooseNext excludes this item from
    // re-selection (answeredIds is built from adaptive history) ----
    await ctx.db.insert("adaptiveHistory", {
      sessionId: session._id,
      userId,
      stepNumber,
      currentQuestionId: question._id,
      nextQuestionId: undefined,
      currentBloom: question.bloomLevel,
      nextBloom: undefined,
      thetaBefore: toLevelMap(session.thetaProfile)[question.bloomLevel],
      thetaAfter: toLevelMap(session.thetaProfile)[question.bloomLevel],
      standardError: toLevelMap(session.standardErrors)[question.bloomLevel],
      aCurrent: question.discriminationA,
      bCurrent: question.difficultyB,
      aNext: undefined,
      bNext: undefined,
      response: "SKIPPED",
      correctness: -1,
      actualResponseTime: 0,
      expectedTime: question.expectedTime * 1000,
      TValue: 0,
      VValue: 0, // V of a skipped item is not an assessment signal
      gamma: exam.gamma,
      delta: exam.delta,
      effectiveDifficulty: question.difficultyB, // no strain/mismatch applied
      predictedProbability: 0, // no response to predict for
      itemInformation: 0,
      behavioralSignal: "NEUTRAL",
      adaptiveAction:
        "Question skipped by student: no evidence, θ unchanged, item excluded from future selection.",
      difficultyChange: "SKIP",
      bloomTransition: "SKIP",
      selectionScore: undefined,
      timestamp: now,
    });

    // ---- Select next question; the skipped item is now in history and
    // cannot be re-served ----
    const provisionalSession: SessionDoc = {
      ...session,
      stepCount: session.stepCount + 1,
      lastBloomLevel: question.bloomLevel,
      lastDifficultyB: question.difficultyB,
    };

    let nextQuestionId: Id<"questions"> | undefined;
    let selectionNote = "exam complete: no further question needed";
    if (session.stepCount + 1 < exam.totalQuestions) {
      const selection = await chooseNext(ctx, provisionalSession, exam);
      selectionNote = selection.note;
      if (selection.selected) {
        nextQuestionId = selection.selected.item.id as Id<"questions">;
      }
    }

    // ---- Link the skip record to the chosen next question ----
    const skipRows = await ctx.db
      .query("adaptiveHistory")
      .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
      .collect();
    const thisSkip = skipRows.find(
      (r: any) => r.stepNumber === stepNumber && r.correctness < 0,
    );
    if (thisSkip) {
      await ctx.db.patch(thisSkip._id, {
        nextQuestionId: nextQuestionId ?? undefined,
        nextBloom: nextQuestionId
          ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc | null)?.bloomLevel
          : undefined,
        aNext: nextQuestionId
          ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc | null)?.discriminationA
          : undefined,
        bNext: nextQuestionId
          ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc | null)?.difficultyB
          : undefined,
      });
    }

    // ---- Update session: step advances, θ untouched, diagnostic state
    // untouched (a skip is not evidence about mastery) ----
    const isComplete = session.stepCount + 1 >= exam.totalQuestions;
    await ctx.db.patch(session._id, {
      stepCount: session.stepCount + 1,
      currentQuestionId: nextQuestionId,
      lastBloomLevel: question.bloomLevel,
      lastDifficultyB: question.difficultyB,
      status: isComplete ? "completed" : "active",
      completedAt: isComplete ? now : undefined,
    });

    const nextQuestionDoc = nextQuestionId
      ? ((await ctx.db.get(nextQuestionId)) as QuestionDoc)
      : null;

    return {
      skipped: true as const,
      selectionNote,
      nextQuestion:
        nextQuestionDoc && !isComplete ? publicQuestion(nextQuestionDoc) : null,
      sessionComplete: isComplete,
    };
  },
});

function selection_note_no_next(): string {
  return "exam complete: no further question needed";
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Live session state for the exam runner (answer fields stripped). */
export const getSessionState = query({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session || session.userId !== userId) return null;
    const exam = (await ctx.db.get(session.examId)) as ExamDoc;
    const question = session.currentQuestionId
      ? ((await ctx.db.get(session.currentQuestionId)) as QuestionDoc | null)
      : null;

    const warnings = await ctx.db
      .query("warnings")
      .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
      .order("desc")
      .take(5);

    return {
      sessionId: session._id,
      status: session.status,
      sessionState: legacyExamSessionState(session.status),
      terminationReason: session.terminationReason ?? null,
      exam: {
        _id: exam._id,
        title: exam.title,
        totalQuestions: exam.totalQuestions,
        violationThreshold: exam.violationThreshold,
        showDebugPanel: exam.showDebugPanel,
        monitoringEnabled: exam.monitoringEnabled,
        monitoringConfig: exam.monitoringConfig ?? null,
      },
      progress: {
        answered: session.stepCount,
        total: exam.totalQuestions,
        correct: session.correctCount,
      },
      currentQuestion: question && session.status === "active" ? publicQuestion(question) : null,
      warnings: warnings.map((w) => ({
        message: w.message,
        severity: w.severity,
        timestamp: w.timestamp,
      })),
      integrity: {
        riskScore: session.riskScore,
        confirmedViolations: session.confirmedViolations,
      },
      debugEnabled: exam.showDebugPanel,
      thetaProfile: toLevelMap(session.thetaProfile),
      standardErrors: toLevelMap(session.standardErrors),
      diagnosticLevel: (session.diagnosticLevel ?? null) as string | null,
    };
  },
});

/** Complete results for a finished session (research view). */
export const getSessionResults = query({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session || session.userId !== userId) return null;
    const exam = (await ctx.db.get(session.examId)) as ExamDoc;

    const history = await loadHistory(ctx, session._id);
    const enriched = [];
    for (const h of history) {
      const q = (await ctx.db.get(h.currentQuestionId)) as QuestionDoc | null;
      enriched.push({
        stepNumber: h.stepNumber,
        questionId: h.currentQuestionId,
        questionText: q?.questionText ?? "(deleted)",
        questionTextAr: q?.questionTextAr ?? null,
        questionType: q?.questionType ?? null,
        bloomLevel: h.currentBloom,
        nextBloom: h.nextBloom ?? null,
        response: h.response,
        correctness: h.correctness,
        actualResponseTime: h.actualResponseTime,
        expectedTime: h.expectedTime,
        T: h.TValue,
        V: h.VValue,
        gamma: h.gamma,
        delta: h.delta,
        a: h.aCurrent,
        b: h.bCurrent,
        bNext: h.bNext ?? null,
        effectiveDifficulty: h.effectiveDifficulty,
        predictedProbability: h.predictedProbability,
        itemInformation: h.itemInformation,
        behavioralSignal: h.behavioralSignal,
        adaptiveAction: h.adaptiveAction,
        difficultyChange: h.difficultyChange,
        bloomTransition: h.bloomTransition,
        selectionScore: h.selectionScore ?? null,
        candidates: h.candidates ?? null,
        thetaBefore: h.thetaBefore,
        thetaAfter: h.thetaAfter,
        standardError: h.standardError,
        explanation: q?.explanation ?? null,
        correctAnswer: q?.correctAnswer ?? null,
        correctAnswerAr: q?.correctAnswerAr ?? null,
        options: q?.options ?? null,
        optionsAr: q?.optionsAr ?? null,
        marks: q?.marks ?? 0,
      });
    }

    // Bloom mastery from OBSERVED responses only — skipped items
    // (correctness -1) carry no evidence and are excluded from mastery and
    // accuracy, while remaining visible in the research log.
    const mastery = zeroLevels();
    const attempted = zeroLevels();
    const correctByLevel = zeroLevels();
    for (const h of history) {
      if (h.correctness < 0) continue; // skipped
      attempted[h.currentBloom] += 1;
      if (h.correctness >= 0.5) correctByLevel[h.currentBloom] += 1;
    }
    for (const level of BLOOM_LEVELS) {
      mastery[level] = attempted[level] > 0 ? correctByLevel[level] / attempted[level] : 0;
    }

    const events = await ctx.db
      .query("monitoringEvents")
      .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
      .collect();
    const incidents = await ctx.db
      .query("integrityIncidents")
      .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
      .collect();
    const warningRows = await ctx.db
      .query("warnings")
      .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
      .collect();

    return {
      session: {
        _id: session._id,
        status: session.status,
        terminationReason: session.terminationReason ?? null,
        startedAt: session.startedAt,
        completedAt: session.completedAt ?? null,
        stepCount: session.stepCount,
        correctCount: session.correctCount,
        totalResponseTimeMs: session.totalResponseTimeMs,
      },
      exam: {
        _id: exam._id,
        title: exam.title,
        totalQuestions: exam.totalQuestions,
        bloomDistribution: exam.bloomDistribution,
        gamma: exam.gamma,
        delta: exam.delta,
        violationThreshold: exam.violationThreshold,
      },
      finalProfile: {
        theta: toLevelMap(session.thetaProfile),
        standardErrors: toLevelMap(session.standardErrors),
        mastery,
        attempted,
      },
      adaptiveHistory: enriched,
      integrity: {
        riskScore: session.riskScore,
        confirmedViolations: session.confirmedViolations,
        events: events
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((e) => ({
            timestamp: e.timestamp,
            type: e.type,
            confidence: e.confidence,
            severity: e.severity,
            detail: e.detail ?? null,
          })),
        incidents: incidents.map((i) => ({
          type: i.type,
          confirmedAt: i.confirmedAt,
          evidenceCount: i.evidenceCount,
        })),
        warnings: warningRows.map((w) => ({
          timestamp: w.timestamp,
          message: w.message,
          severity: w.severity,
        })),
      },
    };
  },
});

/** Student dashboard: exams + past sessions + latest bloom profile. */
export const getDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const exams = await ctx.db
      .query("exams")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .collect();

    const sessions = await ctx.db
      .query("examSessions")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    sessions.sort((a, b) => b.startedAt - a.startedAt);

    const sessionSummaries = [];
    for (const s of sessions.slice(0, 20)) {
      const exam = (await ctx.db.get(s.examId)) as ExamDoc | null;
      sessionSummaries.push({
        sessionId: s._id,
        examTitle: exam?.title ?? "(deleted exam)",
        status: s.status,
        terminationReason: s.terminationReason ?? null,
        startedAt: s.startedAt,
        completedAt: s.completedAt ?? null,
        answered: s.stepCount,
        total: exam?.totalQuestions ?? 0,
        correct: s.correctCount,
        riskScore: s.riskScore,
        confirmedViolations: s.confirmedViolations,
        thetaProfile: toLevelMap(s.thetaProfile),
      });
    }

    // Latest completed/terminated profile for the dashboard radar.
    const finished = sessions.find((s) => s.status !== "active");
    const latestProfile = finished ? toLevelMap(finished.thetaProfile) : null;

    return {
      exams: exams.map((e) => ({
        _id: e._id,
        title: e.title,
        description: e.description ?? null,
        totalQuestions: e.totalQuestions,
        bloomDistribution: e.bloomDistribution,
        gamma: e.gamma,
        delta: e.delta,
        violationThreshold: e.violationThreshold,
      })),
      sessions: sessionSummaries,
      latestProfile,
    };
  },
});

/** Full adaptive history for research export (session-scoped). */
export const getAdaptiveHistory = query({
  args: { sessionId: v.id("examSessions") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = (await ctx.db.get(args.sessionId)) as SessionDoc | null;
    if (!session || session.userId !== userId) return [];
    return await loadHistory(ctx, args.sessionId);
  },
});

export type RespondResult = Awaited<
  ReturnType<typeof respondHandlerShim>
>;
// Type shim so the frontend can import the respond payload shape.
declare function respondHandlerShim(): Promise<{
  correctness: boolean;
  manual: boolean;
  correctAnswer: string;
  explanation: string;
  predictedProbability: number;
  effectiveDifficulty: number;
  T: number;
  V: number;
  thetaBefore: number;
  thetaAfter: number;
  standardError: number;
  itemInformation: number;
  behavioralSignal: string;
  interpretation: string;
  adaptiveAction: string;
  difficultyChange: string;
  bloomTransition: string;
  selectionNote: string;
  bloomProfile: LevelMap;
  nextQuestion: ReturnType<typeof publicQuestion> | null;
  sessionComplete: boolean;
  terminated: boolean;
}>;

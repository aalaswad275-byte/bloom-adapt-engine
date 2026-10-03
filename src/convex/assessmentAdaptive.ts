/**
 * AI Adaptive Assessment Model integration for instructor class assessments.
 *
 * This module wires the class-assessment flow (instructorAssessments +
 * studentAssessments) into the project's existing adaptive engine in
 * src/lib/irt — it deliberately does NOT implement a competing algorithm;
 * every probability, information, and ability estimate comes from there.
 *
 * Model (src/lib/irt/engine.ts):
 *   P = 1 / (1 + exp(-a(θ − b − γT − δV)))    with γ = 0.50, δ = 0.50
 *   b_eff = b + γT + δV
 *
 * Instructor config:
 *   • Question pool (= attached assessmentQuestions links) must have ≥ 18
 *     questions with ≥ 3 per Bloom level before publish.
 *   • displayCount: how many questions each student actually answers
 *     (≤ pool size; pool is the candidate space, display is the quota).
 *
 * Runtime selection per step, reusing the engine's math:
 *   1. θ is updated per Bloom level via MAP over that level's full history.
 *   2. T (time strain) from the student's response time vs expected time.
 *   3. V (validity/mismatch) from silent proctoring risk on the submission.
 *   4. Score remaining pool candidates; pick the best that does not violate
 *      Bloom coverage — a level whose minimum can no longer be met later
 *      becomes MANDATORY (hard eligibility constraint).
 *   5. Never reuse questions: answered items leave the pool permanently.
 *   6. Stop at displayCount; the fixed sequence is stored on the submission.
 */

import type { Doc, Id } from "./_generated/dataModel";
import {
  BLOOM_LEVELS,
  calculateEffectiveDifficulty,
  calculateItemInformation,
  calculateProbability,
  calculateTimeStrain,
  classifyTimeStrain,
  estimateThetaMap,
  type BloomLevel,
  type IRTContext,
} from "../lib/irt";

type QuestionDoc = Doc<"instructorQuestions">;
type AssessmentDoc = Doc<"instructorAssessments">;
type SubmissionDoc = Doc<"assessmentSubmissions">;

/** Project-configured adaptive factors (product spec: γ = δ = 0.50). */
export const ASSESSMENT_GAMMA = 0.5;
export const ASSESSMENT_DELTA = 0.5;

/** Minimum pool size and per-Bloom minimum pool coverage at publish time. */
export const ASSESSMENT_POOL_MIN = 18;
export const ASSESSMENT_BLOOM_MIN = 3;

/** T and V defaults when no response/proctoring signal exists yet. */
export const NEUTRAL_T = 0;
export const NEUTRAL_V = 0;

const BLOOM_SET = new Set<string>(BLOOM_LEVELS);

/** Default difficulty per Bloom level (escalates with cognitive demand). */
export const DEFAULT_B_BY_LEVEL: Record<BloomLevel, number> = {
  remember: -1.0,
  understand: -0.5,
  apply: 0,
  analyze: 0.5,
  evaluate: 1.0,
  create: 1.5,
};

/** Effective 2PL parameters for an instructor question. */
export function itemParams(q: QuestionDoc): { a: number; b: number } {
  return {
    a: q.discriminationA ?? 1.0,
    b: q.difficultyB ?? DEFAULT_B_BY_LEVEL[q.bloomLevel],
  };
}

function zeroLevels(): Record<BloomLevel, number> {
  return {
    remember: 0,
    understand: 0,
    apply: 0,
    analyze: 0,
    evaluate: 0,
    create: 0,
  };
}

/** Bloom level validator for stored strings (forward compatibility). */
export function asBloomLevel(value: string): BloomLevel | null {
  return BLOOM_SET.has(value) ? (value as BloomLevel) : null;
}

// ---------------------------------------------------------------------------
// Pool composition + publish-time validation
// ---------------------------------------------------------------------------

export interface PoolReport {
  total: number;
  byLevel: Record<BloomLevel, number>;
  errors: string[];
  /** True when the pool satisfies every publish-time requirement. */
  valid: boolean;
}

/** Audit a pool (the set of attached questions) against publish rules. */
export function evaluatePool(questions: QuestionDoc[]): PoolReport {
  const byLevel = zeroLevels();
  for (const q of questions) byLevel[q.bloomLevel] += 1;
  const errors: string[] = [];
  if (questions.length < ASSESSMENT_POOL_MIN) {
    errors.push(
      `Pool must contain at least ${ASSESSMENT_POOL_MIN} questions (currently ${questions.length}).`,
    );
  }
  for (const level of BLOOM_LEVELS) {
    if (byLevel[level] < ASSESSMENT_BLOOM_MIN) {
      errors.push(
        `Pool needs at least ${ASSESSMENT_BLOOM_MIN} "${level}" questions (currently ${byLevel[level]}).`,
      );
    }
  }
  return {
    total: questions.length,
    byLevel,
    errors,
    valid: errors.length === 0,
  };
}

/** True when a new question would still respect the display ceiling. */
export function validateDisplayCount(
  poolSize: number,
  displayCount: number,
): string | null {
  if (!Number.isInteger(displayCount) || displayCount < 1) {
    return "Displayed questions must be a whole number of at least 1.";
  }
  if (displayCount > poolSize) {
    return `Displayed questions (${displayCount}) cannot exceed the question pool (${poolSize}).`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// IRT context assembly
// ---------------------------------------------------------------------------

/**
 * Build the IRT context for a step: γ/δ are the project's configured
 * adaptive factors; T comes from the last response time; V reflects the
 * current silent-proctoring risk (higher risk → higher effective difficulty).
 */
export function irtContextFor(
  assessment: Pick<AssessmentDoc, "poolSize" | "displayCount">,
  submission: Pick<SubmissionDoc, "riskScore">,
  T: number,
): IRTContext {
  return {
    gamma: ASSESSMENT_GAMMA,
    delta: ASSESSMENT_DELTA,
    T,
    V: submission.riskScore ?? NEUTRAL_V,
  };
}

/** T = (RT − E)/(E + ε), signed and clipped — from src/lib/irt/timeStrain. */
export function strainFor(
  responseTimeMs: number,
  expectedTimeSec: number,
): { T: number; strainClass: ReturnType<typeof classifyTimeStrain> } {
  const T = calculateTimeStrain(responseTimeMs / 1000, expectedTimeSec);
  return { T, strainClass: classifyTimeStrain(T) };
}

// ---------------------------------------------------------------------------
// Grading (answers are stored in the sequence; grading follows the sequence)
// ---------------------------------------------------------------------------

/** Same grading rules as the legacy linear flow, applied to one item. */
export function gradeOne(q: QuestionDoc, given: string): boolean {
  const g = given.trim();
  if (q.questionType === "short_answer") {
    return g.toLowerCase() === q.correctAnswer.trim().toLowerCase();
  }
  return g === q.correctAnswer;
}

// ---------------------------------------------------------------------------
// Adaptive selection
// ---------------------------------------------------------------------------

/** One candidate scored for the current step. */
export interface ScoredQuestion {
  q: QuestionDoc;
  utility: number;
  probability: number;
  information: number;
  effectiveDifficulty: number;
  bloomLevel: BloomLevel;
  /** True when Bloom coverage rules forbid picking this item now. */
  blocked: boolean;
  reason: string | null;
}

export interface SelectionOutcome {
  next: QuestionDoc | null;
  ranked: ScoredQuestion[];
}

interface SelectArgs {
  pool: QuestionDoc[];
  answeredIds: Set<Id<"instructorQuestions">>;
  theta: Record<BloomLevel, number>;
  irtContext: IRTContext;
  /** Presented count per Bloom level so far. */
  presentedByLevel: Record<BloomLevel, number>;
  /** How many more items will be delivered after this one (excluding it). */
  remainingAfterThis: number;
  /** Total items this student will answer. */
  displayCount: number;
  /** Diagnostic verification context (post incorrect-fast). */
  diagnostic: { level: BloomLevel | null; failures: number };
  /** Difficulty (b) of the item just answered, if any. */
  lastB: number | null;
  /** Behavioral difficulty direction for the next pick. */
  lastDirection: "UP" | "STABLE_OR_UP" | "DIAGNOSTIC" | "DOWN" | null;
}

const W_INFORMATION = 1.0;
const W_TARGET = 0.8;
const W_BLOOM = 0.6;
const W_DIAGNOSTIC = 0.7;
const W_DIFFICULTY = 0.5;
/** Target success probability (standard CAT targeting, P* = 0.5). */
const TARGET_P = 0.5;

/**
 * Score every remaining candidate with the model's own quantities:
 *   utility = w1·I(θ) − w2·|P − P*| + w3·bloomPriority
 *           + w5·diagnosticValue + w6·difficultyAdherence
 * Bloom coverage is a hard constraint: if a level still needs items that
 * can no longer be delivered later, its questions become mandatory now.
 */
export function selectNextAdaptive(args: SelectArgs): SelectionOutcome {
  const remainingSlots = args.displayCount - sumLevels(args.presentedByLevel);
  const remainingAfter = args.remainingAfterThis;
  const ranked: ScoredQuestion[] = [];

  for (const q of args.pool) {
    if (args.answeredIds.has(q._id)) continue; // never reuse a question
    const { a, b } = itemParams(q);
    const level = q.bloomLevel;
    const theta = args.theta[level] ?? 0;
    const probability = calculateProbability(theta, a, b, args.irtContext);
    const information = calculateItemInformation(theta, a, probability);
    const effectiveDifficulty = calculateEffectiveDifficulty(b, args.irtContext);

    // Bloom coverage feasibility for this level.
    const need =
      remainingSlots > 0
        ? Math.max(0, ASSESSMENT_BLOOM_MIN - args.presentedByLevel[level])
        : 0;
    const canStillMeet =
      need === 0 || remainingAfter >= need;
    const blocked = !canStillMeet && remainingSlots > 0;
    const reason = blocked
      ? `mandatory ${level} coverage pending`
      : null;

    // Bloom priority: how far behind quota this level is, scaled by urgency
    // as the display quota tightens (from the existing selector's approach).
    const targetShare = 1 / BLOOM_LEVELS.length;
    const targetCount = targetShare * args.displayCount;
    const behind = Math.max(0, targetCount - args.presentedByLevel[level]);
    const urgency = remainingSlots > 0 ? 1 / remainingSlots : 0;
    const bloomPriority =
      behind * urgency + (blocked ? 10 : 0);

    // Diagnostic value: verify a failed level with same/prerequisite items.
    let diagnosticValue = 0;
    if (args.diagnostic.level !== null) {
      if (level === args.diagnostic.level) diagnosticValue += 1;
      if (args.diagnostic.failures >= 1) {
        const order = BLOOM_LEVELS.indexOf(level);
        const diagOrder = BLOOM_LEVELS.indexOf(args.diagnostic.level);
        if (order < diagOrder) diagnosticValue += 0.5; // prerequisite probing
      }
      if (a >= 0.9) diagnosticValue += 0.25;
    }

    // Difficulty-direction adherence from the behavioral case.
    let difficultyValue = 0;
    if (args.lastDirection !== null && args.lastB !== null) {
      const deltaB = b - args.lastB;
      switch (args.lastDirection) {
        case "UP":
          difficultyValue = deltaB > 0.05 ? 1 : deltaB > -0.05 ? 0.4 : 0;
          break;
        case "STABLE_OR_UP":
          difficultyValue =
            Math.abs(deltaB) <= 0.15 ? 1 : deltaB > 0.15 ? 0.6 : 0.2;
          break;
        case "DIAGNOSTIC":
          difficultyValue =
            Math.abs(deltaB) <= 0.3 ? 1 : deltaB < -0.3 ? 0.3 : 0.1;
          break;
        case "DOWN":
          difficultyValue = deltaB < -0.05 ? 1 : Math.abs(deltaB) <= 0.1 ? 0.5 : 0;
          break;
      }
    } else {
      // First pick: prefer moderate difficulty near θ₀ = 0.
      difficultyValue = 1 - Math.min(1, Math.abs(b) / 2);
    }

    const utility =
      W_INFORMATION * information -
      W_TARGET * Math.abs(probability - TARGET_P) +
      W_BLOOM * bloomPriority +
      W_DIAGNOSTIC * diagnosticValue +
      W_DIFFICULTY * difficultyValue;

    ranked.push({
      q,
      utility,
      probability,
      information,
      effectiveDifficulty,
      bloomLevel: level,
      blocked,
      reason,
    });
  }

  ranked.sort((x, y) => y.utility - x.utility);
  const next = ranked.find((r) => !r.blocked) ?? null;
  return { next: next?.q ?? null, ranked };
}

function sumLevels(counts: Record<BloomLevel, number>): number {
  return BLOOM_LEVELS.reduce((sum, l) => sum + (counts[l] ?? 0), 0);
}

/**
 * Behavioral classification → selection tendency, mirroring the existing
 * pipeline (respond → classifyBehavior → difficulty direction).
 */
export function difficultyDirectionFor(
  correct: boolean,
  strainClass: ReturnType<typeof classifyTimeStrain>,
): "UP" | "STABLE_OR_UP" | "DIAGNOSTIC" | "DOWN" {
  if (correct) return strainClass === "FAST" ? "UP" : "STABLE_OR_UP";
  return strainClass === "FAST" ? "DIAGNOSTIC" : "DOWN";
}

// ---------------------------------------------------------------------------
// Ability estimation
// ---------------------------------------------------------------------------

export interface AnsweredRecord {
  questionId: Id<"instructorQuestions">;
  correct: boolean;
  responseTimeMs: number;
  validity: number;
}

/**
 * Re-estimate θ for one Bloom level from that level's full answer history
 * (MAP under the model, exactly like src/lib/irt/ability.updateProfile).
 * The other five levels are untouched.
 */
export function updateThetaForLevel(
  level: BloomLevel,
  answered: AnsweredRecord[],
  questions: Map<Id<"instructorQuestions">, QuestionDoc>,
  current: Record<BloomLevel, number>,
): number {
  const records = answered.filter((r) => {
    const q = questions.get(r.questionId);
    return q && q.bloomLevel === level;
  });
  if (records.length === 0) return current[level] ?? 0;
  const items = records.map((r) => {
    const q = questions.get(r.questionId)!;
    const { a, b } = itemParams(q);
    const ctx: IRTContext = {
      gamma: ASSESSMENT_GAMMA,
      delta: ASSESSMENT_DELTA,
      T: strainFor(r.responseTimeMs, q.expectedTimeSec).T,
      V: r.validity,
    };
    return { a, b, ctx };
  });
  const responses = records.map((r) => (r.correct ? 1 : 0) as 0 | 1);
  const est = estimateThetaMap(
    responses,
    items,
    0, // prior mean
    1, // prior sd — DEFAULT_ABILITY_CONFIG
  );
  return est.theta;
}

/**
 * Recompute the whole θ profile from a submission's stored sequence — used
 * on resume and before selection so the estimate is always reproducible
 * from persisted data (never drifted client-side).
 */
export function recomputeProfile(
  sequence: Id<"instructorQuestions">[],
  answers: string[],
  responseTimesMs: number[],
  validityFactors: number[],
  questions: Map<Id<"instructorQuestions">, QuestionDoc>,
): Record<BloomLevel, number> {
  const profile = zeroLevels();
  const answered: AnsweredRecord[] = sequence
    .map((qid, i) => ({
      questionId: qid,
      correct: gradeOne(questions.get(qid)!, answers[i] ?? ""),
      responseTimeMs: responseTimesMs[i] ?? 0,
      validity: validityFactors[i] ?? NEUTRAL_V,
    }))
    .filter((r) => questions.has(r.questionId));
  for (const level of BLOOM_LEVELS) {
    profile[level] = updateThetaForLevel(level, answered, questions, profile);
  }
  return profile;
}

/** Deserialize a stored profile into a fresh Record (schema object). */
export function toStoredProfile(
  profile: Record<BloomLevel, number>,
): SubmissionDoc["thetaProfile"] {
  return {
    remember: profile.remember,
    understand: profile.understand,
    apply: profile.apply,
    analyze: profile.analyze,
    evaluate: profile.evaluate,
    create: profile.create,
  };
}

/** Presented counts per Bloom level for a stored sequence. */
export function presentedCounts(
  sequence: Id<"instructorQuestions">[],
  questions: Map<Id<"instructorQuestions">, QuestionDoc>,
): Record<BloomLevel, number> {
  const counts = zeroLevels();
  for (const qid of sequence) {
    const q = questions.get(qid);
    if (q) counts[q.bloomLevel] += 1;
  }
  return counts;
}

/** Normalize legacy submissions (untimed answers array) to a sequence. */
export function normalizeSequence(
  sub: SubmissionDoc,
  linkIds: Id<"instructorQuestions">[],
): { sequence: Id<"instructorQuestions">[]; adaptive: boolean } {
  if (sub.questionSequence !== undefined && sub.questionSequence.length > 0) {
    return { sequence: sub.questionSequence, adaptive: true };
  }
  return { sequence: linkIds, adaptive: false };
}

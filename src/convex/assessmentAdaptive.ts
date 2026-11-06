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
 *   4. Bloom-ladder progression (src/lib/adaptiveLadder): 3 consecutive
 *      correct answers advance one level (speed counts identically); if the
 *      current level has no unanswered questions, the ladder automatically
 *      advances to the next level — never stuck. Create completes via the
 *      required-Create-questions rule (all correct → Passed – Grade A).
 *   5. Never reuse questions: answered items leave the pool permanently.
 *   6. Marks = correctness × question marks only — speed never penalizes
 *      marks; the final grade maps the earned percentage onto the
 *      configurable grading scale.
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
import {
  createMastered,
  promoteLadderOnExhaustion,
  type LadderPromotionReason,
  type LadderState,
} from "../lib/adaptiveLadder";

type QuestionDoc = Doc<"instructorQuestions">;
type AssessmentDoc = Doc<"instructorAssessments">;
type SubmissionDoc = Doc<"assessmentSubmissions">;

/** Project-configured adaptive factors (product spec: γ = 0.35, δ = 0.25). */
export const ASSESSMENT_GAMMA = 0.35;
export const ASSESSMENT_DELTA = 0.25;

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

// ---------------------------------------------------------------------------
// Random selection mode
// ---------------------------------------------------------------------------

/** Total questions a random-mode assessment draws (sum of per-level counts). */
export function randomTotal(
  counts: Record<string, number> | undefined,
): number {
  return BLOOM_LEVELS.reduce(
    (sum, level) => sum + Math.max(0, Math.floor(counts?.[level] ?? 0)),
    0,
  );
}

/**
 * Random mode: draw `counts[level]` questions at random from every Bloom level
 * and order the result Remember → Create.
 *
 * Each student gets their own draw, but always the same shape — the counts the
 * instructor configured. Questions are never repeated within a draw, and the
 * returned order is the fixed sequence the student answers in (no ladder, no
 * re-selection). Missing candidates are simply skipped, so callers must check
 * `randomPoolErrors` before publishing.
 */
export function drawRandomSequence(
  pool: QuestionDoc[],
  counts: Record<string, number> | undefined,
  rand: () => number = Math.random,
): QuestionDoc[] {
  const out: QuestionDoc[] = [];
  for (const level of BLOOM_LEVELS) {
    const want = Math.max(0, Math.floor(counts?.[level] ?? 0));
    if (want === 0) continue;
    const candidates = pool.filter((q) => q.bloomLevel === level);
    // Fisher–Yates over a copy; the first `want` are the draw.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const swap = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = swap;
    }
    out.push(...candidates.slice(0, want));
  }
  return out;
}

/**
 * Publish-time audit for random mode: the pool must be able to satisfy every
 * per-level draw. Unlike the adaptive model there is no minimum pool size —
 * the only requirement is that the requested questions exist.
 */
export function randomPoolErrors(
  questions: QuestionDoc[],
  counts: Record<string, number> | undefined,
): string[] {
  const byLevel = zeroLevels();
  for (const q of questions) byLevel[q.bloomLevel] += 1;
  const errors: string[] = [];
  if (randomTotal(counts) < 1) {
    errors.push("Random selection needs at least one question to draw.");
  }
  for (const level of BLOOM_LEVELS) {
    const want = Math.max(0, Math.floor(counts?.[level] ?? 0));
    if (want > byLevel[level]) {
      errors.push(
        `Random selection draws ${want} "${level}" questions but the pool has ${byLevel[level]}.`,
      );
    }
  }
  return errors;
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
// Adaptive selection — Bloom-ladder driven
// ---------------------------------------------------------------------------

/** One candidate scored for the current step. */
export interface ScoredQuestion {
  q: QuestionDoc;
  utility: number;
  probability: number;
  information: number;
  effectiveDifficulty: number;
  bloomLevel: BloomLevel;
}

export interface LadderSelectArgs {
  pool: QuestionDoc[];
  /** Already-presented questions (never reused). */
  answeredIds: Set<Id<"instructorQuestions">>;
  /** Current Bloom-ladder state (level + streak + Create counters). */
  ladder: LadderState;
  theta: Record<BloomLevel, number>;
  irtContext: IRTContext;
}

export interface LadderSelectionOutcome {
  next: QuestionDoc | null;
  /** Ladder state after selection (may have advanced on exhaustion). */
  ladder: LadderState;
  promotion: LadderPromotionReason | null;
  ranked: ScoredQuestion[];
}

/** Why the run stopped serving questions (stored on the submission). */
export type LadderCompletionReason =
  | "quota" // display quota filled — normal completion
  | "create_mastered" // required Create questions all correct → Passed – Grade A
  | "create_exhausted" // required Create questions completed without full correctness
  | "pool_exhausted"; // no eligible questions remain on the ladder path

const W_INFORMATION = 1.0;
const W_TARGET = 0.8;
/** Target success probability (standard CAT targeting, P* = 0.5). */
const TARGET_P = 0.5;

/**
 * Serve the next question from the student's CURRENT Bloom level.
 *
 * Progression is governed by the ladder (src/lib/adaptiveLadder): the caller
 * advances it after every answer — 3 consecutive correct answers move the
 * student up one level, fast/normal/slow responses count identically.
 *
 * Exhaustion rule: if no unanswered questions remain at the current level,
 * the ladder automatically advances to the next level — even without the
 * streak — and probing continues upward until questions are found or the
 * pool is exhausted. The run never gets stuck.
 *
 * Within the level, candidates are scored with the model's own quantities.
 * Response time keeps driving selection through T (b_eff = b + γT + δV),
 * exactly as it drives θ, SE, P and item information — it never affects
 * final marks (scoring is correctness × question marks only).
 */
export function selectNextLadder(args: LadderSelectArgs): LadderSelectionOutcome {
  let ladder = args.ladder;
  let promotion: LadderPromotionReason | null = null;

  for (;;) {
    const candidates: QuestionDoc[] = [];
    for (const q of args.pool) {
      if (args.answeredIds.has(q._id)) continue; // never reuse a question
      if (q.bloomLevel !== ladder.level) continue;
      candidates.push(q);
    }
    if (candidates.length > 0) {
      const theta = args.theta[ladder.level] ?? 0;
      const ranked = candidates
        .map((q) => {
          const { a, b } = itemParams(q);
          const probability = calculateProbability(theta, a, b, args.irtContext);
          const information = calculateItemInformation(theta, a, probability);
          const effectiveDifficulty = calculateEffectiveDifficulty(
            b,
            args.irtContext,
          );
          return {
            q,
            utility:
              W_INFORMATION * information -
              W_TARGET * Math.abs(probability - TARGET_P),
            probability,
            information,
            effectiveDifficulty,
            bloomLevel: q.bloomLevel,
          } satisfies ScoredQuestion;
        })
        .sort((x, y) => y.utility - x.utility);
      return { next: ranked[0].q, ladder, promotion, ranked };
    }

    const up = promoteLadderOnExhaustion(ladder);
    if (!up) {
      // Top of the ladder with nothing left to serve — the run completes.
      return { next: null, ladder, promotion, ranked: [] };
    }
    ladder = up.state;
    promotion = up.reason;
  }
}

/**
 * Why the run should stop serving questions after the just-recorded answer.
 * Returns null while another question should be served; the caller treats
 * "null + selection found nothing" as pool_exhausted.
 *
 * Create rule: once the ladder reaches Create, keep serving Create questions
 * until the required Create questions are completed. If they are all correct
 * → create_mastered (Passed – Grade A at submit); if they complete without
 * full correctness → create_exhausted (fair computed grade at submit).
 */
export function ladderCompletionReason(args: {
  answersCount: number;
  displayCount: number;
  ladder: LadderState;
  createRequired: number;
}): LadderCompletionReason | null {
  const { answersCount, displayCount, ladder, createRequired } = args;
  if (ladder.level === "create") {
    if (createMastered(ladder, createRequired)) return "create_mastered";
    if (createRequired > 0 && ladder.createAnswered >= createRequired) {
      return "create_exhausted";
    }
  }
  if (answersCount >= displayCount) return "quota";
  return null;
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
export function zeroLevels(): Record<BloomLevel, number> {
  return {
    remember: 0,
    understand: 0,
    apply: 0,
    analyze: 0,
    evaluate: 0,
    create: 0,
  };
}

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

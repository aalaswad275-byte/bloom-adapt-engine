/**
 * Adaptive question selection.
 *
 * The selector NEVER reduces to "correct → harder, incorrect → easier".
 * For every candidate item it computes P, item information, behavioral-case
 * difficulty direction, Bloom/topic/outcome constraints, exposure control,
 * and a configurable adaptive utility, then ranks and selects the best item.
 */

import type { BloomLevel } from "./bloom";
import { BLOOM_META } from "./bloom";
import {
  calculateEffectiveDifficulty,
  calculateItemInformation,
  calculateProbability,
  type IRTContext,
} from "./engine";
import { classifyBehavior, type BehavioralClassification } from "./behavior";

/** A candidate item as seen by the selector (persistence-agnostic). */
export interface CandidateItem {
  id: string;
  bloomLevel: BloomLevel;
  topic: string;
  learningOutcome: string | null;
  /** Discrimination a. */
  a: number;
  /** Difficulty b. */
  b: number;
  expectedTime: number;
  marks: number;
}

/** Bloom distribution tracker for the running exam. */
export interface BloomDistributionState {
  /** Target proportion per level (sums to ~1). */
  targets: Record<BloomLevel, number>;
  /** How many questions each level has already received. */
  counts: Record<BloomLevel, number>;
  /** Total questions answered so far (before this selection). */
  totalAnswered: number;
  /** Total questions the exam will deliver. */
  totalPlanned: number;
  /** Mandatory minimum coverage per level; selection must never violate. */
  mandatoryMinimums: Partial<Record<BloomLevel, number>>;
}

export interface SelectorWeights {
  /** Item information weight. */
  w1: number;
  /** Target-probability proximity penalty weight. */
  w2: number;
  /** Bloom priority weight. */
  w3: number;
  /** Learning-outcome priority weight. */
  w4: number;
  /** Diagnostic value weight (incorrect-fast verification). */
  w5: number;
  /** Difficulty-direction adherence weight. */
  w6: number;
}

export const DEFAULT_SELECTOR_WEIGHTS: SelectorWeights = {
  w1: 1.0,
  w2: 0.8,
  w3: 0.6,
  w4: 0.25,
  w5: 0.7,
  w6: 0.5,
};

export interface ExamSelectorConfig {
  targetProbability: number;
  weights: SelectorWeights;
  /** Distribution urgency multiplier as remaining slots tighten. */
  distributionPressure: number;
  /** Relative exposure penalty scale (0 disables exposure control). */
  exposurePenalty: number;
}

export const DEFAULT_SELECTOR_CONFIG: ExamSelectorConfig = {
  targetProbability: 0.5,
  weights: DEFAULT_SELECTOR_WEIGHTS,
  distributionPressure: 1.2,
  exposurePenalty: 0.35,
};

export interface SelectionInput {
  studentProfile: Record<BloomLevel, number>;
  candidates: CandidateItem[];
  examConfig: ExamSelectorConfig;
  last: {
    bloomLevel: BloomLevel;
    b: number;
    correctness: 0 | 1;
    strainClass: "FAST" | "NORMAL" | "SLOW";
  } | null;
  irtContext: IRTContext;
  bloom: BloomDistributionState;
  /** Number of times each candidate has been exposed before (indexed by id). */
  exposureCounts: Record<string, number>;
  /** Ids already answered in this session (never re-served). */
  answeredIds: Set<string>;
  /** Pending diagnostic context from prior incorrect-fast answers. */
  diagnostic: {
    /** Bloom level requiring verification. */
    level: BloomLevel | null;
    /** Consecutive diagnostic failures at that level. */
    failures: number;
  };
  /** Learning outcomes with unfinished coverage, mapped to priority weight. */
  outcomePriorities: Record<string, number>;
  /** Difficulty range allowed for the exam. */
  difficultyRange: { min: number; max: number };
}

export interface ScoredCandidate {
  item: CandidateItem;
  utility: number;
  probability: number;
  information: number;
  effectiveDifficulty: number;
  bloomPriority: number;
  outcomePriority: number;
  diagnosticValue: number;
  difficultyAdjustmentValue: number;
  distributionPressure: number;
  eligible: boolean;
  ineligibilityReason: string | null;
}

/**
 * Adaptive utility:
 *   U_i = w1 * I_i(theta)
 *       - w2 * |P_i - P_target|
 *       + w3 * BloomPriority_i
 *       + w4 * LearningOutcomePriority_i
 *       + w5 * DiagnosticValue_i
 *       + w6 * DifficultyAdjustmentValue_i
 * minus exposure and distribution-pressure adjustments.
 */
export function scoreCandidate(
  item: CandidateItem,
  input: SelectionInput,
): ScoredCandidate {
  const { examConfig, irtContext } = input;
  const w = examConfig.weights;
  const theta = input.studentProfile[item.bloomLevel] ?? 0;

  const probability = calculateProbability(theta, item.a, item.b, irtContext);
  const information = calculateItemInformation(theta, item.a, probability);
  const effectiveDifficulty = calculateEffectiveDifficulty(item.b, irtContext);

  // ---- Constraint screening ----
  let eligible = true;
  let reason: string | null = null;
  if (input.answeredIds.has(item.id)) {
    eligible = false;
    reason = "already answered";
  } else if (
    item.b < input.difficultyRange.min ||
    item.b > input.difficultyRange.max
  ) {
    eligible = false;
    reason = "outside difficulty range";
  }

  // ---- Bloom distribution pressure ----
  const targetCount = input.bloom.targets[item.bloomLevel] * input.bloom.totalPlanned;
  const remainingSlots = Math.max(0, input.bloom.totalPlanned - input.bloom.totalAnswered);
  const levelRemainingNeed =
    targetCount - input.bloom.counts[item.bloomLevel];
  const expectedNeed = input.bloom.targets[item.bloomLevel] * remainingSlots;
  // Positive when this level is behind its quota, negative when ahead.
  const distributionPressure =
    (levelRemainingNeed - expectedNeed) * examConfig.distributionPressure;

  // Mandatory minimum coverage: if a level's minimum can no longer be met
  // later, items at that level must be prioritized now.
  const minRequired = input.bloom.mandatoryMinimums[item.bloomLevel] ?? 0;
  const minCount = minRequired * input.bloom.totalPlanned;
  const mustServeNow =
    remainingSlots > 0 && input.bloom.counts[item.bloomLevel] < minCount;
  const minUrgency = mustServeNow
    ? (minCount - input.bloom.counts[item.bloomLevel]) / remainingSlots
    : 0;
  if (mustServeNow && remainingSlots <= minCount - input.bloom.counts[item.bloomLevel]) {
    eligible = false;
    reason = `mandatory minimum for ${item.bloomLevel} not yet met`;
  }

  const bloomPriority =
    distributionPressure + (mustServeNow ? 2 * minUrgency : 0);

  // ---- Learning-outcome priority ----
  const outcomePriority = item.learningOutcome
    ? (input.outcomePriorities[item.learningOutcome] ?? 0)
    : 0;

  // ---- Diagnostic value ----
  let diagnosticValue = 0;
  if (input.diagnostic.level !== null) {
    if (item.bloomLevel === input.diagnostic.level) diagnosticValue += 1;
    if (input.diagnostic.failures >= 1) {
      const order = BLOOM_META[item.bloomLevel].order;
      const diagOrder = BLOOM_META[input.diagnostic.level].order;
      if (order < diagOrder) diagnosticValue += 0.5; // prerequisite probing
    }
    if (item.a >= 0.9) diagnosticValue += 0.25; // strong discrimination
    const moderateDistance = Math.abs(item.b - 0);
    diagnosticValue += Math.max(0, 0.25 - 0.1 * moderateDistance);
  }

  // ---- Difficulty direction adherence ----
  let difficultyAdjustmentValue = 0;
  if (input.last) {
    const cls = classifyBehavior(
      input.last.correctness,
      input.last.strainClass,
      input.last.bloomLevel,
    );
    const deltaB = item.b - input.last.b;
    switch (cls.difficultyDirection) {
      case "UP":
        difficultyAdjustmentValue = deltaB > 0.05 ? 1 : deltaB > -0.05 ? 0.4 : 0;
        break;
      case "STABLE_OR_UP":
        difficultyAdjustmentValue =
          Math.abs(deltaB) <= 0.15 ? 1 : deltaB > 0.15 ? 0.6 : 0.2;
        break;
      case "DIAGNOSTIC":
        difficultyAdjustmentValue =
          Math.abs(deltaB) <= 0.3 ? 1 : deltaB < -0.3 ? 0.3 : 0.1;
        break;
      case "DOWN":
        difficultyAdjustmentValue = deltaB < -0.05 ? 1 : Math.abs(deltaB) <= 0.1 ? 0.5 : 0;
        break;
    }
  } else {
    // First item: mild preference for moderate difficulty near theta 0.
    difficultyAdjustmentValue = 1 - Math.min(1, Math.abs(item.b) / 2);
  }

  const utility =
    w.w1 * information -
    w.w2 * Math.abs(probability - examConfig.targetProbability) +
    w.w3 * bloomPriority +
    w.w4 * outcomePriority +
    w.w5 * diagnosticValue +
    w.w6 * difficultyAdjustmentValue -
    examConfig.exposurePenalty * (input.exposureCounts[item.id] ?? 0);

  return {
    item,
    utility,
    probability,
    information,
    effectiveDifficulty,
    bloomPriority,
    outcomePriority,
    diagnosticValue,
    difficultyAdjustmentValue,
    distributionPressure,
    eligible,
    ineligibilityReason: reason,
  };
}

export interface SelectionResult {
  selected: ScoredCandidate | null;
  ranked: ScoredCandidate[];
  behavior: BehavioralClassification | null;
  fallbackUsed: boolean;
  note: string;
}

/**
 * Rank all candidates, apply constraints, and select the best eligible item.
 * If no candidate passes hard constraints (e.g. tiny bank), the least-bad
 * unranked candidate is served with a research note instead of failing the
 * session.
 */
export function selectNextQuestion(
  input: SelectionInput,
): SelectionResult {
  const ranked = input.candidates
    .map((c) => scoreCandidate(c, input))
    .sort((x, y) => y.utility - x.utility);

  const behavior = input.last
    ? classifyBehavior(input.last.correctness, input.last.strainClass, input.last.bloomLevel)
    : null;

  const best = ranked.find((c) => c.eligible);
  if (best) {
    return {
      selected: best,
      ranked,
      behavior,
      fallbackUsed: false,
      note: "selected best eligible candidate by adaptive utility",
    };
  }

  const anyAnsweredLeft = ranked.find((c) => c.ineligibilityReason !== "already answered");
  if (anyAnsweredLeft) {
    return {
      selected: anyAnsweredLeft,
      ranked,
      behavior,
      fallbackUsed: true,
      note: `no fully eligible candidate; served constraint-relaxed item (${anyAnsweredLeft.ineligibilityReason})`,
    };
  }

  return {
    selected: null,
    ranked,
    behavior,
    fallbackUsed: true,
    note: "no candidates remain: exam complete or bank exhausted",
  };
}

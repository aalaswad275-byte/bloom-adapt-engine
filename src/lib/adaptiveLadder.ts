/**
 * Bloom's-Taxonomy ladder rules for the AI Adaptive Assessment Engine.
 *
 * Progression is correctness-driven ONLY:
 *   • Advance one Bloom level after 3 consecutive correct answers — fast,
 *     normal, or slow responses all count identically toward progression.
 *   • Any incorrect answer resets the streak (but never demotes the level).
 *   • If no eligible questions remain at the current level, the ladder
 *     automatically advances to the next level even without the streak —
 *     the run must never get stuck.
 *   • At Create: keep serving Create questions until the required Create
 *     questions are completed. If they are all correct, the assessment
 *     completes with Passed – Grade A; if they are exhausted without full
 *     correctness, it completes with a fair computed grade.
 *
 * Final marks come ONLY from actual correctness × question marks (Bloom
 * weights are baked into question marks by the instructor) — speed never
 * penalizes marks. Response time still feeds T, θ, SE, P, item information
 * and question selection (see src/lib/irt), just not scoring.
 *
 * Final grade = earned marks ÷ total marks → percentage → grading scale.
 * The weakest Bloom area(s) = lowest earned performance per level; response
 * speed is never used to determine weakness.
 */
import { BLOOM_LEVELS, nextHigherLevel, type BloomLevel } from "./irt/bloom";

/** Consecutive correct answers required to advance to the next Bloom level. */
export const LADDER_PROMOTION_STREAK = 3;

/**
 * Required Create-level questions for the Create completion rule (matches
 * the 3-correct promotion streak so the final level demands the same
 * demonstrated mastery as every earlier step).
 */
export const REQUIRED_CREATE_QUESTIONS = 3;

/** Persisted ladder state for one adaptive submission. */
export type LadderState = {
  /** Current Bloom level being served. */
  level: BloomLevel;
  /** Consecutive correct answers at the current level. */
  consecutiveCorrect: number;
  /** Create-level questions answered so far (Create completion rule). */
  createAnswered: number;
  /** Create-level questions answered correctly so far. */
  createCorrect: number;
};

export type LadderPromotionReason = "consecutive_correct" | "exhausted";

export type LadderStep = {
  state: LadderState;
  /** True when the level advanced during this step. */
  promoted: boolean;
  reason: LadderPromotionReason | null;
};

export function createLadderState(level: BloomLevel = "remember"): LadderState {
  return { level, consecutiveCorrect: 0, createAnswered: 0, createCorrect: 0 };
}

/**
 * Ladder step after one answer at the current level. Correct answers build
 * the streak regardless of response time; any incorrect answer resets it.
 * Promotion fires exactly at 3 consecutive correct answers (the top level,
 * Create, never promotes — it completes via the Create rule instead).
 */
export function advanceLadder(state: LadderState, correct: boolean): LadderStep {
  const next: LadderState = { ...state };

  if (state.level === "create") {
    // Create completion rule: the streak no longer promotes; Create
    // counters decide when the assessment completes.
    next.createAnswered = state.createAnswered + 1;
    if (correct) {
      next.createCorrect = state.createCorrect + 1;
      next.consecutiveCorrect = state.consecutiveCorrect + 1;
    } else {
      next.consecutiveCorrect = 0;
    }
    return { state: next, promoted: false, reason: null };
  }

  if (correct) {
    next.consecutiveCorrect = state.consecutiveCorrect + 1;
    if (next.consecutiveCorrect >= LADDER_PROMOTION_STREAK) {
      const up = nextHigherLevel(next.level);
      if (up) {
        next.level = up;
        next.consecutiveCorrect = 0;
        return { state: next, promoted: true, reason: "consecutive_correct" };
      }
    }
  } else {
    next.consecutiveCorrect = 0;
  }
  return { state: next, promoted: false, reason: null };
}

/**
 * Exhaustion advance: no eligible questions remain at the current level, so
 * move up one level even though the 3-correct streak was not met. Returns
 * null past Create (the caller then completes or probes other levels).
 */
export function promoteLadderOnExhaustion(state: LadderState): LadderStep | null {
  const up = nextHigherLevel(state.level);
  if (!up) return null;
  return {
    state: { ...state, level: up, consecutiveCorrect: 0 },
    promoted: true,
    reason: "exhausted",
  };
}

/** True when the required Create questions are completed (all correct). */
export function createMastered(state: LadderState, createRequired: number): boolean {
  return (
    createRequired > 0 &&
    state.createAnswered >= createRequired &&
    state.createCorrect === state.createAnswered
  );
}

// ---------------------------------------------------------------------------
// Final score & grade (marks come from correctness × question marks only)
// ---------------------------------------------------------------------------

/** One configurable grade band: percent ≥ minPercent earns `letter`. */
export type GradeBand = { minPercent: number; letter: string };

/**
 * Default configurable grading scale. Pass a custom scale to
 * `gradeFromPercent` to override (e.g. per-institution schemes).
 */
export const DEFAULT_GRADING_SCALE: GradeBand[] = [
  { minPercent: 90, letter: "A" },
  { minPercent: 80, letter: "B" },
  { minPercent: 70, letter: "C" },
  { minPercent: 60, letter: "D" },
  { minPercent: 0, letter: "F" },
];

/** Map a percentage onto a (descending) grading scale. */
export function gradeFromPercent(
  percent: number,
  scale: GradeBand[] = DEFAULT_GRADING_SCALE,
): string {
  const p = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : 0;
  const bands = [...scale].sort((x, y) => y.minPercent - x.minPercent);
  for (const band of bands) {
    if (p >= band.minPercent) return band.letter;
  }
  return bands[bands.length - 1]?.letter ?? "F";
}

/** Final percentage from earned vs total marks (clamped to 0–100). */
export function percentFromMarks(earned: number, max: number): number {
  if (!Number.isFinite(earned) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (earned / max) * 100));
}

/** Default pass mark (percentage of total marks). */
export const DEFAULT_PASS_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Weak Bloom level analysis (accuracy/earned performance — never speed)
// ---------------------------------------------------------------------------

/** One stored answer aligned to its question's Bloom level and marks. */
export type BloomAnswerRow = {
  bloomLevel: BloomLevel;
  correct: boolean;
  marks: number;
  earned: number;
};

export type BloomPerformance = {
  level: BloomLevel;
  presented: number;
  correct: number;
  incorrect: number;
  earnedMarks: number;
  maxMarks: number;
  /** 0–100: share of the level's available marks actually earned. */
  earnedPerformance: number;
};

/** Per-Bloom-level performance from the presented sequence. */
export function computeBloomPerformance(
  rows: BloomAnswerRow[],
): BloomPerformance[] {
  return BLOOM_LEVELS.map((level) => {
    const at = rows.filter((r) => r.bloomLevel === level);
    const presented = at.length;
    const correct = at.filter((r) => r.correct).length;
    const maxMarks = at.reduce((sum, r) => sum + r.marks, 0);
    const earnedMarks = at.reduce((sum, r) => sum + r.earned, 0);
    return {
      level,
      presented,
      correct,
      incorrect: presented - correct,
      earnedMarks,
      maxMarks,
      earnedPerformance: maxMarks > 0 ? (earnedMarks / maxMarks) * 100 : 0,
    };
  });
}

/**
 * Weakest Bloom area(s): the lowest earned performance among the levels the
 * student actually answered. Ties return every tied level; untouched levels
 * are excluded (no evidence of weakness). Response speed is never consulted.
 */
export function weakestBloomAreas(perf: BloomPerformance[]): BloomLevel[] {
  const attempted = perf.filter((p) => p.presented > 0);
  if (attempted.length === 0) return [];
  const min = Math.min(...attempted.map((p) => p.earnedPerformance));
  return attempted
    .filter((p) => p.earnedPerformance === min)
    .map((p) => p.level);
}

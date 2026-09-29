/**
 * Visual-mismatch service.
 *
 * V_{i,t} is a normalized contextual interaction variable in [0, 1]
 * representing the mismatch between the item's visual presentation and the
 * student's interaction characteristics (gaze deviation, attention to the
 * question region, abnormal interaction patterns, visual behavior).
 *
 * V is an ASSESSMENT-MODEL variable: it enters P via -delta*V. It is NOT an
 * integrity signal and must never be interpreted as cheating on its own.
 * Academic-integrity monitoring is a separate subsystem (see monitoring.ts).
 */

/** Raw interaction signals captured during one item. */
export interface VisualInteractionSample {
  /** Gaze deviation from screen/question region, 0..1 (higher = more deviant). */
  gazeDeviation: number;
  /** Proportion of item display time with attention on the question region, 0..1. */
  attentionToQuestion: number;
  /** Abnormal interaction-event rate normalized 0..1 (erratic pointer/input). */
  abnormalInteraction: number;
}

export const ZERO_INTERACTION: VisualInteractionSample = {
  gazeDeviation: 0,
  attentionToQuestion: 0.5,
  abnormalInteraction: 0,
};

export interface VisualMismatchWeights {
  gazeDeviation: number;
  inattention: number;
  abnormalInteraction: number;
}

export const DEFAULT_VISUAL_WEIGHTS: VisualMismatchWeights = {
  gazeDeviation: 0.45,
  inattention: 0.35,
  abnormalInteraction: 0.2,
};

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Weighted, normalized visual mismatch in [0, 1]:
 *   V = w_g * gazeDeviation
 *     + w_a * (1 - attentionToQuestion)
 *     + w_i * abnormalInteraction
 *
 * All inputs are expected in [0, 1]; they are clamped defensively.
 */
export function calculateVisualMismatch(
  sample: VisualInteractionSample,
  weights: VisualMismatchWeights = DEFAULT_VISUAL_WEIGHTS,
): number {
  const inattention = 1 - clamp01(sample.attentionToQuestion);
  const v =
    weights.gazeDeviation * clamp01(sample.gazeDeviation) +
    weights.inattention * inattention +
    weights.abnormalInteraction * clamp01(sample.abnormalInteraction);
  return clamp01(v);
}

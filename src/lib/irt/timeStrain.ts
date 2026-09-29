/**
 * Time-strain service.
 *
 * Signed normalized time strain:
 *   T_t = (RT_t - E_t) / (E_t + epsilon)
 *
 * Sign semantics (MUST be preserved — never abs()):
 *   T < 0 → answered faster than expected (cognitive fluency / rapid guessing)
 *   T = 0 → within expected time
 *   T > 0 → needed more time than expected (hesitation, cognitive effort)
 *
 * Extreme values may be clipped to a configurable symmetric range while
 * preserving sign.
 */

export type TimeStrainClass = "FAST" | "NORMAL" | "SLOW";

export interface TimeStrainConfig {
  /** Small constant preventing division by zero. Default 1e-6. */
  epsilon: number;
  /** Symmetric clip range preserving sign. Default [-1, 1]. */
  clipLow: number;
  clipHigh: number;
  /** |T| at or below this is NORMAL. Default 0.15. */
  normalBand: number;
}

export const DEFAULT_TIME_STRAIN_CONFIG: TimeStrainConfig = {
  epsilon: 1e-6,
  clipLow: -1,
  clipHigh: 1,
  normalBand: 0.15,
};

/**
 * T_t = (RT_t - E_t) / (E_t + epsilon), clipped to [clipLow, clipHigh] with
 * the sign always preserved.
 */
export function calculateTimeStrain(
  actualTime: number,
  expectedTime: number,
  config: TimeStrainConfig = DEFAULT_TIME_STRAIN_CONFIG,
): number {
  const raw = (actualTime - expectedTime) / (expectedTime + config.epsilon);
  return Math.min(Math.max(raw, config.clipLow), config.clipHigh);
}

/**
 * Classification of signed strain relative to the NORMAL band:
 *   FAST:   T < -normalBand
 *   NORMAL: |T| <= normalBand
 *   SLOW:   T >  normalBand
 */
export function classifyTimeStrain(
  T: number,
  config: TimeStrainConfig = DEFAULT_TIME_STRAIN_CONFIG,
): TimeStrainClass {
  if (T < -config.normalBand) return "FAST";
  if (T > config.normalBand) return "SLOW";
  return "NORMAL";
}

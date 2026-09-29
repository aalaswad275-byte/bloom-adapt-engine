/**
 * Core IRT engine — Bloom's Taxonomy-Integrated Adaptive IRT model.
 *
 * Probability that student correctly answers item i at step t, Bloom level c:
 *
 *   P_{i,t,c}(theta_{t,c}) =
 *       1 / (1 + exp(-a_{i,t,c} * (theta_{t,c} - b_{i,t,c} - gamma*T_t - delta*V_{i,t})))
 *
 * Effective (contextual) difficulty:
 *
 *   b_eff = b_{i,t,c} + gamma*T_t + delta*V_{i,t}
 *   P     = 1 / (1 + exp(-a * (theta - b_eff)))
 *
 * Sign semantics (preserved, never abs()):
 *   T > 0 (slower than expected) → b_eff rises → P falls   (gamma > 0)
 *   T < 0 (faster than expected) → b_eff falls → P rises   (gamma > 0)
 *   V > 0 (visual mismatch)      → b_eff rises → P falls   (delta > 0)
 *
 * This file is the single mathematical source of truth. The adaptive
 * selector, ability estimator, and reporting all call into it — the model
 * is never re-implemented elsewhere.
 */

/** 2PL discrimination parameter of an item. */
export type Discrimination = number;
/** 2PL difficulty parameter of an item. */
export type Difficulty = number;
/** Signed normalized time strain: (RT - E) / (E + eps). See timeStrain.ts. */
export type TimeStrain = number;
/** Normalized visual mismatch in [0, 1]. See visualMismatch.ts. */
export type VisualMismatch = number;

/** Model context for one adaptive step: strain weights and current context values. */
export interface IRTContext {
  /** Time-strain weight gamma (configurable, default 0.35). */
  gamma: number;
  /** Visual-mismatch weight delta (configurable, default 0.25). */
  delta: number;
  /** Signed normalized time strain T_t. */
  T: TimeStrain;
  /** Normalized visual mismatch V_{i,t}. */
  V: VisualMismatch;
}

export const DEFAULT_IRT_CONTEXT: IRTContext = {
  gamma: 0.35,
  delta: 0.25,
  T: 0,
  V: 0,
};

/** Numerical guard for exp() overflow — the logistic saturates far earlier. */
const EXP_CLIP = 35;

function logistic(z: number): number {
  if (z > EXP_CLIP) return 1 / (1 + Math.exp(-EXP_CLIP));
  if (z < -EXP_CLIP) return 1 / (1 + Math.exp(EXP_CLIP));
  return 1 / (1 + Math.exp(-z));
}

/**
 * Effective contextual difficulty:
 *   b_eff = b + gamma * T + delta * V
 */
export function calculateEffectiveDifficulty(
  b: Difficulty,
  ctx: IRTContext,
): number {
  return b + ctx.gamma * ctx.T + ctx.delta * ctx.V;
}

/**
 * The proposed model equation, exactly:
 *   P = 1 / (1 + exp(-a * (theta - b - gamma*T - delta*V)))
 */
export function calculateProbability(
  theta: number,
  a: Discrimination,
  b: Difficulty,
  ctx: IRTContext,
): number {
  const bEff = calculateEffectiveDifficulty(b, ctx);
  return logistic(a * (theta - bEff));
}

/**
 * Fisher information of the item under the extended model at theta:
 *   I(theta) = a^2 * P * (1 - P)
 * Because P already absorbs gamma*T and delta*V through b_eff, this is the
 * information of the effective item curve at the current ability point.
 */
export function calculateItemInformation(
  theta: number,
  a: Discrimination,
  probability: number,
): number {
  return a * a * probability * (1 - probability);
}

/**
 * Bernoulli log-likelihood of observing `responses` (0/1) at items with
 * probabilities `probabilities`.
 */
export function calculateLogLikelihood(
  responses: number[],
  probabilities: number[],
): number {
  let ll = 0;
  for (let i = 0; i < responses.length; i++) {
    const p = Math.min(Math.max(probabilities[i], 1e-9), 1 - 1e-9);
    ll += responses[i] * Math.log(p) + (1 - responses[i]) * Math.log(1 - p);
  }
  return ll;
}

export interface MapEstimate {
  theta: number;
  standardError: number;
}

/**
 * Maximum A Posteriori (MAP) ability estimation under the proposed model.
 *
 * Maximizes  sum_i [ x_i * log P_i(theta) + (1-x_i) * log(1-P_i(theta)) ]
 *           + log N(theta; priorMean, priorSd)
 * over theta with golden-section search on [-4, 4] (a wide, standard theta
 * range), where each P_i uses that item's own T and V context.
 *
 * MAP is preferred over MLE for short adaptive tests because the Gaussian
 * prior keeps the estimate stable after only a handful of items. The
 * estimator is swappable: MLE/EAP can be added later without touching the
 * selector or the pipeline.
 */
export function estimateThetaMap(
  responses: number[],
  items: { a: Discrimination; b: Difficulty; ctx: IRTContext }[],
  priorMean = 0,
  priorSd = 1,
): MapEstimate {
  if (items.length === 0) return { theta: priorMean, standardError: priorSd };

  const negLogPosterior = (theta: number): number => {
    let ll = 0;
    for (let i = 0; i < items.length; i++) {
      const p = Math.min(
        Math.max(calculateProbability(theta, items[i].a, items[i].b, items[i].ctx), 1e-9),
        1 - 1e-9,
      );
      ll += responses[i] * Math.log(p) + (1 - responses[i]) * Math.log(1 - p);
    }
    const prior = -0.5 * ((theta - priorMean) / priorSd) ** 2;
    return -(ll + prior);
  };

  // Golden-section search for the posterior mode.
  const gr = (Math.sqrt(5) - 1) / 2;
  let lo = -4;
  let hi = 4;
  let c = hi - gr * (hi - lo);
  let d = lo + gr * (hi - lo);
  for (let iter = 0; iter < 60; iter++) {
    if (negLogPosterior(c) < negLogPosterior(d)) {
      hi = d;
      d = c;
      c = hi - gr * (hi - lo);
    } else {
      lo = c;
      c = d;
      d = lo + gr * (hi - lo);
    }
  }
  const theta = (lo + hi) / 2;

  // Observed information via central finite difference → standard error.
  const h = 1e-4;
  const f0 = negLogPosterior(theta);
  const fp = negLogPosterior(theta + h);
  const fm = negLogPosterior(theta - h);
  const second = (fp - 2 * f0 + fm) / (h * h);
  const observedInfo = Math.max(second, 1e-6);
  const standardError = 1 / Math.sqrt(observedInfo);

  return { theta, standardError };
}

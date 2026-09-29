/**
 * Six-dimensional student ability — one theta per Bloom level.
 *
 * The system NEVER maintains a single global theta. The complete profile is:
 *
 *   Theta_t = [theta_remember, theta_understand, theta_apply,
 *              theta_analyze, theta_evaluate, theta_create]
 *
 * When an item with Bloom level c is answered, ONLY theta_c is updated;
 * the other five dimensions remain untouched.
 *
 * Estimation uses MAP under the proposed model (see engine.ts) and is
 * designed to be swappable with MLE / EAP / Bayesian variants.
 */

import { BLOOM_LEVELS, type BloomLevel } from "./bloom";
import {
  calculateLogLikelihood,
  calculateProbability,
  estimateThetaMap,
  type IRTContext,
} from "./engine";

export type AbilityProfile = Record<BloomLevel, AbilityEstimate>;

export interface AbilityEstimate {
  theta: number;
  standardError: number;
  /** Number of items answered at this Bloom level. */
  numItems: number;
  /** Log-likelihood (or posterior log-density) at the mode. */
  logLikelihood: number;
}

/** One answered item as recorded for estimation at its Bloom level. */
export interface LevelResponseRecord {
  /** 1 correct, 0 incorrect. */
  response: 0 | 1;
  a: number;
  b: number;
  ctx: IRTContext;
}

export interface AbilityConfig {
  /** theta_0,c for every level (default 0, configurable). */
  initialTheta: number;
  priorMean: number;
  priorSd: number;
}

export const DEFAULT_ABILITY_CONFIG: AbilityConfig = {
  initialTheta: 0,
  priorMean: 0,
  priorSd: 1,
};

/** Initial profile: theta_0,c = initialTheta for all six levels. */
export function createInitialProfile(
  config: AbilityConfig = DEFAULT_ABILITY_CONFIG,
): AbilityProfile {
  return Object.fromEntries(
    BLOOM_LEVELS.map((level) => [
      level,
      {
        theta: config.initialTheta,
        standardError: config.priorSd,
        numItems: 0,
        logLikelihood: 0,
      } satisfies AbilityEstimate,
    ]),
  ) as AbilityProfile;
}

export interface LevelUpdate {
  thetaBefore: number;
  thetaAfter: number;
  standardError: number;
  numItems: number;
  logLikelihood: number;
}

/**
 * Update ONLY the ability of `level` using ALL responses recorded at that
 * level (this item included), via MAP under the proposed probability model.
 * The other five dimensions are returned unchanged (new object, same values).
 */
export function updateProfile(
  profile: AbilityProfile,
  level: BloomLevel,
  levelResponses: LevelResponseRecord[],
  config: AbilityConfig = DEFAULT_ABILITY_CONFIG,
): { profile: AbilityProfile; update: LevelUpdate } {
  const before = profile[level];
  const { theta, standardError } = estimateThetaMap(
    levelResponses.map((r) => r.response),
    levelResponses.map((r) => ({ a: r.a, b: r.b, ctx: r.ctx })),
    config.priorMean,
    config.priorSd,
  );

  // Posterior log-density at the mode (log-likelihood + Gaussian prior).
  const priorLl =
    -0.5 * ((theta - config.priorMean) / config.priorSd) ** 2 -
    Math.log(config.priorSd * Math.sqrt(2 * Math.PI));
  const ll =
    calculateLogLikelihood(
      levelResponses.map((r) => r.response),
      levelResponses.map((r) =>
        calculateProbability(theta, r.a, r.b, r.ctx),
      ),
    ) + priorLl;

  const next: AbilityProfile = {
    ...profile,
    [level]: {
      theta,
      standardError,
      numItems: levelResponses.length,
      logLikelihood: ll,
    },
  };

  return {
    profile: next,
    update: {
      thetaBefore: before.theta,
      thetaAfter: theta,
      standardError,
      numItems: levelResponses.length,
      logLikelihood: ll,
    },
  };
}

/** Final mastery per level: fraction of level items answered correctly. */
export function bloomMastery(
  responsesByLevel: Record<BloomLevel, { correct: number; total: number }>,
): Record<BloomLevel, number> {
  return Object.fromEntries(
    BLOOM_LEVELS.map((level) => {
      const { correct, total } = responsesByLevel[level] ?? {
        correct: 0,
        total: 0,
      };
      return [level, total === 0 ? 0 : correct / total];
    }),
  ) as Record<BloomLevel, number>;
}

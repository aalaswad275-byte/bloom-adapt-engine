/**
 * Behavioral signal classification — the four adaptive cases.
 *
 *   CASE 1  correct + fast    → high mastery + cognitive fluency
 *   CASE 2  correct + slow    → mastery with time strain / hesitation
 *   CASE 3  incorrect + fast  → careless error / misconception / rapid guess
 *   CASE 4  incorrect + slow  → knowledge gap + strain
 *
 * These are adaptive TENDENCIES that bias candidate selection — never rigid
 * rules that replace IRT information-based selection (see selector.ts).
 * The classification uses the signed strain class, never |T| alone.
 */

import type { BloomLevel } from "./bloom";
import type { TimeStrainClass } from "./timeStrain";

/** The four behavioral cases plus a neutral/unclassified fallback. */
export type BehavioralSignal =
  | "CORRECT_FAST"
  | "CORRECT_SLOW"
  | "INCORRECT_FAST"
  | "INCORRECT_SLOW"
  | "NEUTRAL";

export interface BehavioralClassification {
  signal: BehavioralSignal;
  correctness: 0 | 1;
  strainClass: TimeStrainClass;
  interpretation: string;
  /** Adaptive tendency for the next item's difficulty relative to current. */
  difficultyDirection: "UP" | "STABLE_OR_UP" | "DIAGNOSTIC" | "DOWN";
  /** Suggested Bloom transition family for the next item. */
  bloomSuggestion: "HIGHER" | "SAME" | "PREREQUISITE";
  rationale: string;
}

/**
 * Classify one answered item into the behavioral taxonomy.
 *
 * - NORMAL strain resolves to the strain-neutral branch of the correctness
 *   case (correct+NORMAL behaves like correct-slow: validate mastery;
 *   incorrect+NORMAL behaves like incorrect-slow: targeted remediation).
 */
export function classifyBehavior(
  correctness: 0 | 1,
  strainClass: TimeStrainClass,
  bloomLevel: BloomLevel,
): BehavioralClassification {
  if (correctness === 1) {
    if (strainClass === "FAST") {
      return {
        signal: "CORRECT_FAST",
        correctness,
        strainClass,
        interpretation:
          "High mastery with high cognitive fluency — P rises above baseline via -gamma*T.",
        difficultyDirection: "UP",
        bloomSuggestion: "HIGHER",
        rationale:
          "Correct+fast is strong evidence of mastery and fluency: increase difficulty or move toward a higher Bloom level when distribution and information allow.",
      };
    }
    return {
      signal: "CORRECT_SLOW",
      correctness,
      strainClass,
      interpretation:
        "Mastery with time strain or hesitation — -gamma*T reduces P relative to baseline.",
      difficultyDirection: "STABLE_OR_UP",
      bloomSuggestion: "SAME",
      rationale:
        "Correct+slow: maintain similar difficulty or slightly increase; validate mastery before larger jumps.",
    };
  }

  if (strainClass === "FAST") {
    return {
      signal: "INCORRECT_FAST",
      correctness,
      strainClass,
      interpretation:
        "Possible misconception, careless mistake, rapid guessing, or missing prerequisite knowledge — NOT automatically cheating.",
      difficultyDirection: "DIAGNOSTIC",
      bloomSuggestion: "SAME",
      rationale:
        "Incorrect+fast triggers diagnostic verification: another item at the same (or prerequisite) Bloom level, moderate difficulty, strong discrimination. Repeated failure distinguishes genuine gaps from isolated slips.",
    };
  }

  return {
    signal: "INCORRECT_SLOW",
    correctness,
    strainClass,
    interpretation:
      "Knowledge gap combined with high time strain — strong evidence the student is struggling with this skill.",
    difficultyDirection: "DOWN",
    bloomSuggestion: "PREREQUISITE",
    rationale:
      "Incorrect+slow: prefer b_next < b_current and/or a prerequisite Bloom level to locate the missing foundation.",
  };
}

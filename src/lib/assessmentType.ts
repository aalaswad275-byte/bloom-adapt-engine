/**
 * Display vocabulary for assessment kinds.
 *
 * The class final is presented as "Fair Adaptive": every student answers the
 * same question set, each in their own randomized order, so the exam is fair
 * without being a copy-paste paper. Internally it is still
 * `selectionMode: "final"`, which belongs to the fixed-paper
 * (`assessmentType: "static"`) family of the data model — nothing about
 * delivery, grading or reporting changes with this name.
 */
export const FAIR_ADAPTIVE_LABEL = "Fair Adaptive";

/** One-line description of how a Fair Adaptive paper is delivered. */
export const FAIR_ADAPTIVE_BLURB =
  "Same questions for everyone, randomized order per student.";

/** True when an assessment is delivered as the class final (Fair Adaptive). */
export function isFairAdaptive(
  selectionMode: string | null | undefined,
): boolean {
  return selectionMode === "final";
}

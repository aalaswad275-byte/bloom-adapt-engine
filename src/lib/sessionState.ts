/**
 * Canonical examination session states shared by both exam engines.
 *
 * `not_started` means no session/submission exists yet. A started examination
 * stays `in_progress` until it is legitimately submitted/finished, or until an
 * explicitly configured proctoring rule terminates it. An incorrect answer is
 * never a state transition.
 */
export type ExamSessionState =
  | "not_started"
  | "in_progress"
  | "completed"
  | "terminated";

export function assessmentSessionState(
  submission:
    | { status: "in_progress" | "submitted" | "graded"; terminatedByPolicy?: boolean }
    | null
    | undefined,
): ExamSessionState {
  if (!submission) return "not_started";
  if (submission.terminatedByPolicy) return "terminated";
  return submission.status === "in_progress" ? "in_progress" : "completed";
}

export function legacyExamSessionState(
  status: "active" | "paused" | "completed" | "terminated" | null | undefined,
): ExamSessionState {
  if (!status) return "not_started";
  if (status === "terminated") return "terminated";
  if (status === "completed") return "completed";
  return "in_progress";
}

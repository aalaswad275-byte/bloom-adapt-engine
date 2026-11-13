/**
 * Grading service — evaluates a submitted answer against the item's correct
 * answer, by question type. Produces the observed response X in {0,1}.
 *
 * The adaptive pipeline is agnostic to grading mechanics: it only consumes
 * X. Adding a question type means adding a case here — nothing else changes.
 */

export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "fill_in_blank"
  | "matching"
  | "short_answer"
  | "essay"
  | "programming"
  | "code_output"
  | "case_study"
  | "diagram"
  | "image_based";

export const QUESTION_TYPES: QuestionType[] = [
  "multiple_choice",
  "true_false",
  "fill_in_blank",
  "matching",
  "short_answer",
  "essay",
  "programming",
  "code_output",
  "case_study",
  "diagram",
  "image_based",
];

/** True when the type can be auto-graded deterministically. */
export function isAutoGradable(type: QuestionType): boolean {
  return !(
    type === "essay" ||
    type === "programming" ||
    type === "case_study" ||
    type === "diagram"
  );
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Normalize an authored or submitted answer for comparison without changing
 * what is stored. Whitespace is collapsed, text is case-insensitive, and
 * numerically equivalent forms (5, 5.0, +5) compare equal.
 */
export function canonicalAnswer(value: unknown): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (NUMBER_RE.test(text)) return `#${Number(text)}`;
  return text.toLowerCase();
}

function norm(s: string): string {
  return canonicalAnswer(s);
}

/**
 * Grade a submitted answer.
 * - multiple_choice / true_false / code_output / image_based: exact match.
 * - fill_in_blank / short_answer: normalized string match against any
 *   accepted variant (correct_answer may be a string or string[]).
 * - matching: answer is a JSON object of {leftId: rightId}.
 * - essay / programming / case_study / diagram: not auto-gradable —
 *   returns 1 (complete) with `manual: true`; v1 admin can override.
 */
export function gradeAnswer(
  type: QuestionType,
  correctAnswer: unknown,
  submitted: unknown,
): { correct: 0 | 1; manual: boolean } {
  if (submitted === null || submitted === undefined || submitted === "") {
    return { correct: 0, manual: false };
  }

  switch (type) {
    case "multiple_choice":
    case "true_false":
    case "code_output":
    case "image_based": {
      return {
        correct: norm(String(submitted)) === norm(String(correctAnswer)) ? 1 : 0,
        manual: false,
      };
    }
    case "fill_in_blank":
    case "short_answer": {
      const accepted = Array.isArray(correctAnswer)
        ? correctAnswer.map(String)
        : [String(correctAnswer)];
      return {
        correct: accepted.some((c) => norm(c) === norm(String(submitted))) ? 1 : 0,
        manual: false,
      };
    }
    case "matching": {
      try {
        const truth = typeof correctAnswer === "string"
          ? (JSON.parse(correctAnswer) as Record<string, string>)
          : (correctAnswer as Record<string, string>);
        const got = typeof submitted === "string"
          ? (JSON.parse(submitted) as Record<string, string>)
          : (submitted as Record<string, string>);
        const keys = Object.keys(truth);
        if (keys.length === 0) return { correct: 0, manual: false };
        const all = keys.every((k) => got[k] === truth[k]);
        return { correct: all ? 1 : 0, manual: false };
      } catch {
        return { correct: 0, manual: false };
      }
    }
    case "essay":
    case "programming":
    case "case_study":
    case "diagram": {
      return { correct: 1, manual: true };
    }
    default:
      return { correct: 0, manual: false };
  }
}

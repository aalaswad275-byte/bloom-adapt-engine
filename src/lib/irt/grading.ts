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
 * Normalize Arabic and Latin answer text without altering the stored answer.
 *
 * Arabic answers arrive with optional diacritics, tatweel, different alef
 * forms, Arabic-Indic digits, Arabic punctuation, and invisible bidi marks.
 * Two students who wrote the same answer must be graded identically, so all
 * of those presentation differences are folded away here while the original
 * response is preserved for the result page and manual review.
 */
export function normalizeAnswerText(value: unknown): string {
  let text = String(value ?? "")
    .normalize("NFKC")
    // Arabic-Indic and extended Arabic-Indic digits → ASCII digits.
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // Tashkeel, quranic marks, superscript alef, and tatweel.
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, "")
    // Invisible directional controls.
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    // Alef variants and alef maqsura.
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    // Arabic punctuation, then common Latin surrounding punctuation.
    .replace(/[\u060c\u061b\u061f]/g, " ")
    .replace(/[.,;:!?"'“”‘’()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (NUMBER_RE.test(text)) return `#${Number(text)}`;
  // Taa marbuta and haa are commonly interchanged at word endings.
  text = text.replace(/\u0629/g, "\u0647");
  return text;
}

/**
 * Normalize an authored or submitted answer for comparison without changing
 * what is stored. Whitespace is collapsed, text is case-insensitive, and
 * numerically equivalent forms (5, 5.0, +5) compare equal.
 */
export function canonicalAnswer(value: unknown): string {
  return normalizeAnswerText(value);
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

  // Every deterministic type accepts one or more canonical answers. Callers
  // pass both the English and Arabic authored answers when available; the
  // submitted response itself is never language-restricted.
  const accepted = Array.isArray(correctAnswer)
    ? correctAnswer.map(String)
    : [String(correctAnswer)];
  const submittedCanonical = norm(String(submitted));

  switch (type) {
    case "multiple_choice":
    case "true_false":
    case "code_output":
    case "image_based": {
      return {
        correct: accepted.some((c) => norm(c) === submittedCanonical) ? 1 : 0,
        manual: false,
      };
    }
    case "fill_in_blank":
    case "short_answer": {
      return {
        correct: accepted.some((c) => norm(c) === submittedCanonical) ? 1 : 0,
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

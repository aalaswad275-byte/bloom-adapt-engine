import type { Language } from "@/lib/i18n";

/** Minimal shape shared by the legacy and class-assessment question payloads. */
export type BilingualQuestion = {
  questionText: string;
  questionTextAr?: string | null;
  instructionsEn?: string | null;
  instructionsAr?: string | null;
  options?: string[] | null;
  optionsAr?: string[] | null;
  questionType?: string | null;
  dragDropTargets?: Array<{ id: string; label: string; hint?: string }> | null;
  dragDropTargetsAr?: Array<{ id: string; label: string; hint?: string }> | null;
};

export type LocalizedOption = {
  /** Canonical English value sent to the server and used for grading. */
  value: string;
  /** Label shown in the current interface language. */
  label: string;
};

export function localizedQuestionText(
  question: BilingualQuestion | null | undefined,
  language: Language,
): string {
  if (!question) return "";
  if (language === "ar") {
    const ar = question.questionTextAr?.trim();
    if (ar) return ar;
  }
  return question.questionText;
}

export function localizedInstructions(
  question: BilingualQuestion | null | undefined,
  language: Language,
): string | null {
  if (!question) return null;
  if (language === "ar") {
    return (
      question.instructionsAr?.trim() ||
      question.instructionsEn?.trim() ||
      null
    );
  }
  return question.instructionsEn?.trim() || question.instructionsAr?.trim() || null;
}

export function localizedOptions(
  question: BilingualQuestion | null | undefined,
  language: Language,
): LocalizedOption[] {
  const values = question?.options ?? [];
  const arabic = question?.optionsAr ?? [];
  return values.map((value, index) => {
    if (language !== "ar") return { value, label: value };
    const direct = arabic[index]?.trim();
    if (direct) return { value, label: direct };
    if (value === "True") return { value, label: "صح" };
    if (value === "False") return { value, label: "خطأ" };
    return { value, label: value };
  });
}

export function optionLabel(
  question: BilingualQuestion | null | undefined,
  value: string,
  language: Language,
): string {
  if (language !== "ar") return value;
  const values = question?.options ?? [];
  const index = values.indexOf(value);
  const label = index >= 0 ? question?.optionsAr?.[index]?.trim() : undefined;
  if (label) return label;
  if (value === "True") return "صح";
  if (value === "False") return "خطأ";
  return value;
}

/** Arabic correct answer when authored; otherwise the canonical answer with
 *  its Arabic option label when one exists. */
export function localizedCorrectAnswer(
  question: BilingualQuestion | null | undefined,
  correctAnswer: string | null | undefined,
  correctAnswerAr: string | null | undefined,
  language: Language,
): string {
  if (!correctAnswer) return "";
  if (language === "ar" && correctAnswerAr?.trim()) return correctAnswerAr;
  return optionLabel(question, correctAnswer, language);
}

/** Merge an Arabic target translation by stable target id. */
export function localizedTargets(
  question: BilingualQuestion | null | undefined,
  language: Language,
): Array<{ id: string; label: string; hint?: string }> {
  const canonical = question?.dragDropTargets ?? [];
  if (language !== "ar") return canonical;
  const ar = new Map(
    (question?.dragDropTargetsAr ?? []).map((t) => [t.id, t] as const),
  );
  return canonical.map((target) => {
    const translation = ar.get(target.id);
    return translation
      ? {
          id: target.id,
          label: translation.label || target.label,
          hint: translation.hint ?? target.hint,
        }
      : target;
  });
}

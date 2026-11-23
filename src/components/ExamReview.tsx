import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudOff,
  Loader2,
  Lock,
  Save,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  effectiveAnswer,
  QuestionResponse,
  type ResponseQuestion,
} from "@/components/QuestionResponse";
import { useI18n } from "@/lib/i18n";
import { localizedInstructions, localizedQuestionText } from "@/lib/localizedQuestion";
import { cn } from "@/lib/utils";

export type ReviewQuestion = ResponseQuestion & {
  questionTextAr: string | null;
  instructionsEn: string | null;
  instructionsAr: string | null;
  marks: number;
  bloomLevel: string;
};

export type ReviewItem = {
  index: number;
  question: ReviewQuestion;
  answer: string;
  answered: boolean;
};

type SaveState = "saving" | "saved" | "error" | undefined;

type Props = {
  items: ReviewItem[];
  bloomLabels: Record<string, string>;
  submitting: boolean;
  onSave: (questionId: string, answer: string) => Promise<void>;
  onSubmit: () => Promise<void>;
};

const EMPTY = "";

/**
 * Final review of exactly the questions already presented in this run.
 * Students can revisit, edit, complete skipped answers, and then confirm the
 * final submission. Correctness is never requested, computed, or shown.
 */
export function ExamReview({
  items,
  bloomLabels,
  submitting,
  onSave,
  onSubmit,
}: Props) {
  const { language, t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.question.id, item.answer])),
  );
  const valuesRef = useRef(values);
  const dirtyRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Record<string, number>>({});
  const [status, setStatus] = useState<Record<string, SaveState>>({});
  const [active, setActive] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.question.id, item] as const)),
    [items],
  );

  // Keep local drafts in sync with the server record, but never overwrite a
  // response the student is still editing or has not saved yet.
  useEffect(() => {
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of items) {
        const id = item.question.id;
        if (!(id in next)) {
          next[id] = item.answer;
          changed = true;
        } else if (!dirtyRef.current.has(id) && next[id] !== item.answer) {
          next[id] = item.answer;
          changed = true;
        }
      }
      if (changed) valuesRef.current = next;
      return changed ? next : prev;
    });
  }, [items]);

  const saveAnswer = useCallback(
    async (id: string): Promise<boolean> => {
      const item = itemById.get(id);
      if (!item) return true;
      const value = valuesRef.current[id] ?? EMPTY;
      const submitted = effectiveAnswer(item.question, value);
      if (submitted === item.answer) {
        dirtyRef.current.delete(id);
        return true;
      }
      setStatus((prev) => ({ ...prev, [id]: "saving" }));
      try {
        await onSave(id, submitted);
        dirtyRef.current.delete(id);
        setStatus((prev) => ({ ...prev, [id]: "saved" }));
        return true;
      } catch (err) {
        setStatus((prev) => ({ ...prev, [id]: "error" }));
        toast.error(
          err instanceof Error
            ? err.message
            : language === "ar"
              ? "تعذر حفظ الإجابة — تحقق من اتصالك."
              : "Could not save this answer — check your connection.",
        );
        return false;
      }
    },
    [itemById, language, onSave],
  );

  /** Persist every unsaved response; returns false when any save fails. */
  const flush = useCallback(async (): Promise<boolean> => {
    let ok = true;
    for (const id of [...dirtyRef.current]) {
      window.clearTimeout(timersRef.current[id]);
      if (!(await saveAnswer(id))) ok = false;
    }
    return ok;
  }, [saveAnswer]);

  const activeItem = items[active];
  const activeId = activeItem?.question.id;

  const handleChange = (value: string) => {
    if (!activeId) return;
    valuesRef.current = { ...valuesRef.current, [activeId]: value };
    setValues(valuesRef.current);
    dirtyRef.current.add(activeId);
    setStatus((prev) => ({ ...prev, [activeId]: undefined }));
    window.clearTimeout(timersRef.current[activeId]);
    if (activeItem.question.questionType === "short_answer") {
      // Typing is debounced; every other control saves on the spot.
      timersRef.current[activeId] = window.setTimeout(() => {
        void saveAnswer(activeId);
      }, 700);
    } else {
      void saveAnswer(activeId);
    }
  };

  const goTo = (index: number) => {
    if (index < 0 || index >= items.length || index === active) return;
    void flush();
    setActive(index);
  };

  const answeredCount = items.filter(
    (item) => (values[item.question.id] ?? EMPTY).trim().length > 0,
  ).length;
  const unansweredCount = items.length - answeredCount;

  const requestSubmit = async () => {
    if (submitting) return;
    if (await flush()) setConfirmOpen(true);
  };

  const confirmSubmit = async () => {
    if (!(await flush())) return;
    await onSubmit();
  };

  if (!activeItem) return null;

  const activeStatus = activeId ? status[activeId] : undefined;

  return (
    <div className="clay p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="rounded-full bg-[oklch(0.9_0.05_320)] text-[10px] font-bold uppercase tracking-wide text-[oklch(0.4_0.09_320)]">
            {t("Final review")}
          </Badge>
          <h2 className="mt-2 text-xl font-bold">{t("Review your answers")}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {language === "ar"
              ? "راجع كل سؤال عُرض عليك، وعدّل إجاباتك أو أكمل الأسئلة التي تخطيتها. لن يظهر هنا أي تقييم لصحة الإجابات."
              : "Check every question presented in this exam, change an answer, or complete a skipped one. No correctness assessment is shown."}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            className="clay-press rounded-full"
            disabled={submitting}
            onClick={() => void requestSubmit()}
          >
            {submitting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Lock className="mr-2 size-4" />
            )}
            {t("Submit Final Exam")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {language === "ar"
              ? `${answeredCount} مجاب · ${unansweredCount} بدون إجابة`
              : `${answeredCount} answered · ${unansweredCount} unanswered`}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[200px_1fr]">
        {/* Question navigator */}
        <div className="clay-inset h-fit rounded-2xl p-3">
          <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("Questions")}
          </p>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {items.map((item, index) => {
              const answered = (values[item.question.id] ?? EMPTY).trim() !== "";
              const current = index === active;
              return (
                <button
                  key={item.question.id}
                  type="button"
                  aria-current={current ? "step" : undefined}
                  aria-label={`${language === "ar" ? "السؤال" : "Question"} ${index + 1}: ${
                    answered ? t("Answered") : t("Unanswered")
                  }`}
                  title={`${language === "ar" ? "السؤال" : "Question"} ${index + 1} — ${
                    answered ? t("Answered") : t("Unanswered")
                  }`}
                  onClick={() => goTo(index)}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-lg border text-xs font-bold tabular-nums transition-colors",
                    current && "ring-2 ring-[var(--primary)] ring-offset-1",
                    answered
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-foreground"
                      : "border-dashed border-[var(--border)] text-muted-foreground hover:bg-[var(--accent)]/50",
                  )}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid gap-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[var(--primary)]/60" />
              {t("Answered")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
              {t("Unanswered")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full ring-2 ring-[var(--primary)]" />
              {t("Current question")}
            </span>
          </div>
        </div>

        {/* Active question */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge className="clay-inset rounded-full text-xs text-foreground">
              {language === "ar"
                ? `السؤال ${active + 1} من ${items.length}`
                : `Question ${active + 1} of ${items.length}`}
            </Badge>
            <div className="flex items-center gap-2">
              <Badge className="rounded-full bg-[oklch(0.9_0.05_320)] text-[10px] text-[oklch(0.4_0.09_320)]">
                {bloomLabels[activeItem.question.bloomLevel] ??
                  activeItem.question.bloomLevel}
              </Badge>
              <span className="text-xs font-bold text-muted-foreground">
                {activeItem.question.marks}{" "}
                {activeItem.question.marks === 1 ? t("mark") : t("marks")}
              </span>
            </div>
          </div>

          <Badge
            className={cn(
              "mt-3 rounded-full text-[10px]",
              (values[activeItem.question.id] ?? EMPTY).trim() !== ""
                ? "bg-[var(--primary)]/10 text-foreground"
                : "clay-inset text-muted-foreground",
            )}
          >
            {(values[activeItem.question.id] ?? EMPTY).trim() !== ""
              ? t("Answered")
              : t("Unanswered")}
          </Badge>

          <h3 className="mt-3 whitespace-pre-line text-lg font-bold leading-relaxed">
            {localizedQuestionText(activeItem.question, language)}
          </h3>
          {localizedInstructions(activeItem.question, language) && (
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
              {localizedInstructions(activeItem.question, language)}
            </p>
          )}

          <QuestionResponse
            key={activeItem.question.id}
            question={activeItem.question}
            language={language}
            answer={values[activeItem.question.id] ?? EMPTY}
            onChange={handleChange}
          />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {activeStatus === "saving" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("Saving…")}
                </>
              ) : activeStatus === "saved" ? (
                <>
                  <Check className="size-3.5 text-[var(--primary)]" />
                  {t("Answer saved")}
                </>
              ) : activeStatus === "error" ? (
                <>
                  <CloudOff className="size-3.5 text-destructive" />
                  {t("Could not save")}
                </>
              ) : (
                t("Changes are saved automatically")
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => void saveAnswer(activeItem.question.id)}
                disabled={activeStatus === "saving"}
              >
                <Save className="mr-1.5 size-3.5" />
                {t("Save response")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-9 rounded-full"
                aria-label={t("Previous question")}
                disabled={active === 0}
                onClick={() => goTo(active - 1)}
              >
                <ArrowLeft className="size-4 rtl:rotate-180" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-9 rounded-full"
                aria-label={t("Next question")}
                disabled={active === items.length - 1}
                onClick={() => goTo(active + 1)}
              >
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {language === "ar"
            ? "لن تُقبل أي تعديلات بعد الإرسال النهائي."
            : "No changes are accepted after final submission."}
        </p>
        <Button
          className="clay-press rounded-full"
          disabled={submitting}
          onClick={() => void requestSubmit()}
        >
          <Send className="mr-2 size-4" />
          {t("Submit Final Exam")}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="clay">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Submit final exam?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {language === "ar"
                ? `المجاب: ${answeredCount} · بدون إجابة: ${unansweredCount}. بعد الإرسال تُقفل جميع الإجابات ولا يمكن تعديلها، ويحسب النظام النتيجة.`
                : `Answered: ${answeredCount} · Unanswered: ${unansweredCount}. After submission all answers are locked, cannot be changed, and the result is calculated.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-2 text-center text-sm">
            <div className="clay-inset rounded-xl p-3">
              <p className="text-xl font-extrabold tabular-nums">
                {answeredCount}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("Answered questions")}
              </p>
            </div>
            <div className="clay-inset rounded-xl p-3">
              <p className="text-xl font-extrabold tabular-nums">
                {unansweredCount}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("Unanswered questions")}
              </p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">
              {t("Return to review")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void confirmSubmit();
              }}
            >
              {submitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Lock className="mr-2 size-4" />
              )}
              {t("Submit final exam")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

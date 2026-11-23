import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import type { Language } from "@/lib/i18n";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import {
  isDragDropComplete,
  parseDragDropAnswer,
  serializeDragDropAnswer,
} from "@/lib/dragDrop";
import {
  isOrderingComplete,
  parseOrderingAnswer,
  serializeOrderingAnswer,
} from "@/lib/ordering";
import {
  localizedOptions,
  localizedTargets,
  optionLabel,
} from "@/lib/localizedQuestion";
import { cn } from "@/lib/utils";

export type ResponseQuestion = {
  id: string;
  questionText: string;
  questionType:
    | "multiple_choice"
    | "true_false"
    | "short_answer"
    | "drag_drop"
    | "ordering";
  options: string[] | null;
  optionsAr: string[] | null;
  dragDropTargets: Array<{ id: string; label: string; hint?: string }> | null;
  dragDropTargetsAr: Array<{
    id: string;
    label: string;
    hint?: string;
  }> | null;
  partialCredit: boolean | null;
};

/**
 * The answer that will actually be submitted. Ordering questions always hold
 * a complete sequence (their delivered shuffled start), so an untouched
 * ordering response is a valid answer rather than an empty one.
 */
export function effectiveAnswer(
  question: ResponseQuestion,
  answer: string,
): string {
  if (question.questionType !== "ordering") return answer;
  const parsed = parseOrderingAnswer(answer);
  return serializeOrderingAnswer(
    parsed.length > 0 ? parsed : (question.options ?? []),
  );
}

/** Whether the response is complete enough to save/submit this question. */
export function isResponseComplete(
  question: ResponseQuestion,
  answer: string,
): boolean {
  const value = effectiveAnswer(question, answer);
  if (question.questionType === "drag_drop")
    return isDragDropComplete(question.options ?? [], value);
  if (question.questionType === "ordering")
    return isOrderingComplete(question.options ?? [], value);
  return value.trim().length > 0;
}

type Props = {
  question: ResponseQuestion;
  language: Language;
  answer: string;
  onChange: (answer: string) => void;
  disabled?: boolean;
};

/**
 * Input controls for every supported question type. It only reports the
 * student's response upward — it never receives or displays correctness.
 */
export function QuestionResponse({
  question,
  language,
  answer,
  onChange,
  disabled = false,
}: Props) {
  const [pickedItem, setPickedItem] = useState<string | null>(null);

  // A question swap must not carry a click-to-place selection across.
  useEffect(() => {
    setPickedItem(null);
  }, [question.id]);

  const choiceOptions = localizedOptions(question, language);

  if (question.questionType === "multiple_choice") {
    return (
      <RadioGroup
        className="mt-5 grid gap-2"
        value={answer}
        onValueChange={onChange}
        disabled={disabled}
      >
        {choiceOptions.map((opt) => (
          <Label
            key={`${opt.value}-${opt.label}`}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50",
              answer === opt.value
                ? "border-[var(--primary)] bg-[var(--primary)]/5 font-semibold"
                : "border-[var(--border)]",
            )}
          >
            <RadioGroupItem value={opt.value} />
            {opt.label}
          </Label>
        ))}
      </RadioGroup>
    );
  }

  if (question.questionType === "true_false") {
    return (
      <RadioGroup
        className="mt-5 flex gap-3"
        value={answer}
        onValueChange={onChange}
        disabled={disabled}
      >
        {choiceOptions.map((opt) => (
          <Label
            key={opt.value}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-colors hover:bg-[var(--accent)]/50",
              answer === opt.value
                ? "border-[var(--primary)] bg-[var(--primary)]/5 font-semibold"
                : "border-[var(--border)]",
            )}
          >
            <RadioGroupItem value={opt.value} />
            {opt.label}
          </Label>
        ))}
      </RadioGroup>
    );
  }

  if (question.questionType === "short_answer") {
    return (
      <div className="mt-5">
        <textarea
          className="clay-inset min-h-32 w-full resize-y rounded-2xl px-4 py-3 text-sm leading-relaxed"
          placeholder="Type your answer… Arabic and English paragraphs are supported"
          rows={6}
          value={answer}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Your full response is saved exactly as written.
        </p>
      </div>
    );
  }

  if (question.questionType === "drag_drop") {
    const items = question.options ?? [];
    const targets = localizedTargets(question, language);
    const placement = parseDragDropAnswer(answer);
    const assigned = new Set(Object.values(placement).flat());
    const unassigned = items.filter((item) => !assigned.has(item));

    const place = (item: string, targetId: string | null) => {
      if (disabled) return;
      const next = { ...placement };
      for (const key of Object.keys(next)) {
        next[key] = next[key].filter((value) => value !== item);
      }
      if (targetId) next[targetId] = [...(next[targetId] ?? []), item];
      onChange(serializeDragDropAnswer(next));
      setPickedItem(null);
    };

    return (
      <div className="mt-5 grid gap-4">
        <div
          className="clay-inset rounded-2xl p-4"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const item = event.dataTransfer.getData("text/plain");
            if (item) place(item, null);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Draggable items
            </p>
            {pickedItem && (
              <span className="text-[11px] font-semibold text-primary">
                {language === "ar"
                  ? `اضغط على هدف لوضع «${optionLabel(question, pickedItem, language)}»`
                  : `Tap a target to place “${optionLabel(question, pickedItem, language)}”`}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {unassigned.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                All items placed — tap an item inside a target to move it back.
              </span>
            ) : (
              unassigned.map((item) => (
                <button
                  key={item}
                  type="button"
                  draggable={!disabled}
                  disabled={disabled}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", item);
                    setPickedItem(item);
                  }}
                  onClick={() =>
                    setPickedItem((current) =>
                      current === item ? null : item,
                    )
                  }
                  className={cn(
                    "cursor-grab rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors active:cursor-grabbing",
                    pickedItem === item
                      ? "border-[var(--primary)] bg-[var(--primary)]/10 text-primary"
                      : "border-[var(--border)] bg-background hover:bg-[var(--accent)]/60",
                  )}
                >
                  {optionLabel(question, item, language)}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {targets.map((target) => {
            const placed = placement[target.id] ?? [];
            return (
              <div
                key={target.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const item = event.dataTransfer.getData("text/plain");
                  if (item) place(item, target.id);
                }}
                onClick={() => {
                  if (pickedItem) place(pickedItem, target.id);
                }}
                className={cn(
                  "min-h-24 rounded-2xl border-2 border-dashed p-3 transition-colors",
                  pickedItem
                    ? "cursor-pointer border-[var(--primary)]/50 bg-[var(--primary)]/5"
                    : "border-[var(--border)]",
                )}
              >
                <p className="text-xs font-bold">{target.label}</p>
                {target.hint && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {target.hint}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {placed.length === 0 ? (
                    <span className="text-[11px] italic text-muted-foreground">
                      Drop or tap to place here
                    </span>
                  ) : (
                    placed.map((item) => (
                      <button
                        key={item}
                        type="button"
                        draggable={!disabled}
                        disabled={disabled}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", item);
                          setPickedItem(item);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          place(item, null);
                        }}
                        className="rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-xs font-semibold text-primary"
                      >
                        {optionLabel(question, item, language)} ×
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {question.partialCredit === false
            ? "Every placement must be correct to earn this question's marks."
            : "Each correct placement earns a proportional share of the marks."}
        </p>
      </div>
    );
  }

  const items = question.options ?? [];
  const parsedOrder = parseOrderingAnswer(answer);
  const sequence = parsedOrder.length > 0 ? parsedOrder : items;

  const move = (from: number, to: number) => {
    if (disabled || to < 0 || to >= sequence.length || from === to) return;
    const next = [...sequence];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(serializeOrderingAnswer(next));
  };

  return (
    <div className="mt-5 grid gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Drag to reorder — top is first
      </p>
      <div className="grid gap-2">
        {sequence.map((item, index) => (
          <div
            key={item}
            draggable={!disabled}
            onDragStart={(event) => {
              if (disabled) return;
              event.dataTransfer.setData("text/plain", String(index));
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (disabled) return;
              const from = Number(event.dataTransfer.getData("text/plain"));
              if (Number.isInteger(from)) move(from, index);
            }}
            className="flex cursor-grab items-center gap-3 rounded-2xl border bg-background px-3 py-3 text-sm active:cursor-grabbing"
          >
            <GripVertical className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 text-xs font-extrabold text-primary">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 font-semibold">
              {optionLabel(question, item, language)}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 rounded-full"
                aria-label={`Move ${optionLabel(question, item, language)} up`}
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 rounded-full"
                aria-label={`Move ${optionLabel(question, item, language)} down`}
                disabled={disabled || index === sequence.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Drag rows or use the arrow buttons to arrange the sequence.{" "}
        {question.partialCredit === false
          ? "The whole sequence must be correct to earn this question's marks."
          : "Each item in the right position earns a proportional share of the marks."}
      </p>
    </div>
  );
}

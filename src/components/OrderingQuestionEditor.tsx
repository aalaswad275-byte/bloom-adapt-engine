/**
 * Authoring controls for ordering questions. Items are the draggable rows;
 * the correct sequence is a permutation of those items. Up/down buttons and
 * drag handles both reorder the authored answer.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OrderingQuestionEditor({
  items,
  onItemsChange,
  correctOrder,
  onCorrectOrderChange,
  partialCredit,
  onPartialCreditChange,
}: {
  items: string[];
  onItemsChange: (items: string[]) => void;
  correctOrder: string[];
  onCorrectOrderChange: (order: string[]) => void;
  partialCredit: boolean;
  onPartialCreditChange: (value: boolean) => void;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  /** Items still present in the correct sequence, then any new items. */
  const sequence = [
    ...correctOrder.filter((item) => items.includes(item)),
    ...items.filter((item) => !correctOrder.includes(item)),
  ];

  const syncOrder = (nextItems: string[], nextOrder?: string[]) => {
    onItemsChange(nextItems);
    onCorrectOrderChange(
      (nextOrder ?? sequence).filter((item) => nextItems.includes(item)),
    );
  };

  /** Position in the sequence for the item at `items[index]` (handles blanks). */
  const sequenceIndexFor = (index: number) => {
    const value = items[index];
    const occurrence = items
      .slice(0, index)
      .filter((item) => item === value).length;
    let seen = 0;
    for (let i = 0; i < sequence.length; i += 1) {
      if (sequence[i] !== value) continue;
      if (seen === occurrence) return i;
      seen += 1;
    }
    return -1;
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= sequence.length) return;
    const next = [...sequence];
    [next[index], next[target]] = [next[target], next[index]];
    onCorrectOrderChange(next);
  };

  const dropAt = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    const next = [...sequence];
    const [moved] = next.splice(draggedIndex, 1);
    next.splice(index, 0, moved);
    onCorrectOrderChange(next);
    setDraggedIndex(null);
  };

  return (
    <div className="grid gap-4 rounded-2xl border border-dashed p-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold">Items to order</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() => syncOrder([...items, ""], [...sequence, ""])}
          >
            <Plus className="mr-1 size-3" /> Item
          </Button>
        </div>
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(event) => {
                const next = [...items];
                next[index] = event.target.value;
                const seqIndex = sequenceIndexFor(index);
                const nextOrder = [...sequence];
                if (seqIndex >= 0) nextOrder[seqIndex] = event.target.value;
                syncOrder(next, nextOrder);
              }}
              placeholder={`Step ${index + 1}`}
              className="clay-inset rounded-full px-4"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full text-destructive hover:bg-destructive/10"
              onClick={() => {
                const seqIndex = sequenceIndexFor(index);
                syncOrder(
                  items.filter((_, i) => i !== index),
                  seqIndex >= 0
                    ? sequence.filter((_, i) => i !== seqIndex)
                    : sequence,
                );
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <Label className="text-xs font-semibold">
          Correct sequence (top → bottom)
        </Label>
        <div className="grid gap-1.5">
          {sequence.map((item, index) => (
            <div
              key={`${item}-${index}`}
              draggable
              onDragStart={() => setDraggedIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                dropAt(index);
              }}
              className="flex items-center gap-2 rounded-xl border bg-background px-2 py-1.5"
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
              <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {item.trim() || "—"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-full"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-full"
                disabled={index === sequence.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-3.5" />
              </Button>
            </div>
          ))}
          {sequence.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Add at least two items to define their order.
            </p>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Drag rows, or use the arrows, to set the correct sequence. Students
          receive a shuffled starting order.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs">
        <Checkbox
          checked={partialCredit}
          onCheckedChange={(value) => onPartialCreditChange(value === true)}
          className="mt-0.5"
        />
        <span>
          Award partial marks for items in the correct position. When off, the
          question is all-or-nothing.
        </span>
      </label>
    </div>
  );
}

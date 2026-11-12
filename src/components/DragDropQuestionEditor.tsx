/**
 * Authoring controls for drag-and-drop questions. Draggable items are the
 * question's options; every item is assigned to exactly one drop target.
 * Several items may share a target (matching categories), and the partial
 * credit toggle controls proportional marking.
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DragDropEditorTarget = { id: string; label: string };

export function DragDropQuestionEditor({
  items,
  onItemsChange,
  targets,
  onTargetsChange,
  correct,
  onCorrectChange,
  partialCredit,
  onPartialCreditChange,
}: {
  items: string[];
  onItemsChange: (items: string[]) => void;
  targets: DragDropEditorTarget[];
  onTargetsChange: (targets: DragDropEditorTarget[]) => void;
  /** Draggable item → target id. */
  correct: Record<string, string>;
  onCorrectChange: (correct: Record<string, string>) => void;
  partialCredit: boolean;
  onPartialCreditChange: (value: boolean) => void;
}) {
  const nextTargetId = () => {
    let index = targets.length + 1;
    while (targets.some((target) => target.id === `target-${index}`)) index += 1;
    return `target-${index}`;
  };

  return (
    <div className="grid gap-4 rounded-2xl border border-dashed p-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold">Draggable items</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() => onItemsChange([...items, ""])}
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
                onItemsChange(next);
              }}
              placeholder={`Item ${index + 1}`}
              className="clay-inset rounded-full px-4"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full text-destructive hover:bg-destructive/10"
              onClick={() => {
                onItemsChange(items.filter((_, i) => i !== index));
                const nextCorrect = { ...correct };
                delete nextCorrect[item];
                onCorrectChange(nextCorrect);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold">
            Drop targets / matching categories
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() =>
              onTargetsChange([
                ...targets,
                { id: nextTargetId(), label: "" },
              ])
            }
          >
            <Plus className="mr-1 size-3" /> Target
          </Button>
        </div>
        {targets.map((target, index) => (
          <div key={target.id} className="flex items-center gap-2">
            <Input
              value={target.label}
              onChange={(event) => {
                const next = [...targets];
                next[index] = { ...target, label: event.target.value };
                onTargetsChange(next);
              }}
              placeholder={`Target ${index + 1} label`}
              className="clay-inset rounded-full px-4"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full text-destructive hover:bg-destructive/10"
              onClick={() => {
                onTargetsChange(targets.filter((row) => row.id !== target.id));
                onCorrectChange(
                  Object.fromEntries(
                    Object.entries(correct).filter(([, id]) => id !== target.id),
                  ),
                );
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <Label className="text-xs font-semibold">Correct placement</Label>
        {items.filter((item) => item.trim()).length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add draggable items first.
          </p>
        )}
        {items.map((item, index) =>
          item.trim() ? (
            <div
              key={`${item}-${index}`}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--accent)]/40 px-3 py-2"
            >
              <span className="min-w-24 flex-1 text-sm font-semibold">
                {item.trim()}
              </span>
              <span className="text-xs text-muted-foreground">goes to</span>
              <Select
                value={correct[item.trim()] ?? "unassigned"}
                onValueChange={(value) =>
                  onCorrectChange({
                    ...correct,
                    [item.trim()]:
                      value === "unassigned" ? "" : value,
                  })
                }
              >
                <SelectTrigger className="h-8 w-48 rounded-full text-xs">
                  <SelectValue placeholder="Choose a target" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Not assigned</SelectItem>
                  {targets
                    .filter((target) => target.label.trim())
                    .map((target) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null,
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs">
        <Checkbox
          checked={partialCredit}
          onCheckedChange={(value) => onPartialCreditChange(value === true)}
          className="mt-0.5"
        />
        <span>
          Award partial marks for correct placements. When off, the question is
          all-or-nothing.
        </span>
      </label>
    </div>
  );
}

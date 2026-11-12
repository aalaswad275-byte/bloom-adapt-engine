/**
 * Drag-and-drop question model.
 *
 * Draggable items are the question's `options`; targets are labelled drop
 * zones (positions, categories, slots). `correct` maps every item to exactly
 * one target, so the same target may accept several items (matching
 * categories) while each item is used once. The student answer is stored as
 * JSON: `{ targetId: string[] }`.
 */

export type DragDropTarget = {
  id: string;
  label: string;
  hint?: string;
};

export type DragDropPlacement = {
  targetId: string;
  item: string;
};

export type DragDropConfig = {
  items: string[];
  targets: DragDropTarget[];
  correct: DragDropPlacement[];
  partialCredit: boolean;
};

export type DragDropAnswer = Record<string, string[]>;

export type DragDropGrade = {
  correct: boolean;
  fraction: number;
  correctCount: number;
  total: number;
};

const clean = (value: string) => value.trim();

/** Read a stored answer defensively. Unknown shapes grade as empty. */
export function parseDragDropAnswer(raw: string | undefined | null): DragDropAnswer {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DragDropAnswer = {};
    for (const [targetId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const items = Array.isArray(value)
        ? value.map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
        : typeof value === "string"
          ? [value]
          : [];
      if (items.length > 0) out[targetId] = items;
    }
    return out;
  } catch {
    return {};
  }
}

/** Serialize placements for storage. Empty answers store an empty string. */
export function serializeDragDropAnswer(answer: DragDropAnswer): string {
  const entries = Object.entries(answer).filter(([, items]) => items.length > 0);
  return entries.length === 0 ? "" : JSON.stringify(Object.fromEntries(entries));
}

/**
 * Validate and normalize an authored drag/drop question. Throws a
 * user-facing error for every malformed shape so create/update/share all
 * enforce the same rules.
 */
export function normalizeDragDropConfig(input: {
  items?: string[];
  targets?: DragDropTarget[];
  correct?: DragDropPlacement[];
  partialCredit?: boolean;
}): DragDropConfig {
  const items = [...new Set((input.items ?? []).map(clean).filter(Boolean))];
  if (items.length < 2)
    throw new Error("Drag-and-drop questions need at least 2 draggable items");
  if (new Set((input.items ?? []).map(clean).filter(Boolean)).size !== (input.items ?? []).map(clean).filter(Boolean).length)
    throw new Error("Draggable items must be unique");

  const targets: DragDropTarget[] = [];
  const targetIds = new Set<string>();
  for (const target of input.targets ?? []) {
    const id = clean(target.id);
    const label = clean(target.label);
    if (!id || !label) throw new Error("Every drop target needs an id and a label");
    if (targetIds.has(id)) throw new Error("Drop target ids must be unique");
    targetIds.add(id);
    targets.push({
      id,
      label,
      hint: target.hint ? clean(target.hint) : undefined,
    });
  }
  if (targets.length < 2)
    throw new Error("Drag-and-drop questions need at least 2 drop targets");

  const correct: DragDropPlacement[] = [];
  const placed = new Set<string>();
  for (const placement of input.correct ?? []) {
    const item = clean(placement.item);
    const targetId = clean(placement.targetId);
    if (!items.includes(item))
      throw new Error(`"${item}" is not one of the draggable items`);
    if (!targetIds.has(targetId))
      throw new Error(`"${item}" is assigned to an unknown drop target`);
    if (placed.has(item))
      throw new Error(`"${item}" is assigned to more than one drop target`);
    placed.add(item);
    correct.push({ targetId, item });
  }
  const missing = items.filter((item) => !placed.has(item));
  if (missing.length > 0)
    throw new Error(`Assign every draggable item to a target (missing: ${missing.join(", ")})`);

  return {
    items,
    targets,
    correct,
    partialCredit: input.partialCredit !== false,
  };
}

/** Human-readable answer key for result pages and question cards. */
export function formatDragDropAnswer(config: DragDropConfig): string {
  return config.targets
    .map((target) => {
      const items = config.correct
        .filter((placement) => placement.targetId === target.id)
        .map((placement) => placement.item);
      return items.length > 0 ? `${target.label}: ${items.join(", ")}` : null;
    })
    .filter((line): line is string => line !== null)
    .join(" · ");
}

/** Grade one drag/drop response, optionally awarding partial marks. */
export function gradeDragDrop(
  config: DragDropConfig,
  rawAnswer: string | undefined | null,
): DragDropGrade {
  const answer = parseDragDropAnswer(rawAnswer);
  const placedByItem = new Map<string, string>();
  for (const [targetId, items] of Object.entries(answer)) {
    for (const item of items) {
      if (config.items.includes(item)) placedByItem.set(item, targetId);
    }
  }
  const total = config.correct.length;
  const correctCount = config.correct.filter(
    (placement) => placedByItem.get(placement.item) === placement.targetId,
  ).length;
  const complete = total > 0 && correctCount === total;
  const fraction = total === 0 ? 0 : config.partialCredit ? correctCount / total : complete ? 1 : 0;
  return { correct: complete, fraction, correctCount, total };
}

/** Render a student's placements with target labels for result pages. */
export function describeDragDropAnswer(
  config: DragDropConfig,
  rawAnswer: string | undefined | null,
): string {
  const answer = parseDragDropAnswer(rawAnswer);
  return config.targets
    .map((target) => {
      const placed = answer[target.id] ?? [];
      return `${target.label}: ${placed.length > 0 ? placed.join(", ") : "—"}`;
    })
    .join(" · ");
}

/** Whether every draggable item has been placed (drives Submit availability). */
export function isDragDropComplete(
  items: string[],
  rawAnswer: string | undefined | null,
): boolean {
  const answer = parseDragDropAnswer(rawAnswer);
  const placed = new Set(Object.values(answer).flat());
  return items.length > 0 && items.every((item) => placed.has(item));
}

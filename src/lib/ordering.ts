/**
 * Ordering question model.
 *
 * `items` are the draggable rows (`options` on the question row);
 * `correctOrder` is a permutation of those items. The student answer is
 * stored as JSON `{ order: string[] }`.
 */

export type OrderingConfig = {
  items: string[];
  correctOrder: string[];
  partialCredit: boolean;
};

export type OrderingGrade = {
  correct: boolean;
  fraction: number;
  correctPositions: number;
  total: number;
};

const clean = (value: string) => value.trim();

/** Validate and normalize an authored ordering question. */
export function normalizeOrderingConfig(input: {
  items?: string[];
  correctOrder?: string[];
  partialCredit?: boolean;
}): OrderingConfig {
  const items = (input.items ?? []).map(clean).filter(Boolean);
  if (items.length < 2)
    throw new Error("Ordering questions need at least 2 items");
  if (new Set(items).size !== items.length)
    throw new Error("Ordering items must be unique");

  const correctOrder = (input.correctOrder ?? []).map(clean).filter(Boolean);
  if (correctOrder.length !== items.length)
    throw new Error("The correct order must contain every item exactly once");
  if (new Set(correctOrder).size !== correctOrder.length)
    throw new Error("The correct order contains a duplicate item");
  const unknown = correctOrder.filter((item) => !items.includes(item));
  const missing = items.filter((item) => !correctOrder.includes(item));
  if (unknown.length > 0 || missing.length > 0)
    throw new Error("The correct order must be a permutation of the items");

  return {
    items,
    correctOrder,
    partialCredit: input.partialCredit !== false,
  };
}

/** Human-readable sequence for the question card and result page. */
export function formatOrderingAnswer(config: OrderingConfig): string {
  return config.correctOrder
    .map((item, index) => `${index + 1}. ${item}`)
    .join(" · ");
}

/** Student answer parser; unknown/invalid shapes grade as empty. */
export function parseOrderingAnswer(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as { order?: unknown }).order
        : null;
    if (!Array.isArray(values)) return [];
    return values
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function serializeOrderingAnswer(order: string[]): string {
  return order.length === 0 ? "" : JSON.stringify({ order });
}

/**
 * Grade positional matches. Partial credit is the share of items in the
 * correct position; all-or-nothing ignores partial matches.
 */
export function gradeOrdering(
  config: OrderingConfig,
  rawAnswer: string | undefined | null,
): OrderingGrade {
  const answer = parseOrderingAnswer(rawAnswer);
  const positions = new Map<string, number>();
  answer.forEach((item, index) => {
    if (!positions.has(item)) positions.set(item, index);
  });
  let correctPositions = 0;
  config.correctOrder.forEach((item, index) => {
    if (positions.get(item) === index) correctPositions += 1;
  });
  const total = config.correctOrder.length;
  const complete = total > 0 && correctPositions === total;
  const fraction = total === 0
    ? 0
    : config.partialCredit
      ? correctPositions / total
      : complete
        ? 1
        : 0;
  return { correct: complete, fraction, correctPositions, total };
}

/** Render a student's current sequence for result pages. */
export function describeOrderingAnswer(
  items: string[],
  rawAnswer: string | undefined | null,
): string {
  const parsed = parseOrderingAnswer(rawAnswer);
  const order = parsed.length > 0 ? parsed : items;
  return order.map((item, index) => `${index + 1}. ${item}`).join(" · ");
}

/** Whether the student has a complete, duplicate-free sequence. */
export function isOrderingComplete(
  items: string[],
  rawAnswer: string | undefined | null,
): boolean {
  const order = parseOrderingAnswer(rawAnswer);
  return (
    items.length > 0 &&
    order.length === items.length &&
    new Set(order).size === order.length &&
    items.every((item) => order.includes(item))
  );
}

/** Small deterministic hash so each submission gets a stable shuffled start. */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic Fisher–Yates shuffle for the initial student sequence. */
export function shuffledOrderingItems(items: string[], seed: string): string[] {
  const out = [...items];
  let state = hashSeed(seed);
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Bloom's Taxonomy domain model.
 *
 * Every question in the system carries exactly one primary Bloom level.
 * The engine maintains a SEPARATE ability estimate (theta) per level —
 * see ability.ts. These are the only valid level identifiers.
 */

export const BLOOM_LEVELS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];

export interface BloomLevelMeta {
  id: BloomLevel;
  /** Ordinal position 1-6 (higher = cognitively more demanding). */
  order: number;
  label: string;
  description: string;
}

export const BLOOM_META: Record<BloomLevel, BloomLevelMeta> = {
  remember: {
    id: "remember",
    order: 1,
    label: "Remember",
    description: "Retrieve facts and basic concepts from memory.",
  },
  understand: {
    id: "understand",
    order: 2,
    label: "Understand",
    description: "Explain ideas, interpret meaning, restate in own words.",
  },
  apply: {
    id: "apply",
    order: 3,
    label: "Apply",
    description: "Use information in new situations; execute procedures.",
  },
  analyze: {
    id: "analyze",
    order: 4,
    label: "Analyze",
    description: "Draw connections, decompose, differentiate structure.",
  },
  evaluate: {
    id: "evaluate",
    order: 5,
    label: "Evaluate",
    description: "Justify decisions, critique, judge against criteria.",
  },
  create: {
    id: "create",
    order: 6,
    label: "Create",
    description: "Produce new or original work; combine elements into a whole.",
  },
};

/** Canonical Bloom ladder: Remember → Understand → Apply → Analyze → Evaluate → Create. */
export function nextHigherLevel(level: BloomLevel): BloomLevel | null {
  const order = BLOOM_META[level].order;
  const higher = BLOOM_LEVELS.find((l) => BLOOM_META[l].order === order + 1);
  return higher ?? null;
}

/** Nearest prerequisite level (one step down the ladder). */
export function prerequisiteLevel(level: BloomLevel): BloomLevel | null {
  const order = BLOOM_META[level].order;
  const lower = BLOOM_LEVELS.find((l) => BLOOM_META[l].order === order - 1);
  return lower ?? null;
}

/** True when `candidate` is at or below `level` on the Bloom ladder. */
export function isPrerequisiteOf(
  candidate: BloomLevel,
  level: BloomLevel,
): boolean {
  return BLOOM_META[candidate].order <= BLOOM_META[level].order;
}

export function isBloomLevel(value: string): value is BloomLevel {
  return (BLOOM_LEVELS as readonly string[]).includes(value);
}

export const BLOOM_LABEL: Record<BloomLevel, string> = Object.fromEntries(
  BLOOM_LEVELS.map((l) => [l, BLOOM_META[l].label]),
) as Record<BloomLevel, string>;

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

/**
 * Custom display names for the taxonomy.
 *
 * Instructors may rename the six levels for their own assessment ("Recall",
 * "Comprehend", "Employ", …). The identifiers never change — only what is
 * shown — so the adaptive engine, the ladder and every stored θ key stay
 * untouched. Instructors who keep the taxonomy defaults store nothing at all.
 */
export type BloomLabelMap = Record<BloomLevel, string>;

/** The taxonomy defaults, used whenever an instructor keeps the stock names. */
export const DEFAULT_BLOOM_LABELS: BloomLabelMap = { ...BLOOM_LABEL };

/**
 * Expand a stored override map into a complete level → name map, falling back
 * to the taxonomy default for any level the instructor left alone.
 */
export function resolveBloomLabels(
  overrides?: Partial<Record<string, string>> | null,
): BloomLabelMap {
  const out: BloomLabelMap = { ...DEFAULT_BLOOM_LABELS };
  if (!overrides) return out;
  for (const level of BLOOM_LEVELS) {
    const custom = overrides[level];
    if (typeof custom === "string" && custom.trim() !== "") {
      out[level] = custom.trim();
    }
  }
  return out;
}

/**
 * Validate + trim submitted names and keep only the levels that differ from
 * the taxonomy default. Returns null when the instructor kept every default,
 * so assessments that use the stock taxonomy store nothing extra.
 */
export function normalizeBloomLabels(
  overrides?: Partial<Record<string, string>> | null,
): Record<string, string> | null {
  if (!overrides) return null;
  const resolved = resolveBloomLabels(overrides);
  const custom: Record<string, string> = {};
  for (const level of BLOOM_LEVELS) {
    const name = resolved[level].slice(0, 40);
    if (name !== DEFAULT_BLOOM_LABELS[level]) custom[level] = name;
  }
  return Object.keys(custom).length > 0 ? custom : null;
}

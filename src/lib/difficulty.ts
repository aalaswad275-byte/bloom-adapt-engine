/**
 * Coarse difficulty band for an authored question.
 *
 * This is the instructor-facing label shown in the question bank and the
 * create/edit form. It is intentionally separate from the 2PL `difficultyB`
 * parameter the adaptive engine uses: each band maps to a representative b,
 * which is stamped onto questions authored without an explicit b so the
 * adaptive selector agrees with the label the instructor chose.
 */

export const DIFFICULTY_LEVELS = [
  "easy",
  "medium",
  "hard",
  "expert",
] as const;

export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export interface DifficultyMeta {
  id: DifficultyLevel;
  label: string;
  /** Ordinal 1-4 (higher = harder). */
  order: number;
  /** Representative 2PL difficulty b for the band. */
  b: number;
  /** Tailwind classes for the bank badge. */
  badge: string;
  /** Tailwind classes for the card accent bar. */
  accent: string;
}

export const DIFFICULTY_META: Record<DifficultyLevel, DifficultyMeta> = {
  easy: {
    id: "easy",
    label: "Easy",
    order: 1,
    b: -1.2,
    badge: "bg-[oklch(0.91_0.06_150)] text-[oklch(0.33_0.08_150)]",
    accent: "bg-[oklch(0.68_0.13_150)]",
  },
  medium: {
    id: "medium",
    label: "Medium",
    order: 2,
    b: -0.2,
    badge: "bg-[oklch(0.93_0.07_85)] text-[oklch(0.36_0.09_85)]",
    accent: "bg-[oklch(0.76_0.14_85)]",
  },
  hard: {
    id: "hard",
    label: "Hard",
    order: 3,
    b: 0.8,
    badge: "bg-[oklch(0.91_0.08_55)] text-[oklch(0.36_0.1_55)]",
    accent: "bg-[oklch(0.68_0.16_55)]",
  },
  expert: {
    id: "expert",
    label: "Expert",
    order: 4,
    b: 1.8,
    badge: "bg-[oklch(0.89_0.08_25)] text-[oklch(0.34_0.12_25)]",
    accent: "bg-[oklch(0.58_0.17_25)]",
  },
};

/** Representative 2PL b for each band, used when a question has no explicit b. */
export const DIFFICULTY_B: Record<DifficultyLevel, number> = {
  easy: DIFFICULTY_META.easy.b,
  medium: DIFFICULTY_META.medium.b,
  hard: DIFFICULTY_META.hard.b,
  expert: DIFFICULTY_META.expert.b,
};

export function isDifficultyLevel(value: string): value is DifficultyLevel {
  return (DIFFICULTY_LEVELS as readonly string[]).includes(value);
}

/** Nearest band for a 2PL difficulty estimate. */
export function difficultyLevelFromB(b: number): DifficultyLevel {
  if (b < -0.7) return "easy";
  if (b < 0.3) return "medium";
  if (b < 1.3) return "hard";
  return "expert";
}

/**
 * Difficulty of a stored question: the authored band when present, otherwise
 * derived from its 2PL b (legacy rows and AI-generated questions).
 */
export function resolveDifficulty(q: {
  difficultyLevel?: string | null;
  difficultyB?: number | null;
}): DifficultyLevel {
  if (q.difficultyLevel && isDifficultyLevel(q.difficultyLevel))
    return q.difficultyLevel;
  if (typeof q.difficultyB === "number") return difficultyLevelFromB(q.difficultyB);
  return "medium";
}

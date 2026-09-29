/**
 * Unit tests for the Bloom's Taxonomy-Integrated Adaptive IRT model.
 * Covers the 15 mandated test behaviors (spec §42) plus numerical guards.
 * Run: bun test src/lib/irt/__tests__/
 */

import { describe, expect, it } from "bun:test";

import {
  BLOOM_LEVELS,
  DEFAULT_IRT_CONTEXT,
  calculateEffectiveDifficulty,
  calculateItemInformation,
  calculateLogLikelihood,
  calculateProbability,
  calculateTimeStrain,
  calculateVisualMismatch,
  classifyBehavior,
  classifyTimeStrain,
  createInitialProfile,
  estimateThetaMap,
  evaluateIntegrity,
  selectNextQuestion,
  updateProfile,
  type CandidateItem,
  type MonitoringEvent,
  type SelectionInput,
} from "../index";

const CTX_ZERO: Parameters<typeof calculateProbability>[3] = {
  gamma: 0.35,
  delta: 0.25,
  T: 0,
  V: 0,
};

function candidates(): CandidateItem[] {
  return [
    { id: "easy", bloomLevel: "apply", topic: "t", learningOutcome: null, a: 1.0, b: -1.0, expectedTime: 60, marks: 1 },
    { id: "mid", bloomLevel: "apply", topic: "t", learningOutcome: null, a: 1.0, b: 0.0, expectedTime: 60, marks: 1 },
    { id: "mid2", bloomLevel: "apply", topic: "t", learningOutcome: null, a: 1.2, b: 0.2, expectedTime: 60, marks: 1 },
    { id: "hard", bloomLevel: "apply", topic: "t", learningOutcome: null, a: 1.0, b: 1.5, expectedTime: 60, marks: 1 },
    { id: "diag", bloomLevel: "apply", topic: "t", learningOutcome: null, a: 1.5, b: 0.1, expectedTime: 60, marks: 1 },
  ];
}

function baseInput(overrides: Partial<SelectionInput> = {}): SelectionInput {
  const targets = {
    remember: 1 / 6,
    understand: 1 / 6,
    apply: 1 / 3,
    analyze: 1 / 6,
    evaluate: 1 / 12,
    create: 1 / 12,
  };
  const counts = {
    remember: 0,
    understand: 0,
    apply: 2,
    analyze: 0,
    evaluate: 0,
    create: 0,
  };
  return {
    studentProfile: {
      remember: 0,
      understand: 0,
      apply: 0.5,
      analyze: 0,
      evaluate: 0,
      create: 0,
    },
    candidates: candidates(),
    examConfig: {
      targetProbability: 0.5,
      weights: { w1: 1, w2: 0.8, w3: 0.6, w4: 0.25, w5: 0.7, w6: 0.5 },
      distributionPressure: 1.2,
      exposurePenalty: 0.35,
    },
    last: null,
    irtContext: { gamma: 0.35, delta: 0.25, T: 0, V: 0 },
    bloom: {
      targets,
      counts,
      totalAnswered: 2,
      totalPlanned: 12,
      mandatoryMinimums: { remember: 0.08, apply: 0.2 },
    },
    exposureCounts: {},
    answeredIds: new Set(["easy", "mid"]),
    diagnostic: { level: null, failures: 0 },
    outcomePriorities: {},
    difficultyRange: { min: -2, max: 2 },
    ...overrides,
  };
}

describe("model equation P(theta, a, b, gamma*T, delta*V)", () => {
  it("1. increasing theta increases P", () => {
    const lo = calculateProbability(-1, 1.2, 0, CTX_ZERO);
    const hi = calculateProbability(1, 1.2, 0, CTX_ZERO);
    expect(lo < hi).toBe(true);
  });

  it("2. increasing b decreases P", () => {
    const lo = calculateProbability(0.5, 1.2, -0.5, CTX_ZERO);
    const hi = calculateProbability(0.5, 1.2, 0.5, CTX_ZERO);
    expect(lo > hi).toBe(true);
  });

  it("3. increasing a increases discrimination (steeper curve)", () => {
    const dLow = calculateProbability(0.6, 0.5, 0, CTX_ZERO) - calculateProbability(-0.6, 0.5, 0, CTX_ZERO);
    const dHigh = calculateProbability(0.6, 2.5, 0, CTX_ZERO) - calculateProbability(-0.6, 2.5, 0, CTX_ZERO);
    expect(dHigh > dLow).toBe(true);
  });

  it("4. T > 0 reduces P when gamma > 0", () => {
    const base = calculateProbability(0.5, 1.2, 0, CTX_ZERO);
    const strained = calculateProbability(0.5, 1.2, 0, { ...CTX_ZERO, T: 0.4 });
    expect(strained < base).toBe(true);
  });

  it("5. T < 0 increases P when gamma > 0", () => {
    const base = calculateProbability(0.5, 1.2, 0, CTX_ZERO);
    const fluent = calculateProbability(0.5, 1.2, 0, { ...CTX_ZERO, T: -0.4 });
    expect(fluent > base).toBe(true);
  });

  it("6. V > 0 reduces P when delta > 0", () => {
    const base = calculateProbability(0.5, 1.2, 0, CTX_ZERO);
    const mismatched = calculateProbability(0.5, 1.2, 0, { ...CTX_ZERO, V: 0.5 });
    expect(mismatched < base).toBe(true);
  });

  it("effective difficulty equals b + gamma*T + delta*V", () => {
    const bEff = calculateEffectiveDifficulty(0.7, { gamma: 0.5, delta: 0.3, T: 0.2, V: 0.4 });
    expect(Math.abs(bEff - (0.7 + 0.5 * 0.2 + 0.3 * 0.4))).toBeLessThan(1e-12);
  });

  it("probability saturates without overflow (numerical guard)", () => {
    expect(calculateProbability(40, 3, -40, CTX_ZERO)).toBeCloseTo(1, 5);
    expect(calculateProbability(-40, 3, 40, CTX_ZERO)).toBeCloseTo(0, 5);
  });
});

describe("time strain", () => {
  it("computes signed (RT - E)/(E + eps) and preserves sign", () => {
    expect(calculateTimeStrain(130, 100)).toBeGreaterThan(0);
    expect(calculateTimeStrain(70, 100)).toBeLessThan(0);
    expect(calculateTimeStrain(100, 100)).toBeCloseTo(0, 6);
  });

  it("clips extreme values to the configurable range but keeps sign", () => {
    expect(calculateTimeStrain(1000, 10)).toBe(1);
    expect(calculateTimeStrain(-1000 + 20, 10)).toBe(-1);
  });

  it("classifies FAST / NORMAL / SLOW", () => {
    expect(classifyTimeStrain(-0.5)).toBe("FAST");
    expect(classifyTimeStrain(0.05)).toBe("NORMAL");
    expect(classifyTimeStrain(0.6)).toBe("SLOW");
  });
});

describe("visual mismatch", () => {
  it("is zero when interaction matches presentation", () => {
    const v = calculateVisualMismatch({ gazeDeviation: 0, attentionToQuestion: 1, abnormalInteraction: 0 });
    expect(v).toBeCloseTo(0, 9);
  });

  it("increases with deviation and decreases with attention, bounded [0,1]", () => {
    const v = calculateVisualMismatch({ gazeDeviation: 1, attentionToQuestion: 0, abnormalInteraction: 1 });
    expect(v).toBeCloseTo(1, 9);
    const partial = calculateVisualMismatch({ gazeDeviation: 0.5, attentionToQuestion: 0.5, abnormalInteraction: 0.5 });
    expect(partial > 0 && partial < 1).toBe(true);
  });
});

describe("MAP ability estimation", () => {
  it("recovers a high ability from all-correct high-difficulty answers", () => {
    const est = estimateThetaMap(
      [1, 1, 1],
      [
        { a: 1.2, b: 1.0, ctx: CTX_ZERO },
        { a: 1.0, b: 0.8, ctx: CTX_ZERO },
        { a: 1.4, b: 1.2, ctx: CTX_ZERO },
      ],
    );
    expect(est.theta > 0.8).toBe(true);
    expect(est.standardError > 0).toBe(true);
  });

  it("recovers a low ability from all-incorrect easy answers", () => {
    const est = estimateThetaMap(
      [0, 0],
      [
        { a: 1.2, b: -0.5, ctx: CTX_ZERO },
        { a: 1.0, b: -0.8, ctx: CTX_ZERO },
      ],
    );
    expect(est.theta < -0.5).toBe(true);
  });

  it("positive strain raises effective difficulty, so a correct answer implies higher theta", () => {
    // b_eff = b + gamma*T: with T>0 the item was effectively harder, so
    // solving it correctly is stronger evidence of ability (per the model).
    const fast = estimateThetaMap(
      [1],
      [{ a: 1, b: 0, ctx: { gamma: 0.35, delta: 0.25, T: -0.5, V: 0 } }],
    );
    const slow = estimateThetaMap(
      [1],
      [{ a: 1, b: 0, ctx: { gamma: 0.35, delta: 0.25, T: 0.5, V: 0 } }],
    );
    expect(slow.theta > fast.theta).toBe(true);
  });

  it("empty history returns the prior", () => {
    const est = estimateThetaMap([], []);
    expect(est.theta).toBe(0);
    expect(est.standardError).toBe(1);
  });
});

describe("six-dimensional ability profile", () => {
  it("updates ONLY the relevant Bloom theta", () => {
    const profile = createInitialProfile();
    const updated = updateProfile(profile, "apply", [
      { response: 1, a: 1, b: 0, ctx: CTX_ZERO },
    ]).profile;
    for (const level of BLOOM_LEVELS) {
      if (level === "apply") continue;
      expect(updated[level].theta).toBe(profile[level].theta);
      expect(updated[level].numItems).toBe(0);
    }
    expect(updated.apply.numItems).toBe(1);
    expect(updated.apply.theta).not.toBe(0);
  });

  it("maintains all six Bloom abilities independently", () => {
    let p = createInitialProfile();
    const seq: Array<[Parameters<typeof updateProfile>[1], 0 | 1]> = [
      ["remember", 1],
      ["apply", 0],
      ["analyze", 1],
      ["create", 1],
      ["evaluate", 0],
      ["understand", 1],
    ];
    for (const [level, resp] of seq) {
      p = updateProfile(p, level, [{ response: resp, a: 1, b: 0, ctx: CTX_ZERO }]).profile;
    }
    expect(p.remember.theta > p.evaluate.theta).toBe(true); // 1 correct vs 0 incorrect at identical params
    expect(p.remember.numItems).toBe(1);
    expect(p.apply.numItems).toBe(1);
    expect(p.analyze.numItems).toBe(1);
    expect(p.evaluate.numItems).toBe(1);
    expect(p.create.numItems).toBe(1);
    expect(p.understand.numItems).toBe(1);
  });

  it("accumulates responses at a level across steps", () => {
    let p = createInitialProfile();
    p = updateProfile(p, "analyze", [
      { response: 1, a: 1, b: 0, ctx: CTX_ZERO },
      { response: 1, a: 1.2, b: 0.5, ctx: CTX_ZERO },
    ]).profile;
    p = updateProfile(p, "analyze", [
      { response: 1, a: 1, b: 0, ctx: CTX_ZERO },
      { response: 1, a: 1.2, b: 0.5, ctx: CTX_ZERO },
      { response: 1, a: 1.4, b: 1.0, ctx: CTX_ZERO },
    ]).profile;
    expect(p.analyze.numItems).toBe(3);
    expect(p.analyze.theta > 1).toBe(true);
  });
});

describe("behavioral classification", () => {
  it("correct-fast tends upward", () => {
    const b = classifyBehavior(1, "FAST", "apply");
    expect(b.signal).toBe("CORRECT_FAST");
    expect(b.difficultyDirection).toBe("UP");
  });

  it("correct-slow is stable or slightly upward", () => {
    const b = classifyBehavior(1, "SLOW", "analyze");
    expect(b.signal).toBe("CORRECT_SLOW");
    expect(b.difficultyDirection === "STABLE_OR_UP").toBe(true);
  });

  it("incorrect-fast triggers diagnostic verification", () => {
    const b = classifyBehavior(0, "FAST", "apply");
    expect(b.signal).toBe("INCORRECT_FAST");
    expect(b.difficultyDirection).toBe("DIAGNOSTIC");
    expect(b.bloomSuggestion).toBe("SAME");
  });

  it("incorrect-slow tends downward / prerequisite", () => {
    const b = classifyBehavior(0, "SLOW", "analyze");
    expect(b.signal).toBe("INCORRECT_SLOW");
    expect(b.difficultyDirection).toBe("DOWN");
    expect(b.bloomSuggestion).toBe("PREREQUISITE");
  });
});

describe("adaptive selection", () => {
  it("correct-fast selects a harder item than current", () => {
    const result = selectNextQuestion(
      baseInput({
        last: { bloomLevel: "apply", b: 0.0, correctness: 1, strainClass: "FAST" },
        irtContext: { gamma: 0.35, delta: 0.25, T: -0.3, V: 0 },
        diagnostic: { level: null, failures: 0 },
      }),
    );
    expect(result.selected).not.toBeNull();
    expect(result.selected!.eligible).toBe(true);
    // All remaining eligible candidates are harder than b=0.0 — the upward
    // tendency is satisfied; utility picks the most informative one.
    expect(result.selected!.item.b > 0.0).toBe(true);
  });

  it("correct-slow keeps difficulty stable or slightly higher", () => {
    const result = selectNextQuestion(
      baseInput({
        last: { bloomLevel: "apply", b: 0.2, correctness: 1, strainClass: "SLOW" },
        irtContext: { gamma: 0.35, delta: 0.25, T: 0.3, V: 0 },
      }),
    );
    expect(result.selected).not.toBeNull();
    expect(result.selected!.item.b >= 0.05).toBe(true);
    expect(result.selected!.item.b <= 0.6).toBe(true);
  });

  it("incorrect-fast selects a strong-discrimination diagnostic item at similar difficulty", () => {
    const result = selectNextQuestion(
      baseInput({
        last: { bloomLevel: "apply", b: 0.1, correctness: 0, strainClass: "FAST" },
        irtContext: { gamma: 0.35, delta: 0.25, T: -0.35, V: 0 },
        diagnostic: { level: "apply", failures: 0 },
      }),
    );
    expect(result.selected).not.toBeNull();
    expect(result.selected!.item.id).toBe("diag"); // a = 1.5 wins diagnostic value
    expect(Math.abs(result.selected!.item.b - 0.1) <= 0.4).toBe(true);
  });

  it("incorrect-slow selects an easier item", () => {
    const result = selectNextQuestion(
      baseInput({
        last: { bloomLevel: "apply", b: 1.2, correctness: 0, strainClass: "SLOW" },
        irtContext: { gamma: 0.35, delta: 0.25, T: 0.45, V: 0 },
        diagnostic: { level: null, failures: 0 },
      }),
    );
    expect(result.selected).not.toBeNull();
    expect(result.selected!.item.b < 1.2).toBe(true);
  });

  it("never repeats an answered question", () => {
    const input = baseInput({
      last: { bloomLevel: "apply", b: 0, correctness: 1, strainClass: "FAST" },
    });
    const result = selectNextQuestion(input);
    expect(input.answeredIds.has(result.selected!.item.id)).toBe(false);
  });

  it("respects Bloom distribution pressure (behind-quota level boosted)", () => {
    const input = baseInput({
      last: { bloomLevel: "apply", b: 0, correctness: 1, strainClass: "FAST" },
      bloom: {
        targets: {
          remember: 1 / 12,
          understand: 1 / 12,
          apply: 0.5,
          analyze: 1 / 12,
          evaluate: 1 / 12,
          create: 1 / 12,
        },
        counts: { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 },
        totalAnswered: 2,
        totalPlanned: 12,
        mandatoryMinimums: { apply: 0.2 },
      },
    });
    // apply target is 50% (6 of 12) but 0 served — far behind schedule.
    const scored = selectNextQuestion(input).ranked.find((r) => r.item.id === "mid2")!;
    expect(scored.bloomPriority > 0).toBe(true);
  });
});

describe("academic integrity engine independence", () => {
  const ev = (type: MonitoringEvent["type"], confidence: number, ts: number): MonitoringEvent => ({
    id: `${type}-${ts}-${Math.random()}`,
    sessionId: "s1",
    studentId: "u1",
    timestamp: ts,
    type,
    confidence,
    severity: "medium",
  });

  it("does NOT count a single raw detection as a confirmed violation", () => {
    const r = evaluateIntegrity([ev("PHONE_DETECTED", 0.95, Date.now())]);
    expect(r.confirmedViolations).toBe(0);
    expect(r.riskScore > 0).toBe(true);
  });

  it("confirms a violation only after temporal aggregation", () => {
    const now = Date.now();
    const events = [
      ev("PHONE_DETECTED", 0.9, now - 50_000),
      ev("PHONE_DETECTED", 0.9, now - 30_000),
      ev("PHONE_DETECTED", 0.9, now - 10_000),
    ];
    const r = evaluateIntegrity(events, undefined, now);
    expect(r.confirmedViolations).toBe(1);
    expect(r.confirmedTypes).toContain("PHONE_DETECTED");
  });

  it("ignores low-confidence events", () => {
    const now = Date.now();
    const events = [
      ev("TAB_SWITCH", 0.2, now - 30_000),
      ev("TAB_SWITCH", 0.3, now - 20_000),
      ev("TAB_SWITCH", 0.2, now - 10_000),
    ];
    const r = evaluateIntegrity(events, undefined, now);
    expect(r.confirmedViolations).toBe(0);
  });

  it("fires the three-violation rule only from confirmed violations", () => {
    const now = Date.now();
    const events = [
      ...[0, 1, 2].map((i) => ev("PHONE_DETECTED", 0.95, now - 100_000 + i * 5_000)),
      ...[0, 1, 2].map((i) => ev("EXTRA_PERSON", 0.9, now - 50_000 + i * 5_000)),
      ...[0, 1, 2].map((i) => ev("TAB_SWITCH", 0.85, now - 20_000 + i * 5_000)),
    ];
    const r = evaluateIntegrity(events, undefined, now);
    expect(r.confirmedViolations).toBe(3);
    expect(r.shouldTerminate).toBe(true);
  });

  it("never touches theta: monitoring output contains no ability fields", () => {
    const r = evaluateIntegrity([ev("LOOKING_AWAY", 0.9, Date.now())]);
    const keys = Object.keys(r);
    expect(keys.some((k) => ["theta", "ability", "profile"].includes(k))).toBe(false);
  });
});

describe("item information", () => {
  it("peaks near the effective difficulty and is a^2*P*(1-P)", () => {
    const a = 1.4;
    const p = 0.5;
    const info = calculateItemInformation(0, a, p);
    expect(Math.abs(info - a * a * 0.25)).toBeLessThan(1e-12);
    const off = calculateItemInformation(0, a, 0.95);
    expect(off < info).toBe(true);
  });
});

describe("log likelihood", () => {
  it("penalizes confident wrong predictions", () => {
    const good = calculateLogLikelihood([1, 0], [0.9, 0.1]);
    const bad = calculateLogLikelihood([1, 0], [0.1, 0.9]);
    expect(good > bad).toBe(true);
  });
});

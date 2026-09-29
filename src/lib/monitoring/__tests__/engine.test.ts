import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MONITORING_CONFIG,
  ViolationEngine,
  classifyFrame,
  policyForCount,
  withOverrides,
  type FrameSample,
  type Observation,
} from "../index";

const cfg = DEFAULT_MONITORING_CONFIG;

function person(x: number, score = 0.9): FrameSample["persons"][number] {
  return { className: "person", center: { x, y: 0.5 }, score };
}

function phone(score = 0.9): FrameSample["phones"][number] {
  return { className: "cell phone", center: { x: 0.5, y: 0.3 }, score };
}

const baseSample: FrameSample = {
  persons: [person(0.5)],
  phones: [],
  faces: [{ center: { x: 0.5, y: 0.4 }, area: 0.1 }],
  frameOk: true,
  identityVerified: true,
  gazeDeviation: 0.1,
};

function obs(
  type: Observation["type"],
  active: boolean,
  t: number,
  confidence = 0.9,
): Observation {
  return { type, active, confidence, timestamp: t };
}

describe("policyForCount", () => {
  test("ladder: warning → pause → terminate", () => {
    expect(policyForCount(0, cfg)).toBe("NONE");
    expect(policyForCount(1, cfg)).toBe("WARNING");
    expect(policyForCount(2, cfg)).toBe("PAUSE_EXAM");
    expect(policyForCount(3, cfg)).toBe("TERMINATE_EXAM");
  });
});

describe("ViolationEngine debouncing", () => {
  test("NO_PERSON does not fire before its grace period", () => {
    const e = new ViolationEngine(cfg);
    // t=0..4000ms: below the 5000ms NO_PERSON threshold.
    for (let t = 0; t <= 4000; t += 500) {
      const tick = e.process(obs("NO_PERSON", true, t));
      expect(tick.events.filter((ev) => ev.kind === "violation")).toHaveLength(0);
    }
  });

  test("NO_PERSON fires exactly once after 5s persistence", () => {
    const e = new ViolationEngine(cfg);
    let fired = 0;
    for (let t = 0; t <= 6000; t += 500) {
      const tick = e.process(obs("NO_PERSON", true, t));
      fired += tick.events.filter((ev) => ev.kind === "violation").length;
    }
    expect(fired).toBe(1);
    expect(e.violationCount).toBe(1);
  });

  test("violation carries duration ≈ threshold and peak confidence", () => {
    const e = new ViolationEngine(cfg);
    let violation = null;
    for (let t = 0; t <= 6500; t += 500) {
      const tick = e.process(obs("NO_PERSON", true, t, 0.66));
      const v = tick.events.find((ev) => ev.kind === "violation");
      if (v) violation = v;
    }
    expect(violation).not.toBeNull();
    expect(violation!.durationMs).toBeGreaterThanOrEqual(5000);
    expect(violation!.confidence).toBe(0.66);
    expect(violation!.severity).toBe("HIGH");
  });

  test("no repeated violations per frame — one per continuous run", () => {
    const e = new ViolationEngine(cfg);
    let fired = 0;
    for (let t = 0; t <= 20_000; t += 500) {
      const tick = e.process(obs("PHONE_DETECTED", true, t));
      fired += tick.events.filter((ev) => ev.kind === "violation").length;
    }
    // 20s continuous phone → fires once at 2s, never again.
    expect(fired).toBe(1);
  });

  test("recovery resets the timer — brief glitch stays a non-violation", () => {
    const e = new ViolationEngine(cfg);
    // 3s person gone, then back for 1s, then gone again 3s: never 5s straight.
    let violations = 0;
    for (let t = 0; t <= 3000; t += 500)
      violations += e.process(obs("NO_PERSON", true, t)).events.filter((ev) => ev.kind === "violation").length;
    e.process(obs("NO_PERSON", false, 3100));
    for (let t = 3600; t <= 6600; t += 500)
      violations += e.process(obs("NO_PERSON", true, t)).events.filter((ev) => ev.kind === "violation").length;
    expect(violations).toBe(0);
    // Recovery event was recorded for the first run.
  });

  test("recovery resets and re-fires after a fresh full persistence", () => {
    const e = new ViolationEngine(cfg);
    let fired = 0;
    for (let t = 0; t <= 5000; t += 500)
      fired += e.process(obs("LOOKING_AWAY", true, t)).events.filter((ev) => ev.kind === "violation").length;
    const rec = e.process(obs("LOOKING_AWAY", false, 5100));
    expect(rec.events.some((ev) => ev.kind === "recovery")).toBe(true);
    for (let t = 5600; t <= 10_700; t += 500)
      fired += e.process(obs("LOOKING_AWAY", true, t)).events.filter((ev) => ev.kind === "violation").length;
    expect(fired).toBe(2);
    expect(e.violationCount).toBe(2);
  });

  test("unified counter across types drives the policy ladder", () => {
    const e = new ViolationEngine(cfg);
    // 1. tab switch (threshold 0 → immediate)
    const t1 = e.process(obs("TAB_SWITCH", true, 0));
    expect(t1.violationCount).toBe(1);
    expect(e.policy).toBe("WARNING");
    // 2. phone held 2s
    e.process(obs("PHONE_DETECTED", true, 100));
    const t2 = e.process(obs("PHONE_DETECTED", true, 2100));
    expect(t2.violationCount).toBe(2);
    expect(e.policy).toBe("PAUSE_EXAM");
    // 3. multiple persons 3s
    e.process(obs("MULTIPLE_PERSONS", true, 2200));
    const t3 = e.process(obs("MULTIPLE_PERSONS", true, 5200));
    expect(t3.violationCount).toBe(3);
    expect(e.policy).toBe("TERMINATE_EXAM");
  });

  test("sub-threshold confidence never fires", () => {
    const e = new ViolationEngine(cfg);
    for (let t = 0; t <= 8000; t += 500) {
      const tick = e.process(obs("PHONE_DETECTED", true, t, 0.3));
      expect(tick.events.filter((ev) => ev.kind === "violation")).toHaveLength(0);
    }
    expect(e.violationCount).toBe(0);
  });

  test("multiple persons fire after 3s", () => {
    const e = new ViolationEngine(cfg);
    let firedAt = -1;
    for (let t = 0; t <= 4000; t += 500) {
      const tick = e.process(obs("MULTIPLE_PERSONS", true, t));
      if (firedAt === -1 && tick.events.some((ev) => ev.kind === "violation"))
        firedAt = t;
    }
    expect(firedAt).toBe(3000);
  });

  test("risk score is monotone and saturating", () => {
    const e = new ViolationEngine(cfg);
    const r0 = e.riskScore();
    e.process(obs("TAB_SWITCH", true, 0));
    const r1 = e.riskScore();
    e.process(obs("WINDOW_BLUR", true, 10));
    const r2 = e.riskScore();
    expect(r0).toBeLessThan(r1);
    expect(r1).toBeLessThan(r2);
    expect(r2).toBeLessThan(1);
  });
});

describe("classifyFrame", () => {
  test("clean frame → no active conditions", () => {
    const r = classifyFrame(baseSample, {
      minConfidence: 0.55,
      phoneMode: "any_visible",
      identityVerificationEnabled: false,
    });
    const active = r.observations.filter((o) => o.active);
    expect(active).toHaveLength(0);
    expect(r.personCount).toBe(1);
    expect(r.phoneCount).toBe(0);
  });

  test("two persons → MULTIPLE_PERSONS active, presence ok", () => {
    const r = classifyFrame(
      { ...baseSample, persons: [person(0.3), person(0.7, 0.8)] },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: false },
    );
    const multi = r.observations.find((o) => o.type === "MULTIPLE_PERSONS")!;
    expect(multi.active).toBe(true);
    expect(multi.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test("phone visible → PHONE_DETECTED active with detector score", () => {
    const r = classifyFrame(
      { ...baseSample, phones: [phone(0.74)] },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: false },
    );
    const p = r.observations.find((o) => o.type === "PHONE_DETECTED")!;
    expect(p.active).toBe(true);
    expect(p.confidence).toBe(0.74);
  });

  test("phone held up + in_use_only mode → PHONE_IN_USE", () => {
    const r = classifyFrame(
      { ...baseSample, phones: [phone(0.8)] },
      { minConfidence: 0.55, phoneMode: "in_use_only", identityVerificationEnabled: false },
    );
    const p = r.observations.find((o) => o.type === "PHONE_IN_USE")!;
    expect(p.active).toBe(true);
  });

  test("no person and no face → NO_PERSON active, FACE_NOT_VISIBLE not", () => {
    const r = classifyFrame(
      { ...baseSample, persons: [], faces: [] },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: false },
    );
    expect(r.observations.find((o) => o.type === "NO_PERSON")!.active).toBe(true);
    expect(r.observations.find((o) => o.type === "FACE_NOT_VISIBLE")!.active).toBe(false);
  });

  test("person present but no face → FACE_NOT_VISIBLE", () => {
    const r = classifyFrame(
      { ...baseSample, faces: [] },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: false },
    );
    expect(r.observations.find((o) => o.type === "FACE_NOT_VISIBLE")!.active).toBe(true);
  });

  test("identity enabled + unverified person → IDENTITY_NOT_VERIFIED", () => {
    const r = classifyFrame(
      { ...baseSample, identityVerified: false },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: true },
    );
    expect(r.observations.find((o) => o.type === "IDENTITY_NOT_VERIFIED")!.active).toBe(true);
  });

  test("identity disabled never activates the identity condition", () => {
    const r = classifyFrame(
      { ...baseSample, identityVerified: false },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: false },
    );
    expect(r.observations.find((o) => o.type === "IDENTITY_NOT_VERIFIED")!.active).toBe(false);
  });

  test("gaze beyond threshold → LOOKING_AWAY", () => {
    const r = classifyFrame(
      { ...baseSample, gazeDeviation: 0.7 },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: false },
    );
    expect(r.observations.find((o) => o.type === "LOOKING_AWAY")!.active).toBe(true);
  });

  test("frame capture failure → CAMERA_ERROR", () => {
    const r = classifyFrame(
      { ...baseSample, frameOk: false },
      { minConfidence: 0.55, phoneMode: "any_visible", identityVerificationEnabled: false },
    );
    expect(r.observations.find((o) => o.type === "CAMERA_ERROR")!.active).toBe(true);
  });

  test("withOverrides merges threshold patches without mutating defaults", () => {
    const custom = withOverrides({ thresholds: { PHONE_DETECTED: 1000 } });
    expect(custom.thresholds.PHONE_DETECTED).toBe(1000);
    expect(custom.thresholds.NO_PERSON).toBe(cfg.thresholds.NO_PERSON);
    expect(cfg.thresholds.PHONE_DETECTED).toBe(2000);
  });
});

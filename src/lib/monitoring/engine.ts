/**
 * ViolationEngine — the unified violation-management service.
 *
 * Browser events and computer-vision detections both flow through this one
 * state machine. A raw detection only becomes a violation after it persists
 * beyond its configured threshold (debounce/grace), and a fired condition
 * cannot fire again until a recovery is observed, so frames never spam
 * duplicate violations.
 *
 * Pure and framework-free: feed observations with timestamps, get events
 * and the updated violation count back.
 */

import {
  SEVERITY_WEIGHT,
  type MonitoringConfig,
  type PolicyAction,
  type Severity,
  type ViolationSource,
  type ViolationType,
  violationSeverity,
  violationSource,
} from "./types";

/** One raw detection lane sample. */
export interface Observation {
  type: ViolationType;
  /** true = condition present in this sample, false = condition cleared. */
  active: boolean;
  confidence: number;
  timestamp: number;
}

/** Mutable per-type debounce state inside the engine. */
interface ConditionState {
  /** Continuous-presence start time; null when condition absent. */
  since: number | null;
  /** Highest confidence seen during the current continuous run. */
  peakConfidence: number;
  /** Whether a violation has already been emitted for this run. */
  fired: boolean;
}

/** Everything the engine reports after processing an observation batch. */
export interface EngineTick {
  events: EngineEventOutput[];
  violationCount: number;
  /** Currently active (debounced, not yet fired) conditions. */
  pending: Array<{ type: ViolationType; activeMs: number }>;
}

export interface EngineEventOutput {
  kind: "violation" | "recovery";
  type: ViolationType;
  source: ViolationSource;
  timestamp: number;
  confidence: number;
  durationMs: number;
  severity: Severity;
  detail?: string;
}

/** Policy ladder: what the server should do at a given violation count. */
export function policyForCount(
  count: number,
  config: MonitoringConfig,
): PolicyAction {
  if (count >= config.maxViolations) return "TERMINATE_EXAM";
  if (config.pauseViolations > 0 && count >= config.pauseViolations)
    return "PAUSE_EXAM";
  if (config.warnViolations > 0 && count >= config.warnViolations)
    return "WARNING";
  return "NONE";
}

/**
 * Stateful debouncing engine. One instance per exam session; keep it in a
 * ref for the lifetime of the session.
 */
export class ViolationEngine {
  private readonly config: MonitoringConfig;
  private readonly states = new Map<ViolationType, ConditionState>();
  private count = 0;

  constructor(config: MonitoringConfig) {
    this.config = config;
  }

  get violationCount(): number {
    return this.count;
  }

  get policy(): PolicyAction {
    return policyForCount(this.count, this.config);
  }

  /** Force-increment the counter (e.g. server-confirmed external violation). */
  addExternal(): void {
    this.count += 1;
  }

  /**
   * Process one sample. Emits violations for conditions that have now
   * persisted beyond their threshold, and recoveries for conditions that
   * cleared before or after firing.
   */
  process(obs: Observation): EngineTick {
    const events: EngineEventOutput[] = [];
    const st =
      this.states.get(obs.type) ??
      ({ since: null, peakConfidence: 0, fired: false } as ConditionState);

    if (obs.active) {
      if (st.since === null) {
        // Fresh run starts (previous run fully recovered).
        st.since = obs.timestamp;
        st.peakConfidence = obs.confidence;
        st.fired = false;
      } else {
        st.peakConfidence = Math.max(st.peakConfidence, obs.confidence);
      }

      const threshold = this.config.thresholds[obs.type] ?? 0;
      const activeMs = obs.timestamp - st.since;

      // Fire once per continuous run, only past the debounce threshold and
      // only if detector confidence meets the floor.
      if (
        !st.fired &&
        activeMs >= threshold &&
        obs.confidence >= this.config.minConfidence
      ) {
        st.fired = true;
        this.count += 1;
        events.push({
          kind: "violation",
          type: obs.type,
          source: violationSource(obs.type),
          timestamp: obs.timestamp,
          confidence: st.peakConfidence,
          durationMs: activeMs,
          severity: violationSeverity(obs.type),
        });
      }
    } else if (st.since !== null) {
      // Condition disappeared: recovery resets the timer.
      const activeMs = obs.timestamp - st.since;
      events.push({
        kind: "recovery",
        type: obs.type,
        source: violationSource(obs.type),
        timestamp: obs.timestamp,
        confidence: st.peakConfidence,
        durationMs: activeMs,
        severity: violationSeverity(obs.type),
      });
      this.states.set(obs.type, {
        since: null,
        peakConfidence: 0,
        fired: false,
      });
    } else {
      this.states.set(obs.type, st);
    }

    if (obs.active) this.states.set(obs.type, st);

    const pending: EngineTick["pending"] = [];
    for (const [type, s] of this.states) {
      if (s.since !== null && !s.fired) {
        pending.push({
          type,
          activeMs: obs.timestamp - s.since,
        });
      }
    }

    return { events, violationCount: this.count, pending };
  }

  /** Aggregate risk score in [0,1) — saturating weighted sum of fired violations. */
  riskScore(): number {
    let raw = 0;
    for (const [, s] of this.states) {
      if (s.fired) {
        // Weight is applied at emission time via severity; approximate here
        // using the count-based formula for a monotone score.
        raw += 1;
      }
    }
    // Count-weighted: more/severe violations approach 1 but never reach it.
    return 1 - Math.exp(-this.count / 3);
  }
}

/** Severity-weighted contribution of one violation (used for reporting). */
export function violationWeight(severity: Severity): number {
  return SEVERITY_WEIGHT[severity];
}

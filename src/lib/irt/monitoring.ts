/**
 * Academic-integrity risk engine — SEPARATE subsystem from assessment.
 *
 * This dimension consumes face verification, object detections, gaze/head
 * pose, browser and camera events. It produces risk scores, violations,
 * incidents, warnings, and evidence. It MUST NOT touch theta, P, a, b, T,
 * or V. (V is computed from visual-interaction data but is an assessment-
 * model variable, not an integrity signal.)
 *
 * A raw detection NEVER counts as a confirmed violation: events must exceed
 * configurable confidence thresholds and be temporally aggregated before
 * confirmation. The three-violation rule reads confirmed violations only.
 */

export type MonitoringEventType =
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "UNKNOWN_FACE"
  | "IDENTITY_MISMATCH"
  | "FACE_OBSTRUCTED"
  | "LOOKING_AWAY"
  | "EYES_CLOSED"
  | "EXCESSIVE_HEAD_MOVEMENT"
  | "PHONE_DETECTED"
  | "PROHIBITED_OBJECT"
  | "EXTRA_PERSON"
  | "CAMERA_DISCONNECTED"
  | "CAMERA_BLOCKED"
  | "TAB_SWITCH"
  | "WINDOW_BLUR"
  | "ENVIRONMENT_SUSPICIOUS";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface MonitoringEvent {
  /** Unique event id. */
  id: string;
  sessionId: string;
  studentId: string;
  /** Unix ms. */
  timestamp: number;
  type: MonitoringEventType;
  /** Detector confidence in [0, 1]. */
  confidence: number;
  severity: Severity;
  /** Optional evidence references (screenshot/video paths or data URLs). */
  screenshotPath?: string;
  videoPath?: string;
}

export interface MonitoringThresholds {
  /** Minimum confidence for an event to count as evidence. */
  minConfidence: number;
  /** Window (ms) over which same-type events aggregate toward confirmation. */
  aggregationWindowMs: number;
  /** Aggregate evidence weight within the window required for confirmation. */
  confirmationThreshold: number;
  /** Confirmed violations that trigger exam termination/lock. Default 3. */
  violationThreshold: number;
  /** Confirmed violations at which a final warning is issued. Default 2. */
  warningThreshold: number;
}

export const DEFAULT_MONITORING_THRESHOLDS: MonitoringThresholds = {
  minConfidence: 0.6,
  aggregationWindowMs: 60_000,
  confirmationThreshold: 3,
  violationThreshold: 3,
  warningThreshold: 2,
};

/**
 * Per-type base severity and relative evidence weight (how strongly one
 * event of this type contributes toward confirmation of a violation).
 */
const EVENT_WEIGHTS: Record<MonitoringEventType, { severity: Severity; weight: number; userMessage: string }> = {
  NO_FACE: { severity: "medium", weight: 1, userMessage: "Please make sure your face is visible to the camera." },
  MULTIPLE_FACES: { severity: "high", weight: 1.5, userMessage: "Multiple faces detected. You must be alone." },
  UNKNOWN_FACE: { severity: "high", weight: 1.5, userMessage: "Face verification failed. Please re-center your face." },
  IDENTITY_MISMATCH: { severity: "critical", weight: 2, userMessage: "Identity mismatch detected." },
  FACE_OBSTRUCTED: { severity: "medium", weight: 1, userMessage: "Your face appears obstructed. Please remove coverings." },
  LOOKING_AWAY: { severity: "low", weight: 0.75, userMessage: "Please look toward the examination screen." },
  EYES_CLOSED: { severity: "low", weight: 0.5, userMessage: "Please keep your eyes open." },
  EXCESSIVE_HEAD_MOVEMENT: { severity: "low", weight: 0.75, userMessage: "Please reduce excessive head movement." },
  PHONE_DETECTED: { severity: "high", weight: 1.5, userMessage: "Mobile phone detected. Please put it away." },
  PROHIBITED_OBJECT: { severity: "high", weight: 1.5, userMessage: "Prohibited object detected. Please remove it." },
  EXTRA_PERSON: { severity: "high", weight: 1.5, userMessage: "Another person detected in frame." },
  CAMERA_DISCONNECTED: { severity: "critical", weight: 2, userMessage: "Camera disconnected. Please reconnect it." },
  CAMERA_BLOCKED: { severity: "critical", weight: 2, userMessage: "Camera appears blocked." },
  TAB_SWITCH: { severity: "medium", weight: 1, userMessage: "Please stay on the examination page." },
  WINDOW_BLUR: { severity: "low", weight: 0.5, userMessage: "Please keep the exam window focused." },
  ENVIRONMENT_SUSPICIOUS: { severity: "medium", weight: 1, userMessage: "Suspicious activity detected in the environment." },
};

export function eventSeverity(type: MonitoringEventType): Severity {
  return EVENT_WEIGHTS[type].severity;
}

export function eventUserMessage(type: MonitoringEventType): string {
  return EVENT_WEIGHTS[type].userMessage;
}

/** Aggregated evidence for one event type across the session. */
interface TypeEvidence {
  count: number;
  weightSum: number;
  /** Evidence weight from events inside the freshness window only. */
  recentWeightSum: number;
  lastTimestamp: number;
}

/**
 * Ingests a chronological stream of events and produces a risk state:
 * aggregated evidence per type, confirmed violations, pending warnings, and
 * an overall normalized risk score. Pure function — recompute freely.
 */
export function evaluateIntegrity(
  events: MonitoringEvent[],
  thresholds: MonitoringThresholds = DEFAULT_MONITORING_THRESHOLDS,
  now: number = Date.now(),
): {
  confirmedViolations: number;
  confirmedTypes: MonitoringEventType[];
  warnings: string[];
  riskScore: number;
  perType: Record<string, TypeEvidence>;
  shouldTerminate: boolean;
  shouldWarn: boolean;
} {
  // Filter to evidential events and bucket by type within the window.
  const perType: Record<string, TypeEvidence> = {};
  const confirmedTypes: MonitoringEventType[] = [];
  let confirmedViolations = 0;

  for (const ev of events) {
    if (ev.confidence < thresholds.minConfidence) continue;
    const bucket = (perType[ev.type] ??= {
      count: 0,
      weightSum: 0,
      recentWeightSum: 0,
      lastTimestamp: 0,
    });
    const weighted = EVENT_WEIGHTS[ev.type].weight * ev.confidence;
    bucket.count += 1;
    bucket.weightSum += weighted;
    if (now - ev.timestamp <= thresholds.aggregationWindowMs) {
      bucket.recentWeightSum += weighted;
    }
    bucket.lastTimestamp = Math.max(bucket.lastTimestamp, ev.timestamp);
  }

  // Confirmation requires temporal AGGREGATION, not a single detection:
  // either enough evidential weight within the freshness window, or enough
  // persistent repetitions of the same type over the session.
  for (const [type, bucket] of Object.entries(perType)) {
    const recentWeight = bucket.recentWeightSum;
    const persistent = bucket.count >= thresholds.confirmationThreshold;
    if (recentWeight >= thresholds.confirmationThreshold || persistent) {
      confirmedTypes.push(type as MonitoringEventType);
      confirmedViolations += 1;
    }
  }

  // Risk score: saturating weighted sum over all evidential events.
  let riskRaw = 0;
  for (const [type, bucket] of Object.entries(perType)) {
    const typeRisk =
      EVENT_WEIGHTS[type as MonitoringEventType].weight * bucket.weightSum;
    riskRaw += typeRisk;
  }
  const riskScore = 1 - Math.exp(-riskRaw / 8);

  const warnings: string[] = confirmedTypes.map((t) => EVENT_WEIGHTS[t].userMessage);
  const shouldTerminate = confirmedViolations >= thresholds.violationThreshold;
  const shouldWarn =
    confirmedViolations >= thresholds.warningThreshold && !shouldTerminate;

  return {
    confirmedViolations,
    confirmedTypes,
    warnings,
    riskScore,
    perType,
    shouldTerminate,
    shouldWarn,
  };
}

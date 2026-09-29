/**
 * Unified exam monitoring — shared types and configuration.
 *
 * Two detection lanes feed ONE violation engine:
 *   • browser lane  — tab switch, blur, minimize, page exit (DOM events)
 *   • vision lane   — person/phone detection, face presence, identity
 *                     (webcam frames through the object-detection pipeline)
 *
 * A raw detection NEVER becomes a violation immediately: every condition must
 * persist beyond its configured threshold (grace/debounce period) before the
 * engine fires, and a fired condition cannot re-fire until it recovers.
 * All knobs live in MonitoringConfig so behavior changes without touching
 * engine logic.
 */

export type ViolationType =
  // Browser lane
  | "TAB_SWITCH"
  | "WINDOW_BLUR"
  | "BROWSER_MINIMIZED"
  | "LEFT_EXAM_PAGE"
  // Vision lane — presence / identity
  | "NO_PERSON"
  | "FACE_NOT_VISIBLE"
  | "MULTIPLE_PERSONS"
  | "IDENTITY_NOT_VERIFIED"
  // Vision lane — objects
  | "PHONE_DETECTED"
  | "PHONE_IN_USE"
  // Vision lane — attention
  | "LOOKING_AWAY"
  // Camera health
  | "CAMERA_DISABLED"
  | "CAMERA_ERROR";

export type ViolationSource = "browser" | "vision" | "camera";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Server-enforced policy ladder as the unified violation count grows. */
export type PolicyAction = "NONE" | "WARNING" | "PAUSE_EXAM" | "TERMINATE_EXAM";

/** Continuous identity state for the status panel. */
export type IdentityState =
  | "FACE_VERIFIED"
  | "NO_PERSON"
  | "FACE_NOT_VISIBLE"
  | "MULTIPLE_PERSONS"
  | "IDENTITY_NOT_VERIFIED";

/** A violation or recovery emitted by the engine. */
export interface EngineEvent {
  kind: "violation" | "recovery";
  type: ViolationType;
  source: ViolationSource;
  timestamp: number;
  /** Detector confidence at (or above) the configured floor. */
  confidence: number;
  /** How long the condition persisted before firing (ms). */
  durationMs: number;
  severity: Severity;
  detail?: string;
}

export interface MonitoringConfig {
  /** Minimum detector confidence for CV evidence to count. */
  minConfidence: number;
  /** Per-type persistence thresholds in ms (0 = fire on first observation). */
  thresholds: Record<ViolationType, number>;
  /** Unified count that issues a WARNING. */
  warnViolations: number;
  /** Unified count that pauses the exam. */
  pauseViolations: number;
  /** Unified count that terminates the exam. */
  maxViolations: number;
  /** Enable identity checks (v1 single user → effectively always verified). */
  identityVerificationEnabled: boolean;
  /** Count any visible phone as a violation, or only when held/in use. */
  phoneMode: "any_visible" | "in_use_only";
}

export const VIOLATION_TYPES: readonly ViolationType[] = [
  "TAB_SWITCH",
  "WINDOW_BLUR",
  "BROWSER_MINIMIZED",
  "LEFT_EXAM_PAGE",
  "NO_PERSON",
  "FACE_NOT_VISIBLE",
  "MULTIPLE_PERSONS",
  "IDENTITY_NOT_VERIFIED",
  "PHONE_DETECTED",
  "PHONE_IN_USE",
  "LOOKING_AWAY",
  "CAMERA_DISABLED",
  "CAMERA_ERROR",
];

/** Default thresholds per the monitoring spec (grace periods / debouncing). */
export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  minConfidence: 0.55,
  thresholds: {
    TAB_SWITCH: 0,
    WINDOW_BLUR: 0,
    BROWSER_MINIMIZED: 0,
    LEFT_EXAM_PAGE: 0,
    NO_PERSON: 5_000,
    FACE_NOT_VISIBLE: 4_000,
    MULTIPLE_PERSONS: 3_000,
    IDENTITY_NOT_VERIFIED: 5_000,
    PHONE_DETECTED: 2_000,
    PHONE_IN_USE: 1_500,
    LOOKING_AWAY: 5_000,
    CAMERA_DISABLED: 0,
    CAMERA_ERROR: 3_000,
  },
  warnViolations: 1,
  pauseViolations: 2,
  maxViolations: 3,
  identityVerificationEnabled: false,
  phoneMode: "any_visible",
};

/** Merge partial config overrides onto the defaults (config without boilerplate). */
export function withOverrides(
  overrides?: Partial<MonitoringConfig> & {
    thresholds?: Partial<Record<ViolationType, number>>;
  },
): MonitoringConfig {
  if (!overrides) return { ...DEFAULT_MONITORING_CONFIG };
  return {
    ...DEFAULT_MONITORING_CONFIG,
    ...overrides,
    thresholds: {
      ...DEFAULT_MONITORING_CONFIG.thresholds,
      ...(overrides.thresholds ?? {}),
    },
  };
}

type TypeMeta = {
  source: ViolationSource;
  severity: Severity;
  label: string;
  userMessage: string;
};

const TYPE_META: Record<ViolationType, TypeMeta> = {
  TAB_SWITCH: {
    source: "browser",
    severity: "MEDIUM",
    label: "Tab switch",
    userMessage: "Please stay on the examination page.",
  },
  WINDOW_BLUR: {
    source: "browser",
    severity: "LOW",
    label: "Window lost focus",
    userMessage: "Please keep the exam window focused.",
  },
  BROWSER_MINIMIZED: {
    source: "browser",
    severity: "MEDIUM",
    label: "Browser minimized",
    userMessage: "The exam window was minimized.",
  },
  LEFT_EXAM_PAGE: {
    source: "browser",
    severity: "MEDIUM",
    label: "Left exam page",
    userMessage: "You left the examination page.",
  },
  NO_PERSON: {
    source: "vision",
    severity: "HIGH",
    label: "Student not visible",
    userMessage: "You must remain visible to the camera.",
  },
  FACE_NOT_VISIBLE: {
    source: "vision",
    severity: "MEDIUM",
    label: "Face not visible",
    userMessage: "Please keep your face visible to the camera.",
  },
  MULTIPLE_PERSONS: {
    source: "vision",
    severity: "HIGH",
    label: "Multiple persons",
    userMessage: "Another person was detected in the frame. You must be alone.",
  },
  IDENTITY_NOT_VERIFIED: {
    source: "vision",
    severity: "CRITICAL",
    label: "Identity not verified",
    userMessage: "Identity verification failed.",
  },
  PHONE_DETECTED: {
    source: "vision",
    severity: "HIGH",
    label: "Phone detected",
    userMessage: "A mobile phone was detected. Please put it away.",
  },
  PHONE_IN_USE: {
    source: "vision",
    severity: "HIGH",
    label: "Phone in use",
    userMessage: "Using a phone during the exam is not allowed.",
  },
  LOOKING_AWAY: {
    source: "vision",
    severity: "LOW",
    label: "Looking away",
    userMessage: "Please look toward the examination screen.",
  },
  CAMERA_DISABLED: {
    source: "camera",
    severity: "HIGH",
    label: "Camera disabled",
    userMessage: "The camera was disconnected or disabled.",
  },
  CAMERA_ERROR: {
    source: "camera",
    severity: "MEDIUM",
    label: "Camera error",
    userMessage: "The camera feed could not be analyzed.",
  },
};

export function violationSource(type: ViolationType): ViolationSource {
  return TYPE_META[type].source;
}

export function violationSeverity(type: ViolationType): Severity {
  return TYPE_META[type].severity;
}

export function violationLabel(type: ViolationType): string {
  return TYPE_META[type].label;
}

export function violationUserMessage(type: ViolationType): string {
  return TYPE_META[type].userMessage;
}

/** Relative evidence weight per severity (feeds the aggregate risk score). */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  LOW: 0.5,
  MEDIUM: 1,
  HIGH: 1.5,
  CRITICAL: 2,
};

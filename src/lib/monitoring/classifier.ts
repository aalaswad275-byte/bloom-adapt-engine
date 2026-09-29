/**
 * FrameClassifier — turns raw computer-vision output (object detections +
 * face detections) into per-type observations for the ViolationEngine.
 *
 * Pure function of the latest sample; stateless — debounce lives in the
 * engine, thresholds live in config.
 */

import type { ViolationType } from "./types";

export interface Box {
  x: number;
  y: number;
  width: 1;
  height: 1;
}

export interface RawDetection {
  /** COCO class name, e.g. "person", "cell phone". */
  className: string;
  /** Normalized center position in [0,1] per axis. */
  center: { x: number; y: number };
  score: number;
}

export interface FaceInfo {
  /** Normalized center in [0,1]. */
  center: { x: number; y: number };
  /** Normalized box area in [0,1]. */
  area: number;
}

export interface FrameSample {
  /** Person detections from the object detector (COCO class "person"). */
  persons: RawDetection[];
  /** "cell phone" detections from the object detector. */
  phones: RawDetection[];
  /** Face boxes from the face detector (may be from FaceDetector or heuristic). */
  faces: FaceInfo[];
  /** Video frame capture worked (false → CAMERA_ERROR lane). */
  frameOk: boolean;
  /** Student identity verified by the backend (v1: single user → true). */
  identityVerified: boolean;
  /** Gaze/head-pose deviation proxy in [0,1] from the primary face. */
  gazeDeviation: number;
}

export interface FrameObservations {
  observations: Array<{ type: ViolationType; active: boolean; confidence: number }>;
  personCount: number;
  phoneCount: number;
}

const GAZE_AWAY_THRESHOLD = 0.45;

/**
 * Classify one frame into engine observations. Confidence comes from the
 * detector; the engine's minConfidence + per-type thresholds decide whether
 * it becomes a violation.
 */
export function classifyFrame(sample: FrameSample, cfg: {
  minConfidence: number;
  phoneMode: "any_visible" | "in_use_only";
  identityVerificationEnabled: boolean;
}): FrameObservations {
  const observations: FrameObservations["observations"] = [];
  const personCount = sample.persons.length;
  const phoneCount = sample.phones.length;

  // --- Presence ---
  const bestPerson = sample.persons.reduce<number>(
    (m, p) => Math.max(m, p.score),
    0,
  );
  observations.push({
    type: "NO_PERSON",
    active: personCount === 0,
    // Confidence that the frame truly lacks a person grows with clarity of
    // the (absent) detection — use frame quality as a proxy.
    confidence: personCount === 0 ? Math.max(0.6, sample.frameOk ? 0.8 : 0.6) : bestPerson,
  });

  // --- Face visibility (face detector vs person detector agreement) ---
  const faceCount = sample.faces.length;
  observations.push({
    type: "FACE_NOT_VISIBLE",
    active: personCount >= 1 && faceCount === 0,
    confidence: personCount >= 1 && faceCount === 0 ? Math.max(0.6, bestPerson) : faceCount > 0 ? 0.9 : 0.5,
  });

  // --- Multiple persons ---
  observations.push({
    type: "MULTIPLE_PERSONS",
    active: personCount >= 2,
    confidence: personCount >= 2 ? Math.max(...sample.persons.slice(0, 2).map((p) => p.score)) : 0.9,
  });

  // --- Phone ---
  const strongestPhone = sample.phones.reduce<number>((m, p) => Math.max(m, p.score), 0);
  if (cfg.phoneMode === "in_use_only") {
    // Heuristic "in use": phone in the upper 2/3 of the frame (held up),
    // or overlapping the student's head area.
    const inUse = sample.phones.some(
      (p) => p.center.y < 2 / 3,
    );
    observations.push({
      type: "PHONE_IN_USE",
      active: inUse,
      confidence: inUse ? strongestPhone : 0.9,
    });
  } else {
    observations.push({
      type: "PHONE_DETECTED",
      active: phoneCount > 0,
      confidence: phoneCount > 0 ? strongestPhone : 0.9,
    });
  }

  // --- Identity ---
  observations.push({
    type: "IDENTITY_NOT_VERIFIED",
    active:
      cfg.identityVerificationEnabled &&
      personCount >= 1 &&
      !sample.identityVerified,
    confidence: cfg.identityVerificationEnabled ? 0.9 : 0,
  });

  // --- Attention ---
  observations.push({
    type: "LOOKING_AWAY",
    active: personCount >= 1 && sample.gazeDeviation > GAZE_AWAY_THRESHOLD,
    confidence: personCount >= 1 ? Math.min(1, sample.gazeDeviation + 0.3) : 0,
  });

  // --- Camera health ---
  observations.push({
    type: "CAMERA_ERROR",
    active: !sample.frameOk,
    confidence: 0.9,
  });

  return { observations, personCount, phoneCount };
}

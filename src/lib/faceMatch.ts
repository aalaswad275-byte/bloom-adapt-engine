/**
 * Face verification against the student's stored identity image.
 *
 * Uses @vladmandic/face-api (TinyFaceDetector + 68 landmarks + ResNet
 * recognition) to compute 128-d face descriptors for the stored identity
 * photo and the live webcam frame, then compares them with euclidean
 * distance. The models are vendored in /public/face-models.
 */

import { euclideanDistance } from "@vladmandic/face-api";
import type { LabeledFaceDescriptors } from "@vladmandic/face-api";

type FaceApi = typeof import("@vladmandic/face-api");

export type FaceMatchResult =
  | { outcome: "match"; distance: number; threshold: number }
  | { outcome: "mismatch"; distance: number; threshold: number }
  | { outcome: "no_face" }
  | { outcome: "error"; message: string };

export type FaceMatcherState = {
  /** true when the reference identity descriptor is loaded. */
  ready: boolean;
  reference: LabeledFaceDescriptors | null;
};

/** Similarity threshold — distances ≤ this count as the same person. */
export const FACE_MATCH_THRESHOLD = 0.5;

/**
 * Configurable similarity threshold for pre-assessment verification: the
 * best euclidean distance between the live descriptor and any registered
 * pose descriptor must be ≤ this to pass.
 */
export const FACE_VERIFY_THRESHOLD = 0.55;

/** Similarity 0–1 for display (distance 0 → 100%, ≥0.8 → 0%). */
export function distanceToSimilarity(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 0.8));
}

/** The 7 registration poses, in capture order. */
export const FACE_POSES = [
  { key: "center", label: "Look straight ahead", hint: "Face the camera directly" },
  { key: "slight_left", label: "Look slightly left", hint: "Turn your head a little to your left" },
  { key: "slight_right", label: "Look slightly right", hint: "Turn your head a little to your right" },
  { key: "far_left", label: "Turn further left", hint: "Turn your head clearly to your left" },
  { key: "far_right", label: "Turn further right", hint: "Turn your head clearly to your right" },
  { key: "slight_up", label: "Look slightly up", hint: "Raise your chin a little" },
  { key: "slight_down", label: "Look slightly down", hint: "Lower your chin a little" },
] as const;

export type FacePoseKey = (typeof FACE_POSES)[number]["key"];

/** Student-facing instructions for each live-verification issue. */
export const FACE_ISSUES: Record<string, string> = {
  no_face: "No face detected — center your face in the frame.",
  multiple_faces:
    "Multiple faces detected — make sure you are alone in the frame.",
  too_far: "Move closer to the camera — your face is too small.",
  too_close: "Move back a little — you are too close to the camera.",
  off_center: "Center your face in the frame.",
  poor_lighting:
    "Improve the lighting — your face is too dark or washed out.",
};

/** All pose keys the student must register before taking assessments. */
export const FACE_POSE_KEYS = FACE_POSES.map((p) => p.key) as FacePoseKey[];

/** Face too small (< 15% of frame width) or too large (> 80%). */
const SIZE_MIN = 0.15;
const SIZE_MAX = 0.8;
/** Face box center must stay within the middle 80% of the frame. */
const CENTER_MARGIN = 0.1;
/** Acceptable mean luma of the face region (0–255). */
const LUMA_MIN = 45;
const LUMA_MAX = 228;

let lumaCanvas: HTMLCanvasElement | null = null;

/** Mean luma (0–255) of the face box region — flags poor lighting. */
function faceLuma(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
): number {
  if (!lumaCanvas) lumaCanvas = document.createElement("canvas");
  const c = lumaCanvas;
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return 128;
  g.drawImage(
    video,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    32,
    32,
  );
  const data = g.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4);
}

export type LiveFaceAssessment =
  | { ok: true; descriptor: number[]; pose: FacePoseKey | null }
  | { ok: false; issue: "no_face" | "multiple_faces" | "too_far" | "too_close" | "off_center" | "poor_lighting" };

/**
 * Analyze the live video frame with the project's CV pipeline
 * (TinyFaceDetector — a YOLO-family single-shot detector — plus 68
 * landmarks and the ResNet recognition net for 128-d embeddings).
 * Enforces: exactly one face, good size/position, usable lighting;
 * classifies the head pose from landmarks.
 */
export async function analyzeLiveFace(
  faceapi: FaceApi,
  video: HTMLVideoElement,
): Promise<LiveFaceAssessment> {
  const detections = await faceapi
    .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions(TINY_OPTIONS))
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (detections.length === 0) return { ok: false, issue: "no_face" };
  if (detections.length > 1) return { ok: false, issue: "multiple_faces" };

  const det = detections[0];
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const box = det.detection.box;
  const sizeFrac = box.width / vw;
  if (sizeFrac < SIZE_MIN) return { ok: false, issue: "too_far" };
  if (sizeFrac > SIZE_MAX) return { ok: false, issue: "too_close" };
  const cx = box.x + box.width / 2;
  if (cx < vw * CENTER_MARGIN || cx > vw * (1 - CENTER_MARGIN))
    return { ok: false, issue: "off_center" };
  const luma = faceLuma(video, {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });
  if (luma < LUMA_MIN || luma > LUMA_MAX)
    return { ok: false, issue: "poor_lighting" };

  return {
    ok: true,
    descriptor: Array.from(det.descriptor),
    pose: classifyPose(det.landmarks.positions),
  };
}

export type LandmarkPoint = { x: number; y: number };

/**
 * Classify head pose from 68 landmarks using yaw (jaw asymmetry around the
 * nose) and pitch (nose-tip position between eyes and mouth).
 * yaw > 1 → student's left; yaw < 1 → student's right.
 */
export function classifyPose(pts: LandmarkPoint[]): FacePoseKey | null {
  if (pts.length < 68) return null;
  const nose = pts[30];
  const jawL = pts[0]; // image-left jaw
  const jawR = pts[16]; // image-right jaw
  const d = (a: LandmarkPoint, b: LandmarkPoint) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const yaw = d(nose, jawL) / (d(nose, jawR) || 1);

  let eyeY = 0;
  for (let i = 36; i <= 45; i++) eyeY += pts[i].y;
  eyeY /= 10;
  let mouthY = 0;
  for (let i = 48; i <= 59; i++) mouthY += pts[i].y;
  mouthY /= 12;
  const span = mouthY - eyeY;
  const pitch = span > 1 ? (nose.y - eyeY) / span : 0.6;

  if (yaw > 1.6) return "far_left";
  if (yaw < 0.62) return "far_right";
  if (yaw >= 1.12) return "slight_left";
  if (yaw <= 0.87) return "slight_right";
  if (pitch < 0.52) return "slight_up";
  if (pitch > 0.72) return "slight_down";
  return "center";
}

/**
 * Compare a live 128-d descriptor against every registered pose embedding.
 * Passes when the BEST (smallest) distance is within the configured
 * threshold — any registered angle matching counts as verified.
 */
export function bestEmbeddingMatch(
  descriptor: number[],
  stored: number[][],
): { bestDistance: number; similarity: number; passed: boolean } {
  let best = Infinity;
  for (const s of stored) {
    if (s.length !== descriptor.length) continue;
    const d = Math.hypot(
      ...descriptor.map((v, i) => v - (s[i] ?? 0)),
    );
    if (d < best) best = d;
  }
  if (!Number.isFinite(best))
    return { bestDistance: Infinity, similarity: 0, passed: false };
  return {
    bestDistance: best,
    similarity: distanceToSimilarity(best),
    passed: best <= FACE_VERIFY_THRESHOLD,
  };
}

let loadingPromise: Promise<FaceApi> | null = null;

/** Load face-api + models once (tiny detector, 68 landmarks, recognition). */
export async function loadFaceApi(): Promise<FaceApi> {
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const faceapi = await import("@vladmandic/face-api");
      const MODEL_URL = "/face-models";
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      return faceapi;
    })().catch((err) => {
      loadingPromise = null;
      throw err;
    });
  }
  return loadingPromise;
}

const TINY_OPTIONS = { inputSize: 320, scoreThreshold: 0.4 };

/** Single-face detection (with descriptor) on an image/video/canvas. */
export async function detectSingleFace(
  faceapi: FaceApi,
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
) {
  const res = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions(TINY_OPTIONS))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return res;
}

export type DetectedFaceWithDescriptor = NonNullable<
  Awaited<ReturnType<typeof detectSingleFace>>
>;

/**
 * Build the reference descriptor from the student's stored identity image
 * (fetched via its Convex storage URL). Returns null when no face is found.
 */
export async function buildReferenceDescriptor(
  imageUrl: string,
): Promise<LabeledFaceDescriptors | null> {
  const faceapi = await loadFaceApi();
  const img = await faceapi.fetchImage(imageUrl);
  const det = await detectSingleFace(faceapi, img);
  if (!det) return null;
  return new faceapi.LabeledFaceDescriptors("student", [det.descriptor]);
}

/**
 * Verify the live camera frame against the reference descriptor.
 * outcome "match" means the person in frame is the student.
 */
export async function verifyFace(
  state: FaceMatcherState,
  video: HTMLVideoElement,
): Promise<FaceMatchResult> {
  if (!state.ready || !state.reference) {
    return { outcome: "error", message: "Identity reference not loaded" };
  }
  try {
    const faceapi = await loadFaceApi();
    const det = await detectSingleFace(faceapi, video);
    if (!det) return { outcome: "no_face" };
    const distance = euclideanDistance(
      det.descriptor,
      state.reference.descriptors[0],
    );
    return {
      outcome: distance <= FACE_MATCH_THRESHOLD ? "match" : "mismatch",
      distance,
      threshold: FACE_MATCH_THRESHOLD,
    };
  } catch (err) {
    return {
      outcome: "error",
      message: err instanceof Error ? err.message : "Face verification failed",
    };
  }
}

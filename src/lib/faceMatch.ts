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

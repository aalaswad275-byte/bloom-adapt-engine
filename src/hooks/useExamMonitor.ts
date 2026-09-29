/**
 * useExamMonitor — browser-side student monitoring (v1 adapter).
 *
 * v1 scope: quiz engine + integrity monitoring. This hook implements the
 * browser-available subset of the monitoring subsystem:
 *
 *   • face-position sampling via the native FaceDetector API when present
 *     (graceful neutral fallback otherwise) → gazeDeviation proxy + face
 *     presence ratio feeding V_{i,t}
 *   • tab-switch / window-blur / camera-loss detection → integrity events
 *     ingested through the backend risk engine (never touches theta)
 *
 * The returned getIntegrationSnapshot() matches the VisualInteractionSample
 * contract, so a real YOLO/MediaPipe model can replace the internals later
 * without touching the assessment pipeline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ZERO_INTERACTION, type VisualInteractionSample } from "@/lib/irt";

interface MonitorOptions {
  sessionId: Id<"examSessions"> | null;
  enabled: boolean;
}

export interface MonitorStatus {
  cameraReady: boolean;
  cameraError: string | null;
  facePresent: boolean;
  faceConfidence: number;
  eventsEmitted: number;
}

interface DetectedFace {
  boundingBox: DOMRectReadOnly;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function freshSamples() {
  return {
    frames: 0,
    faceFrames: 0,
    gazeDeviationSum: 0,
    tabSwitches: 0,
    cameraLosses: 0,
  };
}

export function useExamMonitor({ sessionId, enabled }: MonitorOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{
    detect: (input: HTMLVideoElement) => Promise<DetectedFace[]>;
  } | null>(null);
  const timerRef = useRef<number | null>(null);
  const ingest = useMutation(api.monitoring.ingestEvent);

  const samplesRef = useRef(freshSamples());
  const [status, setStatus] = useState<MonitorStatus>({
    cameraReady: false,
    cameraError: null,
    facePresent: false,
    faceConfidence: 0,
    eventsEmitted: 0,
  });

  const emit = useCallback(
    (type: string, confidence: number, detail?: string) => {
      if (!sessionId) return;
      samplesRef.current.tabSwitches += type === "TAB_SWITCH" ? 1 : 0;
      samplesRef.current.cameraLosses += type === "CAMERA_DISCONNECTED" ? 1 : 0;
      setStatus((s) => ({ ...s, eventsEmitted: s.eventsEmitted + 1 }));
      ingest({ sessionId, type, confidence, detail }).catch((err) =>
        console.warn("[monitor] event emit failed", err),
      );
    },
    [sessionId, ingest],
  );

  // ------- Camera setup -------
  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus((s) => ({ ...s, cameraReady: true, cameraError: null }));

        const FD = (
          window as unknown as {
            FaceDetector?: new (opts?: unknown) => {
              detect: (input: HTMLVideoElement) => Promise<DetectedFace[]>;
            };
          }
        ).FaceDetector;
        if (FD) {
          try {
            detectorRef.current = new FD({ fastMode: true, maxDetectedFaces: 4 });
          } catch {
            detectorRef.current = null;
          }
        }
      } catch (err) {
        if (cancelled) return;
        setStatus((s) => ({
          ...s,
          cameraError:
            err instanceof Error
              ? err.message
              : "Camera unavailable or permission denied",
        }));
      }
    }
    void start();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      detectorRef.current = null;
    };
  }, [enabled, sessionId]);

  // ------- Sampling loop: face position → gaze proxy for V -------
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const tick = async () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && streamRef.current) {
        let facePresent = false;
        let gazeDeviation = 0;
        const det = detectorRef.current;
        if (det) {
          try {
            const faces = await det.detect(video);
            facePresent = faces.length > 0;
            if (faces.length > 0) {
              const box = faces[0].boundingBox;
              const cx = (box.x + box.width / 2) / (video.videoWidth || 320);
              const cy = (box.y + box.height / 2) / (video.videoHeight || 240);
              gazeDeviation = Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) * 2.2);
            }
          } catch {
            facePresent = false;
          }
        }

        const s = samplesRef.current;
        s.frames += 1;
        if (facePresent) s.faceFrames += 1;
        s.gazeDeviationSum += gazeDeviation;

        setStatus((prev) => ({
          ...prev,
          facePresent,
          faceConfidence: facePresent ? 0.8 : 0,
        }));
      }
    };

    timerRef.current = window.setInterval(() => void tick(), 500);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [enabled, sessionId]);

  // ------- Tab / blur / camera-loss integrity events -------
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const onVisibility = () => {
      if (document.hidden) {
        emit("TAB_SWITCH", 0.9, "document became hidden during exam");
      }
    };
    const onBlur = () => {
      emit("WINDOW_BLUR", 0.7, "exam window lost focus");
    };
    const onCameraEnd = (e: Event) => {
      const track = e.target as MediaStreamTrack;
      if (track.kind === "video") {
        emit("CAMERA_DISCONNECTED", 1.0, "webcam track ended");
        setStatus((s) => ({
          ...s,
          cameraReady: false,
          cameraError: "Camera disconnected",
        }));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    const track = streamRef.current?.getVideoTracks()[0];
    track?.addEventListener("ended", onCameraEnd);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      track?.removeEventListener("ended", onCameraEnd);
    };
  }, [enabled, sessionId, emit]);

  /** Call when a new question is displayed. Resets per-item aggregates. */
  const beginItem = useCallback(() => {
    samplesRef.current = freshSamples();
  }, []);

  /**
   * Per-item interaction snapshot for V_{i,t}. All components in [0,1];
   * neutral zeros when the camera was never available so V stays honest.
   */
  const getIntegrationSnapshot = useCallback((): VisualInteractionSample => {
    const s = samplesRef.current;
    if (!s.frames) return { ...ZERO_INTERACTION };
    return {
      gazeDeviation: clamp01(s.gazeDeviationSum / s.frames),
      attentionToQuestion: clamp01(s.faceFrames / s.frames),
      abnormalInteraction: clamp01(
        s.tabSwitches * 0.5 + s.cameraLosses * 0.5,
      ),
    };
  }, []);

  return {
    videoRef,
    status,
    beginItem,
    getIntegrationSnapshot,
  };
}

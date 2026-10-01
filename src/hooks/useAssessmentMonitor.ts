/**
 * useAssessmentMonitor — self-contained proctoring for class assessments.
 *
 * Same two-lane pipeline as useExamMonitor (browser + webcam/CV) with the
 * shared ViolationEngine for debouncing, but writes to the assessment
 * submission's own violation log via ingestAssessmentViolations, whose
 * server-side policy ladder (WARNING → PAUSE_EXAM → TERMINATE_EXAM) is the
 * source of truth. No sessionId/examSessions involvement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DEFAULT_MONITORING_CONFIG,
  ViolationEngine,
  classifyFrame,
  type RawDetection,
} from "@/lib/monitoring";

interface MonitorOptions {
  submissionId: Id<"assessmentSubmissions"> | null;
  enabled: boolean;
}

export interface AssessmentMonitorStatus {
  cameraState: "connecting" | "connected" | "error";
  cameraError: string | null;
  cvMode: "coco-ssd" | "facedetector" | "off";
  personCount: number;
  phoneCount: number;
  browserFocused: boolean;
  violationCount: number;
  policy: string;
  terminated: boolean;
}

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}

const SAMPLE_INTERVAL_MS = 600;
const FLUSH_INTERVAL_MS = 4_000;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function useAssessmentMonitor({
  submissionId,
  enabled,
}: MonitorOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const queueRef = useRef<
    Array<{ type: string; confidence: number; durationMs?: number }>
  >([]);
  const cvBusyRef = useRef(false);

  const detectorRef = useRef<{
    detect: (input: HTMLVideoElement) => Promise<DetectedFace[]>;
  } | null>(null);
  const cocoRef = useRef<{
    detect: (input: HTMLVideoElement) => Promise<
      Array<{ class: string; score: number; bbox: [number, number, number, number] }>
    >;
  } | null>(null);

  const ingest = useMutation(api.studentAssessments.ingestAssessmentViolations);

  const engine = useMemo(() => new ViolationEngine(DEFAULT_MONITORING_CONFIG), []);

  const [status, setStatus] = useState<AssessmentMonitorStatus>({
    cameraState: "connecting",
    cameraError: null,
    cvMode: "off",
    personCount: 0,
    phoneCount: 0,
    browserFocused: true,
    violationCount: 0,
    policy: "NONE",
    terminated: false,
  });

  const queueEvent = useCallback(
    (ev: { type: string; confidence: number; durationMs: number }) => {
      queueRef.current.push(ev);
    },
    [],
  );

  // -------- Batched flush to the server (policy ladder lives server-side) ----
  useEffect(() => {
    if (!submissionId || !enabled) return;
    flushTimerRef.current = window.setInterval(() => {
      const batch = queueRef.current;
      if (batch.length === 0) return;
      queueRef.current = [];
      ingest({ submissionId, events: batch })
        .then((res) => {
          if (res?.ok) {
            setStatus((s) => ({
              ...s,
              violationCount: res.violationCount ?? s.violationCount,
              policy: res.policyAction ?? s.policy,
              terminated: res.terminated || s.terminated,
            }));
          }
        })
        .catch(() => undefined);
    }, FLUSH_INTERVAL_MS);
    return () => {
      if (flushTimerRef.current !== null)
        window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    };
  }, [submissionId, enabled, ingest]);

  // -------- Browser lane --------
  useEffect(() => {
    if (!submissionId || !enabled) return;

    const fireOnce = (type: string, confidence: number) => {
      const t1 = engine.process({
        type: type as never,
        active: true,
        confidence,
        timestamp: Date.now(),
      });
      t1.events.forEach((ev) =>
        queueEvent({
          type: ev.type,
          confidence: ev.confidence,
          durationMs: Math.round(ev.durationMs),
        }),
      );
      engine.process({
        type: type as never,
        active: false,
        confidence: 0,
        timestamp: Date.now() + 1,
      });
    };

    const onVisibility = () => {
      if (document.hidden) fireOnce("TAB_SWITCH", 0.95);
    };
    const onBlur = () => fireOnce("WINDOW_BLUR", 0.7);
    const onMinimize = () => {
      if (window.outerWidth === 0 && window.outerHeight === 0)
        fireOnce("BROWSER_MINIMIZED", 0.9);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onMinimize);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onMinimize);
    };
  }, [submissionId, enabled, engine, queueEvent]);

  // -------- Camera + model setup --------
  useEffect(() => {
    if (!submissionId || !enabled) return;
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
        setStatus((s) => ({ ...s, cameraState: "connected", cameraError: null }));

        // COCO-SSD for person/phone detection (loads async).
        void (async () => {
          try {
            const tf = await import("@tensorflow/tfjs");
            await tf.ready();
            const cocoSsd = await import("@tensorflow-models/coco-ssd");
            const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
            if (cancelled) return;
            cocoRef.current = model;
            setStatus((s) => ({ ...s, cvMode: "coco-ssd" }));
          } catch {
            if (!cancelled)
              setStatus((s) => ({ ...s, cvMode: "facedetector" }));
          }
        })();

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
          cameraState: "error",
          cameraError:
            err instanceof Error
              ? err.message
              : "Camera unavailable or permission denied",
        }));
        queueEvent({
          type: "CAMERA_DISABLED",
          confidence: 1,
          durationMs: 0,
        });
      }
    }
    void start();

    return () => {
      cancelled = true;
      if (sampleTimerRef.current !== null)
        window.clearInterval(sampleTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      cocoRef.current = null;
      detectorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId, enabled]);

  // -------- Sampling loop: frame → detections → engine --------
  useEffect(() => {
    if (!submissionId || !enabled) return;

    const tick = async () => {
      const video = videoRef.current;
      const stream = streamRef.current;
      if (!video || !stream || video.readyState < 2 || cvBusyRef.current) return;
      cvBusyRef.current = true;
      const now = Date.now();

      try {
        let persons: RawDetection[] = [];
        let phones: RawDetection[] = [];

        const coco = cocoRef.current;
        if (coco) {
          try {
            const preds = await coco.detect(video);
            const w = video.videoWidth || 320;
            const h = video.videoHeight || 240;
            for (const p of preds) {
              const det: RawDetection = {
                className: p.class,
                score: p.score,
                center: {
                  x: (p.bbox[0] + p.bbox[2] / 2) / w,
                  y: (p.bbox[1] + p.bbox[3] / 2) / h,
                },
              };
              if (
                (p.class === "person" || p.class === "cell phone") &&
                p.score >= DEFAULT_MONITORING_CONFIG.minConfidence
              ) {
                if (p.class === "person") persons.push(det);
                else phones.push(det);
              }
            }
          } catch {
            /* transient TF failure */
          }
        }

        const faces: Array<{ center: { x: number; y: number }; area: number }> = [];
        let gazeDeviation = 0;
        const fd = detectorRef.current;
        if (fd) {
          try {
            const detected = await fd.detect(video);
            const w = video.videoWidth || 320;
            const h = video.videoHeight || 240;
            for (const f of detected) {
              faces.push({
                center: {
                  x: (f.boundingBox.x + f.boundingBox.width / 2) / w,
                  y: (f.boundingBox.y + f.boundingBox.height / 2) / h,
                },
                area: (f.boundingBox.width / w) * (f.boundingBox.height / h),
              });
            }
            if (faces.length > 0) {
              const b = faces[0].center;
              gazeDeviation = clamp01(Math.hypot(b.x - 0.5, b.y - 0.5) * 2.2);
            }
          } catch {
            /* fall through */
          }
        }

        const sample = {
          persons,
          phones,
          faces,
          frameOk: true,
          identityVerified: true,
          gazeDeviation,
        };
        const cls = classifyFrame(sample, DEFAULT_MONITORING_CONFIG);

        for (const o of cls.observations) {
          const t = engine.process({
            type: o.type,
            active: o.active,
            confidence: o.confidence,
            timestamp: now,
          });
          t.events.forEach((ev) =>
            queueEvent({
              type: ev.type,
              confidence: ev.confidence,
              durationMs: Math.round(ev.durationMs),
            }),
          );
        }

        setStatus((prev) => ({
          ...prev,
          personCount: cls.personCount,
          phoneCount: cls.phoneCount,
          violationCount: engine.violationCount,
        }));
      } finally {
        cvBusyRef.current = false;
      }
    };

    sampleTimerRef.current = window.setInterval(
      () => void tick(),
      SAMPLE_INTERVAL_MS,
    );
    return () => {
      if (sampleTimerRef.current !== null)
        window.clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    };
  }, [submissionId, enabled, engine, queueEvent]);

  return { videoRef, status };
}

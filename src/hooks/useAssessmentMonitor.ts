/**
 * useAssessmentMonitor — self-contained proctoring for class assessments.
 *
 * Same two-lane pipeline as useExamMonitor (browser + webcam/YOLO26n) with the
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
  loadBrowserObjectDetector,
  type BrowserObjectDetector,
} from "@/lib/monitoring/browserDetector";
import { YoloMonitorClient, type YoloDetection } from "@/lib/monitoring/yoloClient";
import {
  ASSESSMENT_PROCTOR_CONFIG,
  ViolationEngine,
  classifyFrame,
  type MonitorDetectionBox,
  type RawDetection,
} from "@/lib/monitoring";

interface MonitorOptions {
  submissionId: Id<"assessmentSubmissions"> | null;
  enabled: boolean;
}

export interface AssessmentMonitorStatus {
  cameraState: "connecting" | "connected" | "error";
  cameraError: string | null;
  cvMode: "yolo26n" | "coco-ssd" | "facedetector" | "off";
  personCount: number;
  phoneCount: number;
  boxes: MonitorDetectionBox[];
  browserFocused: boolean;
  /** Continuous blur duration (ms) — WINDOW_BLUR only fires after 10 min. */
  blurActiveMs: number;
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
  const focusedRef = useRef(true);

  const detectorRef = useRef<{
    detect: (input: HTMLVideoElement) => Promise<DetectedFace[]>;
  } | null>(null);
  const cocoRef = useRef<BrowserObjectDetector | null>(null);
  const yoloRef = useRef<YoloMonitorClient | null>(null);

  const ingest = useMutation(api.studentAssessments.ingestAssessmentViolations);

  const engine = useMemo(
    () => new ViolationEngine(ASSESSMENT_PROCTOR_CONFIG),
    [],
  );

  const [status, setStatus] = useState<AssessmentMonitorStatus>({
    cameraState: "connecting",
    cameraError: null,
    cvMode: "off",
    personCount: 0,
    phoneCount: 0,
    boxes: [],
    browserFocused: true,
    blurActiveMs: 0,
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
  }, [submissionId, enabled, ingest]);  // -------- Browser lane --------
  // Only TAB_SWITCH / BROWSER_MINIMIZED fire immediately. WINDOW_BLUR is a
  // SUSTAINED condition: the flag is recorded here and the sampling loop
  // feeds it through the engine every tick, so it only becomes a violation
  // after the configured 10-minute threshold of continuous blur.
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
    const onBlur = () => {
      focusedRef.current = false;
      setStatus((s) => ({ ...s, browserFocused: false }));
    };
    const onFocus = () => {
      focusedRef.current = true;
      setStatus((s) => ({ ...s, browserFocused: true }));
    };
    const onMinimize = () => {
      if (window.outerWidth === 0 && window.outerHeight === 0)
        fireOnce("BROWSER_MINIMIZED", 0.9);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("resize", onMinimize);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
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

        // YOLO26n service is primary. COCO-SSD loads in-browser only when the
        // service is unreachable, preserving monitoring availability.
        void (async () => {
          const yolo = new YoloMonitorClient();
          try {
            await yolo.connect();
            if (cancelled) {
              yolo.close();
              return;
            }
            yoloRef.current = yolo;
            setStatus((s) => ({ ...s, cvMode: "yolo26n" }));
            return;
          } catch {
            yolo.close();
            if (cancelled) return;
          }

          try {
            const model = await loadBrowserObjectDetector();
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
      yoloRef.current?.close();
      yoloRef.current = null;
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
        let boxes: MonitorDetectionBox[] = [];

        const asRaw = (detection: YoloDetection): RawDetection => ({
          className: detection.className,
          score: detection.confidence,
          center: {
            x: detection.bbox.x + detection.bbox.width / 2,
            y: detection.bbox.y + detection.bbox.height / 2,
          },
          bbox: detection.bbox,
        });

        let yolo = yoloRef.current;
        if (yolo && !yolo.isOpen) {
          yolo.close();
          yoloRef.current = null;
          yolo = null;
          setStatus((s) => ({ ...s, cvMode: "facedetector", boxes: [] }));
          void loadBrowserObjectDetector()
            .then((model) => {
              cocoRef.current = model;
              setStatus((s) => ({ ...s, cvMode: "coco-ssd" }));
            })
            .catch(() => undefined);
          return;
        }
        if (yolo) {
          const result = await yolo.detect(video);
          if (!result) return;
          const min = ASSESSMENT_PROCTOR_CONFIG.minConfidence;
          for (const detection of result.persons) {
            if (detection.confidence < min) continue;
            persons.push(asRaw(detection));
            boxes.push({
              className: "person",
              confidence: detection.confidence,
              ...detection.bbox,
            });
          }
          for (const detection of result.phones) {
            if (detection.confidence < min) continue;
            phones.push(asRaw(detection));
            boxes.push({
              className: "cell phone",
              confidence: detection.confidence,
              ...detection.bbox,
            });
          }
        } else {
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
                  bbox: {
                    x: p.bbox[0] / w,
                    y: p.bbox[1] / h,
                    width: p.bbox[2] / w,
                    height: p.bbox[3] / h,
                  },
                };
                if (
                  (p.class === "person" || p.class === "cell phone") &&
                  p.score >= ASSESSMENT_PROCTOR_CONFIG.minConfidence
                ) {
                  if (p.class === "person") {
                    persons.push(det);
                    boxes.push({
                      className: "person",
                      confidence: p.score,
                      ...det.bbox!,
                    });
                  } else {
                    phones.push(det);
                    boxes.push({
                      className: "cell phone",
                      confidence: p.score,
                      ...det.bbox!,
                    });
                  }
                }
              }
            } catch {
              /* transient TF failure */
            }
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
        const cls = classifyFrame(sample, ASSESSMENT_PROCTOR_CONFIG);

        // Sustained blur lane: feed the focus flag through the engine every
        // tick. The engine's 10-minute WINDOW_BLUR threshold does the rest.
        const blurTick = engine.process({
          type: "WINDOW_BLUR",
          active: !focusedRef.current,
          confidence: focusedRef.current ? 0 : 0.8,
          timestamp: now,
        });
        blurTick.events.forEach((ev) =>
          queueEvent({
            type: ev.type,
            confidence: ev.confidence,
            durationMs: Math.round(ev.durationMs),
          }),
        );

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

        // Live blur duration for the UI (resets on refocus via recovery).
        const blurState =
          engine["states"] instanceof Map
            ? (engine["states"] as Map<string, { since: number | null }>).
                get("WINDOW_BLUR")
            : undefined;
        const blurActiveMs =
          !focusedRef.current && blurState?.since
            ? now - blurState.since
            : 0;

        setStatus((prev) => ({
          ...prev,
          personCount: cls.personCount,
          phoneCount: cls.phoneCount,
          boxes,
          blurActiveMs,
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

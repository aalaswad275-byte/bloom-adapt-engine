/**
 * useExamMonitor — unified webcam + browser monitoring.
 *
 * Vision lane (primary, runs whenever the camera is available):
 *   • COCO-SSD object detection over <video> frames → `person` count,
 *     `cell phone` count (physical violations)
 *   • FaceDetector API when present (Chrome) as the face-visibility /
 *     gaze-position source, with a phone-in-hand heuristic fallback
 *   • per-frame classifyFrame() → ViolationEngine (grace periods, debouncing,
 *     recovery events)
 *
 * Browser lane: tab switch / blur / minimize → same engine. These are
 * discrete events so they use threshold-0 types and fire once per occurrence.
 *
 * Violations + recoveries are batched to the backend every few seconds, where
 * the unified counter and the WARNING → PAUSE_EXAM → TERMINATE_EXAM policy
 * ladder is enforced server-side. Nothing here touches theta — the
 * VisualInteractionSample feed for V keeps its own neutral path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ZERO_INTERACTION, type VisualInteractionSample } from "@/lib/irt";
import {
  DEFAULT_MONITORING_CONFIG,
  ViolationEngine,
  classifyFrame,
  type EngineEventOutput,
  type EngineTick,
  type FrameSample,
  type IdentityState,
  type MonitoringConfig,
  type PolicyAction,
  type RawDetection,
  type ViolationType,
} from "@/lib/monitoring";

interface MonitorOptions {
  sessionId: Id<"examSessions"> | null;
  enabled: boolean;
  /** Monitoring configuration (thresholds/policy) from the exam record. */
  config?: MonitoringConfig;
}

export interface MonitorStatus {
  // Camera
  cameraState: "connecting" | "connected" | "error";
  cameraError: string | null;
  // Vision
  cvReady: boolean;
  cvMode: "coco-ssd" | "facedetector" | "off";
  identityState: IdentityState;
  personCount: number;
  phoneCount: number;
  phoneState: "none" | "visible" | "in_use";
  gazeDeviation: number;
  // Browser
  browserFocused: boolean;
  // Engine
  violationCount: number;
  policy: PolicyAction;
  eventsEmitted: number;
  pending: Array<{ type: ViolationType; activeMs: number }>;
  // Legacy V-feed aggregates
  facePresent: boolean;
}

/** Faces from the native FaceDetector (Chrome-only). */
interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}

const SAMPLE_INTERVAL_MS = 600; // CV frame cadence
const FLUSH_INTERVAL_MS = 4_000; // batch ingest cadence

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function useExamMonitor({ sessionId, enabled, config }: MonitorOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const sampleTimerRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const queueRef = useRef<EngineEventOutput[]>([]);
  const cvBusyRef = useRef(false);
  const samplesRef = useRef({
    frames: 0,
    faceFrames: 0,
    gazeSum: 0,
    tabSwitches: 0,
    cameraLosses: 0,
  });

  const detectorRef = useRef<{
    detect: (input: HTMLVideoElement) => Promise<DetectedFace[]>;
  } | null>(null);
  const cocoRef = useRef<{
    detect: (input: HTMLVideoElement) => Promise<
      Array<{ class: string; score: number; bbox: [number, number, number, number] }>
    >;
  } | null>(null);

  const ingestEvents = useMutation(api.monitoring.ingestEvents);
  const ingestEvent = useMutation(api.monitoring.ingestEvent);

  const effCfg = useMemo(() => config ?? DEFAULT_MONITORING_CONFIG, [config]);

  const [status, setStatus] = useState<MonitorStatus>({
    cameraState: "connecting",
    cameraError: null,
    cvReady: false,
    cvMode: "off",
    identityState: "FACE_VERIFIED",
    personCount: 0,
    phoneCount: 0,
    phoneState: "none",
    gazeDeviation: 0,
    browserFocused: true,
    violationCount: 0,
    policy: "NONE",
    eventsEmitted: 0,
    pending: [],
    facePresent: false,
  });

  // One engine per session; config is the server snapshot at session start.
  const engine = useMemo(() => new ViolationEngine(effCfg), [effCfg]);

  const queueEvent = useCallback((ev: EngineEventOutput) => {
    queueRef.current.push(ev);
    setStatus((s) => ({ ...s, eventsEmitted: s.eventsEmitted + 1 }));
  }, []);

  // -------- Batched flush to the backend --------
  useEffect(() => {
    if (!sessionId || !enabled) return;
    flushTimerRef.current = window.setInterval(() => {
      const batch = queueRef.current;
      if (batch.length === 0) return;
      queueRef.current = [];
      ingestEvents({
        sessionId,
        events: batch.map((ev) => ({
          type: ev.type,
          kind: ev.kind,
          confidence: ev.confidence,
          durationMs: Math.round(ev.durationMs),
          source: ev.source,
          detail: ev.detail,
        })),
      })
        .then((res) => {
          if (res?.ok) {
            setStatus((s) => ({
              ...s,
              violationCount: res.violationCount ?? s.violationCount,
              policy: res.policyAction ?? s.policy,
            }));
          }
        })
        .catch((err) => console.warn("[monitor] flush failed", err));
    }, FLUSH_INTERVAL_MS);
    return () => {
      if (flushTimerRef.current !== null)
        window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    };
  }, [sessionId, enabled, ingestEvents]);

  // -------- Browser lane --------
  useEffect(() => {
    if (!sessionId || !enabled) return;

    const fireOnce = (type: ViolationType, confidence: number) => {
      // Discrete browser events use threshold-0 types: fire immediately,
      // then clear the lane so the next occurrence can fire again.
      const t1 = engine.process({ type, active: true, confidence, timestamp: Date.now() });
      t1.events.forEach(queueEvent);
      engine.process({
        type,
        active: false,
        confidence: 0,
        timestamp: Date.now() + 1,
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        fireOnce("TAB_SWITCH", 0.95);
        samplesRef.current.tabSwitches += 1;
        setStatus((s) => ({ ...s, browserFocused: false }));
      }
    };
    const onBlur = () => {
      fireOnce("WINDOW_BLUR", 0.7);
      setStatus((s) => ({ ...s, browserFocused: false }));
    };
    const onFocus = () => {
      setStatus((s) => ({ ...s, browserFocused: true }));
    };
    const onMinimize = () => {
      if (window.outerWidth === 0 && window.outerHeight === 0) {
        fireOnce("BROWSER_MINIMIZED", 0.9);
      }
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
  }, [sessionId, enabled, engine, queueEvent]);

  // -------- Camera + model setup --------
  useEffect(() => {
    if (!sessionId || !enabled) return;
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

        // Vision model: COCO-SSD (person + cell phone). Loads async; the
        // sampling loop uses the face/heuristic path until it is ready.
        void (async () => {
          try {
            const tf = await import("@tensorflow/tfjs");
            await tf.ready();
            const cocoSsd = await import("@tensorflow-models/coco-ssd");
            const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
            if (cancelled) return;
            cocoRef.current = model;
            setStatus((s) => ({ ...s, cvReady: true, cvMode: "coco-ssd" }));
          } catch (err) {
            if (cancelled) return;
            console.warn("[monitor] COCO-SSD unavailable; using fallback", err);
            setStatus((s) => ({ ...s, cvMode: "facedetector" }));
          }
        })();

        // Face detector (Chrome) as the face-visibility source.
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
        // Record through the raw lane; the exam stays runnable.
        ingestEvent({
          sessionId: sessionId!,
          type: "CAMERA_DISABLED",
          confidence: 1,
          detail: "camera unavailable at session start",
        }).catch(() => undefined);
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
  }, [sessionId, enabled]);

  // -------- Sampling loop: frame → detections → engine --------
  useEffect(() => {
    if (!sessionId || !enabled) return;

    const tick = async () => {
      const video = videoRef.current;
      const stream = streamRef.current;
      if (!video || !stream || video.readyState < 2 || cvBusyRef.current) return;
      cvBusyRef.current = true;
      const now = Date.now();

      try {
        let persons: RawDetection[] = [];
        let phones: RawDetection[] = [];

        // --- Object detection (person / cell phone) ---
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
              if (p.class === "person" && p.score >= effCfg.minConfidence)
                persons.push(det);
              else if (
                p.class === "cell phone" &&
                p.score >= effCfg.minConfidence
              )
                phones.push(det);
            }
          } catch {
            /* transient TF failure: treat as empty detections this frame */
          }
        }

        // --- Faces (FaceDetector or phone-in-hand heuristic fallback) ---
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
            /* fall through to heuristic */
          }
        } else if (persons.length > 0) {
          // Phone-in-hand heuristic fallback: with a person and a phone both
          // visible but no face detector available, treat the student as
          // present-but-head-down (phone-in-hands posture) so the face lane
          // stays meaningful instead of flapping NO_PERSON/FACE_NOT_VISIBLE.
          if (phones.length > 0) {
            faces.push({
              center: { x: phones[0].center.x, y: 0.45 },
              area: 0.12,
            });
          }
        }

        // --- Classify + feed the engine ---
        const sample: FrameSample = {
          persons,
          phones,
          faces,
          frameOk: true,
          identityVerified:
            !effCfg.identityVerificationEnabled || faces.length === 1,
          gazeDeviation,
        };
        const cls = classifyFrame(sample, effCfg);

        let latestPending: EngineTick["pending"] = [];
        for (const o of cls.observations) {
          const t = engine.process({
            type: o.type,
            active: o.active,
            confidence: o.confidence,
            timestamp: now,
          });
          t.events.forEach(queueEvent);
          latestPending = t.pending;
        }

        // Engine state → UI
        const personCount = cls.personCount;
        const phoneCount = cls.phoneCount;
        const identityState: IdentityState =
          personCount === 0
            ? "NO_PERSON"
            : personCount >= 2
              ? "MULTIPLE_PERSONS"
              : faces.length === 0
                ? "FACE_NOT_VISIBLE"
                : effCfg.identityVerificationEnabled
                  ? sample.identityVerified
                    ? "FACE_VERIFIED"
                    : "IDENTITY_NOT_VERIFIED"
                  : "FACE_VERIFIED";

        const s = samplesRef.current;
        s.frames += 1;
        if (faces.length > 0) s.faceFrames += 1;
        s.gazeSum += gazeDeviation;

        setStatus((prev) => ({
          ...prev,
          personCount,
          phoneCount,
          phoneState:
            phoneCount === 0
              ? "none"
              : effCfg.phoneMode === "in_use_only"
                ? "in_use"
                : "visible",
          gazeDeviation,
          identityState,
          violationCount: engine.violationCount,
          pending: latestPending,
          facePresent: faces.length > 0 || personCount > 0,
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
  }, [sessionId, enabled, engine, effCfg, queueEvent]);

  /** Call when a new question is displayed. Resets per-item aggregates. */
  const beginItem = useCallback(() => {
    samplesRef.current = {
      frames: 0,
      faceFrames: 0,
      gazeSum: 0,
      tabSwitches: 0,
      cameraLosses: 0,
    };
  }, []);

  /**
   * Per-item interaction snapshot for V_{i,t}. Neutral zeros when the camera
   * never produced samples so V stays honest.
   */
  const getIntegrationSnapshot = useCallback((): VisualInteractionSample => {
    const s = samplesRef.current;
    if (!s.frames) return { ...ZERO_INTERACTION };
    return {
      gazeDeviation: clamp01(s.gazeSum / s.frames),
      attentionToQuestion: clamp01(s.faceFrames / s.frames),
      abnormalInteraction: clamp01(s.tabSwitches * 0.5 + s.cameraLosses * 0.5),
    };
  }, []);

  return { videoRef, status, beginItem, getIntegrationSnapshot };
}

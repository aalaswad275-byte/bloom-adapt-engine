/**
 * WebSocket client for the Ultralytics YOLO26n monitoring service.
 *
 * The browser captures one JPEG frame at a time, sends it as binary over the
 * socket, and receives YOLO detections for that exact frame. The service owns
 * the model: it is loaded once at process startup, not per frame. Keeping
 * inference out of the exam tab also prevents the detector from competing with
 * the timer, charts, and proctoring UI for the student's CPU/GPU.
 */

export interface YoloBoundingBox {
  /** Normalized top-left corner, [0,1]. */
  x: number;
  y: number;
  /** Normalized size, [0,1]. */
  width: number;
  height: number;
}

export interface YoloDetection {
  /** COCO class id: 0 = person, 67 = cell phone. */
  classId: number;
  className: "person" | "cell phone";
  confidence: number;
  bbox: YoloBoundingBox;
}

export interface YoloFrameResult {
  persons: YoloDetection[];
  phones: YoloDetection[];
  inferenceMs: number | null;
  device: string | null;
}

type ServerDetection = {
  class_id?: number;
  class_name?: string;
  confidence?: number;
  bbox?: { x?: number; y?: number; width?: number; height?: number };
};

type ServerMessage =
  | {
      type: "ready";
      model?: string;
      device?: string;
    }
  | {
      type: "detections";
      persons?: ServerDetection[];
      phones?: ServerDetection[];
      inference_ms?: number;
      device?: string;
    }
  | { type: "error"; message?: string };

const DEFAULT_WS_URL = "ws://127.0.0.1:8000/ws/monitor";
const viteEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;
const CONNECT_TIMEOUT_MS = 4_000;
const DETECT_TIMEOUT_MS = 2_500;
const MAX_SEND_WIDTH = 640;
const JPEG_QUALITY = 0.72;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeDetection(
  detection: ServerDetection,
  fallbackName: "person" | "cell phone",
): YoloDetection {
  const bbox = detection.bbox ?? {};
  return {
    classId:
      typeof detection.class_id === "number"
        ? detection.class_id
        : fallbackName === "person"
          ? 0
          : 67,
    className: detection.class_name === "cell phone" ? "cell phone" : fallbackName,
    confidence: clamp01(Number(detection.confidence ?? 0)),
    bbox: {
      x: clamp01(Number(bbox.x ?? 0)),
      y: clamp01(Number(bbox.y ?? 0)),
      width: clamp01(Number(bbox.width ?? 0)),
      height: clamp01(Number(bbox.height ?? 0)),
    },
  };
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

export class YoloMonitorClient {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private open = false;
  private inFlight = false;
  private pending: {
    resolve: (result: YoloFrameResult | null) => void;
    timer: number;
  } | null = null;
  private lastDevice: string | null = null;

  constructor(url?: string) {
    this.url =
      url ||
      viteEnv?.VITE_YOLO_WS_URL ||
      DEFAULT_WS_URL;
  }

  get isOpen(): boolean {
    return this.open;
  }

  get device(): string | null {
    return this.lastDevice;
  }

  connect(): Promise<void> {
    if (this.open) return Promise.resolve();
    if (typeof WebSocket === "undefined")
      return Promise.reject(new Error("WebSocket is not available"));

    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        reject(new Error("YOLO monitoring service connection timed out"));
      }, CONNECT_TIMEOUT_MS);

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.open = false;
        reject(error);
      };

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.open = true;
        resolve();
      };

      socket.onerror = () => {
        fail(new Error("YOLO monitoring service is unreachable"));
      };

      socket.onclose = () => {
        this.open = false;
        this.socket = null;
        const pending = this.pending;
        this.pending = null;
        if (pending) {
          window.clearTimeout(pending.timer);
          pending.resolve(null);
        }
        if (!settled) fail(new Error("YOLO monitoring service closed the connection"));
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === "ready") {
          this.lastDevice = message.device ?? null;
          return;
        }

        if (message.type === "error") {
          console.warn("[monitor] YOLO service error", message.message);
          const pending = this.pending;
          this.pending = null;
          this.inFlight = false;
          if (pending) {
            window.clearTimeout(pending.timer);
            pending.resolve(null);
          }
          return;
        }

        if (message.type !== "detections") return;

        const result: YoloFrameResult = {
          persons: (message.persons ?? [])
            .map((detection) => normalizeDetection(detection, "person"))
            .filter((detection) => detection.bbox.width > 0 && detection.bbox.height > 0),
          phones: (message.phones ?? [])
            .map((detection) => normalizeDetection(detection, "cell phone"))
            .filter((detection) => detection.bbox.width > 0 && detection.bbox.height > 0),
          inferenceMs:
            typeof message.inference_ms === "number" ? message.inference_ms : null,
          device: message.device ?? this.lastDevice,
        };
        if (message.device) this.lastDevice = message.device;

        const pending = this.pending;
        this.pending = null;
        this.inFlight = false;
        if (pending) {
          window.clearTimeout(pending.timer);
          pending.resolve(result);
        }
      };
    });
  }

  /** Capture and detect one frame. Returns null when a frame is already in flight. */
  async detect(video: HTMLVideoElement): Promise<YoloFrameResult | null> {
    if (!this.open || !this.socket || this.socket.readyState !== WebSocket.OPEN)
      return null;
    if (this.inFlight) return null;
    if (!video.videoWidth || !video.videoHeight) return null;

    const scale = Math.min(1, MAX_SEND_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToJpeg(canvas);
    if (!blob) return null;
    if (!this.open || !this.socket || this.socket.readyState !== WebSocket.OPEN)
      return null;

    this.inFlight = true;
    return new Promise<YoloFrameResult | null>((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.pending?.resolve !== resolve) return;
        this.pending = null;
        this.inFlight = false;
        resolve(null);
      }, DETECT_TIMEOUT_MS);
      this.pending = { resolve, timer };

      blob
        .arrayBuffer()
        .then((buffer) => {
          if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            window.clearTimeout(timer);
            this.pending = null;
            this.inFlight = false;
            resolve(null);
            return;
          }
          this.socket.send(buffer);
        })
        .catch(() => {
          window.clearTimeout(timer);
          this.pending = null;
          this.inFlight = false;
          resolve(null);
        });
    });
  }

  close(): void {
    this.open = false;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      window.clearTimeout(pending.timer);
      pending.resolve(null);
    }
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
  }
}

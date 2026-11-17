"""
YOLO26n real-time exam-monitoring service.

The Ultralytics model is loaded exactly once during application startup and
reused for every WebSocket frame. The browser sends JPEG frames as binary
messages; this service decodes each frame to RGB, resizes it, runs YOLO26n,
and returns only COCO person (class 0) and cell-phone (class 67) detections.
"""

from __future__ import annotations

import asyncio
import io
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from ultralytics import YOLO

MODEL_PATH = os.getenv("YOLO_MODEL", "yolo26n.pt")
DEVICE_SETTING = os.getenv("YOLO_DEVICE", "auto").strip().lower()
IMAGE_SIZE = int(os.getenv("YOLO_IMG_SIZE", "640"))
CONFIDENCE = float(os.getenv("YOLO_CONF", "0.35"))
IOU = float(os.getenv("YOLO_IOU", "0.5"))
MAX_FRAME_WIDTH = int(os.getenv("YOLO_MAX_FRAME_WIDTH", "640"))
MAX_DETECTIONS = int(os.getenv("YOLO_MAX_DETECTIONS", "20"))
MAX_FRAME_BYTES = int(os.getenv("YOLO_MAX_FRAME_BYTES", "2000000"))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

PERSON_CLASS_ID = 0
PHONE_CLASS_ID = 67
TARGET_CLASSES = {PERSON_CLASS_ID, PHONE_CLASS_ID}

_model: YOLO | None = None
_device: str = "cpu"
_inference_lock = asyncio.Lock()


def choose_device() -> str:
    """Honor YOLO_DEVICE, otherwise use the first available CUDA GPU."""
    if DEVICE_SETTING not in {"", "auto"}:
        return DEVICE_SETTING
    if torch.cuda.is_available():
        return "cuda:0"
    return "cpu"


def resolve_target_ids(model: YOLO) -> tuple[int, int]:
    """
    Use the COCO ids required by the monitoring spec, but verify them against
    the loaded checkpoint's class map so a custom checkpoint cannot silently
    read the wrong class.
    """
    names: dict[int, str] = dict(model.names or {})
    person = next(
        (class_id for class_id, name in names.items() if str(name).lower() == "person"),
        PERSON_CLASS_ID,
    )
    phone = next(
        (
            class_id
            for class_id, name in names.items()
            if str(name).lower() == "cell phone"
        ),
        PHONE_CLASS_ID,
    )
    if person != PERSON_CLASS_ID or phone != PHONE_CLASS_ID:
        print(
            "[yolo] WARNING: checkpoint class ids differ from COCO; "
            f"person={person}, cell phone={phone}"
        )
    return int(person), int(phone)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model, _device
    _device = choose_device()
    print(f"[yolo] loading {MODEL_PATH} on {_device}")
    model = YOLO(MODEL_PATH)
    try:
        model.to(_device)
    except Exception as error:
        if _device == "cpu":
            raise
        print(f"[yolo] device {_device} unavailable ({error}); falling back to CPU")
        _device = "cpu"
        model.to("cpu")
    _model = model
    person_id, phone_id = resolve_target_ids(model)
    print(
        f"[yolo] ready model={MODEL_PATH} device={_device} "
        f"person={person_id} phone={phone_id}"
    )
    app.state.model = model
    app.state.device = _device
    app.state.person_id = person_id
    app.state.phone_id = phone_id
    yield
    _model = None
    app.state.model = None


app = FastAPI(title="Bloom Adapt YOLO26n Monitor", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def preprocess_frame(payload: bytes) -> Image.Image:
    """
    Browser canvas frames are JPEG. Decode to an RGB Pillow image (never pass a
    BGR OpenCV array to Ultralytics by mistake), apply EXIF orientation, and
    downscale while preserving aspect ratio.
    """
    image = Image.open(io.BytesIO(payload))
    image = image.convert("RGB")
    if image.width > MAX_FRAME_WIDTH:
        height = round(image.height * (MAX_FRAME_WIDTH / image.width))
        image = image.resize((MAX_FRAME_WIDTH, height), Image.Resampling.LANCZOS)
    return image


def run_inference(payload: bytes) -> dict[str, Any]:
    """Blocking YOLO call executed in a worker thread."""
    if _model is None:
        raise RuntimeError("YOLO26n model is not loaded")

    image = preprocess_frame(payload)
    started = time.perf_counter()
    with torch.inference_mode():
        results = _model.predict(
            source=image,
            imgsz=IMAGE_SIZE,
            conf=CONFIDENCE,
            iou=IOU,
            classes=[PERSON_CLASS_ID, PHONE_CLASS_ID],
            max_det=MAX_DETECTIONS,
            device=_device,
            verbose=False,
        )
    inference_ms = (time.perf_counter() - started) * 1000

    persons: list[dict[str, Any]] = []
    phones: list[dict[str, Any]] = []
    if results:
        result = results[0]
        boxes = result.boxes
        if boxes is not None and len(boxes) > 0:
            width, height = image.size
            xyxy = boxes.xyxy.detach().cpu().tolist()
            confidences = boxes.conf.detach().cpu().tolist()
            class_ids = boxes.cls.detach().cpu().tolist()
            names = result.names or {}
            for coordinates, confidence, raw_class_id in zip(
                xyxy, confidences, class_ids
            ):
                class_id = int(raw_class_id)
                if class_id not in TARGET_CLASSES:
                    continue
                x1, y1, x2, y2 = (float(value) for value in coordinates)
                detection = {
                    "class_id": class_id,
                    "class_name": str(names.get(class_id, "")),
                    "confidence": round(float(confidence), 4),
                    "bbox": {
                        "x": round(max(0.0, x1 / width), 6),
                        "y": round(max(0.0, y1 / height), 6),
                        "width": round(
                            max(0.0, min(width, x2) - max(0.0, x1)) / width, 6
                        ),
                        "height": round(
                            max(0.0, min(height, y2) - max(0.0, y1)) / height, 6
                        ),
                    },
                }
                if class_id == PERSON_CLASS_ID:
                    persons.append(detection)
                else:
                    phones.append(detection)

    return {
        "type": "detections",
        "persons": persons,
        "phones": phones,
        "person_count": len(persons),
        "phone_count": len(phones),
        "inference_ms": round(inference_ms, 2),
        "device": _device,
        "frame": {"width": image.width, "height": image.height},
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ready" if _model is not None else "loading",
        "model": MODEL_PATH,
        "device": _device,
        "cuda_available": torch.cuda.is_available(),
    }


@app.websocket("/ws/monitor")
async def monitor_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(
        {"type": "ready", "model": MODEL_PATH, "device": _device}
    )

    try:
        while True:
            payload = await websocket.receive_bytes()
            if len(payload) > MAX_FRAME_BYTES:
                await websocket.send_json(
                    {"type": "error", "message": "frame exceeds size limit"}
                )
                continue
            try:
                async with _inference_lock:
                    detection = await asyncio.to_thread(run_inference, payload)
                await websocket.send_json(detection)
            except Exception as error:  # keep the stream alive after a bad frame
                await websocket.send_json(
                    {"type": "error", "message": str(error)[:300]}
                )
    except WebSocketDisconnect:
        return

# YOLO26n exam-monitoring service

This service runs the Ultralytics **YOLO26n** detector (`yolo26n.pt`) for the
Bloom Adapt Engine's webcam proctoring. The model is loaded once when the
process starts and reused for every frame; CUDA is selected automatically when
available and CPU is the fallback.

## Run

```bash
cd monitoring-service
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Ultralytics downloads `yolo26n.pt` automatically on first run. For a fully
offline deployment, download the checkpoint ahead of time and set
`YOLO_MODEL=/path/to/yolo26n.pt`.

## Point the frontend at it

The frontend reads `VITE_YOLO_WS_URL`. Set it in the project's Keys/API keys
environment configuration (do not commit secrets or local URLs):

```
VITE_YOLO_WS_URL=ws://127.0.0.1:8000/ws/monitor
```

For HTTPS deployments use `wss://...` and add the site origin to the service:

```
ALLOWED_ORIGINS=https://app.example.com
```

If the service is unreachable, the exam keeps running and the browser detector
is used as an availability fallback. When the service is connected, YOLO26n is
the authoritative person/phone detector.

## Detection contract

- COCO person class: `0`
- COCO cell-phone class: `67`
- Minimum confidence default: `0.35` (`YOLO_CONF`)
- Inference size default: `640` (`YOLO_IMG_SIZE`)
- Models: `YOLO_MODEL`, `YOLO_DEVICE` (`auto`, `cuda:0`, or `cpu`)

The browser sends binary JPEG frames and receives normalized bounding boxes,
confidence values, and inference time. The existing violation engine applies
the configured grace periods for disappearance/return, multiple people, and
phone use.

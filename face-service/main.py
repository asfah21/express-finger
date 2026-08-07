import base64
import os
import re
from pathlib import Path
from threading import Lock

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

try:
    from insightface.app import FaceAnalysis
    from ultralytics import YOLO
except ImportError as exc:  # pragma: no cover - exercised in deployment
    FaceAnalysis = None
    YOLO = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


FACES_DIR = Path(os.getenv("FACES_DIR", "/data/faces"))
FACE_TOKEN = os.getenv("FACE_SERVICE_TOKEN", "")
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "/models/yolov8n.pt")
YOLO_CONF_THRESHOLD = float(os.getenv("YOLO_CONF_THRESHOLD", "0.40"))
FACE_SIM_THRESHOLD = float(os.getenv("FACE_SIM_THRESHOLD", os.getenv("FACE_MATCH_THRESHOLD", "0.35")))
FACE_DET_SIZE = int(os.getenv("FACE_DET_SIZE", "640"))
IMAGE_MAX_BYTES = int(os.getenv("FACE_IMAGE_MAX_BYTES", str(5 * 1024 * 1024)))

app = FastAPI(title="AZRA Face Recognition Service", version="1.0.0")
state_lock = Lock()
face_app = None
yolo_model = None
known_faces: dict[str, dict] = {}


class RecognizeRequest(BaseModel):
    image: str = Field(..., min_length=32, description="base64 image or data URL")


def require_token(token: str | None):
    if FACE_TOKEN and token != FACE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid face service token")


def decode_image(value: str) -> np.ndarray:
    encoded = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image") from exc
    if len(raw) > IMAGE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unsupported image")
    return image


def ensure_models():
    global face_app, yolo_model
    if IMPORT_ERROR:
        raise RuntimeError(f"Face dependencies are unavailable: {IMPORT_ERROR}")
    if face_app is None:
        face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        face_app.prepare(ctx_id=0, det_size=(640, 640))
    if yolo_model is None:
        yolo_model = YOLO(YOLO_MODEL_PATH)


def normalize_embedding(embedding: np.ndarray) -> np.ndarray:
    embedding = np.asarray(embedding, dtype=np.float32)
    return embedding / max(float(np.linalg.norm(embedding)), 1e-8)


def yolo_face_crops(image: np.ndarray) -> list[np.ndarray]:
    """Use the supplied YOLO model as a lightweight first-pass face detector."""
    ensure_models()
    result = yolo_model.predict(
        source=image,
        verbose=False,
        conf=YOLO_CONF_THRESHOLD,
        iou=0.70,
        max_det=10,
        imgsz=FACE_DET_SIZE,
    )[0]
    if result.boxes is None:
        return []
    crops = []
    height, width = image.shape[:2]
    for box in result.boxes.xyxy.cpu().numpy():
        x1, y1, x2, y2 = [int(v) for v in box[:4]]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(width, x2), min(height, y2)
        if x2 > x1 and y2 > y1:
            crops.append(image[y1:y2, x1:x2])
    return crops


def image_embeddings(image: np.ndarray) -> list[np.ndarray]:
    """Return all valid buffalo_l embeddings found in a browser camera frame."""
    ensure_models()
    crops = yolo_face_crops(image)
    # Keep the reference implementation's useful fallback: buffalo_l can still
    # detect a face when a custom YOLO checkpoint has no compatible face class.
    if not crops:
        crops = [image]
    embeddings = []
    for crop in crops:
        for face in face_app.get(crop):
            embedding = getattr(face, "normed_embedding", None)
            if embedding is None:
                embedding = getattr(face, "embedding", None)
            if embedding is not None:
                embeddings.append(normalize_embedding(embedding))
    return embeddings


def face_id_from_file(file: Path) -> str | None:
    """Extract the employee id from a reference filename.

    Reference files are normally named ``123.jpg``.  Accept a trailing
    separator too (for example ``123_1.jpg`` or ``123-1.jpg``) so a single
    employee can have several reference photos without silently being
    discarded.
    """
    match = re.match(r"^(\d+)(?:[_-].*)?$", file.stem)
    return match.group(1) if match else None


def reload_index():
    global known_faces
    ensure_models()
    indexed = {}
    if not FACES_DIR.exists():
        print(f"Face reference directory does not exist: {FACES_DIR}")
        return 0

    for file in sorted(FACES_DIR.iterdir()):
        if not file.is_file() or file.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        fid = face_id_from_file(file)
        if not fid:
            continue
        image = cv2.imread(str(file), cv2.IMREAD_COLOR)
        if image is None:
            print(f"Could not read face reference image: {file}")
            continue
        embeddings = image_embeddings(image)
        if embeddings:
            indexed.setdefault(fid, {"fid": fid, "embeddings": [], "files": []})
            indexed[fid]["embeddings"].extend(embeddings)
            indexed[fid]["files"].append(file.name)
    with state_lock:
        known_faces = indexed
    print(f"Indexed {len(indexed)} employee face(s) from {sum(len(item.get('files', [])) for item in indexed.values())} file(s) in {FACES_DIR}")
    return len(indexed)


@app.on_event("startup")
def startup():
    if os.getenv("FACE_SERVICE_LAZY_LOAD", "false").lower() != "true":
        try:
            reload_index()
        except Exception as exc:
            print(f"Face service startup warning: {exc}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "indexed_faces": len(known_faces),
        "indexed_files": sum(len(item.get("files", [])) for item in known_faces.values()),
        "faces_dir": str(FACES_DIR),
        "faces_dir_exists": FACES_DIR.exists(),
        "models_loaded": face_app is not None and yolo_model is not None,
    }


@app.post("/reload")
def reload_faces(x_face_service_token: str | None = Header(default=None)):
    require_token(x_face_service_token)
    try:
        count = reload_index()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ok", "indexed_faces": count}


@app.post("/recognize")
def recognize(payload: RecognizeRequest, x_face_service_token: str | None = Header(default=None)):
    require_token(x_face_service_token)
    try:
        image = decode_image(payload.image)
        probes = image_embeddings(image)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not probes:
        return {"matched": False, "reason": "no_face"}
    with state_lock:
        candidates = list(known_faces.values())
    if not candidates:
        return {"matched": False, "reason": "no_reference_faces"}
    scored = []
    for candidate in candidates:
        score = max(float(np.dot(probe, known)) for probe in probes for known in candidate["embeddings"])
        scored.append((score, candidate))
    score, best = max(scored, key=lambda item: item[0])
    if score < FACE_SIM_THRESHOLD:
        return {"matched": False, "reason": "below_threshold", "score": round(score, 5)}
    return {"matched": True, "fid": best["fid"], "score": round(score, 5), "file": best["files"][0] if best.get("files") else None}

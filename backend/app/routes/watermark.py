import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.services.project_manager import get_projects_dir
from app.services.video_editor import find_watermark_file

router = APIRouter(prefix="/api/watermark", tags=["watermark"])
logger = logging.getLogger(__name__)

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
LEGACY_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
ALLOWED_POSITIONS = {"top_right", "top_left", "bottom_right", "bottom_left", "center"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class WatermarkSettingsPayload(BaseModel):
    position: str = Field(default="top_right")
    opacity: int = Field(default=100, ge=20, le=100)


def get_watermarks_dir() -> Path:
    directory = get_projects_dir().parent / "watermarks"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def get_watermark_settings() -> dict[str, Any]:
    wm_dir = get_watermarks_dir()
    settings_file = wm_dir / "watermark_settings.json"
    position = "top_right"
    opacity = 100
    if settings_file.is_file():
        try:
            data = json.loads(settings_file.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                pos = str(data.get("position", "top_right")).strip().lower()
                if pos in ALLOWED_POSITIONS:
                    position = pos
                op = int(data.get("opacity", 100))
                opacity = max(20, min(100, op))
        except Exception:
            pass
    return {"position": position, "opacity": opacity}


def save_watermark_settings(position: str, opacity: int) -> dict[str, Any]:
    pos = (position or "top_right").strip().lower()
    if pos not in ALLOWED_POSITIONS:
        raise ValueError(f"Position must be one of: {', '.join(sorted(ALLOWED_POSITIONS))}")
    op = max(20, min(100, int(opacity)))
    wm_dir = get_watermarks_dir()
    settings_file = wm_dir / "watermark_settings.json"
    payload = {"position": pos, "opacity": op}
    tmp = settings_file.with_name(f".watermark_settings.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, settings_file)
    except OSError:
        tmp.unlink(missing_ok=True)
        settings_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def _has_valid_image_header(content: bytes, suffix: str) -> bool:
    if suffix == ".png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return content.startswith(b"\xff\xd8\xff")
    if suffix == ".webp":
        return len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    return False


def find_saved_custom_watermark() -> Path | None:
    wm_dir = get_watermarks_dir()
    for ext in sorted(ALLOWED_IMAGE_EXTENSIONS):
        target = wm_dir / f"custom_watermark{ext}"
        if target.is_file() and target.stat().st_size > 0:
            return target
    return None


@router.get("")
def get_watermark_status() -> dict[str, Any]:
    custom = find_saved_custom_watermark()
    default_file = find_watermark_file()
    settings = get_watermark_settings()
    mtime = int(custom.stat().st_mtime_ns) if custom and custom.is_file() else 0
    return {
        "has_custom_watermark": custom is not None,
        "custom_filename": custom.name if custom else None,
        "custom_url": f"/api/watermark/image?v={mtime}" if custom else None,
        "default_available": default_file is not None,
        "position": settings["position"],
        "opacity": settings["opacity"],
    }


@router.post("/settings")
def update_watermark_settings(payload: WatermarkSettingsPayload) -> dict[str, Any]:
    try:
        saved = save_watermark_settings(payload.position, payload.opacity)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"status": "success", **saved}


@router.get("/image")
def get_custom_watermark_image():
    custom = find_saved_custom_watermark()
    if not custom or not custom.is_file():
        raise HTTPException(status_code=404, detail="No custom watermark found")
    media_type = "image/png"
    if custom.suffix.lower() in {".jpg", ".jpeg"}:
        media_type = "image/jpeg"
    elif custom.suffix.lower() == ".webp":
        media_type = "image/webp"
    return FileResponse(
        custom,
        media_type=media_type,
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/upload")
async def upload_custom_watermark(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image format. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}",
        )

    content = await file.read(MAX_FILE_SIZE + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded image file is empty")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (maximum 10MB)")
    if not _has_valid_image_header(content, suffix):
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image")

    wm_dir = get_watermarks_dir()
    # Remove existing custom watermarks
    for ext in LEGACY_IMAGE_EXTENSIONS:
        old_file = wm_dir / f"custom_watermark{ext}"
        if old_file.is_file():
            try:
                old_file.unlink()
            except Exception:
                pass

    destination = wm_dir / f"custom_watermark{suffix}"
    tmp = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
    try:
        tmp.write_bytes(content)
        os.replace(tmp, destination)
    except OSError:
        tmp.unlink(missing_ok=True)
        destination.write_bytes(content)
    logger.info("Saved custom watermark to %s (%d bytes)", destination, len(content))

    return {
        "status": "success",
        "filename": destination.name,
        "url": "/api/watermark/image",
        "size": len(content),
    }


@router.delete("")
def delete_custom_watermark():
    wm_dir = get_watermarks_dir()
    deleted = False
    for ext in LEGACY_IMAGE_EXTENSIONS:
        f = wm_dir / f"custom_watermark{ext}"
        if f.is_file():
            try:
                f.unlink()
                deleted = True
            except Exception as e:
                logger.warning("Failed to delete %s: %s", f, e)
    return {"status": "success", "deleted": deleted}

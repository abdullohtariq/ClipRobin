import logging
import os
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.services.video_editor import find_watermark_file

router = APIRouter(prefix="/api/watermark", tags=["watermark"])
logger = logging.getLogger(__name__)

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def get_watermarks_dir() -> Path:
    directory = Path(__file__).resolve().parents[2] / "data" / "watermarks"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def find_saved_custom_watermark() -> Path | None:
    wm_dir = get_watermarks_dir()
    for ext in ALLOWED_IMAGE_EXTENSIONS:
        target = wm_dir / f"custom_watermark{ext}"
        if target.is_file() and target.stat().st_size > 0:
            return target
    return None


@router.get("")
def get_watermark_status() -> dict[str, Any]:
    custom = find_saved_custom_watermark()
    default_file = find_watermark_file()
    return {
        "has_custom_watermark": custom is not None,
        "custom_filename": custom.name if custom else None,
        "custom_url": "/api/watermark/image" if custom else None,
        "default_available": default_file is not None,
    }


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
    elif custom.suffix.lower() == ".svg":
        media_type = "image/svg+xml"
    return FileResponse(custom, media_type=media_type)


@router.post("/upload")
async def upload_custom_watermark(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image format. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (maximum 10MB)")

    wm_dir = get_watermarks_dir()
    # Remove existing custom watermarks
    for ext in ALLOWED_IMAGE_EXTENSIONS:
        old_file = wm_dir / f"custom_watermark{ext}"
        if old_file.is_file():
            try:
                old_file.unlink()
            except Exception:
                pass

    destination = wm_dir / f"custom_watermark{suffix}"
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
    for ext in ALLOWED_IMAGE_EXTENSIONS:
        f = wm_dir / f"custom_watermark{ext}"
        if f.is_file():
            try:
                f.unlink()
                deleted = True
            except Exception as e:
                logger.warning("Failed to delete %s: %s", f, e)
    return {"status": "success", "deleted": deleted}

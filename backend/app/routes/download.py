import json
import logging
import os
import shutil
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.services.downloader import DownloadCancelled, download_video
from app.services.project_manager import create_project

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

DOWNLOAD_JOBS: dict[str, dict[str, Any]] = {}
DOWNLOAD_CANCEL_EVENTS: dict[str, threading.Event] = {}
DOWNLOAD_JOBS_LOCK = threading.Lock()
MAX_COMPLETED_JOBS = 50


def evict_old_download_jobs() -> None:
    completed_keys = [
        k for k, v in DOWNLOAD_JOBS.items()
        if v.get("status") in {"completed", "failed", "cancelled"}
    ]
    if len(completed_keys) > MAX_COMPLETED_JOBS:
        for key in completed_keys[: len(completed_keys) - MAX_COMPLETED_JOBS]:
            DOWNLOAD_JOBS.pop(key, None)
            DOWNLOAD_CANCEL_EVENTS.pop(key, None)


def update_download_job(project_id: str, **updates: Any) -> None:
    with DOWNLOAD_JOBS_LOCK:
        job = DOWNLOAD_JOBS.get(project_id)
        if job is not None:
            if job.get("status") == "cancelled" and updates.get("status") != "cancelled":
                return
            job.update(updates)
        evict_old_download_jobs()


def _write_project_metadata(project_directory: Path, updates: dict[str, Any]) -> None:
    if not project_directory.is_dir():
        return
    meta_file = project_directory / "metadata.json"
    meta: dict[str, Any] = {}
    if meta_file.is_file():
        try:
            loaded = json.loads(meta_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            meta = {}
    for k, v in updates.items():
        if v is not None:
            meta[k] = v
    tmp = meta_file.with_name(f".metadata.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        os.replace(tmp, meta_file)
    except OSError:
        tmp.unlink(missing_ok=True)


def run_background_download(
    project_id: str,
    url: str,
    output_path: Path,
    project_directory: Path,
    cancel_event: threading.Event | None = None,
) -> None:
    if cancel_event is None:
        with DOWNLOAD_JOBS_LOCK:
            cancel_event = DOWNLOAD_CANCEL_EVENTS.get(project_id)

    def on_progress(data: dict[str, Any]) -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise DownloadCancelled("Download cancelled")
        with DOWNLOAD_JOBS_LOCK:
            existing_title = DOWNLOAD_JOBS.get(project_id, {}).get("title")
        update_download_job(
            project_id,
            status=data.get("status", "downloading"),
            step=data.get("step", "Downloading video..."),
            progress=data.get("progress", 0.0),
            title=data.get("title") or existing_title,
        )

    try:
        update_download_job(
            project_id,
            status="downloading",
            step="Extracting video info...",
            progress=5.0,
        )
        info = download_video(
            url,
            output_path,
            progress_callback=on_progress,
            cancel_event=cancel_event,
        )
        if cancel_event is not None and cancel_event.is_set():
            raise DownloadCancelled("Download cancelled")

        _write_project_metadata(
            project_directory,
            {
                "title": info.get("title"),
                "source_type": "YouTube",
                "url": url,
                "duration": info.get("duration"),
            },
        )
        update_download_job(
            project_id,
            status="completed",
            step="Download complete",
            progress=100.0,
            file=output_path.name,
            title=info.get("title"),
            duration=info.get("duration"),
        )
    except DownloadCancelled:
        shutil.rmtree(project_directory, ignore_errors=True)
        update_download_job(
            project_id,
            status="cancelled",
            step="Download cancelled",
            progress=0.0,
        )
    except Exception as error:
        if cancel_event is not None and cancel_event.is_set():
            shutil.rmtree(project_directory, ignore_errors=True)
            update_download_job(
                project_id,
                status="cancelled",
                step="Download cancelled",
                progress=0.0,
            )
            return
        logger.exception("Video download failed for project %s: %s", project_id, error)
        shutil.rmtree(project_directory, ignore_errors=True)
        user_message = (
            "This YouTube video was unavailable to download. "
            "You can choose or drop a local video file (MP4, MOV, MKV, WebM) to generate clips instead."
        )
        update_download_job(
            project_id,
            status="failed",
            step="Video download unavailable",
            progress=0.0,
            error=user_message,
        )
    finally:
        with DOWNLOAD_JOBS_LOCK:
            DOWNLOAD_CANCEL_EVENTS.pop(project_id, None)


class DownloadRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def validate_youtube_url(cls, value: str) -> str:
        parsed = urlparse(value)
        hostname = (parsed.hostname or "").lower()
        allowed_hosts = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}

        if parsed.scheme not in {"http", "https"} or hostname not in allowed_hosts:
            raise ValueError("A YouTube URL is required")

        return value


class DownloadResponse(BaseModel):
    project_id: str
    status: str
    file: str
    title: str | None = None
    step: str | None = None
    progress: float | None = None


def create_project_directory() -> tuple[str, Path]:
    return create_project()


@router.post("/download")
def download(request: DownloadRequest, background_tasks: BackgroundTasks) -> JSONResponse:
    project_id, project_directory = create_project_directory()
    output_path = project_directory / "source.mp4"
    cancel_event = threading.Event()

    with DOWNLOAD_JOBS_LOCK:
        evict_old_download_jobs()
        DOWNLOAD_CANCEL_EVENTS[project_id] = cancel_event
        DOWNLOAD_JOBS[project_id] = {
            "project_id": project_id,
            "status": "queued",
            "step": "Starting download...",
            "progress": 0.0,
            "url": request.url,
            "file": output_path.name,
            "title": None,
            "error": None,
        }

    background_tasks.add_task(
        run_background_download,
        project_id,
        request.url,
        output_path,
        project_directory,
        cancel_event,
    )

    return JSONResponse(
        status_code=202,
        content={
            "project_id": project_id,
            "status": "queued",
            "step": "Starting download...",
            "progress": 0.0,
            "file": output_path.name,
        },
    )


@router.get("/download/{project_id}")
def get_download_status(project_id: str) -> JSONResponse:
    with DOWNLOAD_JOBS_LOCK:
        job = DOWNLOAD_JOBS.get(project_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Download job not found")
        return JSONResponse(status_code=200, content=dict(job))

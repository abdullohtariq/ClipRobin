import logging
import shutil
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.services.downloader import download_video
from app.services.project_manager import create_project

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

DOWNLOAD_JOBS: dict[str, dict[str, Any]] = {}
DOWNLOAD_JOBS_LOCK = threading.Lock()


def update_download_job(project_id: str, **updates: Any) -> None:
    with DOWNLOAD_JOBS_LOCK:
        job = DOWNLOAD_JOBS.get(project_id)
        if job is not None:
            job.update(updates)


def run_background_download(project_id: str, url: str, output_path: Path, project_directory: Path) -> None:
    def on_progress(data: dict[str, Any]) -> None:
        update_download_job(
            project_id,
            status=data.get("status", "downloading"),
            step=data.get("step", "Downloading video..."),
            progress=data.get("progress", 0.0),
            title=data.get("title") or DOWNLOAD_JOBS.get(project_id, {}).get("title"),
        )

    try:
        update_download_job(
            project_id,
            status="downloading",
            step="Extracting video info...",
            progress=5.0,
        )
        info = download_video(url, output_path, progress_callback=on_progress)
        update_download_job(
            project_id,
            status="completed",
            step="Download complete",
            progress=100.0,
            file=output_path.name,
            title=info.get("title"),
            duration=info.get("duration"),
        )
    except Exception as error:
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


class DownloadRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def validate_youtube_url(cls, value: str) -> str:
        parsed = urlparse(value)
        hostname = (parsed.hostname or "").lower()
        allowed_hosts = {"youtube.com", "www.youtube.com", "youtu.be", "www.youtu.be"}

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

    with DOWNLOAD_JOBS_LOCK:
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


import json
import logging
import os
import shutil
import threading
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.routes.download import create_project_directory
from app.services.project_manager import get_project_uid, verify_project_ownership
from app.services.transcriber import transcribe_video

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)
ALLOWED_EXTENSIONS = {".avi", ".mkv", ".mov", ".mp4", ".m4v", ".webm"}
TRANSCRIPTION_JOBS: dict[str, dict[str, Any]] = {}
TRANSCRIPTION_CANCEL_EVENTS: dict[str, threading.Event] = {}
JOBS_LOCK = threading.Lock()
MAX_COMPLETED_JOBS = 50


class LocalVideoPathRequest(BaseModel):
    file_path: str


def evict_old_transcription_jobs() -> None:
    completed_keys = [
        k for k, v in TRANSCRIPTION_JOBS.items()
        if v.get("status") in {"completed", "failed", "cancelled"}
    ]
    if len(completed_keys) > MAX_COMPLETED_JOBS:
        for key in completed_keys[: len(completed_keys) - MAX_COMPLETED_JOBS]:
            TRANSCRIPTION_JOBS.pop(key, None)
            TRANSCRIPTION_CANCEL_EVENTS.pop(key, None)


def update_job(project_id: str, **updates: Any) -> None:
    with JOBS_LOCK:
        job = TRANSCRIPTION_JOBS.get(project_id)
        if job is not None:
            if job.get("status") == "cancelled" and updates.get("status") != "cancelled":
                return
            job.update(updates)
        evict_old_transcription_jobs()


def _save_local_metadata(project_directory: Path, title: str, duration: float) -> None:
    if not project_directory.is_dir():
        return
    meta_file = project_directory / "metadata.json"
    payload: dict[str, Any] = {}
    if meta_file.is_file():
        try:
            loaded = json.loads(meta_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                payload = loaded
        except Exception:
            payload = {}
    if title and not payload.get("title"):
        payload["title"] = title
    payload.setdefault("source_type", "Local Video")
    if duration > 0:
        payload["duration"] = round(duration, 2)
    tmp = meta_file.with_name(f".metadata.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, meta_file)
    except OSError:
        tmp.unlink(missing_ok=True)


def run_local_transcription(
    project_id: str,
    source_path: Path,
    project_directory: Path,
    cancel_event: threading.Event | None = None,
    expected_uid: str | None = None,
) -> None:
    if cancel_event is None:
        with JOBS_LOCK:
            cancel_event = TRANSCRIPTION_CANCEL_EVENTS.get(project_id)
    if expected_uid is None:
        expected_uid = get_project_uid(project_directory)

    def report_progress(step: str, step_progress: float) -> None:
        if cancel_event is not None and cancel_event.is_set():
            return
        if not verify_project_ownership(project_directory, expected_uid):
            return
        if step == "Extracting audio":
            progress = 5
        elif step == "Loading speech model":
            progress = 12
        elif step == "Transcribing audio":
            progress = min(92, 15 + round(step_progress * 0.77))
        elif step.startswith("No audio"):
            progress = 95
        else:
            progress = 95
        update_job(
            project_id,
            status="processing",
            step=step,
            progress=progress,
        )

    try:
        if not verify_project_ownership(project_directory, expected_uid):
            raise RuntimeError("Transcription cancelled")
        result = transcribe_video(
            source_path,
            project_directory / "transcription",
            progress_callback=report_progress,
            cancel_event=cancel_event,
        )
    except Exception as error:
        if cancel_event is not None and cancel_event.is_set():
            update_job(
                project_id,
                status="cancelled",
                step="Transcription cancelled",
            )
            with JOBS_LOCK:
                TRANSCRIPTION_CANCEL_EVENTS.pop(project_id, None)
            return
        logger.exception("Local transcription failed for project %s", project_id)
        update_job(
            project_id,
            status="failed",
            step="Transcription failed",
            error=str(error) or error.__class__.__name__,
        )
        with JOBS_LOCK:
            TRANSCRIPTION_CANCEL_EVENTS.pop(project_id, None)
        return

    with JOBS_LOCK:
        TRANSCRIPTION_CANCEL_EVENTS.pop(project_id, None)
    update_job(
        project_id,
        status="completed",
        step="Complete",
        progress=100,
        result={**result, "project_id": project_id},
    )


@router.post("/local-video/transcribe")
def transcribe_local_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
) -> JSONResponse:
    filename = Path(video.filename or "").name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video file type")

    project_id, project_directory = create_project_directory()
    source_path = project_directory / f"source{extension}"

    try:
        with source_path.open("wb") as destination:
            shutil.copyfileobj(video.file, destination)
    except Exception as error:
        shutil.rmtree(project_directory, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Could not save uploaded video") from error
    finally:
        video.file.close()

    cancel_event = threading.Event()
    with JOBS_LOCK:
        evict_old_transcription_jobs()
        TRANSCRIPTION_CANCEL_EVENTS[project_id] = cancel_event
        TRANSCRIPTION_JOBS[project_id] = {
            "project_id": project_id,
            "status": "queued",
            "step": "Preparing transcription",
            "progress": 0,
        }
    background_tasks.add_task(
        run_local_transcription,
        project_id,
        source_path,
        project_directory,
        cancel_event,
    )
    dur = 0.0
    try:
        from app.services.video_editor import probe_video_duration
        dur = probe_video_duration(source_path)
    except Exception:
        pass
    _save_local_metadata(project_directory, Path(filename).stem, dur)

    return JSONResponse(
        status_code=202,
        content={
            "project_id": project_id,
            "duration": round(dur, 2),
            "status": "queued",
            "step": "Preparing transcription",
            "progress": 0,
        },
    )


@router.get("/local-video/jobs/{project_id}")
def get_local_transcription_job(project_id: str) -> dict[str, Any]:
    with JOBS_LOCK:
        job = TRANSCRIPTION_JOBS.get(project_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Transcription job not found")
        return dict(job)


@router.post("/local-video/from-path")
def transcribe_from_path(
    payload: LocalVideoPathRequest,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    local_file = Path(payload.file_path)
    if not local_file.is_file():
        raise HTTPException(status_code=400, detail="Specified video file does not exist")
    extension = local_file.suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video file type")

    project_id, project_directory = create_project_directory()
    source_path = project_directory / f"source{extension}"

    try:
        try:
            # Instant zero-copy hardlink when on the same NTFS/POSIX volume
            os.link(local_file, source_path)
        except OSError:
            shutil.copyfile(local_file, source_path)
    except Exception as error:
        shutil.rmtree(project_directory, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Could not access local video file") from error

    cancel_event = threading.Event()
    with JOBS_LOCK:
        evict_old_transcription_jobs()
        TRANSCRIPTION_CANCEL_EVENTS[project_id] = cancel_event
        TRANSCRIPTION_JOBS[project_id] = {
            "project_id": project_id,
            "status": "queued",
            "step": "Preparing transcription",
            "progress": 0,
        }
    background_tasks.add_task(
        run_local_transcription,
        project_id,
        source_path,
        project_directory,
        cancel_event,
    )
    dur = 0.0
    try:
        from app.services.video_editor import probe_video_duration
        dur = probe_video_duration(source_path)
    except Exception:
        pass
    _save_local_metadata(project_directory, local_file.stem, dur)

    return JSONResponse(
        status_code=202,
        content={
            "project_id": project_id,
            "duration": round(dur, 2),
            "status": "queued",
            "step": "Preparing transcription",
            "progress": 0,
        },
    )

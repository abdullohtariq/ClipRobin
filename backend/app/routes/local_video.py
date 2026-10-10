import shutil
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.routes.download import create_project_directory
from app.services.transcriber import transcribe_video

router = APIRouter(prefix="/api")
ALLOWED_EXTENSIONS = {".avi", ".mkv", ".mov", ".mp4", ".m4v", ".webm"}
TRANSCRIPTION_JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


def update_job(project_id: str, **updates: Any) -> None:
    with JOBS_LOCK:
        job = TRANSCRIPTION_JOBS.get(project_id)
        if job is not None:
            job.update(updates)


def run_local_transcription(project_id: str, source_path: Path, project_directory: Path) -> None:
    def report_progress(step: str, step_progress: float) -> None:
        if step == "Loading speech model":
            progress = 5
        elif step == "Transcribing audio":
            progress = min(90, 10 + round(step_progress * 0.8))
        else:
            progress = 95
        update_job(
            project_id,
            status="processing",
            step=step,
            progress=progress,
        )

    try:
        result = transcribe_video(
            source_path,
            project_directory / "transcription",
            progress_callback=report_progress,
        )
    except Exception as error:
        update_job(
            project_id,
            status="failed",
            step="Transcription failed",
            error=str(error) or error.__class__.__name__,
        )
        return

    update_job(
        project_id,
        status="completed",
        step="Complete",
        progress=100,
        result=result,
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

    with JOBS_LOCK:
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
    )
    return JSONResponse(
        status_code=202,
        content={
            "project_id": project_id,
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

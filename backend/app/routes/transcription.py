import json
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse

from app.routes.local_video import (
    JOBS_LOCK,
    TRANSCRIPTION_CANCEL_EVENTS,
    TRANSCRIPTION_JOBS,
    evict_old_transcription_jobs,
    run_local_transcription,
)
from app.services.project_manager import get_project_directory

router = APIRouter(prefix="/api/projects")


def _has_complete_transcript(transcript_file: Path) -> bool:
    if not transcript_file.is_file():
        return False
    try:
        data = json.loads(transcript_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        # Legacy transcripts without "is_complete" are assumed complete if they have segments
        if "is_complete" in data:
            return bool(data["is_complete"])
        return isinstance(data.get("segments"), list)
    except Exception:
        return False


@router.post("/{project_id}/transcribe")
def transcribe(project_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    try:
        project_directory = get_project_directory(project_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    source_files = [
        p for p in project_directory.glob("source.*")
        if p.is_file() and not p.name.endswith((".part", ".ytdl", ".tmp"))
    ]
    if not source_files:
        raise HTTPException(status_code=404, detail="Source video not found")
    source_path = source_files[0]

    transcript_file = project_directory / "transcription" / "transcript.json"
    if _has_complete_transcript(transcript_file):
        with JOBS_LOCK:
            evict_old_transcription_jobs()
            TRANSCRIPTION_JOBS[project_id] = {
                "project_id": project_id,
                "status": "completed",
                "step": "Complete",
                "progress": 100,
                "result": {
                    "project_id": project_id,
                    "status": "completed",
                    "text_file": str(project_directory / "transcription" / "transcript.txt"),
                    "json_file": str(transcript_file),
                },
            }
            payload = dict(TRANSCRIPTION_JOBS[project_id])
        return JSONResponse(
            status_code=200,
            content=payload,
        )

    cancel_event = threading.Event()
    with JOBS_LOCK:
        active_job = TRANSCRIPTION_JOBS.get(project_id)
        if active_job and active_job.get("status") in {"queued", "processing"}:
            return JSONResponse(
                status_code=200,
                content=dict(active_job),
            )

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
    return JSONResponse(
        status_code=202,
        content={
            "project_id": project_id,
            "status": "queued",
            "step": "Preparing transcription",
            "progress": 0,
        },
    )

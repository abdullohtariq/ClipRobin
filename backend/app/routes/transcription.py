from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse

from app.routes.local_video import JOBS_LOCK, TRANSCRIPTION_JOBS, run_local_transcription
from app.services.project_manager import get_project_directory

router = APIRouter(prefix="/api/projects")


@router.post("/{project_id}/transcribe")
def transcribe(project_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    try:
        project_directory = get_project_directory(project_id)
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    source_files = list(project_directory.glob("source.*"))
    if not source_files:
        raise HTTPException(status_code=404, detail="Source video not found")
    source_path = source_files[0]

    transcript_file = project_directory / "transcription" / "transcript.json"
    if transcript_file.exists():
        with JOBS_LOCK:
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
        return JSONResponse(
            status_code=200,
            content=TRANSCRIPTION_JOBS[project_id],
        )

    with JOBS_LOCK:
        active_job = TRANSCRIPTION_JOBS.get(project_id)
        if active_job and active_job.get("status") in {"queued", "processing"}:
            return JSONResponse(
                status_code=200,
                content=dict(active_job),
            )

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

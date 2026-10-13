from typing import Any

from fastapi import APIRouter

from app.routes.clips import GENERATION_JOBS, JOBS_LOCK as GENERATION_JOBS_LOCK
from app.routes.local_video import JOBS_LOCK as TRANSCRIPTION_JOBS_LOCK
from app.routes.local_video import TRANSCRIPTION_JOBS

router = APIRouter(prefix="/api/jobs")


@router.get("/active")
def get_active_jobs() -> dict[str, list[dict[str, Any]]]:
    with TRANSCRIPTION_JOBS_LOCK:
        transcription_jobs = [
            {
                "id": job["project_id"],
                "kind": "transcription",
                "project_id": job["project_id"],
                "status": job["status"],
                "step": job["step"],
                "progress": job["progress"],
            }
            for job in TRANSCRIPTION_JOBS.values()
            if job["status"] in {"queued", "processing"}
        ]

    with GENERATION_JOBS_LOCK:
        generation_jobs = [
            {
                "id": job["job_id"],
                "kind": "generation",
                "project_id": job["project_id"],
                "status": job["status"],
                "step": job["step"],
                "progress": job["progress"],
                "completed_clips": job["completed_clips"],
                "total_clips": job["total_clips"],
            }
            for job in GENERATION_JOBS.values()
            if job["status"] in {"queued", "processing", "cancelling"}
        ]

    return {"jobs": transcription_jobs + generation_jobs}

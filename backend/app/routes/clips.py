import logging
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from app.services.clip_generator import generate_clips
from app.services.project_manager import get_clips_directory, get_project_directory

router = APIRouter(prefix="/api/projects")
logger = logging.getLogger(__name__)
GENERATION_JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


def project_or_404(project_id: str) -> Path:
    try:
        return get_project_directory(project_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{project_id}/generate-clips")
def generate_project_clips(
    project_id: str,
    background_tasks: BackgroundTasks,
    show_subtitles: bool = True,
) -> dict[str, str]:
    project_directory = project_or_404(project_id)
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        active_job = next(
            (
                job for job in GENERATION_JOBS.values()
                if job["project_id"] == project_id and job["status"] in {"queued", "processing"}
            ),
            None,
        )
        if active_job:
            raise HTTPException(
                status_code=409,
                detail="Clip generation is already running for this project",
            )
        GENERATION_JOBS[job_id] = {
            "job_id": job_id,
            "project_id": project_id,
            "status": "queued",
            "step": "Preparing clip analysis",
            "progress": 0,
            "completed_clips": 0,
            "total_clips": 0,
        }

    background_tasks.add_task(
        run_clip_generation,
        job_id,
        project_id,
        project_directory,
        show_subtitles,
    )
    return {"job_id": job_id}


def run_clip_generation(
    job_id: str,
    project_id: str,
    project_directory: Path,
    show_subtitles: bool,
) -> None:
    def report_progress(step: str, completed_clips: int, total_clips: int) -> None:
        if step == "Preparing clip analysis":
            progress = 5
        elif step == "Analyzing transcript":
            progress = 10
        elif step == "Rendering clips":
            progress = 15 + round(completed_clips / max(total_clips, 1) * 80)
        else:
            progress = 98
        with JOBS_LOCK:
            job = GENERATION_JOBS.get(job_id)
            if job is not None:
                job.update({
                    "status": "processing",
                    "step": step,
                    "progress": progress,
                    "completed_clips": completed_clips,
                    "total_clips": total_clips,
                })

    try:
        clips = generate_clips(
            project_directory,
            show_subtitles=show_subtitles,
            progress_callback=report_progress,
        )
    except Exception as error:
        logger.exception("Clip generation failed for project %s", project_id)
        with JOBS_LOCK:
            GENERATION_JOBS[job_id].update({
                "status": "failed",
                "step": "Clip generation failed",
                "error": str(error) or error.__class__.__name__,
            })
        return

    with JOBS_LOCK:
        GENERATION_JOBS[job_id].update({
            "status": "completed",
            "step": "Complete",
            "progress": 100,
            "completed_clips": len(clips),
            "total_clips": len(clips),
            "clips": clips,
        })


@router.get("/{project_id}/generation-jobs/{job_id}")
def get_clip_generation_job(project_id: str, job_id: str) -> dict[str, Any]:
    project_or_404(project_id)
    with JOBS_LOCK:
        job = GENERATION_JOBS.get(job_id)
        if job is None or job["project_id"] != project_id:
            raise HTTPException(status_code=404, detail="Clip generation job not found")
        return dict(job)


@router.get("/{project_id}/generation-jobs")
def get_latest_clip_generation_job(project_id: str) -> dict[str, Any]:
    project_or_404(project_id)
    with JOBS_LOCK:
        project_jobs = [
            job for job in GENERATION_JOBS.values()
            if job["project_id"] == project_id
        ]
        job = max(project_jobs, key=lambda item: item["job_id"], default=None)
        return {"job": dict(job) if job is not None else None}


@router.get("/{project_id}/clips")
def get_project_clips(project_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    clips_directory = get_clips_directory(project_id)
    analysis_path = project_directory / "analysis.json"
    analysis_clips = {}
    if analysis_path.is_file():
        import json
        analysis_clips = {clip["id"]: clip for clip in json.loads(analysis_path.read_text(encoding="utf-8")).get("clips", [])}

    clips = []
    for path in sorted(clips_directory.glob("*.mp4")):
        metadata = analysis_clips.get(path.stem, {})
        start = metadata.get("start", 0.0)
        end = metadata.get("end", 0.0)
        clips.append({
            **metadata,
            "id": path.stem,
            "duration": round(end - start, 3),
            "file": path.name,
            "status": "ready",
        })
    return {"clips": clips}


@router.get("/{project_id}/clips/{clip_id}")
def serve_clip(project_id: str, clip_id: str, download: bool = False) -> FileResponse:
    project_or_404(project_id)
    if not clip_id.endswith(".mp4") or Path(clip_id).name != clip_id:
        raise HTTPException(status_code=400, detail="Invalid clip filename")
    clip_path = get_clips_directory(project_id) / clip_id
    if not clip_path.is_file():
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(
        clip_path,
        media_type="video/mp4",
        filename=clip_path.name if download else None,
        headers={} if download else {"Content-Disposition": f'inline; filename="{clip_path.name}"'},
    )

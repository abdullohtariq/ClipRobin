import json
import logging
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from app.services.clip_generator import generate_clips, render_single_clip
from app.services.project_manager import get_clips_directory, get_project_directory
from app.services.video_editor import (
    ClipGenerationCancelled,
    VideoEditorError,
    create_clip,
    find_watermark_file,
)


class TopLineRequest(BaseModel):
    top_line: str
    show_watermark: bool | None = None
    show_subtitles: bool | None = None
    framing_mode: str | None = None


router = APIRouter(prefix="/api/projects")
logger = logging.getLogger(__name__)
GENERATION_JOBS: dict[str, dict[str, Any]] = {}
CANCEL_EVENTS: dict[str, threading.Event] = {}
JOBS_LOCK = threading.Lock()
MAX_COMPLETED_JOBS = 50


def evict_old_generation_jobs() -> None:
    completed_keys = [
        k for k, v in GENERATION_JOBS.items()
        if v.get("status") in {"completed", "failed", "cancelled"}
    ]
    if len(completed_keys) > MAX_COMPLETED_JOBS:
        for key in completed_keys[: len(completed_keys) - MAX_COMPLETED_JOBS]:
            GENERATION_JOBS.pop(key, None)
            CANCEL_EVENTS.pop(key, None)


def ask_save_path_dialog(default_filename: str, file_type: str = "mp4") -> Path | None:
    try:
        import subprocess
        import sys

        script = (
            "import tkinter as tk, sys\n"
            "from tkinter import filedialog\n"
            "root = tk.Tk()\n"
            "root.withdraw()\n"
            "root.attributes('-topmost', True)\n"
            "file_type = sys.argv[1] if len(sys.argv) > 1 else 'mp4'\n"
            "default_fn = sys.argv[2] if len(sys.argv) > 2 else 'clip.mp4'\n"
            "ext, fts = ('.zip', [('ZIP Archive (*.zip)', '*.zip'), ('All Files (*.*)', '*.*')]) "
            "if file_type == 'zip' else ('.mp4', [('MP4 Video (*.mp4)', '*.mp4'), ('All Files (*.*)', '*.*')])\n"
            "chosen = filedialog.asksaveasfilename(parent=root, title='Save As', "
            "initialfile=default_fn, defaultextension=ext, filetypes=fts)\n"
            "root.destroy()\n"
            "if chosen:\n"
            "    sys.stdout.write(chosen)\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", script, file_type, default_filename],
            capture_output=True,
            text=True,
            timeout=120,
        )
        chosen = result.stdout.strip()
        return Path(chosen) if chosen else None
    except Exception as error:
        logger.warning("Could not open native save dialog: %s", error)
        return None


def project_or_404(project_id: str) -> Path:
    try:
        return get_project_directory(project_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def finish_cancelled_job(job_id: str, project_id: str) -> None:
    try:
        clips_directory = get_clips_directory(project_id)
        for generated_clip in clips_directory.glob("*.mp4"):
            generated_clip.unlink()
        for partial_clip in clips_directory.glob(".rendering_*.mp4"):
            try:
                partial_clip.unlink()
            except OSError:
                pass
    except OSError as error:
        logger.exception("Could not remove generated clips after cancelling project %s", project_id)
        with JOBS_LOCK:
            GENERATION_JOBS[job_id].update({
                "status": "failed",
                "step": "Cancellation cleanup failed",
                "error": str(error) or error.__class__.__name__,
            })
            CANCEL_EVENTS.pop(job_id, None)
        return
    with JOBS_LOCK:
        GENERATION_JOBS[job_id].update({
            "status": "cancelled",
            "step": "Cancelled; generated clips removed",
        })
        CANCEL_EVENTS.pop(job_id, None)
        evict_old_generation_jobs()


@router.post("/{project_id}/generate-clips")
def generate_project_clips(
    project_id: str,
    background_tasks: BackgroundTasks,
    show_subtitles: bool = True,
    show_watermark: bool = False,
    clip_duration_seconds: int = 60,
    framing_mode: str | None = None,
) -> dict[str, str]:
    if clip_duration_seconds not in {15, 30, 60, 90}:
        raise HTTPException(
            status_code=422,
            detail="Clip duration must be 15, 30, 60, or 90 seconds",
        )
    if framing_mode is not None and framing_mode not in {"standard", "square_rounded", "true_9_16"}:
        raise HTTPException(
            status_code=422,
            detail="Framing mode must be 'standard', 'square_rounded', or 'true_9_16'",
        )
    project_directory = project_or_404(project_id)
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        active_job = next(
            (
                job for job in GENERATION_JOBS.values()
                if job["project_id"] == project_id
                and job["status"] in {"queued", "processing", "cancelling"}
            ),
            None,
        )
        if active_job:
            raise HTTPException(
                status_code=409,
                detail="Clip generation is already running for this project",
            )
        evict_old_generation_jobs()
        cancel_event = threading.Event()
        GENERATION_JOBS[job_id] = {
            "job_id": job_id,
            "project_id": project_id,
            "status": "queued",
            "step": "Preparing clip analysis",
            "progress": 0,
            "completed_clips": 0,
            "total_clips": 0,
            "ready_clips": [],
        }
        CANCEL_EVENTS[job_id] = cancel_event

    background_tasks.add_task(
        run_clip_generation,
        job_id,
        project_id,
        project_directory,
        show_subtitles,
        cancel_event,
        clip_duration_seconds,
        show_watermark,
        framing_mode,
    )
    return {"job_id": job_id}


def run_clip_generation(
    job_id: str,
    project_id: str,
    project_directory: Path,
    show_subtitles: bool,
    cancel_event: threading.Event,
    clip_duration_seconds: int = 60,
    show_watermark: bool = False,
    framing_mode: str | None = None,
) -> None:
    def report_progress(
        step: str,
        completed_clips: int,
        total_clips: int,
        clip_metadata: dict[str, Any] | None = None,
    ) -> None:
        if cancel_event.is_set():
            return
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
                if clip_metadata is not None:
                    ready = job.setdefault("ready_clips", [])
                    if not any(c.get("id") == clip_metadata.get("id") for c in ready):
                        ready.append(clip_metadata)
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
            show_watermark=show_watermark,
            progress_callback=report_progress,
            cancel_event=cancel_event,
            max_clip_seconds=clip_duration_seconds,
            framing_mode=framing_mode,
        )
    except ClipGenerationCancelled:
        finish_cancelled_job(job_id, project_id)
        return
    except Exception as error:
        if cancel_event.is_set():
            finish_cancelled_job(job_id, project_id)
            return
        logger.exception("Clip generation failed for project %s", project_id)
        with JOBS_LOCK:
            GENERATION_JOBS[job_id].update({
                "status": "failed",
                "step": "Clip generation failed",
                "error": str(error) or error.__class__.__name__,
            })
            CANCEL_EVENTS.pop(job_id, None)
            evict_old_generation_jobs()
        return

    with JOBS_LOCK:
        if cancel_event.is_set():
            was_cancelled = True
        else:
            was_cancelled = False
            GENERATION_JOBS[job_id].update({
                "status": "completed",
                "step": "Complete",
                "progress": 100,
                "completed_clips": len(clips),
                "total_clips": len(clips),
                "clips": clips,
                "ready_clips": clips,
            })
            CANCEL_EVENTS.pop(job_id, None)
            evict_old_generation_jobs()
    if was_cancelled:
        finish_cancelled_job(job_id, project_id)


@router.get("/{project_id}/generation-jobs/{job_id}")
def get_clip_generation_job(project_id: str, job_id: str) -> dict[str, Any]:
    project_or_404(project_id)
    with JOBS_LOCK:
        job = GENERATION_JOBS.get(job_id)
        if job is None or job["project_id"] != project_id:
            raise HTTPException(status_code=404, detail="Clip generation job not found")
        return dict(job)


@router.post("/{project_id}/generation-jobs/{job_id}/cancel")
def cancel_clip_generation(project_id: str, job_id: str) -> dict[str, Any]:
    project_or_404(project_id)
    with JOBS_LOCK:
        job = GENERATION_JOBS.get(job_id)
        if job is None or job["project_id"] != project_id:
            raise HTTPException(status_code=404, detail="Clip generation job not found")
        if job["status"] not in {"queued", "processing", "cancelling"}:
            return dict(job)
        cancel_event = CANCEL_EVENTS.get(job_id)
        if cancel_event is None:
            raise HTTPException(status_code=409, detail="Clip generation can no longer be cancelled")
        cancel_event.set()
        job.update({
            "status": "cancelling",
            "step": "Cancelling and removing generated clips",
        })
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
    framing_mode = "standard"
    if analysis_path.is_file():
        try:
            analysis_data = json.loads(analysis_path.read_text(encoding="utf-8"))
            analysis_clips = {clip["id"]: clip for clip in analysis_data.get("clips", [])}
            framing_mode = analysis_data.get("generation_options", {}).get("framing_mode", "standard")
        except json.JSONDecodeError:
            analysis_clips = {}

    clips = []
    for path in sorted(clips_directory.glob("*.mp4")):
        if path.name.startswith("."):
            continue
        metadata = analysis_clips.get(path.stem, {})
        start = metadata.get("start", 0.0)
        end = metadata.get("end", 0.0)
        clips.append({
            **metadata,
            "id": path.stem,
            "duration": round(end - start, 3),
            "file": path.name,
            "top_line": metadata.get("top_line", ""),
            "framing_mode": metadata.get("framing_mode", framing_mode),
            "status": "ready",
        })
    return {"clips": clips}


@router.post("/{project_id}/clips/{clip_id}/top-line")
def update_clip_top_line(
    project_id: str,
    clip_id: str,
    payload: TopLineRequest,
) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    raw_clip_id = clip_id[:-4] if clip_id.endswith(".mp4") else clip_id
    try:
        updated_clip = render_single_clip(
            project_directory=project_directory,
            clip_id=raw_clip_id,
            top_line=payload.top_line,
            show_watermark=payload.show_watermark,
            show_subtitles=payload.show_subtitles,
            framing_mode=payload.framing_mode,
        )
        return {"clip": updated_clip}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except VideoEditorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.delete("/{project_id}/clips/{clip_id}/top-line")
def delete_clip_top_line(
    project_id: str,
    clip_id: str,
    show_watermark: bool | None = None,
    show_subtitles: bool | None = None,
    framing_mode: str | None = None,
) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    raw_clip_id = clip_id[:-4] if clip_id.endswith(".mp4") else clip_id
    try:
        updated_clip = render_single_clip(
            project_directory=project_directory,
            clip_id=raw_clip_id,
            top_line=None,
            show_watermark=show_watermark,
            show_subtitles=show_subtitles,
            framing_mode=framing_mode,
        )
        return {"clip": updated_clip}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except VideoEditorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/{project_id}/clips/download-all")
def download_all_project_clips(project_id: str) -> FileResponse:
    project_or_404(project_id)
    clip_paths = [p for p in sorted(get_clips_directory(project_id).glob("*.mp4")) if not p.name.startswith(".")]
    if not clip_paths:
        raise HTTPException(status_code=404, detail="No clips are available to download")

    archive_directory = tempfile.TemporaryDirectory(prefix="cliprobin-")
    archive_path = Path(archive_directory.name) / f"{project_id}-clips.zip"
    try:
        with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
            for clip_path in clip_paths:
                archive.write(clip_path, arcname=clip_path.name)
    except (OSError, RuntimeError, ValueError):
        archive_directory.cleanup()
        raise

    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=f"{project_id}-clips.zip",
        background=BackgroundTask(archive_directory.cleanup),
    )


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


@router.post("/{project_id}/clips/{clip_id}/save-dialog")
def export_clip_with_dialog(project_id: str, clip_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    raw_clip_id = clip_id if clip_id.endswith(".mp4") else f"{clip_id}.mp4"
    clip_path = get_clips_directory(project_id) / raw_clip_id
    if not clip_path.is_file():
        raise HTTPException(status_code=404, detail="Clip not found")

    chosen_path = ask_save_path_dialog(clip_path.name, file_type="mp4")
    if not chosen_path:
        return {"saved": False, "cancelled": True}

    try:
        chosen_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(clip_path, chosen_path)
        return {"saved": True, "path": str(chosen_path)}
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Could not save clip: {error}") from error


@router.post("/{project_id}/clips/download-all-dialog")
def export_all_clips_with_dialog(project_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    clip_paths = [p for p in sorted(get_clips_directory(project_id).glob("*.mp4")) if not p.name.startswith(".")]
    if not clip_paths:
        raise HTTPException(status_code=404, detail="No clips are available to download")

    default_name = f"{project_id}-clips.zip"
    chosen_path = ask_save_path_dialog(default_name, file_type="zip")
    if not chosen_path:
        return {"saved": False, "cancelled": True}

    try:
        chosen_path.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(chosen_path, "w", compression=ZIP_DEFLATED) as archive:
            for clip_path in clip_paths:
                archive.write(clip_path, arcname=clip_path.name)
        return {"saved": True, "path": str(chosen_path)}
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Could not save archive: {error}") from error

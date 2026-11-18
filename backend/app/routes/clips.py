import json
import logging
import os
import shutil
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from app.services.ai_analyzer import is_safe_clip_id
from app.services.ai_developer_mode import get_ai_developer_status
from app.services.caption_styles import ANIMATIONS, CAPTION_STYLES, STYLE_ALIASES
from app.services.clip_generator import (
    cleanup_staged_job,
    generate_clips,
    recover_project_generation_state,
    render_single_clip,
)
from app.services.process_utils import get_no_window_subprocess_kwargs
from app.services.project_manager import (
    get_clips_directory,
    get_project_directory,
    get_project_uid,
    verify_project_ownership,
)
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
    caption_style: str | None = None
    caption_animation: str | None = None
    face_tracking: bool | None = None
    tracking_mode: str | None = None
    crop_anchor_x: float | None = None


class ReframeClipRequest(BaseModel):
    framing_mode: str | None = None
    face_tracking: bool | None = None
    tracking_mode: str | None = None
    crop_anchor_x: float | None = None


router = APIRouter(prefix="/api/projects")
logger = logging.getLogger(__name__)
GENERATION_JOBS: dict[str, dict[str, Any]] = {}
CANCEL_EVENTS: dict[str, threading.Event] = {}
JOBS_LOCK = threading.Lock()
MAX_COMPLETED_JOBS = 50
_JOB_SEQ = 0


def _snapshot_job(job: dict[str, Any]) -> dict[str, Any]:
    snap = dict(job)
    if "ready_clips" in snap and isinstance(snap["ready_clips"], list):
        snap["ready_clips"] = list(snap["ready_clips"])
    if "clips" in snap and isinstance(snap["clips"], list):
        snap["clips"] = list(snap["clips"])
    return snap


def _clip_version_token(path: Path) -> str:
    try:
        st = path.stat()
        return f"{st.st_mtime_ns}_{st.st_size}"
    except OSError:
        return str(int(time.time() * 1000))


def _validate_clip_stem(clip_id: str) -> str:
    raw = clip_id[:-4] if clip_id.endswith(".mp4") else clip_id
    if (
        not raw
        or raw in {".", ".."}
        or "/" in raw
        or "\\" in raw
        or ".." in raw
        or Path(raw).name != raw
        or any(ch in raw for ch in "*?[]:<>|\"")
    ):
        raise HTTPException(status_code=400, detail="Invalid clip identifier")
    return raw


def _validate_render_options(
    framing_mode: str | None,
    caption_style: str | None,
    caption_animation: str | None,
    tracking_mode: str | None = None,
    crop_anchor_x: float | None = None,
) -> None:
    if framing_mode is not None and framing_mode not in {"standard", "square_rounded", "true_9_16"}:
        raise HTTPException(
            status_code=422,
            detail="Framing mode must be 'standard', 'square_rounded', or 'true_9_16'",
        )
    allowed_styles = set(CAPTION_STYLES.keys()).union(STYLE_ALIASES.keys())
    if caption_style is not None and caption_style not in allowed_styles:
        raise HTTPException(
            status_code=422,
            detail=f"Caption style must be one of: {sorted(allowed_styles)}",
        )
    if caption_animation is not None and caption_animation not in ANIMATIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Caption animation must be one of: {sorted(ANIMATIONS.keys())}",
        )
    if tracking_mode is not None and tracking_mode not in {"locked", "cuts", "follow"}:
        raise HTTPException(
            status_code=422,
            detail="Tracking mode must be 'locked', 'cuts', or 'follow'",
        )
    if crop_anchor_x is not None and not (0.0 <= float(crop_anchor_x) <= 1.0):
        raise HTTPException(
            status_code=422,
            detail="Crop anchor must be between 0.0 and 1.0",
        )


def _job_matches_project(
    job: dict[str, Any],
    project_id: str,
    project_directory: Path | None = None,
    project_uid: str | None = None,
) -> bool:
    if job.get("project_id") != project_id:
        return False
    job_dir = job.get("project_dir")
    if project_directory is not None and job_dir:
        try:
            if Path(job_dir).resolve() != project_directory.resolve():
                return False
        except OSError:
            if str(job_dir) != str(project_directory):
                return False
    job_uid = job.get("project_uid")
    if project_uid and job_uid and job_uid != project_uid:
        return False
    return True


def _active_stage_ids_for_project(
    project_id: str,
    project_directory: Path | None = None,
) -> set[str]:
    expected_uid = get_project_uid(project_directory) if project_directory is not None else None
    with JOBS_LOCK:
        return {
            job["job_id"]
            for job in GENERATION_JOBS.values()
            if _job_matches_project(job, project_id, project_directory, expected_uid)
            and job.get("status") in {"queued", "processing", "cancelling"}
            and isinstance(job.get("job_id"), str)
        }


def _assert_no_active_generation(
    project_id: str,
    project_directory: Path | None = None,
) -> None:
    if _active_stage_ids_for_project(project_id, project_directory):
        raise HTTPException(
            status_code=409,
            detail="Wait for clip generation to finish before editing individual clips",
        )


def evict_old_generation_jobs() -> None:
    completed_keys = [
        k for k, v in GENERATION_JOBS.items()
        if v.get("status") in {"completed", "failed", "cancelled"}
    ]
    if len(completed_keys) > MAX_COMPLETED_JOBS:
        for key in completed_keys[: len(completed_keys) - MAX_COMPLETED_JOBS]:
            GENERATION_JOBS.pop(key, None)
            CANCEL_EVENTS.pop(key, None)


def _ask_save_path_dialog_windows(default_filename: str, file_type: str = "mp4") -> Path | None:
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD),
            ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE),
            ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR),
            ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD),
            ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD),
            ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD),
            ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR),
            ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD),
            ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR),
            ("lCustData", wintypes.LPARAM),
            ("lpfnHook", ctypes.c_void_p),
            ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", ctypes.c_void_p),
            ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    safe_default = Path(default_filename).name or ("clips.zip" if file_type == "zip" else "clip.mp4")
    file_buffer = ctypes.create_unicode_buffer(safe_default, 4096)
    if file_type == "zip":
        filter_str = "ZIP Archive (*.zip)\0*.zip\0All Files (*.*)\0*.*\0\0"
        def_ext = "zip"
    else:
        filter_str = "MP4 Video (*.mp4)\0*.mp4\0All Files (*.*)\0*.*\0\0"
        def_ext = "mp4"

    OFN_OVERWRITEPROMPT = 0x00000002
    OFN_NOCHANGEDIR = 0x00000008
    OFN_PATHMUSTEXIST = 0x00000800
    OFN_EXPLORER = 0x00080000

    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    try:
        ofn.hwndOwner = ctypes.windll.user32.GetForegroundWindow()
    except Exception:
        ofn.hwndOwner = None
    ofn.lpstrFilter = filter_str
    ofn.nFilterIndex = 1
    ofn.lpstrFile = ctypes.cast(file_buffer, wintypes.LPWSTR)
    ofn.nMaxFile = len(file_buffer)
    ofn.lpstrTitle = "Save As"
    ofn.Flags = OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_EXPLORER
    ofn.lpstrDefExt = def_ext

    get_save_file_name = ctypes.windll.comdlg32.GetSaveFileNameW
    get_save_file_name.argtypes = [ctypes.POINTER(OPENFILENAMEW)]
    get_save_file_name.restype = wintypes.BOOL

    if get_save_file_name(ctypes.byref(ofn)):
        chosen = file_buffer.value.strip()
        return Path(chosen) if chosen else None
    return None


def ask_save_path_dialog(default_filename: str, file_type: str = "mp4") -> Path | None:
    try:
        if os.name == "nt":
            return _ask_save_path_dialog_windows(default_filename, file_type=file_type)

        if getattr(sys, "frozen", False):
            return None

        import subprocess

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
            **get_no_window_subprocess_kwargs(),
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
        project_directory = get_project_directory(project_id)
        cleanup_staged_job(project_directory, job_id)
    except (FileNotFoundError, ValueError):
        pass
    except OSError as error:
        logger.exception("Could not clean up staged job %s after cancelling project %s", job_id, project_id)
        with JOBS_LOCK:
            job = GENERATION_JOBS.get(job_id)
            if job is not None:
                job.update({
                    "status": "failed",
                    "step": "Cancellation cleanup failed",
                    "error": str(error) or error.__class__.__name__,
                    "ready_clips": [],
                    "completed_clips": 0,
                })
            CANCEL_EVENTS.pop(job_id, None)
        return
    with JOBS_LOCK:
        job = GENERATION_JOBS.get(job_id)
        if job is not None:
            job.update({
                "status": "cancelled",
                "step": "Cancelled; previous clips kept",
                "ready_clips": [],
                "completed_clips": 0,
            })
        CANCEL_EVENTS.pop(job_id, None)
        evict_old_generation_jobs()


@router.post("/{project_id}/generate-clips")
def generate_project_clips(
    project_id: str,
    background_tasks: BackgroundTasks,
    show_subtitles: bool = True,
    show_watermark: bool = False,
    clip_duration_seconds: int = 30,
    clip_count: int | None = None,
    generation_mode: str = "random",
    framing_mode: str | None = None,
    caption_style: str | None = None,
    caption_animation: str | None = None,
    face_tracking: bool | None = None,
    tracking_mode: str | None = None,
    crop_anchor_x: float | None = None,
) -> dict[str, str]:
    if generation_mode not in {"random", "ai"}:
        raise HTTPException(status_code=422, detail="Generation mode must be 'random' or 'ai'.")
    if generation_mode == "ai":
        ai_status = get_ai_developer_status()
        if not ai_status["ai_enabled"]:
            raise HTTPException(status_code=403, detail=ai_status["reason"] or "AI Developer Mode is disabled.")
    if clip_duration_seconds not in {12, 15, 30, 60, 90}:
        raise HTTPException(
            status_code=422,
            detail="Clip duration must be 12, 15, 30, 60, or 90 seconds",
        )
    if clip_count is not None and clip_count < 1:
        raise HTTPException(
            status_code=422,
            detail="Clip count must be at least 1",
        )
    _validate_render_options(
        framing_mode,
        caption_style,
        caption_animation,
        tracking_mode=tracking_mode,
        crop_anchor_x=crop_anchor_x,
    )

    project_directory = project_or_404(project_id)
    expected_uid = get_project_uid(project_directory)
    job_id = uuid.uuid4().hex
    global _JOB_SEQ
    with JOBS_LOCK:
        active_job = next(
            (
                job for job in GENERATION_JOBS.values()
                if _job_matches_project(job, project_id, project_directory, expected_uid)
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
        _JOB_SEQ += 1
        cancel_event = threading.Event()
        GENERATION_JOBS[job_id] = {
            "job_id": job_id,
            "project_id": project_id,
            "project_dir": str(project_directory.resolve()),
            "project_uid": expected_uid,
            "status": "queued",
            "step": "Preparing clip analysis",
            "progress": 0,
            "completed_clips": 0,
            "total_clips": 0,
            "ready_clips": [],
            "requested_generation_mode": generation_mode,
            "applied_generation_mode": generation_mode,
            "created_seq": _JOB_SEQ,
            "created_at": time.monotonic(),
        }
        CANCEL_EVENTS[job_id] = cancel_event

    bg_kwargs: dict[str, Any] = {}
    if tracking_mode is not None:
        bg_kwargs["tracking_mode"] = tracking_mode
    if crop_anchor_x is not None:
        bg_kwargs["crop_anchor_x"] = crop_anchor_x
    if expected_uid is not None:
        bg_kwargs["expected_uid"] = expected_uid

    background_tasks.add_task(
        run_clip_generation,
        job_id,
        project_id,
        project_directory,
        show_subtitles,
        cancel_event,
        clip_duration_seconds,
        clip_count,
        generation_mode,
        show_watermark,
        framing_mode,
        caption_style,
        caption_animation,
        face_tracking,
        **bg_kwargs,
    )
    return {"job_id": job_id}


def run_clip_generation(
    job_id: str,
    project_id: str,
    project_directory: Path,
    show_subtitles: bool,
    cancel_event: threading.Event,
    clip_duration_seconds: int = 30,
    clip_count: int | None = None,
    generation_mode: str = "random",
    show_watermark: bool = False,
    framing_mode: str | None = None,
    caption_style: str | None = None,
    caption_animation: str | None = None,
    face_tracking: bool | None = None,
    tracking_mode: str | None = None,
    crop_anchor_x: float | None = None,
    expected_uid: str | None = None,
) -> None:
    if expected_uid is None:
        expected_uid = get_project_uid(project_directory)

    def report_progress(
        step: str,
        completed_clips: int,
        total_clips: int,
        clip_metadata: dict[str, Any] | None = None,
    ) -> None:
        if cancel_event.is_set() or not verify_project_ownership(project_directory, expected_uid):
            return
        if step == "Preparing clip analysis":
            progress = 3
        elif step.startswith("Transcribing"):
            pct_val = 0
            if "(" in step and "%" in step:
                try:
                    pct_val = int(step.split("(")[-1].split("%")[0].strip())
                except Exception:
                    pct_val = 0
            progress = 3 + round((pct_val / 100.0) * 5)
        elif step == "Analyzing transcript":
            progress = 10
        elif step.startswith("Analyzing speaker tracking") or step.startswith("Analyzing face tracking"):
            pct_val = 0
            if ":" in step and "%" in step:
                try:
                    pct_val = int(step.split(":")[-1].replace("%", "").strip())
                except Exception:
                    pct_val = 0
            progress = 10 + round((pct_val / 100.0) * 15)
        elif step == "Rendering clips":
            progress = 25 + round(completed_clips / max(total_clips, 1) * 70)
        else:
            progress = 98
        with JOBS_LOCK:
            job = GENERATION_JOBS.get(job_id)
            if job is not None:
                if clip_metadata is not None:
                    ready = job.setdefault("ready_clips", [])
                    if not any(c.get("id") == clip_metadata.get("id") for c in ready):
                        ready.append(clip_metadata)
                    if "applied_generation_mode" in clip_metadata:
                        job["applied_generation_mode"] = clip_metadata["applied_generation_mode"]
                job.update({
                    "status": "processing",
                    "step": step,
                    "progress": progress,
                    "completed_clips": completed_clips,
                    "total_clips": total_clips,
                })

    try:
        if not verify_project_ownership(project_directory, expected_uid):
            raise ClipGenerationCancelled("Project was deleted or replaced")
        gen_kwargs: dict[str, Any] = {
            "show_subtitles": show_subtitles,
            "show_watermark": show_watermark,
            "progress_callback": report_progress,
            "cancel_event": cancel_event,
            "max_clip_seconds": clip_duration_seconds,
            "requested_clip_count": clip_count,
            "generation_mode": generation_mode,
            "framing_mode": framing_mode,
            "caption_style": caption_style,
            "caption_animation": caption_animation,
            "face_tracking": face_tracking,
            "job_id": job_id,
        }
        if tracking_mode is not None:
            gen_kwargs["tracking_mode"] = tracking_mode
        if crop_anchor_x is not None:
            gen_kwargs["crop_anchor_x"] = crop_anchor_x
        clips = generate_clips(project_directory, **gen_kwargs)
    except ClipGenerationCancelled:
        finish_cancelled_job(job_id, project_id)
        return
    except Exception as error:
        if cancel_event.is_set():
            finish_cancelled_job(job_id, project_id)
            return
        logger.exception("Clip generation failed for project %s", project_id)
        try:
            cleanup_staged_job(project_directory, job_id)
        except Exception:
            pass
        with JOBS_LOCK:
            job = GENERATION_JOBS.get(job_id)
            if job is not None:
                job.update({
                    "status": "failed",
                    "step": "Clip generation failed",
                    "error": str(error) or error.__class__.__name__,
                    "ready_clips": [],
                    "completed_clips": 0,
                })
            CANCEL_EVENTS.pop(job_id, None)
            evict_old_generation_jobs()
        return

    committed_opts: dict[str, Any] = {}
    analysis_file = project_directory / "analysis.json"
    if analysis_file.is_file():
        try:
            loaded_analysis = json.loads(analysis_file.read_text(encoding="utf-8"))
            if isinstance(loaded_analysis, dict) and isinstance(loaded_analysis.get("generation_options"), dict):
                committed_opts = loaded_analysis["generation_options"]
        except Exception:
            committed_opts = {}

    with JOBS_LOCK:
        if cancel_event.is_set():
            was_cancelled = True
        else:
            was_cancelled = False
            job = GENERATION_JOBS.get(job_id)
            if job is not None:
                job.update({
                    "status": "completed",
                    "step": "Complete",
                    "progress": 100,
                    "completed_clips": len(clips),
                    "total_clips": len(clips),
                    "clips": clips,
                    "ready_clips": clips,
                    "requested_generation_mode": committed_opts.get("requested_generation_mode", generation_mode),
                    "applied_generation_mode": committed_opts.get("applied_generation_mode", generation_mode),
                    "ai_provider": committed_opts.get("ai_provider"),
                    "ai_model": committed_opts.get("ai_model"),
                    "ai_fallback_reason": committed_opts.get("ai_fallback_reason"),
                    "applied_tracking_mode": committed_opts.get("applied_tracking_mode"),
                    "tracking_fallback_reason": committed_opts.get("tracking_fallback_reason"),
                })
            CANCEL_EVENTS.pop(job_id, None)
            evict_old_generation_jobs()
    if was_cancelled:
        finish_cancelled_job(job_id, project_id)


@router.get("/{project_id}/generation-jobs/{job_id}")
def get_clip_generation_job(project_id: str, job_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    expected_uid = get_project_uid(project_directory)
    with JOBS_LOCK:
        job = GENERATION_JOBS.get(job_id)
        if job is None or not _job_matches_project(job, project_id, project_directory, expected_uid):
            raise HTTPException(status_code=404, detail="Clip generation job not found")
        return _snapshot_job(job)


@router.post("/{project_id}/generation-jobs/{job_id}/cancel")
def cancel_clip_generation(project_id: str, job_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    expected_uid = get_project_uid(project_directory)
    with JOBS_LOCK:
        job = GENERATION_JOBS.get(job_id)
        if job is None or not _job_matches_project(job, project_id, project_directory, expected_uid):
            raise HTTPException(status_code=404, detail="Clip generation job not found")
        if job["status"] not in {"queued", "processing", "cancelling"}:
            return _snapshot_job(job)
        cancel_event = CANCEL_EVENTS.get(job_id)
        if cancel_event is None:
            raise HTTPException(status_code=409, detail="Clip generation can no longer be cancelled")
        cancel_event.set()
        job.update({
            "status": "cancelling",
            "step": "Cancelling generation; keeping previous clips",
        })
        return _snapshot_job(job)


@router.get("/{project_id}/generation-jobs")
def get_latest_clip_generation_job(project_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    expected_uid = get_project_uid(project_directory)
    with JOBS_LOCK:
        project_jobs = [
            job for job in GENERATION_JOBS.values()
            if _job_matches_project(job, project_id, project_directory, expected_uid)
        ]
        if not project_jobs:
            return {"job": None}
        latest_idx, latest_job = max(
            enumerate(project_jobs),
            key=lambda pair: (
                int(pair[1].get("created_seq", 0)),
                float(pair[1].get("created_at", 0.0)),
                pair[0],
            ),
        )
        _ = latest_idx
        return {"job": _snapshot_job(latest_job)}


@router.get("/{project_id}/clips")
def get_project_clips(project_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    recover_project_generation_state(
        project_directory,
        active_stage_ids=_active_stage_ids_for_project(project_id, project_directory),
    )
    clips_directory = get_clips_directory(project_id)
    analysis_path = project_directory / "analysis.json"
    analysis_clips = {}
    generation_options: dict[str, Any] = {}
    framing_mode = "standard"
    caption_style = "classic"
    caption_animation = None
    face_tracking = True
    tracking_mode = "follow"
    crop_anchor_x = 0.5
    if analysis_path.is_file():
        try:
            analysis_data = json.loads(analysis_path.read_text(encoding="utf-8"))
            analysis_clips = {
                clip["id"]: clip
                for clip in analysis_data.get("clips", [])
                if isinstance(clip, dict) and is_safe_clip_id(clip.get("id"))
            }
            generation_options = (
                analysis_data.get("generation_options", {})
                if isinstance(analysis_data.get("generation_options"), dict)
                else {}
            )
            framing_mode = generation_options.get("framing_mode", "standard")
            caption_style = generation_options.get("caption_style", "classic")
            caption_animation = generation_options.get("caption_animation")
            face_tracking = bool(generation_options.get("face_tracking", True))
            tracking_mode = str(
                generation_options.get("tracking_mode") or ("follow" if face_tracking else "locked")
            )
            crop_anchor_x = float(generation_options.get("crop_anchor_x", 0.5) or 0.5)
        except (json.JSONDecodeError, TypeError, ValueError):
            analysis_clips = {}

    clips = []
    for path in sorted(clips_directory.glob("*.mp4")):
        if path.name.startswith(".") or not is_safe_clip_id(path.stem):
            continue
        metadata = analysis_clips.get(path.stem, {})
        start = metadata.get("start", 0.0)
        end = metadata.get("end", 0.0)
        clip_ft = bool(metadata.get("face_tracking", face_tracking))
        clip_tm = str(
            metadata.get("tracking_mode")
            or (tracking_mode if metadata.get("tracking_mode") is None else metadata.get("tracking_mode"))
            or ("follow" if clip_ft else "locked")
        )
        clips.append({
            **metadata,
            "id": path.stem,
            "duration": round(end - start, 3),
            "file": path.name,
            "v": _clip_version_token(path),
            "top_line": metadata.get("top_line", ""),
            "framing_mode": metadata.get("framing_mode", framing_mode),
            "caption_style": metadata.get("caption_style", caption_style),
            "caption_animation": metadata.get("caption_animation", caption_animation),
            "face_tracking": clip_ft,
            "tracking_mode": clip_tm,
            "crop_anchor_x": float(metadata.get("crop_anchor_x", crop_anchor_x)),
            "requested_generation_mode": generation_options.get("requested_generation_mode"),
            "applied_generation_mode": generation_options.get("applied_generation_mode", generation_options.get("generation_mode")),
            "status": "ready",
        })

    source_duration = 0.0
    for meta_candidate in (
        project_directory / "metadata.json",
        project_directory / "transcription" / "transcript.json",
        project_directory / "transcript.json",
    ):
        if meta_candidate.is_file():
            try:
                meta_obj = json.loads(meta_candidate.read_text(encoding="utf-8"))
                if isinstance(meta_obj, dict):
                    dur_val = float(meta_obj.get("duration", 0.0) or 0.0)
                    if dur_val > 0:
                        source_duration = dur_val
                        break
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                pass

    if source_duration <= 0:
        source_files = [
            p for p in project_directory.glob("source.*")
            if p.is_file() and not p.name.lower().endswith((".part", ".ytdl", ".json", ".txt", ".tmp"))
        ]
        if source_files:
            try:
                from app.services.video_editor import probe_video_duration
                source_duration = probe_video_duration(source_files[0])
            except Exception:
                source_duration = 0.0

    return {
        "clips": clips,
        "source_duration": round(source_duration, 2),
        "generation_options": generation_options,
    }


@router.get("/{project_id}/crop-preview")
def get_project_crop_preview(
    project_id: str,
    start: float = 0.0,
    end: float = 15.0,
    tracking_mode: str = "locked",
    crop_anchor_x: float = 0.5,
) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    if tracking_mode not in {"locked", "cuts", "follow"}:
        raise HTTPException(status_code=422, detail="Tracking mode must be 'locked', 'cuts', or 'follow'")
    if not (0.0 <= crop_anchor_x <= 1.0):
        raise HTTPException(status_code=422, detail="Crop anchor must be between 0.0 and 1.0")
    try:
        from app.services.smart_framing import analyze_speaker_tracking, build_clip_crop_preview
        from app.services.video_editor import find_ffmpeg
        td = analyze_speaker_tracking(
            project_directory=project_directory,
            ffmpeg_path=find_ffmpeg(),
            max_duration=max(1.0, end + 1.0),
            face_tracking=(tracking_mode == "follow"),
            tracking_mode=tracking_mode,
            crop_anchor_x=crop_anchor_x,
        )
        return build_clip_crop_preview(td, start, end)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{project_id}/clips/{clip_id}/reframe")
def reframe_single_clip(
    project_id: str,
    clip_id: str,
    payload: ReframeClipRequest,
) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    _assert_no_active_generation(project_id, project_directory)
    raw_clip_id = _validate_clip_stem(clip_id)
    _validate_render_options(
        payload.framing_mode,
        None,
        None,
        tracking_mode=payload.tracking_mode,
        crop_anchor_x=payload.crop_anchor_x,
    )
    try:
        updated_clip = render_single_clip(
            project_directory=project_directory,
            clip_id=raw_clip_id,
            framing_mode=payload.framing_mode,
            face_tracking=payload.face_tracking,
            tracking_mode=payload.tracking_mode,
            crop_anchor_x=payload.crop_anchor_x,
            preserve_project_options=True,
            keep_existing_top_line=True,
        )
        return {"clip": updated_clip}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except VideoEditorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/{project_id}/clips/{clip_id}/top-line")
def update_clip_top_line(
    project_id: str,
    clip_id: str,
    payload: TopLineRequest,
) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    _assert_no_active_generation(project_id, project_directory)
    raw_clip_id = _validate_clip_stem(clip_id)
    _validate_render_options(
        payload.framing_mode,
        payload.caption_style,
        payload.caption_animation,
        tracking_mode=payload.tracking_mode,
        crop_anchor_x=payload.crop_anchor_x,
    )
    try:
        render_kwargs: dict[str, Any] = {
            "project_directory": project_directory,
            "clip_id": raw_clip_id,
            "top_line": payload.top_line,
            "show_watermark": payload.show_watermark,
            "show_subtitles": payload.show_subtitles,
            "framing_mode": payload.framing_mode,
            "caption_style": payload.caption_style,
            "caption_animation": payload.caption_animation,
            "face_tracking": payload.face_tracking,
        }
        if payload.tracking_mode is not None:
            render_kwargs["tracking_mode"] = payload.tracking_mode
        if payload.crop_anchor_x is not None:
            render_kwargs["crop_anchor_x"] = payload.crop_anchor_x
        updated_clip = render_single_clip(**render_kwargs)
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
    caption_style: str | None = None,
    caption_animation: str | None = None,
    face_tracking: bool | None = None,
    tracking_mode: str | None = None,
    crop_anchor_x: float | None = None,
) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    _assert_no_active_generation(project_id, project_directory)
    raw_clip_id = _validate_clip_stem(clip_id)
    _validate_render_options(
        framing_mode,
        caption_style,
        caption_animation,
        tracking_mode=tracking_mode,
        crop_anchor_x=crop_anchor_x,
    )
    try:
        render_kwargs: dict[str, Any] = {
            "project_directory": project_directory,
            "clip_id": raw_clip_id,
            "top_line": None,
            "show_watermark": show_watermark,
            "show_subtitles": show_subtitles,
            "framing_mode": framing_mode,
            "caption_style": caption_style,
            "caption_animation": caption_animation,
            "face_tracking": face_tracking,
        }
        if tracking_mode is not None:
            render_kwargs["tracking_mode"] = tracking_mode
        if crop_anchor_x is not None:
            render_kwargs["crop_anchor_x"] = crop_anchor_x
        updated_clip = render_single_clip(**render_kwargs)
        return {"clip": updated_clip}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except VideoEditorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/{project_id}/clips/download-all")
def download_all_project_clips(project_id: str) -> FileResponse:
    project_directory = project_or_404(project_id)
    recover_project_generation_state(
        project_directory,
        active_stage_ids=_active_stage_ids_for_project(project_id, project_directory),
    )
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
def serve_clip(
    project_id: str,
    clip_id: str,
    download: bool = False,
    stage_job_id: str | None = None,
) -> FileResponse:
    project_directory = project_or_404(project_id)
    if not clip_id.endswith(".mp4") or Path(clip_id).name != clip_id:
        raise HTTPException(status_code=400, detail="Invalid clip filename")
    _validate_clip_stem(clip_id)

    clip_path: Path | None = None
    if stage_job_id:
        if stage_job_id in _active_stage_ids_for_project(project_id, project_directory):
            safe_stage = stage_job_id
            if not safe_stage.replace("-", "").replace("_", "").isalnum():
                raise HTTPException(status_code=400, detail="Invalid stage job identifier")
            staged_candidate = (project_directory / f".staging_{safe_stage}" / clip_id).resolve()
            staging_root = (project_directory / f".staging_{safe_stage}").resolve()
            if staged_candidate.is_relative_to(staging_root) and staged_candidate.is_file():
                clip_path = staged_candidate

    if clip_path is None:
        recover_project_generation_state(
            project_directory,
            active_stage_ids=_active_stage_ids_for_project(project_id, project_directory),
        )
        clip_path = get_clips_directory(project_id) / clip_id

    if not clip_path.is_file():
        raise HTTPException(status_code=404, detail="Clip not found")
    response_headers = {"Cache-Control": "no-cache"}
    if not download:
        response_headers["Content-Disposition"] = f'inline; filename="{clip_path.name}"'
    return FileResponse(
        clip_path,
        media_type="video/mp4",
        filename=clip_path.name if download else None,
        headers=response_headers,
    )


@router.post("/{project_id}/clips/{clip_id}/save-dialog")
def export_clip_with_dialog(project_id: str, clip_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    recover_project_generation_state(
        project_directory,
        active_stage_ids=_active_stage_ids_for_project(project_id, project_directory),
    )
    stem = _validate_clip_stem(clip_id)
    raw_clip_id = f"{stem}.mp4"
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
    recover_project_generation_state(
        project_directory,
        active_stage_ids=_active_stage_ids_for_project(project_id, project_directory),
    )
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

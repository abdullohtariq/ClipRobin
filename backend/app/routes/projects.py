import json
import os
import shutil
import threading
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.routes.clips import CANCEL_EVENTS, GENERATION_JOBS, JOBS_LOCK as CLIPS_LOCK
from app.routes.download import DOWNLOAD_CANCEL_EVENTS, DOWNLOAD_JOBS, DOWNLOAD_JOBS_LOCK
from app.routes.local_video import (
    JOBS_LOCK as TRANSCRIPTION_LOCK,
    TRANSCRIPTION_CANCEL_EVENTS,
    TRANSCRIPTION_JOBS,
)
from app.services.project_manager import get_project_directory, list_projects

router = APIRouter(prefix="/api/projects")


def _cancel_active_jobs(project_id: str) -> None:
    # 1. Cancel generation jobs
    with CLIPS_LOCK:
        for job_id, job in list(GENERATION_JOBS.items()):
            if job.get("project_id") == project_id:
                event = CANCEL_EVENTS.get(job_id)
                if event:
                    event.set()
                job.update({"status": "cancelled", "step": "Cancelled due to project deletion"})

    # 2. Cancel transcription jobs
    with TRANSCRIPTION_LOCK:
        t_event = TRANSCRIPTION_CANCEL_EVENTS.get(project_id)
        if t_event:
            t_event.set()
        if project_id in TRANSCRIPTION_JOBS:
            TRANSCRIPTION_JOBS[project_id].update({
                "status": "cancelled",
                "step": "Cancelled due to project deletion",
            })

    # 3. Cancel download jobs
    with DOWNLOAD_JOBS_LOCK:
        d_event = DOWNLOAD_CANCEL_EVENTS.get(project_id)
        if d_event:
            d_event.set()
        if project_id in DOWNLOAD_JOBS:
            DOWNLOAD_JOBS[project_id].update({
                "status": "cancelled",
                "step": "Cancelled due to project deletion",
            })


def _safe_rmtree(directory: os.PathLike[str] | str, retries: int = 5, delay: float = 0.2) -> None:
    for attempt in range(retries):
        try:
            shutil.rmtree(directory)
            return
        except (PermissionError, OSError):
            if attempt == retries - 1:
                # Clear readonly flags before final attempt
                for root, _, files in os.walk(directory):
                    for file in files:
                        try:
                            os.chmod(os.path.join(root, file), 0o777)
                        except OSError:
                            pass
                shutil.rmtree(directory, ignore_errors=True)
            else:
                time.sleep(delay)


@router.get("")
def get_projects() -> dict[str, list[dict[str, Any]]]:
    return {"projects": list_projects()}


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str) -> Response:
    try:
        project_directory = get_project_directory(project_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    _cancel_active_jobs(project_id)
    _safe_rmtree(project_directory)
    return Response(status_code=204)


class UpdateProjectPayload(BaseModel):
    title: str


@router.patch("/{project_id}")
def update_project(project_id: str, payload: UpdateProjectPayload) -> dict[str, Any]:
    try:
        project_directory = get_project_directory(project_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    meta_file = project_directory / "metadata.json"
    meta: dict[str, Any] = {}
    if meta_file.is_file():
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    meta = loaded
        except Exception:
            meta = {}
    cleaned_title = payload.title.strip()
    meta["title"] = cleaned_title
    tmp = meta_file.with_name(f".metadata.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        os.replace(tmp, meta_file)
    except OSError:
        tmp.unlink(missing_ok=True)
        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {"project_id": project_id, "title": cleaned_title}

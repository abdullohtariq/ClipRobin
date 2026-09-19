from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services.clip_generator import generate_clips
from app.services.project_manager import get_clips_directory, get_project_directory
from app.services.video_editor import VideoEditorError

router = APIRouter(prefix="/api/projects")


def project_or_404(project_id: str) -> Path:
    try:
        return get_project_directory(project_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{project_id}/generate-clips")
def generate_project_clips(project_id: str) -> dict[str, Any]:
    project_directory = project_or_404(project_id)
    try:
        clips = generate_clips(project_directory)
    except (FileNotFoundError, ValueError, VideoEditorError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="Clip generation failed") from error
    return {"clips": clips}


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
def serve_clip(project_id: str, clip_id: str) -> FileResponse:
    project_or_404(project_id)
    if not clip_id.endswith(".mp4") or Path(clip_id).name != clip_id:
        raise HTTPException(status_code=400, detail="Invalid clip filename")
    clip_path = get_clips_directory(project_id) / clip_id
    if not clip_path.is_file():
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(clip_path, media_type="video/mp4", filename=clip_path.name)

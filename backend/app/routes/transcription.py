import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.transcriber import transcribe_video

router = APIRouter(prefix="/api/projects")
PROJECTS_DIR = Path(__file__).resolve().parents[2] / "data" / "projects"
PROJECT_ID_PATTERN = re.compile(r"^project_\d+$")


class TranscriptionResponse(BaseModel):
    project_id: str
    status: str
    text_file: str
    json_file: str
    segments: int


def get_project_directory(project_id: str) -> Path:
    if not PROJECT_ID_PATTERN.fullmatch(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")

    project_directory = (PROJECTS_DIR / project_id).resolve()
    if project_directory.parent != PROJECTS_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid project ID")

    if not project_directory.is_dir():
        raise HTTPException(status_code=404, detail="Project not found")

    return project_directory


@router.post("/{project_id}/transcribe", response_model=TranscriptionResponse)
def transcribe(project_id: str) -> TranscriptionResponse:
    project_directory = get_project_directory(project_id)
    source_path = project_directory / "source.mp4"

    if not source_path.is_file():
        raise HTTPException(status_code=404, detail="Source video not found")

    try:
        result = transcribe_video(source_path, project_directory / "transcription")
    except Exception as error:
        raise HTTPException(status_code=502, detail="Video transcription failed") from error

    return TranscriptionResponse(
        project_id=project_id,
        status="transcribed",
        **result,
    )

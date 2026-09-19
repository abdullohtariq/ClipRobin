from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.ai_analyzer import (
    AIAnalyzerError,
    analyze_transcript,
    save_analysis,
    validate_transcript,
)

router = APIRouter(prefix="/api")
PROJECTS_DIR = Path(__file__).resolve().parents[2] / "data" / "projects"


class AnalyzeRequest(BaseModel):
    transcript: dict[str, Any]
    provider: str | None = None
    project_id: str | None = None


@router.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    try:
        validate_transcript(request.transcript)
    except AIAnalyzerError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    try:
        analysis = analyze_transcript(request.transcript, request.provider)
    except AIAnalyzerError as error:
        message = str(error)
        status_code = 503 if message.startswith("Missing ") else 502
        raise HTTPException(status_code=status_code, detail=message) from error

    if request.project_id:
        project_directory = (PROJECTS_DIR / request.project_id).resolve()
        if project_directory.parent != PROJECTS_DIR.resolve() or not project_directory.is_dir():
            raise HTTPException(status_code=404, detail="Project not found")
        save_analysis(project_directory, analysis)

    return analysis

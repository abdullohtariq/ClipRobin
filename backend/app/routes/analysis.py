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
from app.services.project_manager import get_project_directory

router = APIRouter(prefix="/api")


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
        try:
            project_directory = get_project_directory(request.project_id)
        except (ValueError, FileNotFoundError) as error:
            raise HTTPException(status_code=404, detail="Project not found") from error
        save_analysis(project_directory, analysis)

    return analysis

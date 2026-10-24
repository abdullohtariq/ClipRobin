from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.ai_analyzer import (
    AIAnalyzerError,
    analyze_transcript,
    save_analysis,
    validate_transcript,
)
from app.services.project_manager import get_project_directory
from app.services.ai_developer_mode import (
    get_ai_developer_status,
    save_gemini_api_key,
    set_developer_mode,
)

router = APIRouter(prefix="/api")


class AnalyzeRequest(BaseModel):
    transcript: dict[str, Any]
    provider: str | None = None
    project_id: str | None = None


class GeminiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=20, max_length=512)


class DeveloperModeRequest(BaseModel):
    enabled: bool


@router.get("/ai/status")
def get_ai_status() -> dict[str, Any]:
    return get_ai_developer_status()


@router.post("/ai/config")
def save_ai_config(request: GeminiKeyRequest) -> dict[str, Any]:
    try:
        save_gemini_api_key(request.api_key)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"success": True, "status": get_ai_developer_status()}


@router.post("/ai/developer-mode")
def update_developer_mode(request: DeveloperModeRequest) -> dict[str, Any]:
    status = get_ai_developer_status()
    if request.enabled and not status["youtube_authenticated"]:
        raise HTTPException(status_code=403, detail="Connect your YouTube account before enabling Developer Mode.")
    if request.enabled and not status["gemini_configured"]:
        raise HTTPException(status_code=400, detail="Save a Gemini API key before enabling Developer Mode.")
    set_developer_mode(request.enabled)
    return {"success": True, "status": get_ai_developer_status()}


@router.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    if (request.provider or "").lower() == "gemini":
        status = get_ai_developer_status()
        if not status["ai_enabled"]:
            raise HTTPException(status_code=403, detail=status["reason"] or "AI Developer Mode is disabled.")
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

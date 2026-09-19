import json
import os
from pathlib import Path
from typing import Any

import httpx


PROVIDER_DEFAULT = "openai"
PROVIDER_CONFIG = {
    "openai": {
        "api_key_env": "OPENAI_API_KEY",
        "base_url_env": "OPENAI_BASE_URL",
        "default_base_url": "https://api.openai.com/v1/chat/completions",
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-4o-mini",
    },
    "deepseek": {
        "api_key_env": "DEEPSEEK_API_KEY",
        "base_url_env": "DEEPSEEK_BASE_URL",
        "default_base_url": "https://api.deepseek.com/chat/completions",
        "model_env": "DEEPSEEK_MODEL",
        "default_model": "deepseek-chat",
    },
    "gemini": {
        "api_key_env": "GEMINI_API_KEY",
        "base_url_env": "GEMINI_BASE_URL",
        "default_base_url": "https://generativelanguage.googleapis.com/v1beta/models",
        "model_env": "GEMINI_MODEL",
        "default_model": "gemini-2.0-flash",
    },
}

SYSTEM_PROMPT = """You are analyzing a transcript to find potential short-form video clips.

Find self-contained sections that could work as short-form content.

Look for:
- a strong opening/hook
- useful, interesting, surprising, or educational information
- a clear idea
- a satisfying conclusion/payoff

Return ONLY valid JSON matching this schema:
{"clips":[{"title":"short title","start":0.0,"end":20.4,"reason":"brief explanation"}]}

Do not rewrite the transcript.
Do not create timestamps that do not exist.
Use the transcript timestamps to determine clip boundaries.
"""


class AIAnalyzerError(Exception):
    """Raised when a provider cannot produce valid clip analysis."""


def analyze_transcript(transcript: dict[str, Any], provider: str | None = None) -> dict[str, Any]:
    segments = validate_transcript(transcript)
    selected_provider = (provider or os.getenv("AI_PROVIDER") or PROVIDER_DEFAULT).lower()
    if selected_provider not in PROVIDER_CONFIG:
        raise AIAnalyzerError(f"Unsupported AI provider: {selected_provider}")

    prompt = build_user_prompt(segments)
    raw_response = request_provider(selected_provider, prompt)
    analysis = parse_analysis(raw_response)
    return validate_analysis(analysis, segments)


def validate_transcript(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(transcript, dict) or not isinstance(transcript.get("segments"), list):
        raise AIAnalyzerError("Transcript must contain a segments array")

    segments = transcript["segments"]
    if not segments:
        raise AIAnalyzerError("Transcript must contain at least one segment")

    previous_end = -1.0
    for segment in segments:
        if not isinstance(segment, dict):
            raise AIAnalyzerError("Each transcript segment must be an object")
        start = segment.get("start")
        end = segment.get("end")
        text = segment.get("text")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise AIAnalyzerError("Transcript timestamps must be numbers")
        if start < 0 or start >= end or start < previous_end:
            raise AIAnalyzerError("Transcript timestamps must be ordered and valid")
        if not isinstance(text, str) or not text.strip():
            raise AIAnalyzerError("Transcript segment text must be non-empty")
        previous_end = end

    return segments


def build_user_prompt(segments: list[dict[str, Any]]) -> str:
    transcript_text = "\n".join(
        f"[{segment['start']:.3f} - {segment['end']:.3f}] {segment['text']}"
        for segment in segments
    )
    return f"Transcript:\n{transcript_text}"


def request_provider(provider: str, user_prompt: str) -> str:
    config = PROVIDER_CONFIG[provider]
    api_key = os.getenv(config["api_key_env"])
    if not api_key:
        raise AIAnalyzerError(f"Missing {config['api_key_env']} environment variable")

    try:
        if provider == "gemini":
            return request_gemini(config, api_key, user_prompt)
        return request_openai_compatible(config, api_key, user_prompt)
    except httpx.HTTPError as error:
        raise AIAnalyzerError(f"{provider} API request failed") from error


def request_openai_compatible(config: dict[str, str], api_key: str, user_prompt: str) -> str:
    response = httpx.post(
        os.getenv(config["base_url_env"], config["default_base_url"]),
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": os.getenv(config["model_env"], config["default_model"]),
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        },
        timeout=120.0,
    )
    response.raise_for_status()
    try:
        return response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise AIAnalyzerError("AI provider returned an unexpected response") from error


def request_gemini(config: dict[str, str], api_key: str, user_prompt: str) -> str:
    model = os.getenv(config["model_env"], config["default_model"])
    base_url = os.getenv(config["base_url_env"], config["default_base_url"])
    response = httpx.post(
        f"{base_url}/{model}:generateContent",
        params={"key": api_key},
        json={
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        },
        timeout=120.0,
    )
    response.raise_for_status()
    try:
        return response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as error:
        raise AIAnalyzerError("AI provider returned an unexpected response") from error


def parse_analysis(raw_response: str) -> dict[str, Any]:
    if not isinstance(raw_response, str):
        raise AIAnalyzerError("AI provider returned non-text content")

    cleaned_response = raw_response.strip()
    if cleaned_response.startswith("```"):
        cleaned_response = cleaned_response.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        analysis = json.loads(cleaned_response)
    except json.JSONDecodeError as error:
        raise AIAnalyzerError("AI provider returned invalid JSON") from error

    if not isinstance(analysis, dict):
        raise AIAnalyzerError("AI response must be a JSON object")
    return analysis


def validate_analysis(analysis: dict[str, Any], segments: list[dict[str, Any]]) -> dict[str, Any]:
    clips = analysis.get("clips")
    if not isinstance(clips, list):
        raise AIAnalyzerError("AI response must contain a clips array")

    valid_boundaries = {value for segment in segments for value in (segment["start"], segment["end"])}
    validated_clips = []
    for clip in clips:
        if not isinstance(clip, dict):
            raise AIAnalyzerError("Each clip must be an object")
        title = clip.get("title")
        start = clip.get("start")
        end = clip.get("end")
        reason = clip.get("reason")
        if not isinstance(title, str) or not title.strip():
            raise AIAnalyzerError("Each clip needs a title")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise AIAnalyzerError("Clip timestamps must be numbers")
        if start >= end or start not in valid_boundaries or end not in valid_boundaries:
            raise AIAnalyzerError("Clip timestamps must match transcript boundaries")
        if not isinstance(reason, str) or not reason.strip():
            raise AIAnalyzerError("Each clip needs a reason")
        validated_clips.append({
            "title": title.strip(),
            "start": start,
            "end": end,
            "reason": reason.strip(),
        })

    return {"clips": validated_clips}


def save_analysis(project_directory: Path, analysis: dict[str, Any]) -> None:
    project_directory.mkdir(parents=True, exist_ok=True)
    (project_directory / "analysis.json").write_text(
        json.dumps(analysis, indent=2),
        encoding="utf-8",
    )

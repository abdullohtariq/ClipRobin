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
        "default_model": "gemini-3.5-flash-lite",
    },
}

SYSTEM_PROMPT = """You are an elite short-form video editor and viral hook specialist. Your job is to analyze a video transcript and identify the most compelling, high-retention short-form video clips (TikTok, YouTube Shorts, Instagram Reels).

CRITERIA FOR CHOOSING GREAT VIRAL CLIPS:
1. Irresistible Hook: The first 3 to 5 seconds must immediately grab attention with a surprising statement, intriguing question, punchy claim, controversial take, or emotional high point. Avoid boring pleasantries ("hello everyone", "welcome back") and awkward pauses.
2. High Retention & Value: The segment must be engaging throughout—delivering a key insight, shocking revelation, funny moment, or dramatic story. Every second counts.
3. Natural & Complete Ending: Always verify where the clip ends and ensure it makes complete sense! The clip MUST NOT cut off mid-sentence, mid-word, or right before a punchline. End on a completed sentence with a satisfying takeaway, punchline, or clear resolution.
4. Hook Quality & Viral Potential Rating: Rate each clip on viral potential from 1 to 10 (where 10 is an exceptional, viral-ready clip).

For each clip, provide:
- "id": A unique identifier (e.g. "clip_001")
- "title": A punchy, attention-grabbing title (max 6-8 words)
- "start": Exact start timestamp in seconds from transcript
- "end": Exact end timestamp in seconds from transcript (must end cleanly on a finished thought/sentence)
- "score": A rating number from 1 to 10 (e.g. 9.5 or 8) based on hook strength, pacing, and viral appeal
- "reason": A 1-2 sentence compelling breakdown of WHY this clip is good, what makes the hook work, and why viewers will keep watching

Return ONLY valid JSON matching this schema:
{"clips":[{"id":"clip_001","title":"Why Most Habits Fail In 7 Days","start":12.5,"end":45.2,"score":9.2,"reason":"Opens immediately with a counterintuitive hook that challenges common belief, maintains tension, and concludes with an actionable rule."}]}

Do not rewrite the transcript.
Do not create timestamps that do not exist.
Use the transcript timestamps to determine clip boundaries.
"""


class AIAnalyzerError(Exception):
    """Raised when a provider cannot produce valid clip analysis."""


def analyze_transcript(
    transcript: dict[str, Any],
    provider: str | None = None,
    max_clip_seconds: int | None = None,
    max_clips: int | None = None,
) -> dict[str, Any]:
    segments = validate_transcript(transcript)
    selected_provider = (provider or os.getenv("AI_PROVIDER") or PROVIDER_DEFAULT).lower()
    if selected_provider not in PROVIDER_CONFIG:
        raise AIAnalyzerError(f"Unsupported AI provider: {selected_provider}")

    prompt = build_user_prompt(segments, max_clip_seconds=max_clip_seconds, max_clips=max_clips)
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
        if start < 0 or start >= end:
            raise AIAnalyzerError("Transcript timestamps must be ordered and valid")
        if start < previous_end:
            # Clamp slight overlaps between consecutive speech segments
            start = previous_end
            if start >= end:
                end = start + 0.05
            segment["start"] = start
            segment["end"] = end
        if not isinstance(text, str) or not text.strip():
            raise AIAnalyzerError("Transcript segment text must be non-empty")
        previous_end = end

    return segments


def build_user_prompt(
    segments: list[dict[str, Any]],
    max_clip_seconds: int | None = None,
    max_clips: int | None = None,
) -> str:
    transcript_text = "\n".join(
        f"[{segment['start']:.3f} - {segment['end']:.3f}] {segment['text']}"
        for segment in segments
    )
    constraints = []
    if max_clip_seconds is not None:
        constraints.append(f"Each clip must be no longer than {max_clip_seconds} seconds.")
    if max_clips is not None:
        constraints.append(f"Return no more than {max_clips} clips.")
    constraint_text = "\n".join(constraints)
    return f"Transcript:\n{transcript_text}\n\n{constraint_text}" if constraint_text else f"Transcript:\n{transcript_text}"


def request_provider(provider: str, user_prompt: str) -> str:
    config = PROVIDER_CONFIG[provider]
    if provider == "gemini":
        from app.services.ai_developer_mode import get_gemini_api_key

        api_key = get_gemini_api_key()
    else:
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

    sorted_boundaries = sorted({float(value) for segment in segments for value in (segment["start"], segment["end"])})
    if not sorted_boundaries:
        raise AIAnalyzerError("Transcript has no valid boundaries")

    def snap_to_boundary(timestamp: float, tolerance: float = 3.0) -> float:
        closest = min(sorted_boundaries, key=lambda boundary: abs(boundary - timestamp))
        if abs(closest - timestamp) <= tolerance:
            return closest
        return timestamp

    validated_clips = []
    for index, clip in enumerate(clips, start=1):
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

        snapped_start = snap_to_boundary(float(start))
        snapped_end = snap_to_boundary(float(end))

        if snapped_start >= snapped_end:
            raise AIAnalyzerError("Clip timestamps must have a valid positive duration")

        valid_boundaries_set = set(sorted_boundaries)
        if snapped_start not in valid_boundaries_set or snapped_end not in valid_boundaries_set:
            raise AIAnalyzerError("Clip timestamps must match transcript boundaries")
        if not isinstance(reason, str) or not reason.strip():
            raise AIAnalyzerError("Each clip needs a reason")

        # Extract and validate score out of 10
        raw_score = clip.get("score")
        if isinstance(raw_score, (int, float)) and 1.0 <= float(raw_score) <= 10.0:
            clip_score = round(float(raw_score), 1)
        else:
            clip_score = 8.5

        clip_id = clip.get("id") or f"clip_{index:03d}"
        validated_clips.append({
            "id": str(clip_id),
            "title": title.strip(),
            "start": snapped_start,
            "end": snapped_end,
            "score": clip_score,
            "reason": reason.strip(),
        })

    return {"clips": validated_clips}


def save_analysis(project_directory: Path, analysis: dict[str, Any]) -> None:
    project_directory.mkdir(parents=True, exist_ok=True)
    (project_directory / "analysis.json").write_text(
        json.dumps(analysis, indent=2),
        encoding="utf-8",
    )

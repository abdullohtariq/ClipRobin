import base64
import binascii
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)
SAFE_CLIP_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def is_safe_clip_id(clip_id: Any) -> bool:
    return isinstance(clip_id, str) and bool(SAFE_CLIP_ID_RE.fullmatch(clip_id)) and clip_id not in {".", ".."}


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
2. Complete Context & Substantial Length: Every clip must be a self-contained story, framework, or argument with full context (setup, core insight, and payoff). NEVER pick a tiny 3 to 8 second isolated sentence fragment. Each clip should be at least 20 to 30 seconds long (or at least 50% of the requested target duration).
3. Avoid Intro Teaser Montages: Long-form podcasts and videos often begin (in the first 0 to 90 seconds) with a rapid-fire highlight montage of disconnected 4-second soundbites. Do NOT select those brief intro teaser fragments—always locate and select the full, uninterrupted conversation later in the transcript where the topic is actually discussed in depth.
4. Natural & Complete Ending: Always verify where the clip ends and ensure it makes complete sense! The clip MUST NOT cut off mid-sentence, mid-word, on a dangling preposition/conjunction ("on", "and", "but", "so"), or right before a punchline. End on a completed sentence with a satisfying takeaway, punchline, or clear resolution.
5. Hook Quality & Viral Potential Rating: Rate each clip on viral potential from 1 to 10 (where 10 is an exceptional, viral-ready clip).

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

    def __init__(self, message: str, *, status_code: int | None = None, retryable: bool = True) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


def resolve_provider(provider: str | None = None) -> str:
    return (provider or os.getenv("AI_PROVIDER") or PROVIDER_DEFAULT).strip().lower()


def analyze_transcript(
    transcript: dict[str, Any],
    provider: str | None = None,
    max_clip_seconds: int | None = None,
    max_clips: int | None = None,
) -> dict[str, Any]:
    segments = validate_transcript(transcript)
    selected_provider = resolve_provider(provider)
    if selected_provider not in PROVIDER_CONFIG:
        raise AIAnalyzerError(f"Unsupported AI provider: {selected_provider}", retryable=False)

    prompt = build_user_prompt(segments, max_clip_seconds=max_clip_seconds, max_clips=max_clips)
    raw_response, used_model = request_provider_with_model(selected_provider, prompt)
    analysis = parse_analysis(raw_response)
    validated = validate_analysis(analysis, segments, max_clip_seconds=max_clip_seconds)
    validated["provider"] = selected_provider
    if used_model:
        validated["model"] = used_model
    return validated


def analyze_included_hooks(
    transcript: dict[str, Any], access_token: str, duration: float,
    max_clip_seconds: int, max_clips: int,
) -> dict[str, Any]:
    segments = validate_transcript(transcript)
    try:
        payload = access_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        issuer = claims.get("iss", "")
    except (AttributeError, binascii.Error, IndexError, ValueError) as error:
        raise AIAnalyzerError("Sign in again to use included Hook Finder credits.") from error
    # Restrict the relay to the Supabase project that issued this token. The hosted
    # function verifies the token before it accesses billing or sends data to Gemini.
    if not isinstance(issuer, str) or not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co/auth/v1", issuer):
        raise AIAnalyzerError("Included Hook Finder needs a hosted Supabase account.")
    endpoint = issuer.removesuffix("/auth/v1") + "/functions/v1/cliprobin-billing"
    body = {
        "action": "hooks",
        "durationSeconds": max(duration, max(segment["end"] for segment in segments)),
        "clipSeconds": max_clip_seconds,
        "clipCount": min(max_clips, 100),
        "segments": [{key: segment[key] for key in ("start", "end", "text")} for segment in segments],
    }
    try:
        response = httpx.post(endpoint, headers={"Authorization": f"Bearer {access_token}"}, json=body, timeout=110)
        result = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise AIAnalyzerError("Could not reach included Hook Finder.") from error
    if response.is_error:
        detail = result.get("error") if isinstance(result, dict) else None
        raise AIAnalyzerError(detail if isinstance(detail, str) else "Included Hook Finder was unavailable.")
    validated = validate_analysis(result, segments, max_clip_seconds=max_clip_seconds)
    validated.update(provider="gemini", model=result.get("model"))
    return validated


def validate_transcript(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(transcript, dict) or not isinstance(transcript.get("segments"), list):
        raise AIAnalyzerError("Transcript must contain a segments array")

    segments = transcript["segments"]
    if not segments:
        raise AIAnalyzerError("Transcript must contain at least one segment")

    normalized: list[dict[str, Any]] = []
    previous_end = -1.0
    for segment in segments:
        if not isinstance(segment, dict):
            raise AIAnalyzerError("Each transcript segment must be an object")
        start = segment.get("start")
        end = segment.get("end")
        text = segment.get("text")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise AIAnalyzerError("Transcript timestamps must be numbers")
        start_val = float(start)
        end_val = float(end)
        if start_val < 0 or start_val >= end_val:
            raise AIAnalyzerError("Transcript timestamps must be ordered and valid")
        if start_val < previous_end:
            # Clamp slight overlaps between consecutive speech segments without mutating caller input
            start_val = previous_end
            if start_val >= end_val:
                end_val = start_val + 0.05
        if not isinstance(text, str) or not text.strip():
            raise AIAnalyzerError("Transcript segment text must be non-empty")
        previous_end = end_val
        normalized.append({**segment, "start": start_val, "end": end_val, "text": text})

    return normalized


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
        min_recommended = max(10, min(25, int(max_clip_seconds * 0.5)))
        constraints.append(
            f"Each clip must be between {min_recommended} and {max_clip_seconds} seconds long "
            f"(no longer than {max_clip_seconds} seconds, with complete setup and conclusion context)."
        )
    if max_clips is not None:
        constraints.append(f"Return no more than {max_clips} clips.")
    constraint_text = "\n".join(constraints)
    return f"Transcript:\n{transcript_text}\n\n{constraint_text}" if constraint_text else f"Transcript:\n{transcript_text}"


def _raise_for_http_status(provider: str, model: str, status: int) -> None:
    if status in {401, 403}:
        raise AIAnalyzerError(
            f"{provider.capitalize()} API key was rejected or lacks permission (HTTP {status}). Check your key in Settings.",
            status_code=status,
            retryable=False,
        )
    if status in {400, 404}:
        raise AIAnalyzerError(
            f"{provider.capitalize()} rejected the request or configured model '{model}' (HTTP {status}).",
            status_code=status,
            retryable=False,
        )
    if status == 429:
        raise AIAnalyzerError(
            f"{provider.capitalize()} rate limit exceeded (HTTP 429). Please retry shortly.",
            status_code=status,
            retryable=True,
        )
    raise AIAnalyzerError(
        f"{provider.capitalize()} API returned HTTP {status} on model '{model}'.",
        status_code=status,
        retryable=status >= 500,
    )


def request_provider_with_model(provider: str, user_prompt: str) -> tuple[str, str]:
    config = PROVIDER_CONFIG[provider]
    if provider == "gemini":
        from app.services.ai_developer_mode import get_gemini_api_key

        api_key = get_gemini_api_key()
    else:
        api_key = os.getenv(config["api_key_env"])
    if not api_key:
        raise AIAnalyzerError(
            f"Missing {config['api_key_env']} configuration",
            status_code=503,
            retryable=False,
        )

    try:
        if provider == "gemini":
            return _request_gemini_with_model(config, api_key, user_prompt)
        return _request_openai_compatible_with_model(provider, config, api_key, user_prompt)
    except AIAnalyzerError:
        raise
    except httpx.TimeoutException as error:
        raise AIAnalyzerError(
            f"{provider.capitalize()} API request timed out.",
            retryable=True,
        ) from error
    except httpx.HTTPError as error:
        raise AIAnalyzerError(f"{provider.capitalize()} API network request failed.") from error


def request_provider(provider: str, user_prompt: str) -> str:
    text, _ = request_provider_with_model(provider, user_prompt)
    return text


def _request_openai_compatible_with_model(
    provider: str,
    config: dict[str, str],
    api_key: str,
    user_prompt: str,
) -> tuple[str, str]:
    model = os.getenv(config["model_env"], config["default_model"])
    response = httpx.post(
        os.getenv(config["base_url_env"], config["default_base_url"]),
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        },
        timeout=120.0,
    )
    if response.status_code >= 400:
        _raise_for_http_status(provider, model, response.status_code)
    try:
        return response.json()["choices"][0]["message"]["content"], model
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise AIAnalyzerError("AI provider returned an unexpected response") from error


def request_openai_compatible(config: dict[str, str], api_key: str, user_prompt: str) -> str:
    text, _ = _request_openai_compatible_with_model("openai", config, api_key, user_prompt)
    return text


def _extract_gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise KeyError("candidates")
    parts = candidates[0].get("content", {}).get("parts", [])
    if not isinstance(parts, list) or not parts:
        raise KeyError("parts")
    for part in parts:
        if isinstance(part, dict) and not part.get("thought") and isinstance(part.get("text"), str) and part["text"].strip():
            return part["text"]
    first_text = parts[0].get("text") if isinstance(parts[0], dict) else None
    if isinstance(first_text, str):
        return first_text
    raise KeyError("text")


def _request_gemini_with_model(config: dict[str, str], api_key: str, user_prompt: str) -> tuple[str, str]:
    primary_model = os.getenv(config["model_env"], config["default_model"])
    base_url = os.getenv(config["base_url_env"], config["default_base_url"])

    candidate_models = [primary_model]
    for alt in ["gemini-3.8-flash", "gemini-3.1-flash-lite"]:
        if alt not in candidate_models:
            candidate_models.append(alt)

    max_retries = 3
    last_status: int | None = None
    last_model: str = primary_model
    last_timeout = False

    with httpx.Client(timeout=120.0) as client:
        for model_idx, model in enumerate(candidate_models):
            for attempt in range(1, max_retries + 1):
                try:
                    response = client.post(
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
                    )
                    if response.status_code >= 400:
                        status = response.status_code
                        last_status = status
                        last_model = model
                        # Non-transient client/credential/model errors fail immediately without retry or model hiding
                        if status not in {429, 500, 502, 503, 504}:
                            _raise_for_http_status("gemini", model, status)
                        if attempt < max_retries:
                            backoff = 1.5 * (2 ** (attempt - 1))
                            logger.warning(
                                "Gemini API returned status %d on model %s. Retrying in %.1fs (attempt %d/%d)...",
                                status, model, backoff, attempt, max_retries
                            )
                            time.sleep(backoff)
                            continue
                        if model_idx + 1 < len(candidate_models):
                            logger.warning(
                                "Model %s returned status %d. Falling back to next candidate %s...",
                                model, status, candidate_models[model_idx + 1]
                            )
                            break
                        _raise_for_http_status("gemini", model, status)

                    try:
                        return _extract_gemini_text(response.json()), model
                    except (KeyError, IndexError, TypeError, ValueError) as error:
                        raise AIAnalyzerError("AI provider returned an unexpected response") from error
                except AIAnalyzerError:
                    raise
                except httpx.TimeoutException:
                    last_timeout = True
                    last_model = model
                    if attempt < max_retries:
                        backoff = 1.5 * (2 ** (attempt - 1))
                        logger.warning(
                            "Gemini API timed out on %s. Retrying in %.1fs (attempt %d/%d)...",
                            model, backoff, attempt, max_retries
                        )
                        time.sleep(backoff)
                        continue
                    if model_idx + 1 < len(candidate_models):
                        break
                    raise AIAnalyzerError(
                        f"Gemini API request timed out on model '{model}'.",
                        retryable=True,
                    )
                except httpx.NetworkError as error:
                    last_model = model
                    if attempt < max_retries:
                        backoff = 1.5 * (2 ** (attempt - 1))
                        logger.warning(
                            "Gemini API network error on %s (%s). Retrying in %.1fs (attempt %d/%d)...",
                            model, error.__class__.__name__, backoff, attempt, max_retries
                        )
                        time.sleep(backoff)
                        continue
                    raise AIAnalyzerError(
                        f"Network error contacting Gemini API ({error.__class__.__name__}).",
                        retryable=True,
                    ) from error

    if last_status is not None:
        _raise_for_http_status("gemini", last_model, last_status)
    if last_timeout:
        raise AIAnalyzerError(f"Gemini API request timed out on model '{last_model}'.", retryable=True)
    raise AIAnalyzerError("Gemini API request failed after all retries and fallback models")


def request_gemini(config: dict[str, str], api_key: str, user_prompt: str) -> str:
    text, _ = _request_gemini_with_model(config, api_key, user_prompt)
    return text


def parse_analysis(raw_response: str) -> dict[str, Any]:
    if not isinstance(raw_response, str):
        raise AIAnalyzerError("AI provider returned non-text content")

    cleaned_response = raw_response.strip()
    if cleaned_response.startswith("```"):
        body = cleaned_response[3:]
        if body.lower().startswith("json"):
            body = body[4:]
        cleaned_response = body.rsplit("```", 1)[0].strip()
    elif not cleaned_response.startswith("{"):
        brace_start = cleaned_response.find("{")
        brace_end = cleaned_response.rfind("}")
        if brace_start != -1 and brace_end > brace_start:
            cleaned_response = cleaned_response[brace_start : brace_end + 1]

    try:
        analysis = json.loads(cleaned_response)
    except json.JSONDecodeError as error:
        raise AIAnalyzerError("AI provider returned invalid JSON") from error

    if not isinstance(analysis, dict):
        raise AIAnalyzerError("AI response must be a JSON object")
    return analysis


_DANGLING_END_WORDS = {
    "a", "an", "the", "and", "or", "but", "nor", "so", "yet",
    "on", "in", "at", "to", "for", "with", "by", "from", "of", "about", "into", "onto",
    "that", "which", "who", "whom", "whose", "because", "if", "when", "while", "where", "like",
}


def _normalize_words(text: str) -> list[str]:
    cleaned = "".join(c.lower() if c.isalnum() else " " for c in text)
    return [w for w in cleaned.split() if len(w) >= 3]


def _ends_with_dangling_word(text: str) -> bool:
    stripped = text.strip()
    if not stripped or stripped[-1] in ".?!\"')":
        return False
    words = stripped.split()
    if not words:
        return False
    last_word = "".join(c.lower() for c in words[-1] if c.isalpha())
    return last_word in _DANGLING_END_WORDS


def _relocate_and_expand_clip_bounds(
    snapped_start: float,
    snapped_end: float,
    segments: list[dict[str, Any]],
    max_clip_seconds: int | None,
) -> tuple[float, float]:
    """
    If a clip selected by the LLM is a tiny fragment (e.g., < 14s in a long video) or ends on a
    dangling mid-sentence word:
    1. Check if it is an intro teaser soundbite (start < 120s in a > 300s video) that repeats
       later in the main body of the transcript; if so, relocate to the main conversation.
    2. Expand across adjacent transcript segments so the clip has complete context (setup + payoff)
       within max_clip_seconds.
    """
    if not segments:
        return snapped_start, snapped_end

    total_span = float(segments[-1]["end"]) - float(segments[0]["start"])
    if total_span < 35.0:
        return snapped_start, snapped_end

    eff_max = float(max_clip_seconds) if max_clip_seconds is not None and max_clip_seconds > 0 else 60.0
    min_viable = max(10.0, min(20.0, eff_max * 0.45))
    target_fill = max(min_viable + 6.0, min(eff_max * 0.92, 55.0))

    # Locate segment index range [lo_idx, hi_idx] for [snapped_start, snapped_end]
    lo_idx = 0
    hi_idx = len(segments) - 1
    for i, seg in enumerate(segments):
        if abs(float(seg["start"]) - snapped_start) < 1e-3:
            lo_idx = i
            break
    for i in range(lo_idx, len(segments)):
        if abs(float(segments[i]["end"]) - snapped_end) < 1e-3:
            hi_idx = i
            break

    orig_lo_idx, orig_hi_idx = lo_idx, hi_idx
    cur_dur = snapped_end - snapped_start

    # 1. If this is a short intro teaser (< 14s in the first 120s of a > 300s video),
    # search for the actual conversation later in the transcript (> 120s).
    if cur_dur < 14.0 and snapped_start < 120.0 and total_span > 300.0:
        teaser_text = " ".join(str(segments[i]["text"]) for i in range(lo_idx, hi_idx + 1))
        teaser_words = _normalize_words(teaser_text)
        if len(teaser_words) >= 4:
            teaser_ngrams = {
                tuple(teaser_words[k : k + 4]) for k in range(len(teaser_words) - 3)
            }
            teaser_word_set = {w for w in teaser_words if len(w) >= 4}
            best_match_idx: int | None = None
            best_score = 0.0
            for i, seg in enumerate(segments):
                if float(seg["start"]) <= 120.0:
                    continue
                window_text = str(seg["text"])
                if i + 1 < len(segments):
                    window_text += " " + str(segments[i + 1]["text"])
                cand_words = _normalize_words(window_text)
                if len(cand_words) < 4:
                    continue
                cand_ngrams = {
                    tuple(cand_words[k : k + 4]) for k in range(len(cand_words) - 3)
                }
                ngram_hits = len(teaser_ngrams & cand_ngrams)
                word_overlap = (
                    len(teaser_word_set & set(cand_words)) / max(1, len(teaser_word_set))
                    if teaser_word_set
                    else 0.0
                )
                score = ngram_hits * 2.0 + word_overlap
                if (ngram_hits >= 1 or word_overlap >= 0.65) and score > best_score:
                    best_score = score
                    best_match_idx = i
            if best_match_idx is not None:
                lo_idx = best_match_idx
                hi_idx = best_match_idx

    # 2. Expand short clips so they have full setup and payoff context
    cur_start = float(segments[lo_idx]["start"])
    cur_end = float(segments[hi_idx]["end"])
    if (cur_end - cur_start) < min_viable:
        # First include up to ~65% of target_fill as setup before the anchor hook if relocated,
        # or ~35% before if expanding in place
        max_pre_budget = target_fill * 0.72
        while lo_idx > 0:
            prev_seg = segments[lo_idx - 1]
            cand_start = float(prev_seg["start"])
            if (cur_end - cand_start) > target_fill or (float(segments[hi_idx]["start"]) - cand_start) > max_pre_budget:
                break
            lo_idx -= 1
            cur_start = cand_start

        # Then expand forward to reach at least min_viable (up to target_fill) and a clean sentence ending
        while hi_idx + 1 < len(segments):
            next_seg = segments[hi_idx + 1]
            cand_end = float(next_seg["end"])
            if (cand_end - cur_start) > eff_max:
                break
            if (cur_end - cur_start) >= min_viable and not _ends_with_dangling_word(str(segments[hi_idx]["text"])):
                if (cand_end - cur_start) > target_fill:
                    break
            hi_idx += 1
            cur_end = cand_end

    # 3. Even if already >= min_viable, never leave the last segment ending on a dangling word ("on", "and", etc.)
    while hi_idx + 1 < len(segments) and _ends_with_dangling_word(str(segments[hi_idx]["text"])):
        next_end = float(segments[hi_idx + 1]["end"])
        if (next_end - cur_start) > eff_max + 6.0:
            break
        hi_idx += 1
        cur_end = next_end

    if lo_idx == orig_lo_idx and hi_idx == orig_hi_idx:
        return snapped_start, snapped_end
    return float(segments[lo_idx]["start"]), float(segments[hi_idx]["end"])


def validate_analysis(
    analysis: dict[str, Any],
    segments: list[dict[str, Any]],
    max_clip_seconds: int | None = None,
) -> dict[str, Any]:
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

    valid_boundaries_set = {round(b, 3) for b in sorted_boundaries} | set(sorted_boundaries)
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

        if (
            snapped_start not in valid_boundaries_set
            and round(snapped_start, 3) not in valid_boundaries_set
        ) or (
            snapped_end not in valid_boundaries_set
            and round(snapped_end, 3) not in valid_boundaries_set
        ):
            raise AIAnalyzerError("Clip timestamps must match transcript boundaries")
        if not isinstance(reason, str) or not reason.strip():
            raise AIAnalyzerError("Each clip needs a reason")

        snapped_start, snapped_end = _relocate_and_expand_clip_bounds(
            snapped_start,
            snapped_end,
            segments,
            max_clip_seconds=max_clip_seconds,
        )

        # Extract and validate score out of 10
        raw_score = clip.get("score")
        if isinstance(raw_score, (int, float)) and 1.0 <= float(raw_score) <= 10.0:
            clip_score = round(float(raw_score), 1)
        else:
            clip_score = 8.5

        # Allocate filesystem-safe local clip IDs; retain any provider identifier separately.
        clip_id = f"clip_{index:03d}"
        raw_provider_id = clip.get("id")
        entry: dict[str, Any] = {
            "id": clip_id,
            "title": title.strip(),
            "start": snapped_start,
            "end": snapped_end,
            "score": clip_score,
            "reason": reason.strip(),
        }
        if isinstance(raw_provider_id, str) and raw_provider_id.strip():
            entry["provider_id"] = raw_provider_id.strip()
        validated_clips.append(entry)

    if not validated_clips:
        raise AIAnalyzerError("AI response contained no valid clips")

    return {"clips": validated_clips}


def save_analysis(project_directory: Path, analysis: dict[str, Any]) -> None:
    project_directory.mkdir(parents=True, exist_ok=True)
    target = project_directory / "analysis.json"
    serialized = json.dumps(analysis, indent=2)
    tmp = target.with_name(f".analysis.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(serialized, encoding="utf-8")
        os.replace(tmp, target)
    except OSError:
        tmp.unlink(missing_ok=True)
        target.write_text(serialized, encoding="utf-8")

import base64
import json

import httpx
import pytest

from app.services.ai_analyzer import (
    AIAnalyzerError,
    analyze_included_hooks,
    build_user_prompt,
    parse_analysis,
    validate_analysis,
    validate_transcript,
)


def test_included_hooks_uses_the_account_service_and_sends_only_transcript_fields(monkeypatch):
    segment = {"start": 0, "end": 30, "text": "A complete thought"}
    transcript = {"segments": [{**segment, "words": [{"word": "A"}]}], "path": "local.mp4"}

    def token_for(issuer):
        payload = base64.urlsafe_b64encode(json.dumps({"iss": issuer}).encode()).decode().rstrip("=")
        return f"header.{payload}.fixture"

    bearer = token_for("https://project.supabase.co/auth/v1")
    calls = []

    def post(url, *, headers, json, timeout):
        calls.append(url)
        assert url == "https://project.supabase.co/functions/v1/cliprobin-billing"
        assert headers == {"Authorization": f"Bearer {bearer}"}
        assert json == {"action": "hooks", "durationSeconds": 1801, "clipSeconds": 30, "clipCount": 3, "segments": [segment]}
        return httpx.Response(200, json={"model": "gemini-3.5-flash-lite", "clips": [
            {"title": "A complete thought", "start": 0, "end": 30, "score": 8, "reason": "Good opening"},
        ]})

    monkeypatch.setattr("app.services.ai_analyzer.httpx.post", post)
    result = analyze_included_hooks(transcript, bearer, 1801, 30, 3)
    assert result["clips"][0]["id"] == "clip_001"
    assert result["model"] == "gemini-3.5-flash-lite"
    with pytest.raises(AIAnalyzerError, match="hosted Supabase account"):
        analyze_included_hooks(transcript, token_for("https://example.test/auth/v1"), 1801, 30, 3)
    assert len(calls) == 1


def test_validate_transcript_valid():
    transcript = {
        "segments": [
            {"start": 0.0, "end": 4.5, "text": "Hello world."},
            {"start": 4.5, "end": 10.0, "text": "Welcome to Clip Robin."},
        ]
    }
    segments = validate_transcript(transcript)
    assert len(segments) == 2
    assert segments[0]["start"] == 0.0
    assert segments[1]["end"] == 10.0


def test_validate_transcript_clamps_overlapping_segments():
    # Segment 2 starts before Segment 1 ends (common in faster-whisper)
    transcript = {
        "segments": [
            {"start": 0.0, "end": 5.2, "text": "First segment speaking."},
            {"start": 5.0, "end": 9.5, "text": "Overlapping second segment."},
        ]
    }
    segments = validate_transcript(transcript)
    assert len(segments) == 2
    assert segments[0]["start"] == 0.0
    assert segments[0]["end"] == 5.2
    # Verify segment 1 was clamped to previous_end
    assert segments[1]["start"] == 5.2
    assert segments[1]["end"] == 9.5


def test_validate_transcript_rejects_malformed_input():
    with pytest.raises(AIAnalyzerError, match="segments array"):
        validate_transcript({})

    with pytest.raises(AIAnalyzerError, match="at least one segment"):
        validate_transcript({"segments": []})

    with pytest.raises(AIAnalyzerError, match="must be numbers"):
        validate_transcript({"segments": [{"start": "zero", "end": 5.0, "text": "text"}]})

    with pytest.raises(AIAnalyzerError, match="ordered and valid"):
        validate_transcript({"segments": [{"start": -1.0, "end": 5.0, "text": "text"}]})

    with pytest.raises(AIAnalyzerError, match="ordered and valid"):
        validate_transcript({"segments": [{"start": 5.0, "end": 2.0, "text": "text"}]})


def test_build_user_prompt():
    segments = [
        {"start": 1.25, "end": 3.75, "text": "Clip snippet."},
    ]
    prompt = build_user_prompt(segments)
    assert "[1.250 - 3.750] Clip snippet." in prompt


def test_parse_analysis_json_and_markdown():
    # Standard JSON
    res1 = parse_analysis('{"clips": []}')
    assert res1 == {"clips": []}

    # Markdown wrapped JSON
    markdown_wrapped = """```json
    {"clips": [{"title": "Highlight", "start": 0.0, "end": 10.0, "reason": "Engaging hook"}]}
    ```"""
    res2 = parse_analysis(markdown_wrapped)
    assert len(res2["clips"]) == 1
    assert res2["clips"][0]["title"] == "Highlight"


def test_validate_analysis_injects_missing_clip_id():
    segments = [
        {"start": 0.0, "end": 15.0, "text": "Introduction."},
        {"start": 15.0, "end": 30.0, "text": "Main point."},
    ]
    # AI returned clips without "id" field
    analysis = {
        "clips": [
            {"title": "Hook", "start": 0.0, "end": 15.0, "reason": "Great start"},
            {"title": "Lesson", "start": 15.0, "end": 30.0, "reason": "Great lesson"},
        ]
    }
    validated = validate_analysis(analysis, segments)
    assert len(validated["clips"]) == 2
    assert validated["clips"][0]["id"] == "clip_001"
    assert validated["clips"][1]["id"] == "clip_002"


def test_validate_analysis_snaps_floating_point_boundaries():
    segments = [
        {"start": 0.0, "end": 14.512, "text": "First section."},
        {"start": 14.512, "end": 32.894, "text": "Second section."},
    ]
    # AI model outputs rounded timestamps (14.5 and 32.9)
    analysis = {
        "clips": [
            {"title": "Rounded Timestamps", "start": 0.0, "end": 14.5, "reason": "Close to 14.512"},
            {"title": "Second Clip", "start": 14.5, "end": 32.9, "reason": "Close to 32.894"},
        ]
    }
    validated = validate_analysis(analysis, segments)
    assert len(validated["clips"]) == 2
    # Verify snapped to exact boundary
    assert validated["clips"][0]["end"] == 14.512
    assert validated["clips"][1]["start"] == 14.512
    assert validated["clips"][1]["end"] == 32.894



def test_validate_analysis_preserves_and_defaults_score():
    segments = [
        {"start": 0.0, "end": 15.0, "text": "Viral hook."},
        {"start": 15.0, "end": 30.0, "text": "Payoff."},
    ]
    analysis = {
        "clips": [
            {"title": "Hook", "start": 0.0, "end": 15.0, "reason": "High hook potential", "score": 9.4},
            {"title": "Payoff", "start": 15.0, "end": 30.0, "reason": "Great ending"},
        ]
    }
    validated = validate_analysis(analysis, segments)
    assert validated["clips"][0]["score"] == 9.4
    assert validated["clips"][1]["score"] == 8.5

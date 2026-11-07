import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routes.clips import CANCEL_EVENTS, GENERATION_JOBS, JOBS_LOCK
from app.services.clip_generator import _is_transcript_usable, generate_clips
from app.services.project_manager import create_project
from app.services.smart_framing import (
    ANALYSIS_VERSION,
    _smooth_and_simplify_segment,
    _source_signature,
    analyze_speaker_tracking,
)

client = TestClient(app)


def test_latest_generation_job_uses_chronological_sequence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    project_id, _ = create_project()

    older_id = "ffffffff-ffff-4fff-bfff-ffffffffffff"
    newer_id = "00000000-0000-4000-8000-000000000001"

    with JOBS_LOCK:
        # Insert newer_id first and older_id second so dict iteration order alone would pick older_id
        GENERATION_JOBS[newer_id] = {
            "job_id": newer_id,
            "project_id": project_id,
            "status": "processing",
            "progress": 42,
            "created_seq": 11,
            "created_at": 1005.0,
            "ready_clips": [],
        }
        GENERATION_JOBS[older_id] = {
            "job_id": older_id,
            "project_id": project_id,
            "status": "completed",
            "progress": 100,
            "created_seq": 10,
            "created_at": 1000.0,
            "ready_clips": [],
        }

    try:
        res = client.get(f"/api/projects/{project_id}/generation-jobs")
        assert res.status_code == 200
        assert res.json()["job"]["job_id"] == newer_id
    finally:
        with JOBS_LOCK:
            GENERATION_JOBS.pop(older_id, None)
            GENERATION_JOBS.pop(newer_id, None)
            CANCEL_EVENTS.pop(older_id, None)
            CANCEL_EVENTS.pop(newer_id, None)


def test_mock_analysis_v2_cache_reused_and_top_lines_preserved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    _, project_dir = create_project()

    (project_dir / "source.mp4").write_bytes(b"fake video bytes")
    (project_dir / "transcript.json").write_text(
        json.dumps(
            {
                "language": "ar",
                "is_complete": True,
                "covered_duration": 120.0,
                "segments": [
                    {"start": 0.0, "end": 30.0, "text": "Segment one text"},
                    {"start": 30.0, "end": 60.0, "text": "Segment two text"},
                ],
            }
        ),
        encoding="utf-8",
    )

    mock_calls = {"count": 0}
    captured_languages: list[str | None] = []

    def fake_mock_analysis(project_directory: Path, **kwargs: Any) -> dict[str, Any]:
        mock_calls["count"] += 1
        dur = float(kwargs.get("max_clip_seconds", 30.0))
        analysis = {
            "analyzer_version": 2,
            "clips": [
                {
                    "id": "clip_001",
                    "title": "Hook 1",
                    "start": 0.0,
                    "end": dur,
                    "reason": "Mock analysis: test",
                }
            ],
        }
        (project_directory / "analysis.json").write_text(
            json.dumps(analysis), encoding="utf-8"
        )
        return analysis

    def fake_create_clip(
        source_path: Path, output_path: Path, start: float, end: float, **kwargs: Any
    ) -> Path:
        captured_languages.append(kwargs.get("language"))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"rendered mp4")
        return output_path

    monkeypatch.setattr("app.services.clip_generator.create_mock_analysis", fake_mock_analysis)
    monkeypatch.setattr("app.services.clip_generator.create_clip", fake_create_clip)

    # First run creates mock analysis v2 and forwards transcript language ('ar')
    clips_1 = generate_clips(
        project_dir,
        max_clip_seconds=30.0,
        requested_clip_count=1,
        caption_style="robin",
    )
    assert len(clips_1) == 1
    assert mock_calls["count"] == 1
    assert captured_languages[-1] == "ar"

    # Inject a custom top_line into analysis.json
    saved = json.loads((project_dir / "analysis.json").read_text(encoding="utf-8"))
    saved["clips"][0]["top_line"] = "KEEP THIS HOOK"
    (project_dir / "analysis.json").write_text(json.dumps(saved), encoding="utf-8")

    # Second run with only caption_style changed should reuse v2 cache (no re-analysis)
    clips_2 = generate_clips(
        project_dir,
        max_clip_seconds=30.0,
        requested_clip_count=1,
        caption_style="punch",
    )
    assert mock_calls["count"] == 1
    assert clips_2[0]["top_line"] == "KEEP THIS HOOK"

    # Force re-analysis with matching timestamps and verify top_line is preserved
    def fake_mock_same_window(project_directory: Path, **kwargs: Any) -> dict[str, Any]:
        mock_calls["count"] += 1
        analysis = {
            "analyzer_version": 2,
            "clips": [
                {
                    "id": "clip_001",
                    "title": "Reanalyzed Hook",
                    "start": 0.0,
                    "end": 30.0,
                    "reason": "Mock analysis: re-run",
                }
            ],
        }
        (project_directory / "analysis.json").write_text(
            json.dumps(analysis), encoding="utf-8"
        )
        return analysis

    monkeypatch.setattr(
        "app.services.clip_generator.create_mock_analysis", fake_mock_same_window
    )
    clips_3 = generate_clips(
        project_dir,
        max_clip_seconds=30.0,
        requested_clip_count=2,  # count_insufficient triggers re-analysis
        caption_style="punch",
    )
    assert mock_calls["count"] == 2
    assert clips_3[0]["top_line"] == "KEEP THIS HOOK"


def test_partial_transcript_detected_and_retranscribed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    project_id, project_dir = create_project()
    (project_dir / "source.mp4").write_bytes(b"video")

    tx_dir = project_dir / "transcription"
    tx_dir.mkdir(parents=True, exist_ok=True)
    tx_path = tx_dir / "transcript.json"
    tx_path.write_text(
        json.dumps(
            {
                "is_complete": False,
                "covered_duration": 35.0,
                "segments": [{"start": 0.0, "end": 10.0, "text": "Hello"}],
            }
        ),
        encoding="utf-8",
    )

    assert _is_transcript_usable(tx_path, 30.0) is True
    assert _is_transcript_usable(tx_path, 90.0) is False
    assert _is_transcript_usable(tx_path, None) is False

    started = {"called": False}

    def fake_run_transcription(*args: Any, **kwargs: Any) -> None:
        started["called"] = True

    monkeypatch.setattr(
        "app.routes.transcription.run_local_transcription", fake_run_transcription
    )
    from app.routes.local_video import TRANSCRIPTION_CANCEL_EVENTS, TRANSCRIPTION_JOBS

    try:
        res = client.post(f"/api/projects/{project_id}/transcribe")
        assert res.status_code == 202
        assert res.json()["status"] == "queued"
        assert started["called"] is True
    finally:
        TRANSCRIPTION_JOBS.pop(project_id, None)
        TRANSCRIPTION_CANCEL_EVENTS.pop(project_id, None)


def test_smart_framing_smooth_segment_and_dual_shot_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1. Verify O(N) _smooth_and_simplify_segment handles 1,000 samples rapidly & cleanly
    samples = [(i * 0.25, 420 + int(40 * ((i % 20) / 20.0))) for i in range(1000)]
    t0 = time.perf_counter()
    keyframes = _smooth_and_simplify_segment(samples, crop_w=608, max_left=1312)
    elapsed = time.perf_counter() - t0
    assert elapsed < 0.25
    assert len(keyframes) >= 1
    assert all(0 <= x <= 1312 and x % 2 == 0 for _, x in keyframes)

    # 2. Verify dual shots_tracked / shots_static cache hit with zero re-scans
    project_dir = tmp_path / "sf_proj"
    project_dir.mkdir(parents=True)
    source = project_dir / "source.mp4"
    source.write_bytes(b"dummy source video")

    cache_payload = {
        "version": ANALYSIS_VERSION,
        "source": _source_signature(source),
        "source_width": 1920,
        "source_height": 1080,
        "crop_width": 608,
        "crop_height": 1080,
        "video_duration": 120.0,
        "scanned_duration": 60.0,
        "is_full_scan": False,
        "shots_tracked": [{"start": 0.0, "end": 60.0, "keyframes": [[0.0, 400], [10.0, 500]]}],
        "shots_static": [{"start": 0.0, "end": 60.0, "x": 420}],
        "shots": [{"start": 0.0, "end": 60.0, "keyframes": [[0.0, 400], [10.0, 500]]}],
    }
    (project_dir / "tracking_analysis.json").write_text(
        json.dumps(cache_payload), encoding="utf-8"
    )

    def fail_if_probed(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Cache should have been hit without probing or scanning video!")

    monkeypatch.setattr("app.services.smart_framing.probe_video_dimensions", fail_if_probed)

    tracked = analyze_speaker_tracking(
        project_dir, "ffmpeg", max_duration=45.0, face_tracking=True
    )
    assert tracked["face_tracking"] is True
    assert "keyframes" in tracked["shots"][0]

    static = analyze_speaker_tracking(
        project_dir, "ffmpeg", max_duration=45.0, face_tracking=False
    )
    assert static["face_tracking"] is False
    assert static["shots"][0]["x"] == 420


def test_watermark_settings_isolation_and_upload_validation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects_dir = tmp_path / "isolated_data" / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))

    # Update settings
    res = client.post(
        "/api/watermark/settings", json={"position": "bottom_left", "opacity": 65}
    )
    assert res.status.real == 200 if hasattr(res, "status") else res.status_code == 200
    assert res.json()["position"] == "bottom_left"
    assert res.json()["opacity"] == 65
    assert (tmp_path / "isolated_data" / "watermarks" / "watermark_settings.json").is_file()

    # Reject SVG upload
    svg_res = client.post(
        "/api/watermark/upload",
        files={"file": ("logo.svg", b"<svg></svg>", "image/svg+xml")},
    )
    assert svg_res.status_code == 400

    # Reject spoofed PNG magic bytes
    bad_png = client.post(
        "/api/watermark/upload",
        files={"file": ("logo.png", b"not-a-real-png", "image/png")},
    )
    assert bad_png.status_code == 400

    # Accept valid PNG magic bytes
    valid_png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    ok_png = client.post(
        "/api/watermark/upload",
        files={"file": ("logo.png", valid_png_bytes, "image/png")},
    )
    assert ok_png.status_code == 200
    status_res = client.get("/api/watermark")
    assert status_res.status_code == 200
    body = status_res.json()
    assert body["has_custom_watermark"] is True
    assert body["position"] == "bottom_left"
    assert body["opacity"] == 65
    assert "?v=" in body["custom_url"]


def test_youtube_oauth_xss_escaping_and_upload_path_traversal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects_dir = tmp_path / "yt_data" / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    project_id, _ = create_project()

    xss = "<script>alert('xss')</script>"
    cb = client.get("/api/youtube/oauth/callback", params={"error": xss})
    assert cb.status_code == 400
    assert "<script>alert" not in cb.text
    assert "&lt;script&gt;" in cb.text

    for bad_clip_id in ("../source", "..\\source", "clip_*", ".hidden"):
        up = client.post(
            "/api/youtube/upload",
            json={
                "project_id": project_id,
                "clip_id": bad_clip_id,
                "title": "Test Title",
            },
        )
        assert up.status_code == 400


def test_ai_developer_mode_isolated_atomic_persistence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects_dir = tmp_path / "ai_data" / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    status0 = client.get("/api/ai/status")
    assert status0.status_code == 200
    assert status0.json()["gemini_configured"] is False

    # Cannot enable developer mode before configuring a key
    fail_enable = client.post("/api/ai/developer-mode", json={"enabled": True})
    assert fail_enable.status_code == 400

    # Save valid-length key into isolated gemini_config.json
    fake_key = "AIzaSyTestKeyForRegressionSuite123456"
    save_res = client.post("/api/ai/config", json={"api_key": fake_key})
    assert save_res.status_code == 200
    assert save_res.json()["status"]["ai_enabled"] is True
    assert (tmp_path / "ai_data" / "gemini_config.json").is_file()

    # Toggle developer mode off and back on
    off_res = client.post("/api/ai/developer-mode", json={"enabled": False})
    assert off_res.status_code == 200
    assert off_res.json()["status"]["ai_enabled"] is False


def test_relocate_and_expand_intro_teaser_clip() -> None:
    from app.services.ai_analyzer import _relocate_and_expand_clip_bounds

    segments = [
        {"start": 0.0, "end": 26.13, "text": "Welcome to the show today."},
        {
            "start": 26.13,
            "end": 30.79,
            "text": "Wait, how much are you going to spend on content this year? Well over 200 million.",
        },
        {"start": 30.79, "end": 400.0, "text": "Let us start from the beginning of your journey."},
        {"start": 3915.0, "end": 3929.12, "text": "We reinvest almost every dollar we make back into videos."},
        {
            "start": 3929.12,
            "end": 3942.0,
            "text": "How much are you going to spend on content this year? Well over 200 million dollars.",
        },
        {
            "start": 3942.0,
            "end": 3968.5,
            "text": "Because each video costs three to five million to produce at this scale.",
        },
    ]

    new_start, new_end = _relocate_and_expand_clip_bounds(26.13, 30.79, segments, 60.0)
    assert new_start >= 3915.0
    assert new_end >= 3968.5
    assert (new_end - new_start) >= 35.0


def test_split_screen_clamp_prevents_center_seam_crossing() -> None:
    from app.services.smart_framing import _clamp_split_screen_target

    orig_w = 1280
    crop_w = 404
    half_w = orig_w / 2.0  # 640.0
    visible = [(1, 520.0, 90.0), (2, 960.0, 90.0)]

    # Left speaker near the center divider should be clamped so right edge (cx + crop_w / 2) <= 640
    left_cx = _clamp_split_screen_target(
        target_cx=520.0,
        visible=visible,
        orig_w=orig_w,
        crop_w=crop_w,
    )
    assert left_cx + (crop_w / 2.0) <= half_w

    # Right speaker near the center divider should be clamped so left edge (cx - crop_w / 2) >= 640
    right_cx = _clamp_split_screen_target(
        target_cx=700.0,
        visible=visible,
        orig_w=orig_w,
        crop_w=crop_w,
    )
    assert right_cx - (crop_w / 2.0) >= half_w


def test_clip_serving_includes_version_token_and_no_cache_header(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    projects_dir = tmp_path / "clip_cache_data" / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    project_id, project_dir = create_project()
    clips_dir = project_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    clip_file = clips_dir / "clip_001.mp4"
    clip_file.write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom")

    list_res = client.get(f"/api/projects/{project_id}/clips")
    assert list_res.status_code == 200
    clips = list_res.json()["clips"]
    assert len(clips) == 1
    assert clips[0]["v"]

    serve_res = client.get(f"/api/projects/{project_id}/clips/clip_001.mp4")
    assert serve_res.status_code == 200
    assert "no-cache" in serve_res.headers.get("cache-control", "").lower()


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

    locked = analyze_speaker_tracking(
        project_dir, "ffmpeg", max_duration=45.0, face_tracking=False
    )
    assert locked["face_tracking"] is False
    assert locked["applied_tracking_mode"] == "locked"
    assert locked["shots"][0]["x"] == 656

    static = analyze_speaker_tracking(
        project_dir, "ffmpeg", max_duration=45.0, tracking_mode="cuts"
    )
    assert static["face_tracking"] is False
    assert static["applied_tracking_mode"] == "cuts"
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

    # Accept valid decoded PNG image
    from io import BytesIO
    from PIL import Image

    buf = BytesIO()
    Image.new("RGBA", (16, 16), (0, 200, 120, 255)).save(buf, format="PNG")
    valid_png_bytes = buf.getvalue()
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


def _sha256(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def _seed_committed_project(project_dir: Path) -> tuple[str, str, str]:
    (project_dir / "source.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42source")
    trans_dir = project_dir / "transcription"
    trans_dir.mkdir(parents=True, exist_ok=True)
    (trans_dir / "transcript.json").write_text(
        json.dumps({
            "language": "en",
            "duration": 90.0,
            "has_audio": True,
            "has_speech": True,
            "segments": [
                {"start": 0.0, "end": 30.0, "text": "Segment one speech content here."},
                {"start": 30.0, "end": 60.0, "text": "Segment two speech content here."},
                {"start": 60.0, "end": 90.0, "text": "Segment three speech content here."},
            ],
        }),
        encoding="utf-8",
    )
    clips_dir = project_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    clip1 = clips_dir / "clip_001.mp4"
    clip2 = clips_dir / "clip_002.mp4"
    clip1.write_bytes(b"committed-clip-one-bytes")
    clip2.write_bytes(b"committed-clip-two-bytes")
    analysis_path = project_dir / "analysis.json"
    analysis_path.write_text(
        json.dumps({
            "generation_mode": "random",
            "requested_generation_mode": "random",
            "applied_generation_mode": "random",
            "generation_options": {
                "clip_duration_seconds": 30,
                "generation_mode": "random",
                "requested_generation_mode": "random",
                "applied_generation_mode": "random",
                "framing_mode": "standard",
                "tracking_mode": "follow",
                "applied_tracking_mode": "follow",
            },
            "clips": [
                {"id": "clip_001", "title": "Old Clip 1", "start": 0.0, "end": 30.0, "file": "clip_001.mp4"},
                {"id": "clip_002", "title": "Old Clip 2", "start": 30.0, "end": 60.0, "file": "clip_002.mp4"},
            ],
        }),
        encoding="utf-8",
    )
    return _sha256(clip1), _sha256(clip2), _sha256(analysis_path)


def test_regeneration_staging_preserves_existing_clips_on_cancel_and_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading
    import zipfile
    from io import BytesIO
    from app.routes.clips import run_clip_generation

    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    project_id, project_dir = create_project()
    h1, h2, h_analysis = _seed_committed_project(project_dir)

    monkeypatch.setattr("app.services.video_editor.find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.video_editor.probe_video_duration", lambda *_: 90.0)

    # Case A: Cancel during 2nd staged clip -> committed clips + ZIP stay identical
    staged_bytes: list[bytes] = []
    cancel_evt = threading.Event()

    def cancel_on_second(*args, **kwargs):
        out = Path(kwargs.get("output_path") if "output_path" in kwargs else args[1])
        assert ".staging_" in str(out)
        if "clip_001" in out.name:
            out.write_bytes(b"new-staged-clip-1")
            staged_bytes.append(out.read_bytes())
            # Live endpoint must STILL serve original clip bytes during staging!
            live = client.get(f"/api/projects/{project_id}/clips/clip_001.mp4")
            assert live.status_code == 200
            assert live.content == b"committed-clip-one-bytes"
            return
        if "clip_002" in out.name:
            # Staged preview must serve finished clip_001 while clip_002 begins!
            staged = client.get(
                f"/api/projects/{project_id}/clips/clip_001.mp4",
                params={"stage_job_id": job_id},
            )
            assert staged.status_code == 200
            assert staged.content == b"new-staged-clip-1"
            cancel_evt.set()
            return
        raise AssertionError(f"Unexpected clip render: {out.name}")

    monkeypatch.setattr("app.services.clip_generator.create_clip", cancel_on_second)
    job_id = "cancel_during_second"
    with JOBS_LOCK:
        GENERATION_JOBS[job_id] = {
            "job_id": job_id,
            "project_id": project_id,
            "project_dir": str(project_dir.resolve()),
            "status": "queued",
            "step": "Queued",
            "progress": 0,
            "completed_clips": 0,
            "total_clips": 0,
            "ready_clips": [],
        }
        CANCEL_EVENTS[job_id] = cancel_evt

    run_clip_generation(
        job_id,
        project_id,
        project_dir,
        True,
        cancel_evt,
        clip_duration_seconds=30,
        generation_mode="random",
    )
    assert GENERATION_JOBS[job_id]["status"] == "cancelled"
    assert _sha256(project_dir / "clips" / "clip_001.mp4") == h1
    assert _sha256(project_dir / "clips" / "clip_002.mp4") == h2
    assert _sha256(project_dir / "analysis.json") == h_analysis
    assert not any(p.name.startswith(".staging_") for p in project_dir.iterdir())

    zip_res = client.get(f"/api/projects/{project_id}/clips/download-all")
    assert zip_res.status_code == 200
    with zipfile.ZipFile(BytesIO(zip_res.content)) as zf:
        assert sorted(zf.namelist()) == ["clip_001.mp4", "clip_002.mp4"]
        assert zf.read("clip_001.mp4") == b"committed-clip-one-bytes"

    # Case B: Failure on 2nd clip preserves existing clips & analysis
    def fail_on_second(*args, **kwargs):
        out = Path(kwargs.get("output_path") if "output_path" in kwargs else args[1])
        if "clip_001" in out.name:
            out.write_bytes(b"partial-new-1")
            return
        raise RuntimeError("synthetic ffmpeg crash")

    monkeypatch.setattr("app.services.clip_generator.create_clip", fail_on_second)
    job_fail = "fail_during_second"
    fail_evt = threading.Event()
    with JOBS_LOCK:
        GENERATION_JOBS[job_fail] = {
            "job_id": job_fail,
            "project_id": project_id,
            "project_dir": str(project_dir.resolve()),
            "status": "queued",
            "step": "Queued",
            "progress": 0,
            "completed_clips": 0,
            "total_clips": 0,
            "ready_clips": [],
        }
        CANCEL_EVENTS[job_fail] = fail_evt

    run_clip_generation(
        job_fail,
        project_id,
        project_dir,
        True,
        fail_evt,
        clip_duration_seconds=30,
        generation_mode="random",
    )
    assert GENERATION_JOBS[job_fail]["status"] == "failed"
    assert _sha256(project_dir / "clips" / "clip_001.mp4") == h1
    assert _sha256(project_dir / "clips" / "clip_002.mp4") == h2
    assert _sha256(project_dir / "analysis.json") == h_analysis
    assert not any(p.name.startswith(".staging_") for p in project_dir.iterdir())

    # Case C: Orphaned staging folder recovered/cleaned without losing committed clips
    orphan = project_dir / ".staging_orphan999"
    orphan.mkdir(parents=True, exist_ok=True)
    (orphan / "clip_001.mp4").write_bytes(b"partial-trash")
    clips_list = client.get(f"/api/projects/{project_id}/clips")
    assert clips_list.status_code == 200
    assert len(clips_list.json()["clips"]) == 2
    assert not orphan.exists()


def test_malicious_clip_ids_in_analysis_cannot_escape_project(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.ai_analyzer import validate_analysis

    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    project_id, project_dir = create_project()
    outside_sentinel = tmp_path / "outside.mp4"
    outside_sentinel.write_bytes(b"DO-NOT-OVERWRITE")

    segments = [
        {"start": 0.0, "end": 20.0, "text": "Segment one"},
        {"start": 20.0, "end": 40.0, "text": "Segment two"},
        {"start": 40.0, "end": 60.0, "text": "Segment three"},
        {"start": 60.0, "end": 80.0, "text": "Segment four"},
    ]
    raw = validate_analysis(
        {
            "clips": [
                {"id": "../../outside", "title": "Traversal", "start": 0, "end": 20, "reason": "r1"},
                {"id": r"C:\evil\clip", "title": "Drive", "start": 20, "end": 40, "reason": "r2"},
                {"id": r"\\server\share\clip", "title": "UNC", "start": 40, "end": 60, "reason": "r3"},
                {"id": "clip_001", "title": "Duplicate", "start": 60, "end": 80, "reason": "r4"},
            ]
        },
        segments,
    )
    assert [c["id"] for c in raw["clips"]] == ["clip_001", "clip_002", "clip_003", "clip_004"]
    assert raw["clips"][0]["provider_id"] == "../../outside"

    # Also test malicious pre-existing cached analysis.json cannot write outside project
    (project_dir / "source.mp4").write_bytes(b"dummy")
    (project_dir / "analysis.json").write_text(
        json.dumps({
            "generation_mode": "random",
            "generation_options": {"clip_duration_seconds": 30, "generation_mode": "random"},
            "clips": [{"id": "../../outside", "title": "Cached Evil", "start": 0.0, "end": 25.0}],
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr("app.services.video_editor.find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.video_editor.probe_video_duration", lambda *_: 60.0)
    monkeypatch.setattr(
        "app.services.clip_generator.create_clip",
        lambda *args, **kw: Path(kw.get("output_path") if "output_path" in kw else args[1]).write_bytes(b"safe-output"),
    )
    res_clips = generate_clips(project_dir, max_clip_seconds=30, generation_mode="random")
    assert outside_sentinel.read_bytes() == b"DO-NOT-OVERWRITE"
    assert res_clips[0]["id"] == "clip_001"
    assert (project_dir / "clips" / "clip_001.mp4").is_file()

    # Path traversal on GET serve_clip must also be rejected
    assert client.get(f"/api/projects/{project_id}/clips/..%2Foutside.mp4").status_code in {400, 404}
    assert client.get(f"/api/projects/{project_id}/clips/..%5Coutside.mp4").status_code in {400, 404}


def test_locked_crop_zero_face_scan_divider_detection_and_reframe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import numpy as np
    from app.services.smart_framing import _frame_has_vertical_center_divider

    # 1. Divider detection: crisp dark seam vs smooth shared-room frame
    split_frame = np.full((360, 640), 180, dtype=np.uint8)
    split_frame[:, 318:322] = 5
    assert _frame_has_vertical_center_divider(split_frame) is True

    shared_frame = np.tile(np.linspace(20, 220, 640, dtype=np.uint8), (360, 1))
    assert _frame_has_vertical_center_divider(shared_frame) is False

    # 2. Locked Crop must never call _scan_faces and honors crop_anchor_x
    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    project_id, project_dir = create_project()
    (project_dir / "source.mp4").write_bytes(b"video")

    monkeypatch.setattr("app.services.smart_framing.probe_video_dimensions", lambda *_: (1920, 1080))
    monkeypatch.setattr(
        "app.services.smart_framing._scan_faces",
        lambda *a, **kw: (_ for _ in ()).throw(AssertionError("_scan_faces must NOT run for locked mode")),
    )
    td = analyze_speaker_tracking(
        project_dir,
        "ffmpeg",
        tracking_mode="locked",
        crop_anchor_x=0.25,
    )
    assert td["applied_tracking_mode"] == "locked"
    assert td["shots"][0]["x"] == 328  # round(((1920 - 608) * 0.25)/2)*2

    # 3. Crop preview endpoint & single-clip reframe without altering siblings
    prev = client.get(
        f"/api/projects/{project_id}/crop-preview",
        params={"start": 0, "end": 15, "tracking_mode": "locked", "crop_anchor_x": 0.25},
    )
    assert prev.status_code == 200
    assert prev.json()["x"] == 328

    _seed_committed_project(project_dir)
    monkeypatch.setattr("app.services.video_editor.find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.video_editor.probe_video_duration", lambda *_: 90.0)
    monkeypatch.setattr(
        "app.services.clip_generator.create_clip",
        lambda *args, **kw: Path(kw.get("output_path") if "output_path" in kw else args[1]).write_bytes(b"reframed"),
    )
    ref = client.post(
        f"/api/projects/{project_id}/clips/clip_001/reframe",
        json={"framing_mode": "true_9_16", "tracking_mode": "locked", "crop_anchor_x": 0.8},
    )
    assert ref.status_code == 200
    assert ref.json()["clip"]["tracking_mode"] == "locked"
    assert ref.json()["clip"]["crop_anchor_x"] == 0.8
    saved_analysis = json.loads((project_dir / "analysis.json").read_text(encoding="utf-8"))
    assert saved_analysis["generation_options"]["tracking_mode"] == "follow"
    c1 = next(c for c in saved_analysis["clips"] if c["id"] == "clip_001")
    c2 = next(c for c in saved_analysis["clips"] if c["id"] == "clip_002")
    assert c1["tracking_mode"] == "locked"
    assert c1["crop_anchor_x"] == 0.8
    assert c2.get("tracking_mode") != "locked" or c2.get("crop_anchor_x") is None


def test_ai_modes_errors_gate_and_fallback_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import httpx
    from app.routes.clips import run_clip_generation
    from app.services.ai_analyzer import AIAnalyzerError, analyze_transcript
    import threading

    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    secret_key = "AIzaSySecretKeyNeverLeakInErrors123456"

    # Developer Mode gate applies even when AI_PROVIDER=gemini
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    project_id, project_dir = create_project()
    _seed_committed_project(project_dir)
    gate_res = client.post(
        "/api/analyze",
        json={"transcript": {"segments": [{"start": 0, "end": 10, "text": "hello world"}]}},
    )
    assert gate_res.status_code == 403
    assert client.post(f"/api/projects/{project_id}/generate-clips", params={"generation_mode": "ai"}).status_code == 403

    # Configure key -> developer mode ON
    assert client.post("/api/ai/config", json={"api_key": secret_key}).status_code == 200

    # Mock HTTP errors (401, 404, 429, malformed JSON) & verify no key leak
    for status_code, body_json, expect_fragment in [
        (401, {"error": {"message": f"Invalid key {secret_key}"}}, "401"),
        (404, {"error": {"message": "Model not found"}}, "404"),
        (429, {"error": {"message": "Rate limit exceeded"}}, "rate limit"),
        (200, {"candidates": [{"content": {"parts": [{"text": "{not valid json"}]}}]}, "valid json"),
    ]:
        class FakeClient:
            def __init__(self, *a, **kw):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def post(self, *a, **kw):
                req = httpx.Request("POST", "https://generativelanguage.googleapis.com/v1beta/test")
                return httpx.Response(status_code=status_code, json=body_json, request=req)

        monkeypatch.setattr("app.services.ai_analyzer.httpx.Client", FakeClient)
        monkeypatch.setattr("app.services.ai_analyzer.time.sleep", lambda *_: None)
        with pytest.raises(AIAnalyzerError) as exc_info:
            analyze_transcript({"segments": [{"start": 0.0, "end": 12.0, "text": "Testing AI error paths"}]})
        msg = str(exc_info.value).lower()
        assert secret_key.lower() not in msg
        assert expect_fragment in msg

    # Fallback recorded explicitly -> retry with AI bypasses cached fallback!
    monkeypatch.setattr("app.services.video_editor.find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.video_editor.probe_video_duration", lambda *_: 90.0)
    monkeypatch.setattr(
        "app.services.clip_generator.create_clip",
        lambda *args, **kw: Path(kw.get("output_path") if "output_path" in kw else args[1]).write_bytes(b"clip"),
    )

    ai_calls = {"count": 0}
    def fail_then_succeed_ai(*a, **kw):
        ai_calls["count"] += 1
        if ai_calls["count"] == 1:
            raise AIAnalyzerError("Temporary quota hit", status_code=429)
        return {
            "provider": "gemini",
            "model": "gemini-2.5-flash",
            "clips": [{"id": "clip_001", "title": "Real AI Hook", "start": 0.0, "end": 30.0, "score": 9.3, "reason": "Strong hook"}],
        }

    monkeypatch.setattr("app.services.ai_analyzer.analyze_transcript", fail_then_succeed_ai)
    evt1 = threading.Event()
    job1 = "ai_fallback_job"
    with JOBS_LOCK:
        GENERATION_JOBS[job1] = {
            "job_id": job1, "project_id": project_id, "project_dir": str(project_dir.resolve()),
            "status": "queued", "step": "Q", "progress": 0, "completed_clips": 0, "total_clips": 0, "ready_clips": [],
        }
        CANCEL_EVENTS[job1] = evt1
    run_clip_generation(job1, project_id, project_dir, True, evt1, clip_duration_seconds=30, generation_mode="ai")
    assert GENERATION_JOBS[job1]["requested_generation_mode"] == "ai"
    assert GENERATION_JOBS[job1]["applied_generation_mode"] == "random"
    assert "Temporary quota hit" in (GENERATION_JOBS[job1]["ai_fallback_reason"] or "")

    evt2 = threading.Event()
    job2 = "ai_retry_job"
    with JOBS_LOCK:
        GENERATION_JOBS[job2] = {
            "job_id": job2, "project_id": project_id, "project_dir": str(project_dir.resolve()),
            "status": "queued", "step": "Q", "progress": 0, "completed_clips": 0, "total_clips": 0, "ready_clips": [],
        }
        CANCEL_EVENTS[job2] = evt2
    run_clip_generation(job2, project_id, project_dir, True, evt2, clip_duration_seconds=30, generation_mode="ai")
    assert ai_calls["count"] == 2
    assert GENERATION_JOBS[job2]["applied_generation_mode"] == "ai"
    assert GENERATION_JOBS[job2]["ai_fallback_reason"] is None


def test_project_ids_not_reused_and_silent_ffmpeg_video_end_to_end(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import shutil
    import subprocess
    from app.services.transcriber import transcribe_video

    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))
    p1, _ = create_project()
    p2, d2 = create_project()
    assert (p1, p2) == ("project_001", "project_002")
    shutil.rmtree(d2)
    p3, d3 = create_project()
    assert p3 == "project_003"

    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin is None:
        from app.services.video_editor import find_ffmpeg
        try:
            ffmpeg_bin = find_ffmpeg()
        except Exception:
            pytest.skip("ffmpeg not installed in PATH")

    silent_source = d3 / "source.mp4"
    subprocess.run(
        [
            ffmpeg_bin,
            "-y",
            "-f", "lavfi",
            "-i", "testsrc=duration=3:size=640x360:rate=24",
            "-an",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(silent_source),
        ],
        check=True,
        capture_output=True,
    )

    stages: list[str] = []
    # Whisper must NOT run when source has no audio stream
    monkeypatch.setattr(
        "app.services.transcriber.get_whisper_model",
        lambda *a, **kw: (_ for _ in ()).throw(AssertionError("Whisper must not load on silent video")),
    )
    transcript = transcribe_video(
        silent_source,
        d3 / "transcription",
        progress_callback=lambda stage, pct: stages.append(stage),
    )
    assert transcript["has_audio"] is False
    assert transcript["segments"] == 0
    saved_transcript = json.loads((d3 / "transcription" / "transcript.json").read_text(encoding="utf-8"))
    assert saved_transcript["segments"] == []
    assert saved_transcript["has_audio"] is False
    assert any("audio" in s.lower() for s in stages)

    generated_clips = generate_clips(
        d3,
        max_clip_seconds=15,
        requested_clip_count=1,
        generation_mode="random",
        show_subtitles=False,
        framing_mode="true_9_16",
        tracking_mode="locked",
    )
    assert len(generated_clips) == 1
    assert generated_clips[0]["selection_method"] == "time_slice"
    out_mp4 = d3 / "clips" / "clip_001.mp4"
    assert out_mp4.is_file() and out_mp4.stat().st_size > 1000


def test_corrupt_watermark_preserves_existing_and_local_api_security(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from io import BytesIO
    from PIL import Image

    projects_dir = tmp_path / "sec_data" / "projects"
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(projects_dir))

    buf = BytesIO()
    Image.new("RGBA", (24, 24), (10, 120, 240, 255)).save(buf, format="PNG")
    good_png = buf.getvalue()
    assert client.post("/api/watermark/upload", files={"file": ("brand.png", good_png, "image/png")}).status_code == 200
    before = client.get("/api/watermark/image").content

    # Truncated header-only PNG must fail decode & preserve previous watermark!
    truncated_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
    assert client.post("/api/watermark/upload", files={"file": ("broken.png", truncated_png, "image/png")}).status_code == 400
    assert client.get("/api/watermark/image").content == before

    # Cross-origin & Sec-Fetch-Site rejection
    evil = client.get("/api/projects", headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    assert "access-control-allow-origin" not in evil.headers
    assert client.get("/api/projects", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    # OAuth callback stays reachable across site redirects
    assert client.get("/api/youtube/oauth/callback", params={"error": "denied"}, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 400

    # Per-launch API token enforcement
    monkeypatch.setenv("CLIPROBIN_API_TOKEN", "launch_secret_token")
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects", headers={"X-ClipRobin-Token": "wrong"}).status_code == 401
    assert client.get("/api/projects", headers={"X-ClipRobin-Token": "launch_secret_token"}).status_code == 200
    # Query token accepted only on media GET paths, rejected on JSON list routes
    assert client.get("/api/projects", params={"token": "launch_secret_token"}).status_code == 401
    assert client.get("/api/watermark/image", params={"token": "launch_secret_token"}).status_code == 200


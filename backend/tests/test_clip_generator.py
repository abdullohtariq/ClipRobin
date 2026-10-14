import json
from pathlib import Path
import threading
import pytest

from app.services.clip_generator import generate_clips
from app.services.video_editor import ClipGenerationCancelled, VideoEditorError


def test_generate_clips_missing_source_video(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="Source video not found"):
        generate_clips(tmp_path)


def test_generate_clips_preserves_existing_clips_on_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Setup project with source video and transcript
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    existing_clip = clips_dir / "clip_old.mp4"
    existing_clip.write_bytes(b"previous working clip")

    # Add analysis
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"},
                {"id": "clip_002", "title": "Clip 2", "start": 10.0, "end": 20.0, "reason": "Test"},
            ]
        }),
        encoding="utf-8",
    )

    # Mock create_clip to fail on clip 2
    def mock_create_clip(source, output, start, end, **kwargs):
        if "clip_002" in output.name:
            raise VideoEditorError("Simulated FFmpeg failure")
        output.write_bytes(b"rendered clip 1")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    with pytest.raises(VideoEditorError, match="Simulated FFmpeg failure"):
        generate_clips(tmp_path)

    # Verify original clip was NOT purged when render failed
    assert existing_clip.is_file()
    assert existing_clip.read_bytes() == b"previous working clip"


def test_generate_clips_cancellation_preserves_existing_clips(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    existing_clip = clips_dir / "clip_old.mp4"
    existing_clip.write_bytes(b"previous working clip")

    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    cancel_event = threading.Event()
    cancel_event.set()

    with pytest.raises(ClipGenerationCancelled):
        generate_clips(tmp_path, cancel_event=cancel_event)

    assert existing_clip.is_file()
    assert existing_clip.read_bytes() == b"previous working clip"


def test_generate_clips_successful_atomic_swap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    existing_clip = clips_dir / "clip_old.mp4"
    existing_clip.write_bytes(b"old clip")

    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 15.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    def mock_create_clip(source, output, start, end, **kwargs):
        output.write_bytes(b"new clip content")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    results = generate_clips(tmp_path)
    assert len(results) == 1
    assert results[0]["id"] == "clip_001"
    assert results[0]["status"] == "ready"

    # Old clip should now be gone, and new clip in place
    assert not existing_clip.is_file()
    new_clip = clips_dir / "clip_001.mp4"
    assert new_clip.is_file()
    assert new_clip.read_bytes() == b"new clip content"

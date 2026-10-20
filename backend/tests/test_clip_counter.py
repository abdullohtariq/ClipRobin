import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.mock_analyzer import create_mock_analysis
from app.services.project_manager import create_project
from app.services.video_editor import probe_video_duration

client = TestClient(app)


def test_mock_analysis_respects_max_clips(tmp_path: Path):
    project_dir = tmp_path / "project_test"
    project_dir.mkdir()
    trans_dir = project_dir / "transcription"
    trans_dir.mkdir()

    # Create dummy transcript with 10 segments of 6 seconds each (total 60s)
    segments = [
        {"start": i * 6.0, "end": (i + 1) * 6.0, "text": f"Sentence number {i}."}
        for i in range(10)
    ]
    (trans_dir / "transcript.json").write_text(
        json.dumps({"segments": segments}), encoding="utf-8"
    )

    # Request 12-second clips, max 2 clips
    analysis = create_mock_analysis(project_dir, max_clip_seconds=12.0, max_clips=2)
    clips = analysis.get("clips", [])
    assert len(clips) == 2
    assert clips[0]["id"] == "clip_001"
    assert clips[1]["id"] == "clip_002"
    assert clips[0]["end"] - clips[0]["start"] <= 15.0


def test_mock_analysis_12s_clips(tmp_path: Path):
    project_dir = tmp_path / "project_test_12"
    project_dir.mkdir()
    trans_dir = project_dir / "transcription"
    trans_dir.mkdir()

    # 4 segments of 4 seconds each (total 16s)
    segments = [
        {"start": i * 4.0, "end": (i + 1) * 4.0, "text": f"Short segment {i}."}
        for i in range(4)
    ]
    (trans_dir / "transcript.json").write_text(
        json.dumps({"segments": segments}), encoding="utf-8"
    )

    analysis = create_mock_analysis(project_dir, max_clip_seconds=12.0)
    clips = analysis.get("clips", [])
    assert len(clips) >= 1
    for clip in clips:
        # All clips are sliced around the 12s target
        assert clip["end"] - clip["start"] <= 16.0


def test_generate_clips_accepts_12s_and_clip_count(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, project_dir = create_project()

    response = client.post(
        f"/api/projects/{project_id}/generate-clips",
        params={"clip_duration_seconds": 12, "clip_count": 3},
    )
    assert response.status_code == 200
    assert "job_id" in response.json()


def test_generate_clips_rejects_invalid_clip_count(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, project_dir = create_project()

    # clip_count < 1 must return 422
    response = client.post(
        f"/api/projects/{project_id}/generate-clips",
        params={"clip_duration_seconds": 12, "clip_count": 0},
    )
    assert response.status_code == 422
    assert "Clip count must be at least 1" in response.json()["detail"]


def test_get_project_clips_includes_source_duration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, project_dir = create_project()

    # Create dummy source video file
    dummy_source = project_dir / "source.mp4"
    dummy_source.write_bytes(b"dummy")

    with patch("app.services.video_editor.probe_video_duration", return_value=124.5):
        response = client.get(f"/api/projects/{project_id}/clips")
        assert response.status_code == 200
        data = response.json()
        assert "clips" in data
        assert "source_duration" in data
        assert data["source_duration"] == 124.5


def test_probe_video_duration_ffprobe(tmp_path: Path):
    dummy_video = tmp_path / "test.mp4"
    dummy_video.write_bytes(b"data")

    # Mock ffprobe output
    mock_res = MagicMock()
    mock_res.returncode = 0
    mock_res.stdout = json.dumps({"format": {"duration": "42.75"}})

    with patch("shutil.which", return_value="ffprobe"), \
         patch("subprocess.run", return_value=mock_res):
        dur = probe_video_duration(dummy_video)
        assert dur == 42.75


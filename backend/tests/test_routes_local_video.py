import io
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from app.main import app

client = TestClient(app)


def test_transcribe_local_video_rejects_unsupported_extension():
    fake_file = io.BytesIO(b"malicious executable")
    response = client.post(
        "/api/local-video/transcribe",
        files={"video": ("test.exe", fake_file, "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Unsupported video file type" in response.json()["detail"]


def test_transcribe_local_video_accepts_valid_video(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    # Mock run_local_transcription so it doesn't trigger whisper during tests
    monkeypatch.setattr("app.routes.local_video.run_local_transcription", lambda *args, **kwargs: None)

    fake_video = io.BytesIO(b"fake mp4 video bytes")
    response = client.post(
        "/api/local-video/transcribe",
        files={"video": ("sample.mp4", fake_video, "video/mp4")},
    )
    assert response.status_code == 202
    data = response.json()
    assert "project_id" in data
    assert data["status"] == "queued"

    # Verify job polling
    job_response = client.get(f"/api/local-video/jobs/{data['project_id']}")
    assert job_response.status_code == 200
    assert job_response.json()["project_id"] == data["project_id"]


def test_get_local_transcription_job_not_found():
    response = client.get("/api/local-video/jobs/project_nonexistent")
    assert response.status_code == 404


def test_transcribe_from_path_rejects_nonexistent_file():
    response = client.post("/api/local-video/from-path", json={"file_path": "nonexistent_file.mp4"})
    assert response.status_code == 400
    assert "Specified video file does not exist" in response.json()["detail"]


def test_transcribe_from_path_rejects_unsupported_extension(tmp_path: Path):
    bad_file = tmp_path / "bad.txt"
    bad_file.write_text("not a video")
    response = client.post("/api/local-video/from-path", json={"file_path": str(bad_file)})
    assert response.status_code == 400
    assert "Unsupported video file type" in response.json()["detail"]


def test_transcribe_from_path_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    monkeypatch.setattr("app.routes.local_video.run_local_transcription", lambda *args, **kwargs: None)

    valid_file = tmp_path / "my_video.mp4"
    valid_file.write_bytes(b"sample video data")

    response = client.post("/api/local-video/from-path", json={"file_path": str(valid_file)})
    assert response.status_code == 202
    data = response.json()
    assert "project_id" in data
    assert data["status"] == "queued"


def test_evict_old_transcription_jobs():
    from app.routes.local_video import TRANSCRIPTION_JOBS, evict_old_transcription_jobs, MAX_COMPLETED_JOBS
    for i in range(MAX_COMPLETED_JOBS + 10):
        TRANSCRIPTION_JOBS[f"test_evict_{i}"] = {"status": "completed"}
    evict_old_transcription_jobs()
    remaining = [k for k in TRANSCRIPTION_JOBS if k.startswith("test_evict_")]
    assert len(remaining) <= MAX_COMPLETED_JOBS
    for k in remaining:
        TRANSCRIPTION_JOBS.pop(k, None)


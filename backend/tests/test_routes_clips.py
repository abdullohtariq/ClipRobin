from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.routes.clips import GENERATION_JOBS, JOBS_LOCK as CLIPS_LOCK
from app.services.project_manager import create_project

client = TestClient(app)


def test_generate_clips_invalid_duration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, _ = create_project()

    response = client.post(
        f"/api/projects/{project_id}/generate-clips",
        params={"clip_duration_seconds": 45},  # Valid are 15, 30, 60, 90
    )
    assert response.status_code == 422

def test_generate_clips_rejects_duplicate_active_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, _ = create_project()

    with CLIPS_LOCK:
        GENERATION_JOBS["existing_job"] = {
            "job_id": "existing_job",
            "project_id": project_id,
            "status": "processing",
        }

    response = client.post(
        f"/api/projects/{project_id}/generate-clips",
        params={"clip_duration_seconds": 60},
    )
    assert response.status_code == 409
    assert "already running" in response.json()["detail"]

    with CLIPS_LOCK:
        GENERATION_JOBS.pop("existing_job", None)


def test_generate_clips_project_not_found(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    response = client.post(
        "/api/projects/project_999/generate-clips",
        params={"clip_duration_seconds": 60},
    )
    assert response.status_code == 404


def test_download_all_no_clips(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, _ = create_project()

    response = client.get(f"/api/projects/{project_id}/clips/download-all")
    assert response.status_code == 404

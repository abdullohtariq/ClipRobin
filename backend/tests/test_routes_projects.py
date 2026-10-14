from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.routes.clips import GENERATION_JOBS, JOBS_LOCK as CLIPS_LOCK
from app.services.project_manager import create_project

client = TestClient(app)


def test_get_projects(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    response = client.get("/api/projects")
    assert response.status_code == 200
    assert response.json() == {"projects": []}

    project_id, _ = create_project()
    response = client.get("/api/projects")
    assert response.status_code == 200
    assert len(response.json()["projects"]) == 1
    assert response.json()["projects"][0]["project_id"] == project_id


def test_delete_project_success_and_cancels_jobs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, project_dir = create_project()
    assert project_dir.is_dir()

    with CLIPS_LOCK:
        GENERATION_JOBS["job_123"] = {
            "job_id": "job_123",
            "project_id": project_id,
            "status": "processing",
        }

    response = client.delete(f"/api/projects/{project_id}")
    assert response.status_code == 204
    assert not project_dir.is_dir()

    # Verify active job was cancelled
    with CLIPS_LOCK:
        assert GENERATION_JOBS["job_123"]["status"] == "cancelled"


def test_delete_project_invalid_id():
    response = client.delete("/api/projects/invalid..id")
    assert response.status_code == 400


def test_delete_project_not_found(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    response = client.delete("/api/projects/project_999")
    assert response.status_code == 404


from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from app.main import app

client = TestClient(app)


def test_download_rejects_non_youtube_urls():
    response = client.post("/api/download", json={"url": "https://vimeo.com/123456"})
    assert response.status_code == 422
    assert "YouTube URL is required" in str(response.json())

    response = client.post("/api/download", json={"url": "https://evil-site.com/video"})
    assert response.status_code == 422


def test_download_accepts_youtube_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))

    # Mock run_background_download to not actually hit YouTube network
    monkeypatch.setattr("app.routes.download.run_background_download", lambda *args, **kwargs: None)

    response = client.post("/api/download", json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
    assert response.status_code == 202
    data = response.json()
    assert "project_id" in data
    assert data["status"] == "queued"
    assert data["file"] == "source.mp4"

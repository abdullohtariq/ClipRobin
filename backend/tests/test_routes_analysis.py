from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.services.project_manager import create_project

client = TestClient(app)


def test_analyze_validates_transcript_schema():
    response = client.post("/api/analyze", json={"transcript": {}})
    assert response.status_code == 422


def test_analyze_handles_overlapping_segments_and_saves_to_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, project_dir = create_project()

    # Mock analyze_transcript to return valid analysis without calling remote LLMs
    def mock_analyze(transcript, provider):
        return {
            "clips": [
                {"id": "clip_001", "title": "Clip Title", "start": 0.0, "end": 10.0, "reason": "Good hook"}
            ]
        }

    monkeypatch.setattr("app.routes.analysis.analyze_transcript", mock_analyze)

    payload = {
        "transcript": {
            "segments": [
                {"start": 0.0, "end": 5.0, "text": "Segment one."},
                {"start": 4.8, "end": 10.0, "text": "Overlapping segment two."},
            ]
        },
        "project_id": project_id,
    }
    response = client.post("/api/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["clips"]) == 1

    # Verify analysis.json was saved into project directory
    analysis_file = project_dir / "analysis.json"
    assert analysis_file.is_file()


def test_analyze_nonexistent_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))

    monkeypatch.setattr(
        "app.routes.analysis.analyze_transcript",
        lambda t, p: {"clips": [{"id": "clip_001", "title": "T", "start": 0.0, "end": 5.0, "reason": "R"}]},
    )

    payload = {
        "transcript": {
            "segments": [{"start": 0.0, "end": 5.0, "text": "Test"}]
        },
        "project_id": "project_999",
    }
    response = client.post("/api/analyze", json=payload)
    assert response.status_code == 404


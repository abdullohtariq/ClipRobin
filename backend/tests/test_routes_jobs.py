from fastapi.testclient import TestClient

from app.main import app
from app.routes.clips import GENERATION_JOBS, JOBS_LOCK as CLIPS_LOCK
from app.routes.download import DOWNLOAD_JOBS, DOWNLOAD_JOBS_LOCK
from app.routes.local_video import JOBS_LOCK as TRANSCRIPTION_LOCK, TRANSCRIPTION_JOBS

client = TestClient(app)


def test_active_jobs_empty():
    with CLIPS_LOCK, TRANSCRIPTION_LOCK, DOWNLOAD_JOBS_LOCK:
        GENERATION_JOBS.clear()
        TRANSCRIPTION_JOBS.clear()
        DOWNLOAD_JOBS.clear()

    response = client.get("/api/jobs/active")
    assert response.status_code == 200
    assert response.json() == {"jobs": []}


def test_active_jobs_combines_download_transcription_and_generation():
    with CLIPS_LOCK, TRANSCRIPTION_LOCK, DOWNLOAD_JOBS_LOCK:
        GENERATION_JOBS.clear()
        TRANSCRIPTION_JOBS.clear()
        DOWNLOAD_JOBS.clear()

        DOWNLOAD_JOBS["project_001"] = {
            "project_id": "project_001",
            "status": "downloading",
            "step": "Downloading video...",
            "progress": 45.0,
            "title": "Sample YouTube Video",
        }

        TRANSCRIPTION_JOBS["project_002"] = {
            "project_id": "project_002",
            "status": "processing",
            "step": "Transcribing audio",
            "progress": 60,
        }

        GENERATION_JOBS["gen_001"] = {
            "job_id": "gen_001",
            "project_id": "project_003",
            "status": "processing",
            "step": "Rendering clips",
            "progress": 75,
            "current_clip": 2,
            "total_clips": 3,
        }

    response = client.get("/api/jobs/active")
    assert response.status_code == 200
    jobs = response.json()["jobs"]
    assert len(jobs) == 3

    types = {job["kind"] for job in jobs}
    assert types == {"download", "transcription", "generation"}

    # Exclude completed/failed jobs
    with CLIPS_LOCK:
        GENERATION_JOBS["gen_001"]["status"] = "completed"

    response = client.get("/api/jobs/active")
    assert len(response.json()["jobs"]) == 2

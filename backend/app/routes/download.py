import shutil
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from app.services.downloader import download_video

router = APIRouter(prefix="/api")
PROJECTS_DIR = Path(__file__).resolve().parents[2] / "data" / "projects"


class DownloadRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def validate_youtube_url(cls, value: str) -> str:
        parsed = urlparse(value)
        hostname = (parsed.hostname or "").lower()
        allowed_hosts = {"youtube.com", "www.youtube.com", "youtu.be", "www.youtu.be"}

        if parsed.scheme not in {"http", "https"} or hostname not in allowed_hosts:
            raise ValueError("A YouTube URL is required")

        return value


class DownloadResponse(BaseModel):
    project_id: str
    status: str
    file: str


def create_project_directory() -> tuple[str, Path]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    project_number = 1

    while True:
        project_id = f"project_{project_number:03d}"
        project_directory = PROJECTS_DIR / project_id
        try:
            project_directory.mkdir()
            return project_id, project_directory
        except FileExistsError:
            project_number += 1


@router.post("/download", response_model=DownloadResponse)
def download(request: DownloadRequest) -> DownloadResponse:
    project_id, project_directory = create_project_directory()
    output_path = project_directory / "source.mp4"

    try:
        download_video(request.url, output_path)
    except Exception as error:
        shutil.rmtree(project_directory, ignore_errors=True)
        raise HTTPException(status_code=502, detail="Video download failed") from error

    return DownloadResponse(
        project_id=project_id,
        status="downloaded",
        file=output_path.name,
    )

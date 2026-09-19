import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECTS_DIR = Path(__file__).resolve().parents[2] / "data" / "projects"
PROJECT_ID_PATTERN = re.compile(r"^project_\d+$")


def create_project() -> tuple[str, Path]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    number = 1
    while True:
        project_id = f"project_{number:03d}"
        directory = PROJECTS_DIR / project_id
        try:
            directory.mkdir()
            return project_id, directory
        except FileExistsError:
            number += 1


def get_project_directory(project_id: str) -> Path:
    if not PROJECT_ID_PATTERN.fullmatch(project_id):
        raise ValueError("Invalid project ID")
    directory = (PROJECTS_DIR / project_id).resolve()
    if directory.parent != PROJECTS_DIR.resolve() or not directory.is_dir():
        raise FileNotFoundError("Project not found")
    return directory


def get_clips_directory(project_id: str) -> Path:
    directory = get_project_directory(project_id) / "clips"
    directory.mkdir(exist_ok=True)
    return directory


def list_projects() -> list[dict[str, Any]]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    projects = []
    for directory in sorted(PROJECTS_DIR.glob("project_*")):
        if not directory.is_dir() or not PROJECT_ID_PATTERN.fullmatch(directory.name):
            continue
        source_files = list(directory.glob("source.*"))
        clips = list((directory / "clips").glob("*.mp4")) if (directory / "clips").is_dir() else []
        projects.append({
            "project_id": directory.name,
            "created_at": datetime.fromtimestamp(
                directory.stat().st_ctime, tz=timezone.utc
            ).isoformat(),
            "source_type": "Local Video" if source_files else "Unknown",
            "clips": len(clips),
            "status": "Ready" if clips else "Created",
        })
    return projects

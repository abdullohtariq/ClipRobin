import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

def get_projects_dir() -> Path:
    return Path(
        os.environ.get(
            "CLIPROBIN_PROJECTS_DIR",
            str(Path(__file__).resolve().parents[2] / "data" / "projects"),
        )
    )


PROJECTS_DIR = get_projects_dir()
PROJECT_ID_PATTERN = re.compile(r"^project_\d+$")


def create_project() -> tuple[str, Path]:
    projects_dir = get_projects_dir()
    projects_dir.mkdir(parents=True, exist_ok=True)
    number = 1
    while True:
        project_id = f"project_{number:03d}"
        directory = projects_dir / project_id
        try:
            directory.mkdir()
            return project_id, directory
        except FileExistsError:
            number += 1


def get_project_directory(project_id: str) -> Path:
    if not PROJECT_ID_PATTERN.fullmatch(project_id):
        raise ValueError("Invalid project ID")
    projects_dir = get_projects_dir()
    directory = (projects_dir / project_id).resolve()
    if directory.parent != projects_dir.resolve() or not directory.is_dir():
        raise FileNotFoundError("Project not found")
    return directory


def get_clips_directory(project_id: str) -> Path:
    directory = get_project_directory(project_id) / "clips"
    directory.mkdir(exist_ok=True)
    return directory


def list_projects() -> list[dict[str, Any]]:
    projects_dir = get_projects_dir()
    projects_dir.mkdir(parents=True, exist_ok=True)
    projects = []
    for directory in sorted(projects_dir.glob("project_*")):
        if not directory.is_dir() or not PROJECT_ID_PATTERN.fullmatch(directory.name):
            continue
        source_files = list(directory.glob("source.*"))
        clips = list((directory / "clips").glob("*.mp4")) if (directory / "clips").is_dir() else []
        meta_file = directory / "metadata.json"
        title = None
        if meta_file.is_file():
            try:
                import json
                with open(meta_file, "r", encoding="utf-8") as f:
                    title = json.load(f).get("title")
            except Exception:
                pass
        projects.append({
            "project_id": directory.name,
            "title": title or directory.name,
            "created_at": datetime.fromtimestamp(
                directory.stat().st_ctime, tz=timezone.utc
            ).isoformat(),
            "source_type": "Local Video" if source_files else "Unknown",
            "clips": len(clips),
            "status": "Ready" if clips else "Created",
        })
    return projects

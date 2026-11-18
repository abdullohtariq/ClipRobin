import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_PROJECT_SEQ_LOCK = threading.Lock()


def get_projects_dir() -> Path:
    return Path(
        os.environ.get(
            "CLIPROBIN_PROJECTS_DIR",
            str(Path(__file__).resolve().parents[2] / "data" / "projects"),
        )
    )


PROJECTS_DIR = get_projects_dir()
PROJECT_ID_PATTERN = re.compile(r"^project_\d+$")


def _atomic_write_text(target: Path, content: str) -> None:
    tmp = target.with_name(f".{target.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, target)
    except OSError:
        tmp.unlink(missing_ok=True)
        target.write_text(content, encoding="utf-8")


def get_project_uid(project_directory: Path) -> str | None:
    meta_file = project_directory / "metadata.json"
    if not meta_file.is_file():
        return None
    try:
        loaded = json.loads(meta_file.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            uid = loaded.get("project_uid")
            return str(uid) if isinstance(uid, str) and uid.strip() else None
    except Exception:
        return None
    return None


def verify_project_ownership(project_directory: Path, expected_uid: str | None) -> bool:
    """Return True if the project directory still belongs to expected_uid."""
    if not expected_uid:
        return project_directory.is_dir()
    if not project_directory.is_dir():
        return False
    current_uid = get_project_uid(project_directory)
    return current_uid == expected_uid


def create_project() -> tuple[str, Path]:
    projects_dir = get_projects_dir()
    projects_dir.mkdir(parents=True, exist_ok=True)
    with _PROJECT_SEQ_LOCK:
        max_num = 0
        try:
            with os.scandir(projects_dir) as entries:
                for entry in entries:
                    if entry.is_dir() and entry.name.startswith("project_"):
                        suffix = entry.name[len("project_"):]
                        if suffix.isdigit():
                            max_num = max(max_num, int(suffix))
        except OSError:
            pass

        seq_file = projects_dir / ".next_project_seq"
        stored_next = 1
        if seq_file.is_file():
            try:
                raw_seq = seq_file.read_text(encoding="utf-8").strip()
                if raw_seq.isdigit():
                    stored_next = max(1, int(raw_seq))
            except OSError:
                stored_next = 1

        number = max(max_num + 1, stored_next)
        while True:
            project_id = f"project_{number:03d}"
            directory = projects_dir / project_id
            try:
                directory.mkdir()
                _atomic_write_text(seq_file, str(number + 1))
                _atomic_write_text(
                    directory / "metadata.json",
                    json.dumps({"project_uid": uuid.uuid4().hex}, indent=2),
                )
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
        source_files = [
            p for p in directory.glob("source.*")
            if p.is_file() and not p.name.endswith((".part", ".ytdl", ".tmp"))
        ]
        clips = (
            [p for p in (directory / "clips").glob("*.mp4") if not p.name.startswith(".")]
            if (directory / "clips").is_dir()
            else []
        )
        meta_file = directory / "metadata.json"
        title = None
        source_type = None
        if meta_file.is_file():
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    if isinstance(meta, dict):
                        title = meta.get("title")
                        source_type = meta.get("source_type")
            except Exception:
                pass
        projects.append({
            "project_id": directory.name,
            "title": title or directory.name,
            "created_at": datetime.fromtimestamp(
                directory.stat().st_ctime, tz=timezone.utc
            ).isoformat(),
            "source_type": source_type or ("Local Video" if source_files else "Unknown"),
            "clips": len(clips),
            "status": "Ready" if clips else "Created",
        })
    return projects

from pathlib import Path
import pytest

from app.services.project_manager import (
    create_project,
    get_clips_directory,
    get_project_directory,
    get_projects_dir,
    list_projects,
)


def test_create_project_creates_sequential_directories(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    
    project_id_1, dir_1 = create_project()
    assert project_id_1 == "project_001"
    assert dir_1.is_dir()
    assert dir_1.name == "project_001"

    project_id_2, dir_2 = create_project()
    assert project_id_2 == "project_002"
    assert dir_2.is_dir()
    assert dir_2.name == "project_002"


def test_get_project_directory_validates_regex():
    with pytest.raises(ValueError, match="Invalid project ID"):
        get_project_directory("invalid_project_name")

    with pytest.raises(ValueError, match="Invalid project ID"):
        get_project_directory("../project_001")

    with pytest.raises(ValueError, match="Invalid project ID"):
        get_project_directory("project_123/../../etc")


def test_get_project_directory_nonexistent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    with pytest.raises(FileNotFoundError, match="Project not found"):
        get_project_directory("project_999")


def test_get_clips_directory_creates_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    project_id, _ = create_project()
    clips_dir = get_clips_directory(project_id)
    assert clips_dir.is_dir()
    assert clips_dir.name == "clips"


def test_list_projects(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLIPROBIN_PROJECTS_DIR", str(tmp_path))
    assert list_projects() == []

    project_id, project_dir = create_project()
    (project_dir / "source.mp4").write_bytes(b"dummy video content")
    clips_dir = project_dir / "clips"
    clips_dir.mkdir()
    (clips_dir / "clip_001.mp4").write_bytes(b"clip content")

    projects = list_projects()
    assert len(projects) == 1
    assert projects[0]["project_id"] == project_id
    assert projects[0]["source_type"] == "Local Video"
    assert projects[0]["clips"] == 1
    assert projects[0]["status"] == "Ready"


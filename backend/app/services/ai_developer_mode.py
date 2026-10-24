"""Local Gemini configuration and YouTube-gated developer mode."""

import json
import os
from pathlib import Path
from typing import Any


def _config_path() -> Path:
    from app.services.project_manager import get_projects_dir

    return get_projects_dir().parent / "gemini_config.json"


def _read_config() -> dict[str, Any]:
    path = _config_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def get_gemini_api_key() -> str:
    """Read the Gemini key from the environment or local, ignored app data."""
    return os.getenv("GEMINI_API_KEY", "").strip() or str(_read_config().get("api_key", "")).strip()


def save_gemini_api_key(api_key: str) -> None:
    normalized = api_key.strip()
    if not normalized:
        raise ValueError("A Gemini API key is required.")
    if len(normalized) > 512:
        raise ValueError("The Gemini API key is too long.")

    config = _read_config()
    config["api_key"] = normalized
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def set_developer_mode(enabled: bool) -> None:
    config = _read_config()
    config["developer_mode"] = bool(enabled)
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def is_developer_mode_enabled() -> bool:
    return bool(_read_config().get("developer_mode", False))


def get_ai_developer_status() -> dict[str, Any]:
    from app.services.youtube_uploader import default_youtube_service

    gemini_configured = bool(get_gemini_api_key())
    youtube_authenticated = bool(default_youtube_service.get_status().get("authenticated"))
    developer_mode = is_developer_mode_enabled()
    ai_enabled = gemini_configured and youtube_authenticated and developer_mode

    if ai_enabled:
        reason = None
    elif not youtube_authenticated:
        reason = "Connect your YouTube account to enable AI Developer Mode."
    elif not gemini_configured:
        reason = "Add a Gemini API key to enable AI Developer Mode."
    else:
        reason = "Enable Developer Mode to use AI clip generation."

    return {
        "gemini_configured": gemini_configured,
        "youtube_authenticated": youtube_authenticated,
        "developer_mode": developer_mode,
        "ai_enabled": ai_enabled,
        "reason": reason,
    }

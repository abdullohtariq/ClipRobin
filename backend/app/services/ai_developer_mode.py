"""Local Gemini configuration and AI developer mode."""

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

_CONFIG_LOCK = threading.RLock()


def _config_path() -> Path:
    from app.services.project_manager import get_projects_dir

    return get_projects_dir().parent / "gemini_config.json"


def _read_config() -> dict[str, Any]:
    with _CONFIG_LOCK:
        path = _config_path()
        if not path.is_file():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}


def _write_config_atomic(config: dict[str, Any]) -> None:
    with _CONFIG_LOCK:
        path = _config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(config, handle, indent=2)
            os.replace(tmp_name, path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise


def get_gemini_api_key() -> str:
    """Read the Gemini key from the environment or local, ignored app data."""
    return os.getenv("GEMINI_API_KEY", "").strip() or str(_read_config().get("api_key", "")).strip()


def save_gemini_api_key(api_key: str) -> None:
    normalized = api_key.strip()
    if not normalized:
        raise ValueError("A Gemini API key is required.")
    if len(normalized) > 512:
        raise ValueError("The Gemini API key is too long.")

    with _CONFIG_LOCK:
        config = _read_config()
        config["api_key"] = normalized
        if "developer_mode" not in config:
            config["developer_mode"] = True
        _write_config_atomic(config)


def set_developer_mode(enabled: bool) -> None:
    with _CONFIG_LOCK:
        config = _read_config()
        config["developer_mode"] = bool(enabled)
        _write_config_atomic(config)


def is_developer_mode_enabled() -> bool:
    config = _read_config()
    if "developer_mode" in config:
        return bool(config.get("developer_mode"))
    return bool(get_gemini_api_key())


def get_ai_developer_status() -> dict[str, Any]:
    from app.services.youtube_uploader import default_youtube_service

    gemini_configured = bool(get_gemini_api_key())
    youtube_authenticated = bool(default_youtube_service.get_status().get("authenticated"))
    developer_mode = is_developer_mode_enabled()
    ai_enabled = gemini_configured and developer_mode

    if ai_enabled:
        reason = None
    elif not gemini_configured:
        reason = "Add a Gemini API key in Settings to enable AI Hook Finder."
    else:
        reason = "Enable AI Developer Mode in Settings to use AI clip generation."

    return {
        "gemini_configured": gemini_configured,
        "youtube_authenticated": youtube_authenticated,
        "developer_mode": developer_mode,
        "ai_enabled": ai_enabled,
        "reason": reason,
    }

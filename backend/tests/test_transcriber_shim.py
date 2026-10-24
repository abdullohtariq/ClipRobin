from unittest.mock import MagicMock
import pytest
from app.services.transcriber import _safe_av_open


def test_safe_av_open_handles_metadata_errors_type_error(monkeypatch):
    called_with = []

    def mock_orig_open(*args, **kwargs):
        called_with.append((args, kwargs.copy()))
        if "metadata_errors" in kwargs:
            raise TypeError("open() got an unexpected keyword argument 'metadata_errors'")
        return "success_container"

    import app.services.transcriber as transcriber_mod
    monkeypatch.setattr(transcriber_mod, "_orig_av_open", mock_orig_open)

    res = _safe_av_open("test_video.mp4", mode="r", metadata_errors="ignore")
    assert res == "success_container"
    assert len(called_with) == 2
    # First attempt had metadata_errors
    assert "metadata_errors" in called_with[0][1]
    # Second attempt had metadata_errors stripped
    assert "metadata_errors" not in called_with[1][1]


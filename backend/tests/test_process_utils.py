import os
import subprocess
from unittest.mock import patch

from app.services.process_utils import get_no_window_subprocess_kwargs


def test_get_no_window_subprocess_kwargs_windows():
    with patch("os.name", "nt"):
        kwargs = get_no_window_subprocess_kwargs()
        assert "creationflags" in kwargs
        assert kwargs["creationflags"] == 0x08000000  # CREATE_NO_WINDOW
        assert "startupinfo" in kwargs
        startupinfo = kwargs["startupinfo"]
        assert isinstance(startupinfo, subprocess.STARTUPINFO)
        assert startupinfo.dwFlags & subprocess.STARTF_USESHOWWINDOW
        assert startupinfo.wShowWindow == subprocess.SW_HIDE


def test_get_no_window_subprocess_kwargs_non_windows():
    with patch("os.name", "posix"):
        kwargs = get_no_window_subprocess_kwargs()
        assert kwargs == {}


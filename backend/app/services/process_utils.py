import os
import subprocess
from typing import Any


def get_no_window_subprocess_kwargs() -> dict[str, Any]:
    """
    Return subprocess keyword arguments to suppress visible console/CLI windows on Windows.

    When running ClipRobin as a packaged desktop app (Tauri GUI / PyInstaller --windowed),
    invoking console executables like ffmpeg, ffprobe, or python will cause Windows to
    allocate a new console window unless CREATE_NO_WINDOW and SW_HIDE are passed.
    """
    kwargs: dict[str, Any] = {}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 1)
        startupinfo.wShowWindow = getattr(subprocess, "SW_HIDE", 0)
        kwargs["startupinfo"] = startupinfo
    return kwargs


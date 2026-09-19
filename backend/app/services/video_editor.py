import shutil
import subprocess
import os
from pathlib import Path


class VideoEditorError(Exception):
    """Raised when FFmpeg cannot create a clip."""


def find_ffmpeg() -> str:
    executable = shutil.which("ffmpeg")
    if executable:
        return executable

    if os.name == "nt":
        winget_packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
        matches = winget_packages.glob("Gyan.FFmpeg.Shared*/*/bin/ffmpeg.exe")
        for match in matches:
            if match.is_file():
                return str(match)

    raise VideoEditorError(
        "FFmpeg was not found. Install FFmpeg and restart the backend."
    )


def create_clip(
    source_path: Path,
    output_path: Path,
    start_time: float,
    end_time: float,
) -> Path:
    if start_time < 0 or end_time <= start_time:
        raise VideoEditorError("Clip start must be before clip end")
    if not source_path.is_file():
        raise VideoEditorError("Source video not found")
    ffmpeg_path = find_ffmpeg()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_path,
        "-y",
        "-ss",
        str(start_time),
        "-i",
        str(source_path),
        "-t",
        str(end_time - start_time),
        "-c",
        "copy",
        str(output_path),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() or "FFmpeg failed to create the clip"
        raise VideoEditorError(detail) from error
    return output_path

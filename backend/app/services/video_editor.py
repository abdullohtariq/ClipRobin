import os
import shutil
import subprocess
import tempfile
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


def _copy_font_file(destination_directory: Path) -> str | None:
    if os.name == "nt":
        windows_dir = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        candidates = [
            windows_dir / "Fonts" / "segoeui.ttf",
            windows_dir / "Fonts" / "arial.ttf",
        ]
    else:
        candidates = [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        ]

    for candidate in candidates:
        if candidate.is_file():
            font_file = destination_directory / "subtitle-font.ttf"
            shutil.copyfile(candidate, font_file)
            return font_file.name
    return None


def _build_filter_graph(
    start_time: float,
    end_time: float,
    subtitle_segments: list[dict[str, float | str]] | None = None,
    show_subtitles: bool = True,
    subtitle_directory: Path | None = None,
    font_file: str | None = None,
) -> str:
    base_filter = (
        "scale=720:1280:force_original_aspect_ratio=decrease,"
        "pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
    )
    if not show_subtitles or not subtitle_segments or subtitle_directory is None:
        return base_filter

    font_fragment = f"fontfile='{font_file}':" if font_file else ""
    subtitle_filters = []
    for segment in subtitle_segments:
        if not isinstance(segment, dict):
            continue
        segment_start = float(segment.get("start", 0.0))
        segment_end = float(segment.get("end", 0.0))
        text = str(segment.get("text", "")).strip()
        if not text or segment_end <= segment_start:
            continue

        overlapping_start = max(start_time, segment_start)
        overlapping_end = min(end_time, segment_end)
        if overlapping_end <= overlapping_start:
            continue

        local_start = max(0.0, overlapping_start - start_time)
        local_end = max(local_start + 0.05, overlapping_end - start_time)
        fade_out_start = max(local_start + 0.15, local_end - 0.2)
        alpha_expression = (
            f"if(lt(t,{local_start + 0.12}),(t-{local_start})/0.12,"
            f"if(lt(t,{fade_out_start}),1,"
            f"max(0,1-((t-{fade_out_start})/0.2))))"
        )
        text_file = subtitle_directory / f"subtitle-{len(subtitle_filters)}.txt"
        text_file.write_text(text, encoding="utf-8")
        subtitle_filters.append(
            "drawtext=textfile='{}':{}expansion=none:fontsize=30:fontcolor=white:shadowcolor=black@0.9:"
            "shadowx=2:shadowy=2:box=1:boxcolor=black@0.45:boxborderw=12:"
            "x=(w-text_w)/2:y=h-th-40:alpha='{}':enable='between(t,{:.3f},{:.3f})'".format(
                text_file.name,
                font_fragment,
                alpha_expression,
                local_start,
                local_end,
            )
        )

    if not subtitle_filters:
        return base_filter
    return base_filter + "," + ",".join(subtitle_filters)


def create_clip(
    source_path: Path,
    output_path: Path,
    start_time: float,
    end_time: float,
    subtitle_segments: list[dict[str, float | str]] | None = None,
    show_subtitles: bool = True,
) -> Path:
    if start_time < 0 or end_time <= start_time:
        raise VideoEditorError("Clip start must be before clip end")
    if not source_path.is_file():
        raise VideoEditorError("Source video not found")
    ffmpeg_path = find_ffmpeg()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    source_path = source_path.resolve()
    output_path = output_path.resolve()
    try:
        with tempfile.TemporaryDirectory(
            prefix="cliprobin-subtitles-",
            dir=output_path.parent,
        ) as temporary_directory:
            subtitle_directory = Path(temporary_directory)
            filter_graph = _build_filter_graph(
                start_time,
                end_time,
                subtitle_segments,
                show_subtitles=show_subtitles,
                subtitle_directory=subtitle_directory,
                font_file=(
                    _copy_font_file(subtitle_directory)
                    if show_subtitles and subtitle_segments
                    else None
                ),
            )
            command = [
                ffmpeg_path,
                "-y",
                "-ss",
                str(start_time),
                "-i",
                str(source_path),
                "-t",
                str(end_time - start_time),
                "-vf",
                filter_graph,
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
            subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                cwd=Path(temporary_directory),
            )
    except subprocess.CalledProcessError as error:
        stderr_lines = (error.stderr or "").strip().splitlines()
        useful_lines = [
            line.strip()
            for line in stderr_lines
            if any(marker in line for marker in ("Error", "Stray %", "Conversion failed"))
        ]
        detail = "\n".join(useful_lines[-5:]) or "\n".join(stderr_lines[-8:])
        detail = detail or "FFmpeg failed to create the clip"
        raise VideoEditorError(detail) from error
    return output_path

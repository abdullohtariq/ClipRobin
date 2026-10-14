import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from PIL import ImageFont


class VideoEditorError(Exception):
    """Raised when FFmpeg cannot create a clip."""


class ClipGenerationCancelled(Exception):
    """Raised when clip rendering is cancelled by the user."""


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


def has_audio_stream(source_path: Path, ffmpeg_path: str) -> bool:
    try:
        result = subprocess.run(
            [ffmpeg_path, "-i", str(source_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
        )
        return "Audio:" in result.stderr
    except Exception:
        return True


def _copy_font_file(destination_directory: Path) -> str | None:
    if os.name == "nt":
        windows_dir = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        candidates = [
            windows_dir / "Fonts" / "segoeuib.ttf",
            windows_dir / "Fonts" / "arialbd.ttf",
            windows_dir / "Fonts" / "segoeui.ttf",
            windows_dir / "Fonts" / "arial.ttf",
        ]
    else:
        candidates = [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        ]

    for candidate in candidates:
        if candidate.is_file():
            font_file = destination_directory / "subtitle-font.ttf"
            shutil.copyfile(candidate, font_file)
            return font_file.name
    return None


def _layout_subtitle_words(
    segment: dict[str, object],
    start_time: float,
    end_time: float,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: float,
) -> list[dict[str, object]]:
    segment_start = max(start_time, float(segment.get("start", start_time)))
    segment_end = min(end_time, float(segment.get("end", end_time)))
    if segment_end <= segment_start:
        return []

    source_words = segment.get("words")
    timed_words = (
        [
            word
            for word in source_words
            if isinstance(word, dict)
            and isinstance(word.get("start"), (int, float))
            and isinstance(word.get("end"), (int, float))
            and isinstance(word.get("text"), str)
            and word["text"].strip()
        ]
        if isinstance(source_words, list)
        else []
    )
    if timed_words:
        caption_words = [
            {
                "text": word["text"].strip(),
                "start": max(segment_start, float(word["start"])),
                "end": min(segment_end, float(word["end"])),
            }
            for word in timed_words
            if float(word["end"]) > segment_start
            and float(word["start"]) < segment_end
        ]
    else:
        text = str(segment.get("text", "")).strip()
        fallback_words = text.split()
        word_duration = (segment_end - segment_start) / max(len(fallback_words), 1)
        caption_words = [
            {
                "text": word,
                "start": segment_start + index * word_duration,
                "end": segment_start + (index + 1) * word_duration,
            }
            for index, word in enumerate(fallback_words)
        ]

    lines: list[dict[str, object]] = []
    line_words: list[dict[str, object]] = []
    line_width = 0.0
    space_width = float(font.getlength(" "))
    for word in caption_words:
        if word["end"] <= word["start"]:
            continue
        word_width = float(font.getlength(word["text"]))
        next_width = line_width + (space_width if line_words else 0.0) + word_width
        if line_words and next_width > max_width:
            lines.append({"words": line_words, "width": line_width})
            line_words = []
            line_width = 0.0
        word_x = line_width + (space_width if line_words else 0.0)
        line_words.append({**word, "x": word_x, "width": word_width})
        line_width = word_x + word_width

    if line_words:
        lines.append({"words": line_words, "width": line_width})
    return lines


def _build_filter_graph(
    start_time: float,
    end_time: float,
    subtitle_segments: list[dict[str, object]] | None = None,
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
    font_size = 34
    font_path = subtitle_directory / font_file if font_file else None
    try:
        font = (
            ImageFont.truetype(str(font_path), font_size)
            if font_path
            else ImageFont.load_default(size=font_size)
        )
    except OSError:
        font = ImageFont.load_default(size=font_size)

    for segment in subtitle_segments:
        if not isinstance(segment, dict):
            continue
        lines = _layout_subtitle_words(segment, start_time, end_time, font, max_width=640)
        if not lines:
            continue

        segment_start = max(
            0.0,
            max(start_time, float(segment.get("start", start_time))) - start_time,
        )
        segment_end = min(end_time, float(segment.get("end", end_time))) - start_time
        line_height = 48
        for line_index, line in enumerate(lines):
            line_words = line["words"]
            line_width = float(line["width"])
            text = " ".join(str(word["text"]) for word in line_words)
            text_file = subtitle_directory / f"subtitle-{len(subtitle_filters)}.txt"
            text_file.write_text(text, encoding="utf-8")
            y_position = f"h-340-{(len(lines) - line_index - 1) * line_height}"
            subtitle_filters.append(
                "drawtext=textfile='{}':{}expansion=none:fontsize={}:fontcolor=white:"
                "borderw=3:bordercolor=black@0.95:shadowcolor=black@0.9:shadowx=2:shadowy=2:"
                "box=1:boxcolor=black@0.55:boxborderw=10:y_align=baseline:"
                "x=(w-text_w)/2:y={}:enable='between(t,{:.3f},{:.3f})'".format(
                    text_file.name,
                    font_fragment,
                    font_size,
                    y_position,
                    segment_start,
                    max(segment_start + 0.05, segment_end),
                )
            )
            for word in line_words:
                highlight_file = subtitle_directory / f"subtitle-word-{len(subtitle_filters)}.txt"
                highlight_file.write_text(str(word["text"]), encoding="utf-8")
                word_start = max(0.0, float(word["start"]) - start_time)
                word_end = max(word_start + 0.03, float(word["end"]) - start_time)
                pop_font_size = font_size + 7
                word_x = (
                    f"(w-{line_width:.3f})/2+{float(word['x']):.3f}"
                    f"-(text_w-{float(word['width']):.3f})/2"
                )
                subtitle_filters.append(
                    "drawtext=textfile='{}':{}expansion=none:"
                    "fontsize='if(lt(t,{:.3f}),{}, {})':fontcolor=yellow:"
                    "borderw=3:bordercolor=black@0.95:shadowcolor=black@0.9:shadowx=2:shadowy=2:"
                    "x={}:y={}:y_align=baseline:enable='between(t,{:.3f},{:.3f})'".format(
                        highlight_file.name,
                        font_fragment,
                        word_start + 0.12,
                        pop_font_size,
                        font_size,
                        word_x,
                        y_position,
                        word_start,
                        word_end,
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
    subtitle_segments: list[dict[str, object]] | None = None,
    show_subtitles: bool = True,
    cancel_event: threading.Event | None = None,
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
            filter_script = subtitle_directory / "video-filters.txt"
            filter_script.write_text(filter_graph, encoding="utf-8")
            has_audio = has_audio_stream(source_path, ffmpeg_path)
            command = [
                ffmpeg_path,
                "-y",
                "-ss",
                str(start_time),
                "-i",
                str(source_path),
                "-t",
                str(end_time - start_time),
                "-/filter:v",
                filter_script.name,
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
            ]
            if has_audio:
                command.extend([
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "192k",
                ])
            else:
                command.extend(["-an"])
            command.extend([
                "-movflags",
                "+faststart",
                str(output_path),
            ])
            if cancel_event is not None and cancel_event.is_set():
                raise ClipGenerationCancelled("Clip generation was cancelled")
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=Path(temporary_directory),
            )
            while True:
                try:
                    _, stderr = process.communicate(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    if cancel_event is None or not cancel_event.is_set():
                        continue
                    process.terminate()
                    try:
                        _, stderr = process.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        _, stderr = process.communicate()
                    if output_path.exists():
                        output_path.unlink()
                    raise ClipGenerationCancelled("Clip generation was cancelled")
            if cancel_event is not None and cancel_event.is_set():
                if output_path.exists():
                    output_path.unlink()
                raise ClipGenerationCancelled("Clip generation was cancelled")
            if process.returncode:
                raise subprocess.CalledProcessError(
                    process.returncode,
                    command,
                    stderr=stderr,
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

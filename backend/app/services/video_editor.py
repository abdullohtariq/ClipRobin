import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _generate_rounded_corner_mask(
    destination_directory: Path,
    size: int | None = None,
    width: int = 660,
    height: int = 660,
    radius: int = 36,
    filename: str = "rounded-mask.png",
) -> Path:
    if size is not None:
        width = size
        height = size
    mask_file = destination_directory / filename
    scale = 4
    high_w = width * scale
    high_h = height * scale
    high_radius = radius * scale
    img = Image.new("L", (high_w, high_h), 0)
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, high_w, high_h), radius=high_radius, fill=255)
    img = img.resize((width, height), Image.Resampling.LANCZOS)
    img.save(mask_file)
    return mask_file


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


def find_watermark_file() -> Path | None:
    env_path = os.environ.get("CLIPROBIN_WATERMARK_PATH")
    if env_path and Path(env_path).is_file():
        return Path(env_path).resolve()

    root = Path(__file__).resolve().parents[3]
    candidates = [
        root / "watermark.png",
        root / "clip_robin_watermark.png",
        root / "frontend" / "public" / "watermark.png",
        Path("watermark.png").resolve(),
        Path("clip_robin_watermark.png").resolve(),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


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


def _build_subtitle_filters(
    start_time: float,
    end_time: float,
    subtitle_segments: list[dict[str, object]] | None = None,
    show_subtitles: bool = True,
    subtitle_directory: Path | None = None,
    font_file: str | None = None,
    framing_mode: str = "standard",
    caption_style: str = "classic",
) -> list[str]:
    if not show_subtitles or not subtitle_segments or subtitle_directory is None:
        return []

    font_fragment = f"fontfile='{font_file}':" if font_file else ""
    subtitle_filters = []

    style = (caption_style or "classic").lower().strip()
    if style == "bold_emerald":
        font_size = 36
        pop_font_delta = 8
        base_style_fragment = (
            "fontsize=36:fontcolor=white:"
            "borderw=4:bordercolor=black@0.95:shadowcolor=black@0.85:shadowx=3:shadowy=3"
        )
        highlight_color = "0x10b981"
        highlight_borderw = 4
    elif style == "clean_gold":
        font_size = 33
        pop_font_delta = 5
        base_style_fragment = (
            "fontsize=33:fontcolor=white:"
            "borderw=2:bordercolor=black@0.85:shadowcolor=black@0.7:shadowx=2:shadowy=2"
        )
        highlight_color = "0xfbbf24"
        highlight_borderw = 2
    else:  # "classic"
        font_size = 34
        pop_font_delta = 7
        base_style_fragment = (
            "fontsize=34:fontcolor=white:"
            "borderw=3:bordercolor=black@0.95:shadowcolor=black@0.9:shadowx=2:shadowy=2:"
            "box=1:boxcolor=black@0.55:boxborderw=10"
        )
        highlight_color = "yellow"
        highlight_borderw = 3

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
            if framing_mode == "square_rounded":
                y_position = f"1010+{line_index * line_height}"
            else:
                y_position = f"h-340-{(len(lines) - line_index - 1) * line_height}"
            subtitle_filters.append(
                "drawtext=textfile='{}':{}expansion=none:{}:y_align=baseline:"
                "x=(w-text_w)/2:y={}:enable='between(t,{:.3f},{:.3f})'".format(
                    text_file.name,
                    font_fragment,
                    base_style_fragment,
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
                pop_font_size = font_size + pop_font_delta
                word_x = (
                    f"(w-{line_width:.3f})/2+{float(word['x']):.3f}"
                    f"-(text_w-{float(word['width']):.3f})/2"
                )
                subtitle_filters.append(
                    "drawtext=textfile='{}':{}expansion=none:"
                    "fontsize='if(lt(t,{:.3f}),{}, {})':fontcolor={}:"
                    "borderw={}:bordercolor=black@0.95:shadowcolor=black@0.9:shadowx=2:shadowy=2:"
                    "x={}:y={}:y_align=baseline:enable='between(t,{:.3f},{:.3f})'".format(
                        highlight_file.name,
                        font_fragment,
                        word_start + 0.12,
                        pop_font_size,
                        font_size,
                        highlight_color,
                        highlight_borderw,
                        word_x,
                        y_position,
                        word_start,
                        word_end,
                    )
                )

    return subtitle_filters


def _build_top_line_filters(
    top_line: str | None,
    subtitle_directory: Path,
    font_file: str | None = None,
    has_watermark: bool = False,
    framing_mode: str = "standard",
) -> list[str]:
    if not top_line or not top_line.strip():
        return []

    cleaned_text = top_line.strip()
    words = cleaned_text.split()
    if not words:
        return []

    # Maximum 15 words limit for social safe zones & punchy headlines
    if len(words) > 15:
        words = words[:15]

    # Split into up to 2 lines respecting safe social margin (approx 28 chars per line)
    import textwrap

    if "\n" in cleaned_text:
        candidate_lines = [line.strip() for line in cleaned_text.split("\n") if line.strip()]
        wrapped_lines: list[str] = []
        for cand in candidate_lines:
            wrapped_lines.extend(textwrap.wrap(cand, width=28))
        raw_lines = wrapped_lines[:2]
    else:
        full_text = " ".join(words)
        wrapped_lines = textwrap.wrap(full_text, width=28)
        if len(wrapped_lines) > 2:
            mid = (len(words) + 1) // 2
            raw_lines = [" ".join(words[:mid]), " ".join(words[mid:])]
        else:
            raw_lines = wrapped_lines

    font_fragment = f"fontfile='{font_file}':" if font_file else ""
    filters: list[str] = []

    # Safe vertical position:
    # 720x1280 vertical video. 16:9 video content begins at Y=438.
    # When watermark is present with top line, watermark is shifted up to Y=90 (7% of H) and ends at Y~169.
    # The top line is placed at Y=260-306 in standard mode.
    # In square_rounded mode, square video begins at Y=310, so top line is at Y=205 (with watermark) or Y=190.
    if framing_mode == "square_rounded":
        base_y = 205 if has_watermark else 190
        line_spacing = 42
    else:
        base_y = 260 if has_watermark else 240
        line_spacing = 46

    if len(raw_lines) == 1:
        y_positions = [base_y + 15]
    else:
        y_positions = [base_y, base_y + line_spacing]

    for line_index, line_text in enumerate(raw_lines):
        line_file = subtitle_directory / f"top-line-{line_index}.txt"
        line_file.write_text(line_text, encoding="utf-8")
        y_pos = y_positions[line_index]
        filters.append(
            "drawtext=textfile='{}':{}expansion=none:fontsize=32:fontcolor=white:"
            "borderw=3:bordercolor=black@0.95:shadowcolor=black@0.9:shadowx=2:shadowy=2:"
            "box=1:boxcolor=black@0.65:boxborderw=8:y_align=baseline:fix_bounds=true:"
            "x=(w-text_w)/2:y={}".format(
                line_file.name,
                font_fragment,
                y_pos,
            )
        )

    return filters


def _build_filter_graph(
    start_time: float,
    end_time: float,
    subtitle_segments: list[dict[str, object]] | None = None,
    show_subtitles: bool = True,
    subtitle_directory: Path | None = None,
    font_file: str | None = None,
    framing_mode: str = "standard",
    caption_style: str = "classic",
) -> str:
    if framing_mode == "square_rounded" and subtitle_directory is not None:
        _generate_rounded_corner_mask(subtitle_directory)
        base_filter = (
            "color=c=black:s=720x1280:r=30[bg];"
            "[0:v]crop=min(iw\\,ih):min(iw\\,ih),scale=660:660,format=yuva420p[sq];"
            "movie=rounded-mask.png:loop=0,setpts=N/FRAME_RATE/TB[mask];"
            "[sq][mask]alphamerge[rounded];"
            "[bg][rounded]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p"
        )
    elif framing_mode == "true_9_16":
        base_filter = (
            "crop=w=min(iw\\,ih*9/16):h=ih:x=(iw-ow)/2:y=0,scale=720:1280,format=yuv420p"
        )
    elif subtitle_directory is not None:
        _generate_rounded_corner_mask(
            subtitle_directory,
            width=672,
            height=378,
            radius=28,
            filename="rounded-mask-16-9.png",
        )
        base_filter = (
            "color=c=black:s=720x1280:r=30[bg];"
            "[0:v]scale=672:378:force_original_aspect_ratio=increase,crop=672:378,format=yuva420p[card];"
            "movie=rounded-mask-16-9.png:loop=0,setpts=N/FRAME_RATE/TB[mask];"
            "[card][mask]alphamerge[rounded];"
            "[bg][rounded]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p"
        )
    else:
        base_filter = (
            "scale=720:1280:force_original_aspect_ratio=decrease,"
            "pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
        )
    subtitle_filters = _build_subtitle_filters(
        start_time,
        end_time,
        subtitle_segments=subtitle_segments,
        show_subtitles=show_subtitles,
        subtitle_directory=subtitle_directory,
        font_file=font_file,
        framing_mode=framing_mode,
        caption_style=caption_style,
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
    show_watermark: bool = False,
    top_line: str | None = None,
    cancel_event: threading.Event | None = None,
    framing_mode: str = "standard",
    caption_style: str = "classic",
) -> Path:
    if start_time < 0 or end_time <= start_time:
        raise VideoEditorError("Clip start must be before clip end")
    if not source_path.is_file():
        raise VideoEditorError("Source video not found")
    ffmpeg_path = find_ffmpeg()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    source_path = source_path.resolve()
    output_path = output_path.resolve()
    watermark_path = find_watermark_file() if show_watermark else None

    try:
        with tempfile.TemporaryDirectory(
            prefix="cliprobin-subtitles-",
            dir=output_path.parent,
        ) as temporary_directory:
            subtitle_directory = Path(temporary_directory)
            font_file = (
                _copy_font_file(subtitle_directory)
                if ((show_subtitles and subtitle_segments) or (top_line and top_line.strip()))
                else None
            )
            subtitle_filters = _build_subtitle_filters(
                start_time,
                end_time,
                subtitle_segments=subtitle_segments,
                show_subtitles=show_subtitles,
                subtitle_directory=subtitle_directory,
                font_file=font_file,
                framing_mode=framing_mode,
                caption_style=caption_style,
            )
            top_line_filters = _build_top_line_filters(
                top_line,
                subtitle_directory=subtitle_directory,
                font_file=font_file,
                has_watermark=bool(watermark_path and watermark_path.is_file()),
                framing_mode=framing_mode,
            )
            all_text_filters = top_line_filters + subtitle_filters
            has_audio = has_audio_stream(source_path, ffmpeg_path)

            if framing_mode == "square_rounded":
                _generate_rounded_corner_mask(subtitle_directory, size=660, radius=36)
                bg_and_square = (
                    "color=c=black:s=720x1280:r=30[bg];"
                    "[0:v]crop=min(iw\\,ih):min(iw\\,ih),scale=660:660,format=yuva420p[sq];"
                    "movie=rounded-mask.png:loop=0,setpts=N/FRAME_RATE/TB[mask];"
                    "[sq][mask]alphamerge[rounded];"
                    "[bg][rounded]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p"
                )
                if watermark_path and watermark_path.is_file():
                    wm_y = "round(H*0.07)"
                    base_filter_complex = (
                        f"{bg_and_square}[base];"
                        f"[1:v]scale=240:-2[wm];"
                        f"[base][wm]overlay=(W-w)/2:{wm_y}"
                    )
                    if all_text_filters:
                        filter_graph = base_filter_complex + "," + ",".join(all_text_filters) + "[v]"
                    else:
                        filter_graph = base_filter_complex + "[v]"

                    filter_script = subtitle_directory / "filter-complex.txt"
                    filter_script.write_text(filter_graph, encoding="utf-8")

                    command = [
                        ffmpeg_path,
                        "-y",
                        "-ss",
                        str(start_time),
                        "-i",
                        str(source_path),
                        "-i",
                        str(watermark_path),
                        "-t",
                        str(end_time - start_time),
                        "-/filter_complex",
                        filter_script.name,
                        "-map",
                        "[v]",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "medium",
                        "-crf",
                        "23",
                    ]
                else:
                    if all_text_filters:
                        filter_graph = bg_and_square + "," + ",".join(all_text_filters) + "[v]"
                    else:
                        filter_graph = bg_and_square + "[v]"

                    filter_script = subtitle_directory / "filter-complex.txt"
                    filter_script.write_text(filter_graph, encoding="utf-8")

                    command = [
                        ffmpeg_path,
                        "-y",
                        "-ss",
                        str(start_time),
                        "-i",
                        str(source_path),
                        "-t",
                        str(end_time - start_time),
                        "-/filter_complex",
                        filter_script.name,
                        "-map",
                        "[v]",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "medium",
                        "-crf",
                        "23",
                    ]
                if has_audio:
                    command.extend([
                        "-map",
                        "0:a?",
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
            elif framing_mode == "true_9_16":
                from app.services.smart_framing import analyze_speaker_tracking, get_crop_filter_for_clip
                project_dir = output_path.parent.parent if output_path.parent.name == "clips" else source_path.parent
                try:
                    tracking_data = analyze_speaker_tracking(
                        project_directory=project_dir,
                        ffmpeg_path=ffmpeg_path,
                        cancel_event=cancel_event,
                    )
                    crop_w, crop_h, x_expr = get_crop_filter_for_clip(tracking_data, start_time, end_time)
                except Exception:
                    crop_w = int(round(1080 * 9 / 16))
                    crop_h = 1080
                    x_expr = "(in_w-out_w)/2"
                    tracking_data = {}

                if tracking_data.get("already_vertical"):
                    base_filter = (
                        "scale=720:1280:force_original_aspect_ratio=decrease,"
                        "pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
                    )
                else:
                    base_filter = f"crop=w={crop_w}:h={crop_h}:x='{x_expr}':y=0,scale=720:1280,format=yuv420p"

                if watermark_path and watermark_path.is_file():
                    wm_y = "round(H*0.07)"
                    base_filter_complex = (
                        f"[0:v]{base_filter}[base];"
                        f"[1:v]scale=240:-2[wm];"
                        f"[base][wm]overlay=(W-w)/2:{wm_y}"
                    )
                    if all_text_filters:
                        filter_graph = base_filter_complex + "," + ",".join(all_text_filters) + "[v]"
                    else:
                        filter_graph = base_filter_complex + "[v]"

                    filter_script = subtitle_directory / "filter-complex.txt"
                    filter_script.write_text(filter_graph, encoding="utf-8")

                    command = [
                        ffmpeg_path,
                        "-y",
                        "-ss",
                        str(start_time),
                        "-i",
                        str(source_path),
                        "-i",
                        str(watermark_path),
                        "-t",
                        str(end_time - start_time),
                        "-/filter_complex",
                        filter_script.name,
                        "-map",
                        "[v]",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "medium",
                        "-crf",
                        "23",
                    ]
                else:
                    filter_graph = (
                        base_filter + "," + ",".join(all_text_filters)
                        if all_text_filters
                        else base_filter
                    )
                    filter_script = subtitle_directory / "video-filters.txt"
                    filter_script.write_text(filter_graph, encoding="utf-8")

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
                    if watermark_path and watermark_path.is_file():
                        command.extend([
                            "-map",
                            "0:a?",
                        ])
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
            else:
                _generate_rounded_corner_mask(
                    subtitle_directory,
                    width=672,
                    height=378,
                    radius=28,
                    filename="rounded-mask-16-9.png",
                )
                bg_and_video = (
                    "color=c=black:s=720x1280:r=30[bg];"
                    "[0:v]scale=672:378:force_original_aspect_ratio=increase,crop=672:378,format=yuva420p[card];"
                    "movie=rounded-mask-16-9.png:loop=0,setpts=N/FRAME_RATE/TB[mask];"
                    "[card][mask]alphamerge[rounded];"
                    "[bg][rounded]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p"
                )
                if watermark_path and watermark_path.is_file():
                    wm_y = "round(H*0.07)" if (top_line and top_line.strip()) else "round(H*0.20)"
                    base_filter_complex = (
                        f"{bg_and_video}[base];"
                        f"[1:v]scale=240:-2[wm];"
                        f"[base][wm]overlay=(W-w)/2:{wm_y}"
                    )
                    if all_text_filters:
                        filter_graph = base_filter_complex + "," + ",".join(all_text_filters) + "[v]"
                    else:
                        filter_graph = base_filter_complex + "[v]"

                    filter_script = subtitle_directory / "filter-complex.txt"
                    filter_script.write_text(filter_graph, encoding="utf-8")

                    command = [
                        ffmpeg_path,
                        "-y",
                        "-ss",
                        str(start_time),
                        "-i",
                        str(source_path),
                        "-i",
                        str(watermark_path),
                        "-t",
                        str(end_time - start_time),
                        "-/filter_complex",
                        filter_script.name,
                        "-map",
                        "[v]",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "medium",
                        "-crf",
                        "23",
                    ]
                else:
                    if all_text_filters:
                        filter_graph = bg_and_video + "," + ",".join(all_text_filters) + "[v]"
                    else:
                        filter_graph = bg_and_video + "[v]"

                    filter_script = subtitle_directory / "filter-complex.txt"
                    filter_script.write_text(filter_graph, encoding="utf-8")

                    command = [
                        ffmpeg_path,
                        "-y",
                        "-ss",
                        str(start_time),
                        "-i",
                        str(source_path),
                        "-t",
                        str(end_time - start_time),
                        "-/filter_complex",
                        filter_script.name,
                        "-map",
                        "[v]",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "medium",
                        "-crf",
                        "23",
                    ]
                if has_audio:
                    command.extend([
                        "-map",
                        "0:a?",
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

"""ASS subtitle generation service.

Transforms word-level transcript timestamps into stylistically formatted,
animated SubStation Alpha (.ass) subtitle files compatible with FFmpeg's libass filter.
"""

from __future__ import annotations

import logging
import math
import shutil
from pathlib import Path
from typing import Any

from app.services.caption_styles import (
    CaptionStyleDefinition,
    get_caption_animation,
    get_caption_style,
    get_fonts_directory,
    resolve_font_file,
)

logger = logging.getLogger(__name__)


def format_ass_time(seconds: float) -> str:
    """Format floating point seconds into ASS timestamp format: H:MM:SS.cc"""
    if seconds < 0.0:
        seconds = 0.0
    total_centis = int(round(seconds * 100))
    hours = total_centis // 360000
    remainder = total_centis % 360000
    minutes = remainder // 6000
    remainder = remainder % 6000
    secs = remainder // 100
    centis = remainder % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def escape_ass_text(text: str) -> str:
    """Escape literal characters that have special meaning in ASS formatting."""
    # Replace backslash with double backslash to avoid accidental escape tags
    escaped = text.replace("\\", "\\\\")
    # Replace braces used for ASS override tags
    escaped = escaped.replace("{", "\\{").replace("}", "\\}")
    # Replace newlines with spaces or standard ASS linebreaks
    escaped = escaped.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    return escaped.strip()


def hex_to_ass_color(hex_color: str | None, alpha_fraction: float = 0.0) -> str:
    """Convert #RRGGBB hex color and alpha fraction (0.0=opaque, 1.0=transparent) to ASS &HAABBGGRR& format."""
    if not hex_color or not hex_color.startswith("#"):
        hex_color = "#FFFFFF"

    cleaned = hex_color.lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(c * 2 for c in cleaned)
    elif len(cleaned) != 6:
        cleaned = "FFFFFF"

    r = cleaned[0:2]
    g = cleaned[2:4]
    b = cleaned[4:6]

    alpha_clamped = max(0.0, min(1.0, alpha_fraction))
    alpha_byte = int(round(alpha_clamped * 255))
    alpha_hex = f"{alpha_byte:02X}"

    # ASS color ordering is Alpha, Blue, Green, Red
    return f"&H{alpha_hex}{b}{g}{r}&"


def stage_caption_fonts(destination_dir: Path) -> Path:
    """Copy or link bundled font assets into destination_dir/fonts for cwd-relative libass discovery."""
    fonts_staging = destination_dir / "fonts"
    fonts_staging.mkdir(parents=True, exist_ok=True)

    bundled_fonts_dir = get_fonts_directory()
    if bundled_fonts_dir.is_dir():
        for font_file in bundled_fonts_dir.glob("*.ttf"):
            dest_file = fonts_staging / font_file.name
            if not dest_file.exists():
                try:
                    shutil.copyfile(font_file, dest_file)
                except OSError as error:
                    logger.warning("Could not copy font %s: %s", font_file, error)
    return fonts_staging


def _extract_timed_words(
    subtitle_segments: list[dict[str, Any]] | None,
    clip_start: float,
    clip_end: float,
) -> list[dict[str, Any]]:
    """Extract and normalize timed words from subtitle segments relative to clip start."""
    if not subtitle_segments or clip_end <= clip_start:
        return []

    clip_duration = clip_end - clip_start
    raw_words: list[dict[str, Any]] = []

    for segment in subtitle_segments:
        if not isinstance(segment, dict):
            continue
        seg_start = float(segment.get("start", 0.0))
        seg_end = float(segment.get("end", 0.0))
        if seg_end <= clip_start or seg_start >= clip_end:
            continue

        words = segment.get("words")
        if isinstance(words, list) and words:
            for w in words:
                if isinstance(w, dict) and "text" in w:
                    w_start = float(w.get("start", seg_start))
                    w_end = float(w.get("end", seg_end))
                    w_text = str(w.get("text", "")).strip()
                    if w_text:
                        raw_words.append({"start": w_start, "end": w_end, "text": w_text})
        else:
            # Fallback: synthesize timestamps evenly for segment text
            text = str(segment.get("text", "")).strip()
            tokens = text.split()
            if tokens and seg_end > seg_start:
                duration_per_token = (seg_end - seg_start) / len(tokens)
                for idx, token in enumerate(tokens):
                    t_start = seg_start + idx * duration_per_token
                    t_end = t_start + duration_per_token
                    raw_words.append({"start": t_start, "end": t_end, "text": token})

    # Normalize relative to clip_start
    normalized: list[dict[str, Any]] = []
    for w in raw_words:
        rel_start = max(0.0, w["start"] - clip_start)
        rel_end = min(clip_duration, w["end"] - clip_start)
        if rel_end <= 0.0 or rel_start >= clip_duration:
            continue

        # Enforce minimum duration of 80ms
        if rel_end - rel_start < 0.08:
            rel_end = min(clip_duration, rel_start + 0.08)

        normalized.append({
            "start": rel_start,
            "end": rel_end,
            "text": w["text"],
        })

    normalized.sort(key=lambda x: x["start"])

    # Resolve overlaps and hold short gaps up to 1.20s (so captions don't disappear for less than a second)
    cleaned: list[dict[str, Any]] = []
    for i, word in enumerate(normalized):
        cur_start = word["start"]
        cur_end = word["end"]

        if i + 1 < len(normalized):
            next_start = normalized[i + 1]["start"]
            if cur_end > next_start:
                cur_end = max(cur_start + 0.08, next_start)
            elif next_start - cur_end <= 1.20:
                # Bridge gap (hold word up to 1.20s so captions don't flash/disappear)
                cur_end = next_start

        cleaned.append({
            "start": cur_start,
            "end": max(cur_start + 0.08, cur_end),
            "text": word["text"],
        })

    return cleaned


def _chunk_words(
    words: list[dict[str, Any]],
    animation: str | None = None,
) -> list[list[dict[str, Any]]]:
    """Group words into chunks of at most 2 words per line for high visibility."""
    if not words:
        return []

    # Exactly 2 words per line as requested by user
    max_chunk_size = 2

    chunks: list[list[dict[str, Any]]] = []
    current_chunk: list[dict[str, Any]] = []

    for i, word in enumerate(words):
        if not current_chunk:
            current_chunk.append(word)
            continue

        prev_word = current_chunk[-1]
        gap = word["start"] - prev_word["end"]

        # If gap is significant (> 1.20s) or chunk reaches 2 words, finalize chunk
        if gap > 1.20 or len(current_chunk) >= max_chunk_size:
            chunks.append(current_chunk)
            current_chunk = [word]
        else:
            current_chunk.append(word)

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def generate_ass_subtitles(
    subtitle_segments: list[dict[str, Any]] | None,
    clip_start: float,
    clip_end: float,
    style: CaptionStyleDefinition | str | None = None,
    animation: str | None = None,
    framing_mode: str = "standard",
    language: str | None = None,
    top_line: str | None = None,
    has_watermark: bool = False,
    play_res_x: int = 720,
    play_res_y: int = 1280,
) -> str:
    """Generate complete, valid ASS subtitle content with style and animation rules.

    Safe vertical zones:
    - standard (16:9): Y=940 (sits below the 16:9 video at Y=829, avoiding touching it)
    - square_rounded (1:1): Y=1050 (sits below the 1:1 square video at Y=970, avoiding touching it)
    - true_9_16: Y=940 (bottom 62-75% safe band, well above bottom 20% UI)
    """
    import textwrap

    if isinstance(style, str) or style is None:
        style_def = get_caption_style(style)
    else:
        style_def = style

    anim_id = get_caption_animation(animation, style_def)
    font_family, font_file = resolve_font_file(style_def, language=language)

    # Safe Y placement depending on framing mode
    if framing_mode == "square_rounded":
        # Square video ends at Y=970, so Y=1050 leaves 35px padding below square video
        pos_y = 1050
        margin_v = play_res_y - pos_y  # 230
    else:
        # Standard 16:9 card ends at Y=829, so Y=940 leaves >65px breathing room below card
        # In True 9:16 full-bleed, Y=940 is in the 62-75% height band (73.4% of 1280)
        pos_y = 940
        margin_v = play_res_y - pos_y  # 340

    primary_ass = hex_to_ass_color(style_def.primary_color, alpha_fraction=0.0)
    if style_def.accent_color:
        secondary_ass = hex_to_ass_color(style_def.primary_color, alpha_fraction=0.0)
        accent_ass = hex_to_ass_color(style_def.accent_color, alpha_fraction=0.0)
    else:
        secondary_ass = hex_to_ass_color("#B8B8B8", alpha_fraction=0.0)
        accent_ass = hex_to_ass_color("#FFFFFF", alpha_fraction=0.0)
    outline_ass = hex_to_ass_color("#000000", alpha_fraction=0.0)
    back_ass = hex_to_ass_color("#000000", alpha_fraction=1.0 - style_def.box_opacity if style_def.border_style == 3 else 0.5)

    # Header and V4+ Styles definition (font size 52 for high visibility with 2 words per line)
    font_size = 52
    border_style = style_def.border_style
    outline_w = style_def.outline_width
    shadow_d = style_def.shadow_depth

    top_line_style_def = ""
    top_line_events: list[str] = []
    if top_line and top_line.strip():
        cleaned_text = top_line.strip()
        words = cleaned_text.split()
        if len(words) > 15:
            words = words[:15]
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

        if framing_mode == "square_rounded":
            base_top_y = 205 if has_watermark else 190
            line_spacing = 42
        else:
            base_top_y = 260 if has_watermark else 240
            line_spacing = 46

        if len(raw_lines) == 1:
            y_positions = [base_top_y + 15]
        else:
            y_positions = [base_top_y, base_top_y + line_spacing]

        top_line_style_def = (
            f"Style: TopLine,Montserrat,32,&H00FFFFFF,&H00000000,&H00000000,&H5A000000,"
            f"-1,0,0,0,100,100,0,0,3,8,0,8,20,20,20,1\n"
        )
        clip_duration = max(0.1, clip_end - clip_start)
        duration_str = format_ass_time(clip_duration)
        for line_idx, line_str in enumerate(raw_lines):
            y_pos = y_positions[line_idx]
            escaped = escape_ass_text(line_str)
            top_line_events.append(
                f"Dialogue: 1,0:00:00.00,{duration_str},TopLine,,0,0,0,,{{\\an8\\pos({play_res_x // 2},{y_pos})}}{escaped}"
            )

    # ASS Script Header
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {play_res_x}\n"
        f"PlayResY: {play_res_y}\n"
        "ScaledBorderAndShadow: yes\n"
        "WrapStyle: 2\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{font_family},{font_size},{primary_ass},{secondary_ass},{outline_ass},{back_ass},"
        f"-1,0,0,0,100,100,0,0,{border_style},{outline_w},{shadow_d},2,24,24,{margin_v},1\n"
        f"{top_line_style_def}"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    words = _extract_timed_words(subtitle_segments, clip_start, clip_end)
    events: list[str] = list(top_line_events)
    if not words:
        if events:
            return header + "\n".join(events) + "\n"
        return header

    chunks = _chunk_words(words, anim_id)

    pos_tag = f"\\an2\\pos({play_res_x // 2},{pos_y})"

    for c_idx, chunk in enumerate(chunks):
        chunk_start = chunk[0]["start"]
        chunk_end = chunk[-1]["end"]
        if chunk_end <= chunk_start:
            continue

        # Hold chunk on screen longer so captions never disappear for less than a second!
        if c_idx + 1 < len(chunks):
            next_chunk_start = chunks[c_idx + 1][0]["start"]
            gap = next_chunk_start - chunk_end
            if gap <= 1.25:
                # Bridge gap completely to the start of the next chunk
                chunk_end = next_chunk_start
            else:
                # Even for longer pauses, hold the caption for an extra 0.8s
                chunk_end = min(chunk_end + 0.80, next_chunk_start - 0.05)
        else:
            # Last chunk in the clip: hold for an extra 1.0s (capped by clip duration)
            clip_dur = max(0.1, clip_end - clip_start)
            chunk_end = min(clip_dur, chunk_end + 1.0)

        # Format tokens according to style text_case
        formatted_chunk = []
        for w in chunk:
            raw_t = w["text"]
            t = raw_t.upper() if style_def.text_case == "upper" else raw_t
            formatted_chunk.append({**w, "text": escape_ass_text(t)})

        if style_def.id == "karaoke" or anim_id == "sweep":
            # Karaoke sweep (\kf tag) across the 2-word phrase
            phrase_parts = []
            for w in formatted_chunk:
                w_duration_cs = max(8, int(round((w["end"] - w["start"]) * 100)))
                phrase_parts.append(f"{{\\kf{w_duration_cs}}}{w['text']}")
            phrase_text = " ".join(phrase_parts)
            start_str = format_ass_time(chunk_start)
            end_str = format_ass_time(chunk_end)
            events.append(
                f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{{{pos_tag}}}{phrase_text}"
            )
        else:
            # Clean word-by-word active highlight without distracting animation effects (pop/grow/fade/glide bouncing)
            for active_idx, active_word in enumerate(formatted_chunk):
                w_start = active_word["start"]
                if active_idx == 0:
                    w_start = chunk_start

                if active_idx + 1 < len(formatted_chunk):
                    w_end = formatted_chunk[active_idx + 1]["start"]
                else:
                    w_end = chunk_end

                if w_end <= w_start:
                    w_end = w_start + 0.08

                line_parts = []
                for idx, w in enumerate(formatted_chunk):
                    if idx == active_idx:
                        line_parts.append(f"{{\\1c{accent_ass}}}{w['text']}{{\\1c{primary_ass}}}")
                    else:
                        line_parts.append(f"{{\\1c{secondary_ass}}}{w['text']}")

                line_text = " ".join(line_parts)
                start_str = format_ass_time(w_start)
                end_str = format_ass_time(w_end)
                events.append(
                    f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{{{pos_tag}}}{line_text}"
                )

    return header + "\n".join(events) + "\n"

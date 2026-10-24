import pytest
from pathlib import Path

from app.services.ass_captions import (
    escape_ass_text,
    format_ass_time,
    generate_ass_subtitles,
    hex_to_ass_color,
    stage_caption_fonts,
)
from app.services.caption_styles import ALL_ANIMATION_IDS, CAPTION_STYLES


def test_format_ass_time():
    assert format_ass_time(0.0) == "0:00:00.00"
    assert format_ass_time(1.25) == "0:00:01.25"
    assert format_ass_time(65.5) == "0:01:05.50"
    assert format_ass_time(3661.02) == "1:01:01.02"
    assert format_ass_time(-5.0) == "0:00:00.00"


def test_escape_ass_text():
    assert escape_ass_text("Hello World") == "Hello World"
    assert escape_ass_text(r"Path\To\File") == r"Path\\To\\File"
    assert escape_ass_text("Hello {bracket} test") == r"Hello \{bracket\} test"
    assert escape_ass_text("Line 1\nLine 2\r\nLine 3") == "Line 1 Line 2 Line 3"


def test_hex_to_ass_color():
    # White opaque
    assert hex_to_ass_color("#FFFFFF", alpha_fraction=0.0) == "&H00FFFFFF&"
    # Emerald opaque (#34D399 -> B=99, G=D3, R=34)
    assert hex_to_ass_color("#34D399", alpha_fraction=0.0) == "&H0099D334&"
    # Yellow opaque (#F7C204 -> B=04, G=C2, R=F7)
    assert hex_to_ass_color("#F7C204", alpha_fraction=0.0) == "&H0004C2F7&"
    # Black 75% opacity box (alpha = 0.25 -> 40 hex)
    assert hex_to_ass_color("#000000", alpha_fraction=0.25) == "&H40000000&"


def test_safe_vertical_positioning():
    segments = [
        {
            "start": 0.0,
            "end": 2.0,
            "words": [
                {"start": 0.0, "end": 1.0, "text": "Testing"},
                {"start": 1.0, "end": 2.0, "text": "safe"},
            ],
        }
    ]

    # 1. Standard (16:9): Y=940, MarginV=340
    # Card is at Y=451-829. Text anchor at Y=940 leaves >65px clear margin below card.
    ass_standard = generate_ass_subtitles(
        segments, clip_start=0.0, clip_end=2.0, framing_mode="standard"
    )
    assert r"\pos(360,940)" in ass_standard
    assert "24,24,340,1" in ass_standard

    # 2. Square Rounded (1:1): Y=1050, MarginV=230
    # Square video ends at Y=970. Text anchor at Y=1050 leaves 35px clear margin below square.
    ass_square = generate_ass_subtitles(
        segments, clip_start=0.0, clip_end=2.0, framing_mode="square_rounded"
    )
    assert r"\pos(360,1050)" in ass_square
    assert "24,24,230,1" in ass_square

    # 3. True 9:16: Y=940 (safe in the bottom 62-75% band)
    ass_916 = generate_ass_subtitles(
        segments, clip_start=0.0, clip_end=2.0, framing_mode="true_9_16"
    )
    assert r"\pos(360,940)" in ass_916


def test_all_25_combinations():
    segments = [
        {
            "start": 0.0,
            "end": 4.0,
            "words": [
                {"start": 0.0, "end": 0.9, "text": "The"},
                {"start": 0.9, "end": 1.8, "text": "quick"},
                {"start": 1.8, "end": 2.7, "text": "brown"},
                {"start": 2.7, "end": 3.6, "text": "fox"},
            ],
        }
    ]

    for style_id in CAPTION_STYLES:
        for anim_id in ALL_ANIMATION_IDS:
            ass_text = generate_ass_subtitles(
                segments,
                clip_start=0.0,
                clip_end=4.0,
                style=style_id,
                animation=anim_id,
            )
            assert "[Script Info]" in ass_text
            assert "PlayResX: 720" in ass_text
            assert "PlayResY: 1280" in ass_text
            assert "[V4+ Styles]" in ass_text
            assert "[Events]" in ass_text
            assert "Dialogue:" in ass_text

            # Check style-specific formatting
            if style_id in ("punch", "robin"):
                assert "BROWN" in ass_text
            elif style_id == "clean":
                assert "brown" in ass_text


def test_empty_transcript_handling():
    # Empty transcript segments should not crash and should produce valid ASS script
    ass_text = generate_ass_subtitles(None, clip_start=0.0, clip_end=5.0)
    assert "[Script Info]" in ass_text
    assert "[Events]" in ass_text

    ass_text2 = generate_ass_subtitles([], clip_start=0.0, clip_end=5.0)
    assert "[Script Info]" in ass_text2
    assert "[Events]" in ass_text2


def test_top_line_integration_in_ass():
    segments = [
        {
            "start": 0.0,
            "end": 2.0,
            "words": [{"start": 0.0, "end": 1.5, "text": "hello"}],
        }
    ]
    ass_text = generate_ass_subtitles(
        segments,
        clip_start=0.0,
        clip_end=2.0,
        top_line="THIS IS THE TOP HOOK LINE",
    )
    assert "Style: TopLine,Montserrat,32" in ass_text
    assert ",0,0,1,3,2,8,20,20,20,1" in ass_text  # BorderStyle=1 (outline with shadow, no box background)
    assert "TopLine" in ass_text
    assert "THIS IS THE TOP HOOK LINE" in ass_text
    assert r"\an8\pos(360," in ass_text

    # Top line with true_9_16 framing mode
    ass_true_916 = generate_ass_subtitles(
        segments,
        clip_start=0.0,
        clip_end=2.0,
        top_line="TRUE 9:16 HOOK",
        framing_mode="true_9_16",
        has_watermark=True,
    )
    assert r"\an8\pos(360,190)" in ass_true_916  # Single line placed at base_y(175) + 15 = 190
    assert ",0,0,1,3,2,8,20,20,20,1" in ass_true_916

    # Top line even with no subtitle words
    ass_top_only = generate_ass_subtitles(
        None,
        clip_start=0.0,
        clip_end=2.0,
        top_line="STANDALONE HOOK",
    )
    assert "STANDALONE HOOK" in ass_top_only
    assert "TopLine" in ass_top_only


def test_stage_caption_fonts(tmp_path: Path):
    fonts_dir = stage_caption_fonts(tmp_path)
    assert fonts_dir.is_dir()
    assert (fonts_dir / "Montserrat-Bold.ttf").is_file()
    assert (fonts_dir / "Anton-Regular.ttf").is_file()
    assert (fonts_dir / "Poppins-Bold.ttf").is_file()



def test_karaoke_colors_and_animations():
    segments = [
        {
            "start": 0.0,
            "end": 2.0,
            "words": [
                {"start": 0.0, "end": 1.0, "text": "karaoke"},
                {"start": 1.0, "end": 2.0, "text": "test"},
            ],
        }
    ]
    # Karaoke sweep must have accent color (&H0099D334& for emerald) as primary and white (&H00FFFFFF&) as secondary
    ass_karaoke = generate_ass_subtitles(segments, 0.0, 2.0, style="karaoke")
    assert r"\kf" in ass_karaoke
    assert r"\1c&H0099D334&" in ass_karaoke
    assert r"\2c&H00FFFFFF&" in ass_karaoke

    # Robin style must have grow animation scale transform
    ass_robin = generate_ass_subtitles(segments, 0.0, 2.0, style="robin")
    assert r"\fscx115" in ass_robin
    assert r"\1c&H0099D334&" in ass_robin

    # Punch style must have pop animation scale transform
    ass_punch = generate_ass_subtitles(segments, 0.0, 2.0, style="punch")
    assert r"\fscx116" in ass_punch
    assert r"\1c&H0004C2F7&" in ass_punch

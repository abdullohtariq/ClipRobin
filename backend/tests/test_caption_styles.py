import pytest
from pathlib import Path

from app.services.caption_styles import (
    ALL_ANIMATION_IDS,
    ANIMATIONS,
    CAPTION_STYLES,
    DEFAULT_STYLE_ID,
    STYLE_ALIASES,
    get_caption_animation,
    get_caption_style,
    get_fonts_directory,
    list_caption_styles,
    resolve_font_file,
)


def test_styles_and_animations_definitions():
    expected_styles = {"clean", "punch", "robin", "pill", "karaoke"}
    assert set(CAPTION_STYLES.keys()) == expected_styles

    expected_animations = {"pop", "grow", "sweep", "fade", "glide"}
    assert set(ANIMATIONS.keys()) == expected_animations
    assert set(ALL_ANIMATION_IDS) == expected_animations

    assert DEFAULT_STYLE_ID == "robin"


def test_get_caption_style_defaults_and_aliases():
    # None or empty defaults to Robin
    assert get_caption_style(None).id == "robin"
    assert get_caption_style("").id == "robin"

    # Aliases
    assert get_caption_style("classic").id == "robin"
    assert get_caption_style("bold_emerald").id == "robin"
    assert get_caption_style("clean_gold").id == "clean"

    # Exact styles
    for style_id in ["clean", "punch", "robin", "pill", "karaoke"]:
        assert get_caption_style(style_id).id == style_id

    # Unknown style raises ValueError
    with pytest.raises(ValueError, match="Unknown caption style"):
        get_caption_style("cyberpunk_neon")


def test_get_caption_animation_resolution():
    # Defaults for each style
    clean_style = get_caption_style("clean")
    assert get_caption_animation(None, clean_style) == "fade"

    punch_style = get_caption_style("punch")
    assert get_caption_animation(None, punch_style) == "pop"

    robin_style = get_caption_style("robin")
    assert get_caption_animation(None, robin_style) == "grow"

    pill_style = get_caption_style("pill")
    assert get_caption_animation(None, pill_style) == "pop"

    karaoke_style = get_caption_style("karaoke")
    assert get_caption_animation(None, karaoke_style) == "sweep"

    # Explicit allowed animations
    assert get_caption_animation("pop", clean_style) == "pop"
    assert get_caption_animation("glide", robin_style) == "glide"

    # Unknown animation
    with pytest.raises(ValueError, match="Unknown caption animation"):
        get_caption_animation("moonwalk", robin_style)


def test_fonts_directory_and_bundled_fonts():
    fonts_dir = get_fonts_directory()
    assert fonts_dir.is_dir()

    expected_fonts = [
        "Montserrat-Bold.ttf",
        "Montserrat-Black.ttf",
        "Anton-Regular.ttf",
        "Poppins-Bold.ttf",
        "NotoSansArabic-Bold.ttf",
        "NotoSansDevanagari-Bold.ttf",
    ]
    for font_name in expected_fonts:
        assert (fonts_dir / font_name).is_file(), f"Font file {font_name} is missing from {fonts_dir}"


def test_resolve_font_file_fallbacks():
    robin_style = get_caption_style("robin")

    # Latin / English
    family, file_name = resolve_font_file(robin_style, language="en")
    assert family == "Montserrat"
    assert file_name == "Montserrat-Black.ttf"

    # Arabic
    family, file_name = resolve_font_file(robin_style, language="ar")
    assert family == "Noto Sans Arabic"
    assert file_name == "NotoSansArabic-Bold.ttf"

    # Hindi / Devanagari
    family, file_name = resolve_font_file(robin_style, language="hi")
    assert family == "Noto Sans Devanagari"
    assert file_name == "NotoSansDevanagari-Bold.ttf"


def test_list_caption_styles():
    styles = list_caption_styles()
    assert len(styles) == 5
    style_ids = {s["id"] for s in styles}
    assert style_ids == {"clean", "punch", "robin", "pill", "karaoke"}

    for s in styles:
        assert "name" in s
        assert "description" in s
        assert "default_animation" in s
        assert "allowed_animations" in s
        assert "allowed_animations_detail" in s
        assert len(s["allowed_animations_detail"]) == len(s["allowed_animations"])


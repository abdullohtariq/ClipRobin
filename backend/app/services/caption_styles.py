"""Caption style and animation registry.

Defines the 5 styles and 5 animations for the local ASS subtitle rendering pipeline,
with support for font resolution in development and frozen PyInstaller builds,
transcript language fallback, and backward-compatible alias resolution.
"""

from __future__ import annotations

import logging
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CaptionStyleDefinition:
    id: str
    name: str
    description: str
    font_family: str
    font_file: str
    text_case: str  # "normal" | "upper"
    primary_color: str  # Hex RRGGBB e.g. "#FFFFFF"
    accent_color: str | None  # Hex RRGGBB e.g. "#34D399"
    outline_width: int
    shadow_depth: int
    border_style: int  # 1 = outline + shadow, 3 = opaque / translucent box
    box_opacity: float  # 0.0 to 1.0 (e.g. 0.75 for Pill)
    default_animation: str
    allowed_animations: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


ANIMATIONS: dict[str, dict[str, Any]] = {
    "pop": {
        "id": "pop",
        "name": "Pop",
        "description": "Each word enters at 50% scale, grows to 115% over ~100ms, settles at 100% by ~200ms",
    },
    "grow": {
        "id": "grow",
        "name": "Grow",
        "description": "Whole chunk visible; active word changes to accent color and scales 100 -> 115 -> 100% over ~300ms",
    },
    "sweep": {
        "id": "sweep",
        "name": "Sweep",
        "description": "Karaoke sweep fill across the phrase",
    },
    "fade": {
        "id": "fade",
        "name": "Fade",
        "description": "Chunk fades in with subtle 95 -> 100% scale over 120ms",
    },
    "glide": {
        "id": "glide",
        "name": "Glide",
        "description": "Word rises ~12px while fading in over ~160ms",
    },
}

ALL_ANIMATION_IDS = list(ANIMATIONS.keys())

CAPTION_STYLES: dict[str, CaptionStyleDefinition] = {
    "clean": CaptionStyleDefinition(
        id="clean",
        name="Clean",
        description="Clean minimal typography with soft shadow",
        font_family="Montserrat",
        font_file="Montserrat-Bold.ttf",
        text_case="normal",
        primary_color="#FFFFFF",
        accent_color=None,
        outline_width=3,
        shadow_depth=2,
        border_style=1,
        box_opacity=0.0,
        default_animation="fade",
        allowed_animations=ALL_ANIMATION_IDS,
    ),
    "punch": CaptionStyleDefinition(
        id="punch",
        name="Punch",
        description="High-impact bold all-caps with golden accent pop",
        font_family="Anton",
        font_file="Anton-Regular.ttf",
        text_case="upper",
        primary_color="#FFFFFF",
        accent_color="#F7C204",
        outline_width=4,
        shadow_depth=0,
        border_style=1,
        box_opacity=0.0,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
    ),
    "robin": CaptionStyleDefinition(
        id="robin",
        name="Robin",
        description="Signature viral all-caps style with emerald highlight",
        font_family="Montserrat",
        font_file="Montserrat-Black.ttf",
        text_case="upper",
        primary_color="#FFFFFF",
        accent_color="#34D399",
        outline_width=4,
        shadow_depth=0,
        border_style=1,
        box_opacity=0.0,
        default_animation="grow",
        allowed_animations=ALL_ANIMATION_IDS,
    ),
    "pill": CaptionStyleDefinition(
        id="pill",
        name="Pill",
        description="Translucent dark box with popping active word highlight",
        font_family="Poppins",
        font_file="Poppins-Bold.ttf",
        text_case="normal",
        primary_color="#FFFFFF",
        accent_color="#34D399",
        outline_width=10,
        shadow_depth=0,
        border_style=3,
        box_opacity=0.75,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
    ),
    "karaoke": CaptionStyleDefinition(
        id="karaoke",
        name="Karaoke",
        description="Smooth fill sweep across the phrase",
        font_family="Montserrat",
        font_file="Montserrat-Bold.ttf",
        text_case="normal",
        primary_color="#FFFFFF",
        accent_color="#34D399",
        outline_width=3,
        shadow_depth=1,
        border_style=1,
        box_opacity=0.0,
        default_animation="sweep",
        allowed_animations=ALL_ANIMATION_IDS,
    ),
}

DEFAULT_STYLE_ID = "robin"

# Backward compatibility aliases for existing projects and tests
STYLE_ALIASES: dict[str, str] = {
    "classic": "robin",
    "bold_emerald": "robin",
    "clean_gold": "clean",
}


def get_fonts_directory() -> Path:
    """Resolve the directory containing bundled font assets in dev or frozen PyInstaller."""
    # 1. PyInstaller frozen path
    if hasattr(sys, "_MEIPASS"):
        meipass_dir = Path(sys._MEIPASS) / "assets" / "fonts"
        if meipass_dir.is_dir():
            return meipass_dir

    # 2. Package relative path
    pkg_fonts = Path(__file__).resolve().parent.parent.parent / "assets" / "fonts"
    if pkg_fonts.is_dir():
        return pkg_fonts

    # 3. Repository root relative
    repo_fonts = Path("backend/assets/fonts").resolve()
    if repo_fonts.is_dir():
        return repo_fonts

    return pkg_fonts


def resolve_font_file(style: CaptionStyleDefinition, language: str | None = None) -> tuple[str, str]:
    """Resolve font family name and font filename, with fallback for non-Latin languages.

    Returns (font_family, font_file_name).
    """
    normalized_lang = (language or "").strip().lower()

    if normalized_lang in {"ar", "fa", "ur"} or normalized_lang.startswith("ar"):
        arabic_font = "NotoSansArabic-Bold.ttf"
        arabic_path = get_fonts_directory() / arabic_font
        if arabic_path.is_file():
            return "Noto Sans Arabic", arabic_font
        logger.warning("Arabic font %s not found, falling back to %s", arabic_font, style.font_file)

    if normalized_lang in {"hi", "mr", "ne"} or normalized_lang.startswith("hi"):
        devanagari_font = "NotoSansDevanagari-Bold.ttf"
        devanagari_path = get_fonts_directory() / devanagari_font
        if devanagari_path.is_file():
            return "Noto Sans Devanagari", devanagari_font
        logger.warning("Devanagari font %s not found, falling back to %s", devanagari_font, style.font_file)

    if normalized_lang in {"zh", "ja", "ko"} or any(normalized_lang.startswith(prefix) for prefix in ("zh-", "ja-", "ko-")):
        logger.warning("CJK language '%s' detected; CJK glyphs may fall back to default font renderer.", language)

    return style.font_family, style.font_file


def get_caption_style(style_id: str | None) -> CaptionStyleDefinition:
    """Lookup a style definition by ID or alias, defaulting to Robin."""
    if not style_id:
        return CAPTION_STYLES[DEFAULT_STYLE_ID]

    normalized = style_id.strip().lower()
    if normalized in STYLE_ALIASES:
        normalized = STYLE_ALIASES[normalized]

    if normalized in CAPTION_STYLES:
        return CAPTION_STYLES[normalized]

    raise ValueError(f"Unknown caption style '{style_id}'. Allowed styles: {list(CAPTION_STYLES.keys())}")


def get_caption_animation(animation_id: str | None, style: CaptionStyleDefinition) -> str:
    """Validate and return the animation ID for a given style.

    Defaults to style.default_animation if animation_id is None.
    """
    if not animation_id:
        return style.default_animation

    normalized = animation_id.strip().lower()
    if normalized not in ANIMATIONS:
        raise ValueError(f"Unknown caption animation '{animation_id}'. Allowed animations: {ALL_ANIMATION_IDS}")

    if normalized not in style.allowed_animations:
        raise ValueError(
            f"Animation '{animation_id}' is not allowed for style '{style.id}'. "
            f"Allowed animations: {style.allowed_animations}"
        )

    return normalized


def list_caption_styles() -> list[dict[str, Any]]:
    """Return all caption styles with metadata formatted for the UI and API."""
    styles = []
    for s in CAPTION_STYLES.values():
        data = s.to_dict()
        data["allowed_animations_detail"] = [
            ANIMATIONS[anim_id] for anim_id in s.allowed_animations if anim_id in ANIMATIONS
        ]
        styles.append(data)
    return styles


"""Caption style and animation registry.

Defines the 18 styles and 5 animations for the local ASS subtitle rendering pipeline,
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
    category: str = "bold"  # "bold" | "minimal" | "boxed"
    font_size: int = 52
    outline_color: str = "#000000"
    box_color: str = "#000000"
    shadow_color: str = "#000000"
    italic: bool = False
    letter_spacing: int = 0

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
    "classic": CaptionStyleDefinition(
        id="classic",
        name="Classic",
        description="The original Clip Robin word-by-word look.",
        font_family="Montserrat",
        font_file="Montserrat-Bold.ttf",
        text_case="normal",
        primary_color="#FFFFFF",
        accent_color="#FFFF00",
        outline_width=3,
        shadow_depth=2,
        border_style=1,
        box_opacity=0.55,
        default_animation="pop",
        allowed_animations=["pop"],
        category="boxed",
    ),
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
        category="minimal",
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
        category="bold",
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
        category="bold",
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
        category="boxed",
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
        category="minimal",
    ),
    "hormozi": CaptionStyleDefinition(
        id="hormozi",
        name="Hormozi",
        description="Chunky yellow all-caps with bright green viral word pop",
        font_family="Montserrat",
        font_file="Montserrat-Black.ttf",
        text_case="upper",
        primary_color="#FDE047",
        accent_color="#4ADE80",
        outline_width=5,
        shadow_depth=4,
        border_style=1,
        box_opacity=0.0,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
        category="bold",
        font_size=56,
    ),
    "hype": CaptionStyleDefinition(
        id="hype",
        name="Hype",
        description="Slanted Shorts display type with electric cyan punch",
        font_family="Anton",
        font_file="Anton-Regular.ttf",
        text_case="upper",
        primary_color="#FFFFFF",
        accent_color="#22D3EE",
        outline_width=5,
        shadow_depth=5,
        border_style=1,
        box_opacity=0.0,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
        category="bold",
        font_size=58,
        italic=True,
    ),
    "sticker": CaptionStyleDefinition(
        id="sticker",
        name="Sticker",
        description="Solid white Reels sticker box with dark ink and emerald pop",
        font_family="Poppins",
        font_file="Poppins-Bold.ttf",
        text_case="normal",
        primary_color="#09090B",
        accent_color="#059669",
        outline_width=10,
        shadow_depth=2,
        border_style=3,
        box_opacity=0.96,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
        category="boxed",
        font_size=50,
        box_color="#FFFFFF",
    ),
    "marker": CaptionStyleDefinition(
        id="marker",
        name="Marker",
        description="Highlighter yellow bar with bold black caps and red emphasis",
        font_family="Montserrat",
        font_file="Montserrat-Black.ttf",
        text_case="upper",
        primary_color="#09090B",
        accent_color="#DC2626",
        outline_width=10,
        shadow_depth=2,
        border_style=3,
        box_opacity=0.96,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
        category="boxed",
        font_size=50,
        box_color="#FACC15",
    ),
    "neon": CaptionStyleDefinition(
        id="neon",
        name="Neon",
        description="Electric magenta glow outline with cyan highlight",
        font_family="Poppins",
        font_file="Poppins-Bold.ttf",
        text_case="normal",
        primary_color="#FFFFFF",
        accent_color="#22D3EE",
        outline_width=4,
        shadow_depth=3,
        border_style=1,
        box_opacity=0.0,
        default_animation="grow",
        allowed_animations=ALL_ANIMATION_IDS,
        category="bold",
        outline_color="#C026D3",
        shadow_color="#701A75",
    ),
    "flame": CaptionStyleDefinition(
        id="flame",
        name="Flame",
        description="High-contrast all-caps with fiery crimson emphasis",
        font_family="Montserrat",
        font_file="Montserrat-Black.ttf",
        text_case="upper",
        primary_color="#FFFFFF",
        accent_color="#EF4444",
        outline_width=5,
        shadow_depth=3,
        border_style=1,
        box_opacity=0.0,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
        category="bold",
        font_size=54,
    ),
    "cinema": CaptionStyleDefinition(
        id="cinema",
        name="Cinema",
        description="Wide-tracked warm ivory editorial captions with amber cue",
        font_family="Montserrat",
        font_file="Montserrat-Bold.ttf",
        text_case="normal",
        primary_color="#FEF3C7",
        accent_color="#FBBF24",
        outline_width=2,
        shadow_depth=3,
        border_style=1,
        box_opacity=0.0,
        default_animation="fade",
        allowed_animations=ALL_ANIMATION_IDS,
        category="minimal",
        font_size=46,
        outline_color="#09090B",
        letter_spacing=2,
    ),
    "podcast": CaptionStyleDefinition(
        id="podcast",
        name="Podcast",
        description="Sleek obsidian studio card with sky-blue word focus",
        font_family="Poppins",
        font_file="Poppins-Bold.ttf",
        text_case="normal",
        primary_color="#F4F4F5",
        accent_color="#38BDF8",
        outline_width=10,
        shadow_depth=2,
        border_style=3,
        box_opacity=0.86,
        default_animation="glide",
        allowed_animations=ALL_ANIMATION_IDS,
        category="boxed",
        font_size=50,
        box_color="#09090B",
    ),
    "electric": CaptionStyleDefinition(
        id="electric",
        name="Electric",
        description="Bold creator all-caps with sky-blue highlight",
        font_family="Montserrat",
        font_file="Montserrat-Black.ttf",
        text_case="upper",
        primary_color="#FFFFFF",
        accent_color="#38BDF8",
        outline_width=4,
        shadow_depth=3,
        border_style=1,
        box_opacity=0.0,
        default_animation="grow",
        allowed_animations=ALL_ANIMATION_IDS,
        category="bold",
        font_size=54,
        outline_color="#09090B",
    ),
    "aesthetic": CaptionStyleDefinition(
        id="aesthetic",
        name="Aesthetic",
        description="Soft lifestyle typography with pastel rose highlight",
        font_family="Poppins",
        font_file="Poppins-Bold.ttf",
        text_case="normal",
        primary_color="#FFFFFF",
        accent_color="#FDA4AF",
        outline_width=2,
        shadow_depth=2,
        border_style=1,
        box_opacity=0.0,
        default_animation="fade",
        allowed_animations=ALL_ANIMATION_IDS,
        category="minimal",
        font_size=48,
        outline_color="#18181B",
        letter_spacing=1,
    ),
    "sunset": CaptionStyleDefinition(
        id="sunset",
        name="Sunset",
        description="Warm cream condensed headline caps with tangerine pop",
        font_family="Anton",
        font_file="Anton-Regular.ttf",
        text_case="upper",
        primary_color="#FFF7ED",
        accent_color="#FB923C",
        outline_width=4,
        shadow_depth=3,
        border_style=1,
        box_opacity=0.0,
        default_animation="pop",
        allowed_animations=ALL_ANIMATION_IDS,
        category="bold",
        font_size=56,
    ),
    "dark_tag": CaptionStyleDefinition(
        id="dark_tag",
        name="Night Box",
        description="Deep midnight navy box with golden amber highlight",
        font_family="Poppins",
        font_file="Poppins-Bold.ttf",
        text_case="normal",
        primary_color="#E2E8F0",
        accent_color="#FACC15",
        outline_width=10,
        shadow_depth=2,
        border_style=3,
        box_opacity=0.92,
        default_animation="glide",
        allowed_animations=ALL_ANIMATION_IDS,
        category="boxed",
        font_size=50,
        box_color="#0F172A",
    ),
}

DEFAULT_STYLE_ID = "classic"

# Backward compatibility aliases for existing projects and tests
STYLE_ALIASES: dict[str, str] = {
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
    Classic has a fixed built-in highlight so it always uses its default animation.
    """
    if not animation_id or style.id == "classic":
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


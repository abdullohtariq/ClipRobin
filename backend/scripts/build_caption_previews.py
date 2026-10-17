"""Build pre-rendered moving caption previews at build/dev time.

Renders every caption style x allowed animation combination (including Classic)
using the production caption pipeline at 720x1280, downscales to 360x640,
extracts poster images, and writes manifest.json.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Ensure backend package is in path
backend_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_root))

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402
from app.services.caption_styles import CAPTION_STYLES, CaptionStyleDefinition  # noqa: E402
from app.services.video_editor import create_clip, find_ffmpeg  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("build_caption_previews")

RENDERER_VERSION = "1.0"
MAX_TOTAL_BYTES = 10 * 1024 * 1024  # 10 MB maximum bundle limit


def compute_style_hash(style: CaptionStyleDefinition, animation_id: str) -> str:
    """Generate deterministic sha256 of style and animation metadata."""
    payload = {
        "style": style.to_dict(),
        "animation": animation_id,
        "renderer_version": RENDERER_VERSION,
    }
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def generate_synthetic_background(temp_dir: Path, ffmpeg_path: str) -> Path:
    """Create a dark neutral gradient with a subtle speaker silhouette and gentle drift."""
    width, height = 720, 1280
    bg_img = Image.new("RGB", (width, height), (14, 14, 16))
    draw = ImageDraw.Draw(bg_img)

    # Vertical gradient
    for y in range(height):
        r = int(22 - 12 * (y / height))
        g = int(22 - 12 * (y / height))
        b = int(26 - 15 * (y / height))
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    # Speaker silhouette (head & shoulders in upper-middle, Y: 300 to 750)
    sil_color = (28, 28, 34)
    # Shoulders
    draw.ellipse([190, 480, 530, 780], fill=sil_color)
    # Neck
    draw.rectangle([335, 420, 385, 500], fill=sil_color)
    # Head
    draw.ellipse([300, 310, 420, 450], fill=sil_color)

    # Blur slightly for clean anti-aliased silhouette edges
    bg_img = bg_img.filter(ImageFilter.GaussianBlur(radius=2))
    bg_image_path = temp_dir / "synthetic_bg.png"
    bg_img.save(bg_image_path)

    bg_video_path = temp_dir / "synthetic_bg.mp4"
    # Slow drift: max ~3% zoom over 4 seconds (120 frames at 30 fps)
    cmd = [
        ffmpeg_path,
        "-y",
        "-loop",
        "1",
        "-i",
        str(bg_image_path),
        "-vf",
        "zoompan=z='min(zoom+0.00025,1.03)':d=120:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=30",
        "-t",
        "4.0",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "22",
        str(bg_video_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return bg_video_path


def build_previews(output_dir: Path | None = None) -> dict[str, object]:
    """Generate all preview MP4s, posters, and manifest.json."""
    if output_dir is None:
        repo_root = backend_root.parent
        output_dir = repo_root / "frontend" / "public" / "caption-previews"

    output_dir.mkdir(parents=True, exist_ok=True)
    words_file = backend_root / "assets" / "caption_preview" / "demo_words.json"
    if not words_file.is_file():
        raise FileNotFoundError(f"Missing demo words fixture at: {words_file}")

    segments = json.loads(words_file.read_text(encoding="utf-8"))
    ffmpeg_path = find_ffmpeg()
    logger.info("Found FFmpeg: %s", ffmpeg_path)
    logger.info("Output directory: %s", output_dir)

    manifest: dict[str, object] = {
        "version": "1.0",
        "renderer_version": RENDERER_VERSION,
        "items": {},
    }

    with tempfile.TemporaryDirectory(prefix="cliprobin-preview-gen-") as tmp:
        temp_dir = Path(tmp)
        logger.info("Generating synthetic 720x1280 background video...")
        bg_video = generate_synthetic_background(temp_dir, ffmpeg_path)

        total_combinations = sum(len(s.allowed_animations) for s in CAPTION_STYLES.values())
        processed = 0

        for style_id, style_def in CAPTION_STYLES.items():
            for anim_id in style_def.allowed_animations:
                processed += 1
                key = f"{style_id}__{anim_id}"
                logger.info(
                    "[%d/%d] Rendering preview for %s (style: %s, anim: %s)...",
                    processed,
                    total_combinations,
                    key,
                    style_id,
                    anim_id,
                )

                # 1. Render 720x1280 vertical video using production pipeline
                temp_720 = temp_dir / f"{key}_720.mp4"
                create_clip(
                    source_path=bg_video,
                    output_path=temp_720,
                    start_time=0.0,
                    end_time=4.0,
                    subtitle_segments=segments,
                    show_subtitles=True,
                    caption_style=style_id,
                    caption_animation=anim_id,
                    framing_mode="true_9_16",
                )

                # 2. Downscale to 360x640, CRF ~28, 30fps, faststart, no audio
                dest_video = output_dir / f"{key}.mp4"
                cmd_scale = [
                    ffmpeg_path,
                    "-y",
                    "-i",
                    str(temp_720),
                    "-vf",
                    "scale=360:640",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "28",
                    "-an",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(dest_video),
                ]
                subprocess.run(cmd_scale, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                # 3. Extract poster at 2.1s (when active word 'captions' is highlighted)
                dest_poster = output_dir / f"{key}.jpg"
                cmd_poster = [
                    ffmpeg_path,
                    "-y",
                    "-ss",
                    "2.1",
                    "-i",
                    str(dest_video),
                    "-vframes",
                    "1",
                    "-q:v",
                    "4",  # JPEG quality ~80
                    str(dest_poster),
                ]
                subprocess.run(cmd_poster, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                if temp_720.is_file():
                    temp_720.unlink()

                # Also save style default alias {style_id}.mp4 and {style_id}.jpg for direct preview
                if anim_id == style_def.default_animation:
                    shutil.copyfile(dest_video, output_dir / f"{style_id}.mp4")
                    shutil.copyfile(dest_poster, output_dir / f"{style_id}.jpg")

                item_hash = compute_style_hash(style_def, anim_id)
                manifest["items"][key] = {
                    "style": style_id,
                    "animation": anim_id,
                    "video": f"{key}.mp4",
                    "poster": f"{key}.jpg",
                    "duration": 4.0,
                    "width": 360,
                    "height": 640,
                    "size_bytes": dest_video.stat().st_size,
                    "poster_size_bytes": dest_poster.stat().st_size,
                    "definition_hash": item_hash,
                }

    # Write manifest.json
    manifest_file = output_dir / "manifest.json"
    manifest_file.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    logger.info("Manifest written to: %s", manifest_file)

    # Check total size
    total_bytes = sum(f.stat().st_size for f in output_dir.glob("*") if f.is_file())
    total_mb = total_bytes / (1024 * 1024)
    logger.info("Total preview assets size: %.2f MB (%d bytes)", total_mb, total_bytes)

    if total_bytes > MAX_TOTAL_BYTES:
        raise RuntimeError(
            f"Preview assets total size ({total_mb:.2f} MB) exceeds maximum allowed limit of 10 MB!"
        )

    return manifest


if __name__ == "__main__":
    build_previews()


"""Tests verifying caption previews manifest and asset freshness."""

from __future__ import annotations

import json
from pathlib import Path
import pytest

from app.services.caption_styles import CAPTION_STYLES
from scripts.build_caption_previews import compute_style_hash, MAX_TOTAL_BYTES


def test_caption_previews_manifest_matches_registry():
    repo_root = Path(__file__).resolve().parent.parent.parent
    previews_dir = repo_root / "frontend" / "public" / "caption-previews"
    manifest_file = previews_dir / "manifest.json"

    if not manifest_file.is_file():
        pytest.fail(
            "Caption previews manifest missing; run backend/scripts/build_caption_previews.py"
        )

    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        pytest.fail(
            f"Invalid manifest.json ({error}); run backend/scripts/build_caption_previews.py"
        )

    items = manifest.get("items", {})

    total_bytes = 0
    for style_id, style_def in CAPTION_STYLES.items():
        for anim_id in style_def.allowed_animations:
            key = f"{style_id}__{anim_id}"
            if key not in items:
                pytest.fail(
                    f"Preview item '{key}' missing from manifest; run backend/scripts/build_caption_previews.py"
                )

            item = items[key]
            mp4_file = previews_dir / f"{key}.mp4"
            jpg_file = previews_dir / f"{key}.jpg"

            if not mp4_file.is_file() or mp4_file.stat().st_size == 0:
                pytest.fail(
                    f"Preview video '{mp4_file.name}' missing or empty; run backend/scripts/build_caption_previews.py"
                )
            if not jpg_file.is_file() or jpg_file.stat().st_size == 0:
                pytest.fail(
                    f"Preview poster '{jpg_file.name}' missing or empty; run backend/scripts/build_caption_previews.py"
                )

            expected_hash = compute_style_hash(style_def, anim_id)
            if item.get("definition_hash") != expected_hash:
                pytest.fail(
                    f"Preview '{key}' definition hash is stale; run backend/scripts/build_caption_previews.py"
                )

            total_bytes += mp4_file.stat().st_size + jpg_file.stat().st_size

        # Verify direct style preview files used by the UI
        style_mp4 = previews_dir / f"{style_id}.mp4"
        style_jpg = previews_dir / f"{style_id}.jpg"
        assert style_mp4.is_file() and style_mp4.stat().st_size > 0, (
            f"Style preview video '{style_mp4.name}' missing; run backend/scripts/build_caption_previews.py"
        )
        assert style_jpg.is_file() and style_jpg.stat().st_size > 0, (
            f"Style preview poster '{style_jpg.name}' missing; run backend/scripts/build_caption_previews.py"
        )
        total_bytes += style_mp4.stat().st_size + style_jpg.stat().st_size

    assert total_bytes < MAX_TOTAL_BYTES, (
        f"Preview assets total size ({total_bytes} bytes) exceeds 10 MB limit!"
    )


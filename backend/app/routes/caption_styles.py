"""Routes for caption styles and animations registry."""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter
from app.services.caption_styles import list_caption_styles

router = APIRouter(prefix="/api/caption-styles", tags=["caption-styles"])


@router.get("")
def get_caption_styles_endpoint() -> list[dict[str, Any]]:
    """Return the list of available caption styles and their allowed animations."""
    return list_caption_styles()


from typing import Any

from fastapi import APIRouter

from app.services.project_manager import list_projects

router = APIRouter(prefix="/api/projects")


@router.get("")
def get_projects() -> dict[str, list[dict[str, Any]]]:
    return {"projects": list_projects()}

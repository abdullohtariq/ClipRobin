import shutil
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services.project_manager import get_project_directory, list_projects

router = APIRouter(prefix="/api/projects")


@router.get("")
def get_projects() -> dict[str, list[dict[str, Any]]]:
    return {"projects": list_projects()}


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str) -> Response:
    try:
        project_directory = get_project_directory(project_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    shutil.rmtree(project_directory)
    return Response(status_code=204)

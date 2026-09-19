import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.routes.download import create_project_directory
from app.routes.transcription import TranscriptionResponse
from app.services.transcriber import transcribe_video

router = APIRouter(prefix="/api")
ALLOWED_EXTENSIONS = {".avi", ".mkv", ".mov", ".mp4", ".m4v", ".webm"}


@router.post("/local-video/transcribe", response_model=TranscriptionResponse)
def transcribe_local_video(video: UploadFile = File(...)) -> TranscriptionResponse:
    filename = Path(video.filename or "").name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video file type")

    project_id, project_directory = create_project_directory()
    source_path = project_directory / f"source{extension}"

    try:
        with source_path.open("wb") as destination:
            shutil.copyfileobj(video.file, destination)

        result = transcribe_video(source_path, project_directory / "transcription")
    except Exception as error:
        shutil.rmtree(project_directory, ignore_errors=True)
        raise HTTPException(status_code=502, detail="Local video transcription failed") from error
    finally:
        video.file.close()

    return TranscriptionResponse(
        project_id=project_id,
        status="transcribed",
        **result,
    )

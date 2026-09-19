import json
from pathlib import Path
from typing import Any

from app.services.mock_analyzer import create_mock_analysis
from app.services.video_editor import create_clip


def generate_clips(project_directory: Path) -> list[dict[str, Any]]:
    analysis_path = project_directory / "analysis.json"
    if not analysis_path.is_file():
        analysis = create_mock_analysis(project_directory)
    else:
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))

    source_files = list(project_directory.glob("source.*"))
    if not source_files:
        raise FileNotFoundError("Source video not found")
    source_path = source_files[0]
    clips_directory = project_directory / "clips"
    clips_directory.mkdir(exist_ok=True)

    generated = []
    for clip in analysis.get("clips", []):
        clip_id = clip["id"]
        output_path = clips_directory / f"{clip_id}.mp4"
        create_clip(source_path, output_path, clip["start"], clip["end"])
        generated.append({
            **clip,
            "duration": round(clip["end"] - clip["start"], 3),
            "file": output_path.name,
            "status": "ready",
        })
    return generated

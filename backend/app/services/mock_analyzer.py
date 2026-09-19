import json
from pathlib import Path
from typing import Any


def create_mock_analysis(project_directory: Path) -> dict[str, Any]:
    transcript_path = project_directory / "transcription" / "transcript.json"
    if not transcript_path.is_file():
        transcript_path = project_directory / "transcript.json"
    if not transcript_path.is_file():
        raise FileNotFoundError("Transcript not found")

    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    segments = transcript.get("segments", [])
    if not segments:
        raise ValueError("Transcript has no segments")

    clips = []
    for index in range(0, len(segments), 3):
        selected = segments[index:index + 3]
        clips.append({
            "id": f"clip_{len(clips) + 1:03d}",
            "title": selected[0]["text"][:80].strip(),
            "start": selected[0]["start"],
            "end": selected[-1]["end"],
            "reason": "Mock analysis: a timestamped group of transcript segments.",
        })

    analysis = {"clips": clips}
    (project_directory / "analysis.json").write_text(
        json.dumps(analysis, indent=2), encoding="utf-8"
    )
    return analysis

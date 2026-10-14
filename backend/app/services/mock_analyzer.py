import json
from pathlib import Path
from typing import Any

MIN_CLIP_SECONDS = 20.0
MAX_CLIP_SECONDS = 60.0


def _normalize_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for segment in segments:
        if not isinstance(segment, dict):
            raise ValueError("Transcript segments must be objects")

        start = segment.get("start")
        end = segment.get("end")
        text = segment.get("text")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise ValueError("Transcript segment timestamps must be numeric")
        if start < 0 or end <= start:
            raise ValueError("Transcript segment timestamps must be valid")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Transcript segment text must be non-empty")

        normalized.append({
            "start": float(start),
            "end": float(end),
            "text": text.strip(),
        })

    normalized.sort(key=lambda segment: segment["start"])
    previous_end = 0.0
    for segment in normalized:
        if segment["start"] < previous_end:
            segment["start"] = previous_end
            if segment["end"] <= segment["start"]:
                segment["end"] = segment["start"] + 0.05
        previous_end = segment["end"]

    return normalized


def create_mock_analysis(
    project_directory: Path,
    max_clip_seconds: float = MAX_CLIP_SECONDS,
) -> dict[str, Any]:
    transcript_path = project_directory / "transcription" / "transcript.json"
    if not transcript_path.is_file():
        transcript_path = project_directory / "transcript.json"
    if not transcript_path.is_file():
        raise FileNotFoundError("Transcript not found")

    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    if not isinstance(transcript, dict):
        raise ValueError("Transcript must contain a segments array")

    segments = _normalize_segments(transcript.get("segments", []))
    if not segments:
        raise ValueError("Transcript has no segments")

    clips = []
    index = 0
    while index < len(segments):
        start_index = index
        start_time = segments[start_index]["start"]
        index += 1

        while index < len(segments):
            candidate_end = segments[index]["end"]
            current_duration = candidate_end - start_time
            if current_duration > max_clip_seconds:
                break
            index += 1
            if current_duration >= max_clip_seconds:
                break

        selected = segments[start_index:index]
        remaining_duration = (
            segments[-1]["end"] - segments[index]["start"]
            if index < len(segments)
            else 0
        )
        if (
            index < len(segments)
            and remaining_duration < MIN_CLIP_SECONDS
            and segments[index - 1]["end"] - start_time + remaining_duration <= max_clip_seconds
        ):
            selected.extend(segments[index:])
            index = len(segments)

        clips.append({
            "id": f"clip_{len(clips) + 1:03d}",
            "title": " ".join(segment["text"] for segment in selected)[:80].strip(),
            "start": selected[0]["start"],
            "end": selected[-1]["end"],
            "reason": "Mock analysis: a longer self-contained group of timestamped transcript segments.",
        })

    analysis = {"clips": clips}
    (project_directory / "analysis.json").write_text(
        json.dumps(analysis, indent=2), encoding="utf-8"
    )
    return analysis

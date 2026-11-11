import json
import os
import threading
from pathlib import Path
from typing import Any

MIN_CLIP_SECONDS = 20.0
MAX_CLIP_SECONDS = 60.0
MOCK_ANALYZER_VERSION = 2


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


def _resolve_media_duration(project_directory: Path, transcript: dict[str, Any] | None = None) -> float:
    if isinstance(transcript, dict):
        try:
            d = float(transcript.get("duration") or transcript.get("covered_duration") or 0.0)
            if d > 0:
                return d
        except (TypeError, ValueError):
            pass
    meta_file = project_directory / "metadata.json"
    if meta_file.is_file():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            if isinstance(meta, dict):
                d = float(meta.get("duration") or 0.0)
                if d > 0:
                    return d
        except Exception:
            pass
    source_files = [
        p for p in project_directory.glob("source.*")
        if p.is_file() and not p.name.lower().endswith((".part", ".ytdl", ".json", ".txt", ".tmp"))
    ]
    if source_files:
        try:
            from app.services.video_editor import probe_video_duration
            return max(0.0, float(probe_video_duration(source_files[0]) or 0.0))
        except Exception:
            return 0.0
    return 0.0


def create_mock_analysis(
    project_directory: Path,
    max_clip_seconds: float = MAX_CLIP_SECONDS,
    max_clips: int | None = None,
    segments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    transcript: dict[str, Any] | None = None
    if segments is None:
        transcript_path = project_directory / "transcription" / "transcript.json"
        if not transcript_path.is_file():
            transcript_path = project_directory / "transcript.json"
        if not transcript_path.is_file():
            raise FileNotFoundError("Transcript not found")

        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
        if not isinstance(transcript, dict):
            raise ValueError("Transcript must contain a segments array")

        raw_segments = transcript.get("segments", [])
    else:
        raw_segments = segments

    normalized_segments = _normalize_segments(raw_segments)
    clips: list[dict[str, Any]] = []

    if not normalized_segments:
        duration = _resolve_media_duration(project_directory, transcript)
        if duration <= 0.5:
            raise ValueError("Transcript has no segments")
        cursor = 0.0
        step = max(4.0, float(max_clip_seconds))
        while cursor < duration - 0.5:
            if max_clips is not None and len(clips) >= max_clips:
                break
            clip_end = min(duration, cursor + step)
            if duration - clip_end < min(4.0, step * 0.25) and (duration - cursor) <= step * 1.15:
                clip_end = duration
            if clip_end - cursor < 1.0 and clips:
                break
            idx = len(clips) + 1
            clips.append({
                "id": f"clip_{idx:03d}",
                "title": f"Segment {idx} ({int(cursor)}s–{int(round(clip_end))}s)",
                "start": round(cursor, 3),
                "end": round(clip_end, 3),
                "selection_method": "time_slice",
                "reason": "Time-based slice (no detected speech track).",
            })
            cursor = clip_end
    else:
        index = 0
        effective_min_clip_seconds = min(MIN_CLIP_SECONDS, max_clip_seconds * 0.5)

        while index < len(normalized_segments):
            if max_clips is not None and len(clips) >= max_clips:
                break

            start_index = index
            start_time = normalized_segments[start_index]["start"]
            index += 1

            while index < len(normalized_segments):
                candidate_end = normalized_segments[index]["end"]
                current_duration = candidate_end - start_time
                if current_duration > max_clip_seconds:
                    break
                index += 1
                if current_duration >= max_clip_seconds:
                    break

            selected = normalized_segments[start_index:index]
            remaining_duration = (
                normalized_segments[-1]["end"] - normalized_segments[index]["start"]
                if index < len(normalized_segments)
                else 0
            )
            if (
                index < len(normalized_segments)
                and remaining_duration < effective_min_clip_seconds
                and normalized_segments[index - 1]["end"] - start_time + remaining_duration <= max_clip_seconds
            ):
                selected.extend(normalized_segments[index:])
                index = len(normalized_segments)

            clips.append({
                "id": f"clip_{len(clips) + 1:03d}",
                "title": " ".join(segment["text"] for segment in selected)[:80].strip(),
                "start": selected[0]["start"],
                "end": selected[-1]["end"],
                "selection_method": "interval",
                "reason": "Evenly spaced slice across transcript segments (Fast Interval).",
            })

    analysis: dict[str, Any] = {
        "analyzer_version": MOCK_ANALYZER_VERSION,
        "clips": clips,
    }
    output_path = project_directory / "analysis.json"
    tmp_path = project_directory / f"analysis.json.{os.getpid()}.{threading.get_ident()}.tmp"
    tmp_path.write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    os.replace(tmp_path, output_path)
    return analysis

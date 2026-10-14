import json
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable

from app.services.mock_analyzer import create_mock_analysis
from app.services.video_editor import ClipGenerationCancelled, VideoEditorError, create_clip

def _load_transcript_segments(project_directory: Path) -> list[dict[str, Any]]:
    transcript_path = project_directory / "transcription" / "transcript.json"
    if not transcript_path.is_file():
        transcript_path = project_directory / "transcript.json"
    if not transcript_path.is_file():
        return []

    try:
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if not isinstance(transcript, dict):
        return []

    segments = transcript.get("segments", [])
    if not isinstance(segments, list):
        return []

    valid_segments = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        start = segment.get("start")
        end = segment.get("end")
        text = segment.get("text")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        if not isinstance(text, str) or not text.strip():
            continue
        valid_segment: dict[str, Any] = {
            "start": float(start),
            "end": float(end),
            "text": text.strip(),
        }
        words = segment.get("words")
        if isinstance(words, list):
            valid_segment["words"] = [
                {
                    "start": float(word["start"]),
                    "end": float(word["end"]),
                    "text": word["text"].strip(),
                }
                for word in words
                if isinstance(word, dict)
                and isinstance(word.get("start"), (int, float))
                and isinstance(word.get("end"), (int, float))
                and isinstance(word.get("text"), str)
                and word["text"].strip()
            ]
        valid_segments.append(valid_segment)
    return sorted(valid_segments, key=lambda item: item["start"])


def generate_clips(
    project_directory: Path,
    show_subtitles: bool = True,
    show_watermark: bool = False,
    progress_callback: Callable[[str, int, int], None] | None = None,
    cancel_event: threading.Event | None = None,
    max_clip_seconds: float = 60.0,
) -> list[dict[str, Any]]:
    source_files = list(project_directory.glob("source.*"))
    if not source_files:
        raise FileNotFoundError("Source video not found")
    source_path = source_files[0]
    clips_directory = project_directory / "clips"
    clips_directory.mkdir(exist_ok=True)

    if progress_callback:
        progress_callback("Preparing clip analysis", 0, 0)
    analysis_path = project_directory / "analysis.json"
    analysis = None
    if analysis_path.is_file():
        try:
            loaded = json.loads(analysis_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            loaded = None
        if isinstance(loaded, dict):
            clips = loaded.get("clips", [])
            is_old_mock_analysis = any(
                isinstance(clip, dict) and clip.get("reason", "").startswith("Mock analysis:")
                for clip in clips
            )
            if clips and not is_old_mock_analysis:
                analysis = loaded
            else:
                analysis = None
    if not analysis:
        if progress_callback:
            progress_callback("Analyzing transcript", 0, 0)
        analysis = create_mock_analysis(project_directory, max_clip_seconds=max_clip_seconds)

    if cancel_event is not None and cancel_event.is_set():
        raise ClipGenerationCancelled("Clip generation was cancelled")
    transcript_segments = _load_transcript_segments(project_directory)
    generated = []
    analysis_clips = analysis.get("clips", [])
    if not analysis_clips:
        raise ValueError("Analysis contains no clips")
    if progress_callback:
        progress_callback("Rendering clips", 0, len(analysis_clips))

    with tempfile.TemporaryDirectory(prefix=".clips-staging-", dir=project_directory) as staging:
        staging_directory = Path(staging)
        staged_outputs: list[tuple[Path, dict[str, Any]]] = []
        for index, clip in enumerate(analysis_clips, start=1):
            if cancel_event is not None and cancel_event.is_set():
                raise ClipGenerationCancelled("Clip generation was cancelled")
            try:
                clip_id = clip.get("id") or f"clip_{index:03d}"
                output_path = staging_directory / f"{clip_id}.mp4"
                subtitle_segments = [
                    segment for segment in transcript_segments
                    if segment["end"] > clip["start"] and segment["start"] < clip["end"]
                ]
                create_clip(
                    source_path,
                    output_path,
                    clip["start"],
                    clip["end"],
                    subtitle_segments=subtitle_segments if show_subtitles else None,
                    show_subtitles=show_subtitles,
                    show_watermark=show_watermark,
                    cancel_event=cancel_event,
                )
                if cancel_event is not None and cancel_event.is_set():
                    raise ClipGenerationCancelled("Clip generation was cancelled")
                staged_outputs.append((output_path, {
                    **clip,
                    "id": clip_id,
                    "duration": round(clip["end"] - clip["start"], 3),
                    "file": output_path.name,
                    "status": "ready",
                }))
            except (KeyError, TypeError, ValueError, VideoEditorError) as error:
                raise VideoEditorError(f"Could not render clip {index} of {len(analysis_clips)}: {error}") from error
            if progress_callback:
                progress_callback("Rendering clips", index, len(analysis_clips))

        # Atomic commit: all clips rendered without error or cancellation!
        for existing_clip in clips_directory.glob("*.mp4"):
            try:
                existing_clip.unlink()
            except OSError:
                pass

        for staged_path, clip_metadata in staged_outputs:
            destination = clips_directory / staged_path.name
            shutil.move(str(staged_path), destination)
            generated.append(clip_metadata)

    if progress_callback:
        progress_callback("Finishing up", len(generated), len(generated))
    return generated

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any, Callable

from app.services.mock_analyzer import create_mock_analysis
from app.services.video_editor import VideoEditorError, create_clip

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
        valid_segments.append({
            "start": float(start),
            "end": float(end),
            "text": text.strip(),
        })
    return sorted(valid_segments, key=lambda item: item["start"])


def generate_clips(
    project_directory: Path,
    show_subtitles: bool = True,
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> list[dict[str, Any]]:
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
        analysis = create_mock_analysis(project_directory)

    source_files = list(project_directory.glob("source.*"))
    if not source_files:
        raise FileNotFoundError("Source video not found")
    source_path = source_files[0]
    clips_directory = project_directory / "clips"
    clips_directory.mkdir(exist_ok=True)
    transcript_segments = _load_transcript_segments(project_directory)
    generated = []
    analysis_clips = analysis.get("clips", [])
    if not analysis_clips:
        raise ValueError("Analysis contains no clips")
    if progress_callback:
        progress_callback("Rendering clips", 0, len(analysis_clips))

    with tempfile.TemporaryDirectory(prefix=".clips-staging-", dir=project_directory) as staging:
        staging_directory = Path(staging)
        replaced_previous_clips = False
        for index, clip in enumerate(analysis_clips, start=1):
            try:
                clip_id = clip["id"]
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
                )
                if not replaced_previous_clips:
                    for existing_clip in clips_directory.glob("*.mp4"):
                        existing_clip.unlink()
                    replaced_previous_clips = True
                shutil.move(str(output_path), clips_directory / output_path.name)
                generated.append({
                    **clip,
                    "duration": round(clip["end"] - clip["start"], 3),
                    "file": output_path.name,
                    "status": "ready",
                })
            except (KeyError, TypeError, ValueError, VideoEditorError) as error:
                raise VideoEditorError(f"Could not render clip {index} of {len(analysis_clips)}: {error}") from error
            if progress_callback:
                progress_callback("Rendering clips", index, len(analysis_clips))

    if progress_callback:
        progress_callback("Finishing up", len(generated), len(generated))
    return generated

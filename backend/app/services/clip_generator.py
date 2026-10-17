import json
import shutil
import tempfile
import threading
import uuid
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
    framing_mode: str | None = None,
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

    saved_options = analysis.get("generation_options", {}) if isinstance(analysis, dict) else {}
    if framing_mode is not None:
        use_framing_mode = framing_mode
    elif "framing_mode" in saved_options:
        use_framing_mode = str(saved_options["framing_mode"])
    else:
        use_framing_mode = "standard"

    analysis["generation_options"] = {
        "show_subtitles": show_subtitles,
        "show_watermark": show_watermark,
        "framing_mode": use_framing_mode,
    }
    analysis_path.write_text(json.dumps(analysis, indent=2), encoding="utf-8")

    if cancel_event is not None and cancel_event.is_set():
        raise ClipGenerationCancelled("Clip generation was cancelled")
    transcript_segments = _load_transcript_segments(project_directory)
    generated = []
    analysis_clips = analysis.get("clips", [])
    if not analysis_clips:
        raise ValueError("Analysis contains no clips")
    if progress_callback:
        progress_callback("Rendering clips", 0, len(analysis_clips))

    existing_clips = list(clips_directory.glob("*.mp4"))
    backup_directory: Path | None = None
    if existing_clips:
        backup_dir_path = project_directory / f".clips-backup-{uuid.uuid4().hex[:8]}"
        backup_dir_path.mkdir(exist_ok=True)
        for ec in existing_clips:
            shutil.move(str(ec), str(backup_dir_path / ec.name))
        backup_directory = backup_dir_path

    try:
        for index, clip in enumerate(analysis_clips, start=1):
            if cancel_event is not None and cancel_event.is_set():
                raise ClipGenerationCancelled("Clip generation was cancelled")
            clip_id = clip.get("id") or f"clip_{index:03d}"
            temp_output = clips_directory / f".rendering_{clip_id}.mp4"
            final_output = clips_directory / f"{clip_id}.mp4"
            try:
                subtitle_segments = [
                    segment for segment in transcript_segments
                    if segment["end"] > clip["start"] and segment["start"] < clip["end"]
                ]
                create_clip(
                    source_path,
                    temp_output,
                    clip["start"],
                    clip["end"],
                    subtitle_segments=subtitle_segments if show_subtitles else None,
                    show_subtitles=show_subtitles,
                    show_watermark=show_watermark,
                    top_line=clip.get("top_line"),
                    cancel_event=cancel_event,
                    framing_mode=use_framing_mode,
                )
                if cancel_event is not None and cancel_event.is_set():
                    if temp_output.is_file():
                        temp_output.unlink(missing_ok=True)
                    raise ClipGenerationCancelled("Clip generation was cancelled")

                # Move directly to final file so this clip appears immediately!
                if temp_output.is_file():
                    temp_output.replace(final_output)

                clip_metadata = {
                    **clip,
                    "id": clip_id,
                    "duration": round(clip["end"] - clip["start"], 3),
                    "file": final_output.name,
                    "top_line": clip.get("top_line", ""),
                    "framing_mode": use_framing_mode,
                    "status": "ready",
                }
                generated.append(clip_metadata)
            except (KeyError, TypeError, ValueError, VideoEditorError) as error:
                if temp_output.is_file():
                    temp_output.unlink(missing_ok=True)
                raise VideoEditorError(f"Could not render clip {index} of {len(analysis_clips)}: {error}") from error
            except Exception:
                if temp_output.is_file():
                    temp_output.unlink(missing_ok=True)
                raise

            if progress_callback:
                progress_callback("Rendering clips", index, len(analysis_clips), clip_metadata)

        # Success: clean up backup directory
        if backup_directory and backup_directory.is_dir():
            shutil.rmtree(backup_directory, ignore_errors=True)

    except Exception:
        # Clean up any partial rendering files
        for tmp in clips_directory.glob(".rendering_*.mp4"):
            try:
                tmp.unlink()
            except OSError:
                pass
        # If generation failed or was cancelled and we had backup clips, restore previous clips
        if backup_directory and backup_directory.is_dir():
            for ec in backup_directory.glob("*.mp4"):
                dest = clips_directory / ec.name
                if not dest.is_file():
                    try:
                        shutil.move(str(ec), str(dest))
                    except OSError:
                        pass
            shutil.rmtree(backup_directory, ignore_errors=True)
        raise

    if progress_callback:
        progress_callback("Finishing up", len(generated), len(generated))
    return generated


def render_single_clip(
    project_directory: Path,
    clip_id: str,
    top_line: str | None = None,
    show_subtitles: bool | None = None,
    show_watermark: bool | None = None,
    framing_mode: str | None = None,
) -> dict[str, Any]:
    source_files = list(project_directory.glob("source.*"))
    if not source_files:
        raise FileNotFoundError("Source video not found")
    source_path = source_files[0]

    analysis_path = project_directory / "analysis.json"
    if not analysis_path.is_file():
        raise FileNotFoundError("Analysis not found")
    try:
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError("Invalid analysis format") from error

    clips = analysis.get("clips", [])
    target_clip = next(
        (c for c in clips if c.get("id") == clip_id or f"{c.get('id')}.mp4" == clip_id),
        None,
    )
    if not target_clip:
        raise ValueError(f"Clip '{clip_id}' not found in project")

    cleaned_top_line: str | None = None
    if top_line is not None and top_line.strip():
        words = top_line.strip().split()
        if len(words) > 15:
            raise ValueError("Top line must be 15 words or fewer")
        cleaned_top_line = top_line.strip()

    saved_options = analysis.get("generation_options", {})
    if show_watermark is not None:
        use_watermark = show_watermark
    elif "show_watermark" in saved_options:
        use_watermark = bool(saved_options["show_watermark"])
    else:
        from app.services.video_editor import find_watermark_file
        use_watermark = find_watermark_file() is not None

    if show_subtitles is not None:
        use_subtitles = show_subtitles
    else:
        use_subtitles = saved_options.get("show_subtitles", True)

    if framing_mode is not None:
        use_framing_mode = framing_mode
    elif "framing_mode" in saved_options:
        use_framing_mode = str(saved_options["framing_mode"])
    else:
        use_framing_mode = "standard"

    if "generation_options" not in analysis:
        analysis["generation_options"] = {}
    analysis["generation_options"]["show_watermark"] = use_watermark
    analysis["generation_options"]["show_subtitles"] = use_subtitles
    analysis["generation_options"]["framing_mode"] = use_framing_mode

    transcript_segments = _load_transcript_segments(project_directory)
    subtitle_segments = [
        segment for segment in transcript_segments
        if segment["end"] > target_clip["start"] and segment["start"] < target_clip["end"]
    ]

    clips_directory = project_directory / "clips"
    clips_directory.mkdir(parents=True, exist_ok=True)
    actual_id = target_clip.get("id") or clip_id.replace(".mp4", "")
    final_output = clips_directory / f"{actual_id}.mp4"
    temp_output = clips_directory / f".rendering_{actual_id}_{uuid.uuid4().hex[:6]}.mp4"

    try:
        create_clip(
            source_path=source_path,
            output_path=temp_output,
            start_time=target_clip["start"],
            end_time=target_clip["end"],
            subtitle_segments=subtitle_segments if use_subtitles else None,
            show_subtitles=use_subtitles,
            show_watermark=use_watermark,
            top_line=cleaned_top_line,
            framing_mode=use_framing_mode,
        )
        if temp_output.is_file():
            temp_output.replace(final_output)
    finally:
        if temp_output.is_file():
            temp_output.unlink(missing_ok=True)

    target_clip["top_line"] = cleaned_top_line or ""
    analysis_path.write_text(json.dumps(analysis, indent=2), encoding="utf-8")

    return {
        **target_clip,
        "id": actual_id,
        "duration": round(target_clip["end"] - target_clip["start"], 3),
        "file": final_output.name,
        "top_line": cleaned_top_line or "",
        "framing_mode": use_framing_mode,
        "status": "ready",
    }

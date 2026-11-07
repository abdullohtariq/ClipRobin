import json
import logging
import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Callable

from app.services.mock_analyzer import create_mock_analysis
from app.services.video_editor import ClipGenerationCancelled, VideoEditorError, create_clip

logger = logging.getLogger(__name__)


def _atomic_write_json(target_path: Path, data: dict[str, Any]) -> None:
    tmp_path = target_path.with_name(
        f"{target_path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp_path, target_path)


def _clip_version_token(path: Path) -> str:
    try:
        st = path.stat()
        return f"{st.st_mtime_ns}_{st.st_size}"
    except OSError:
        return uuid.uuid4().hex[:12]


def _find_project_transcript_path(project_directory: Path) -> Path | None:
    for candidate in (
        project_directory / "transcription" / "transcript.json",
        project_directory / "transcript.json",
    ):
        if candidate.is_file():
            return candidate
    return None


def _is_transcript_usable(transcript_path: Path, required_duration: float | None) -> bool:
    if not transcript_path.is_file():
        return False
    try:
        data = json.loads(transcript_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(data, dict) or not isinstance(data.get("segments"), list):
        return False
    if data.get("is_complete", True):
        return True
    if required_duration is None:
        return False
    try:
        covered = float(data.get("covered_duration", 0.0) or 0.0)
    except (TypeError, ValueError):
        return False
    return covered >= max(0.0, required_duration - 0.5)


def _load_transcript_language(project_directory: Path) -> str | None:
    transcript_path = _find_project_transcript_path(project_directory)
    if transcript_path is None:
        return None
    try:
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(transcript, dict):
        return None
    lang = transcript.get("language")
    return str(lang).strip() if isinstance(lang, str) and lang.strip() else None


def _load_transcript_segments(project_directory: Path) -> list[dict[str, Any]]:
    transcript_path = _find_project_transcript_path(project_directory)
    if transcript_path is None:
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
    progress_callback: Callable[..., None] | None = None,
    cancel_event: threading.Event | None = None,
    max_clip_seconds: float = 30.0,
    requested_clip_count: int | None = None,
    generation_mode: str = "random",
    framing_mode: str | None = None,
    caption_style: str | None = None,
    caption_animation: str | None = None,
    face_tracking: bool | None = None,
) -> list[dict[str, Any]]:
    source_files = [
        p for p in project_directory.glob("source.*")
        if p.is_file() and not p.name.lower().endswith((".part", ".ytdl", ".json", ".txt", ".tmp"))
    ]
    if not source_files:
        raise FileNotFoundError("Source video not found")
    source_path = source_files[0]
    clips_directory = project_directory / "clips"
    clips_directory.mkdir(exist_ok=True)

    if progress_callback:
        progress_callback("Preparing clip analysis", 0, 0)
    analysis_path = project_directory / "analysis.json"
    analysis = None
    existing_top_lines: dict[tuple[float, float], str] = {}
    if analysis_path.is_file():
        try:
            loaded = json.loads(analysis_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            loaded = None
        if isinstance(loaded, dict):
            clips = loaded.get("clips", [])
            for existing_clip in clips:
                if isinstance(existing_clip, dict) and existing_clip.get("top_line"):
                    try:
                        key = (
                            round(float(existing_clip["start"]), 1),
                            round(float(existing_clip["end"]), 1),
                        )
                        existing_top_lines[key] = str(existing_clip["top_line"])
                    except (KeyError, TypeError, ValueError):
                        pass
            loaded_options = (
                loaded.get("generation_options", {})
                if isinstance(loaded.get("generation_options"), dict)
                else {}
            )
            is_old_mock_analysis = (
                any(
                    isinstance(clip, dict) and str(clip.get("reason", "")).startswith("Mock analysis:")
                    for clip in clips
                )
                and int(loaded.get("analyzer_version", 0) or 0) < 2
                and "clip_duration_seconds" not in loaded_options
            )
            saved_mode = loaded_options.get("generation_mode", "random")
            mode_mismatch = saved_mode != generation_mode
            saved_duration = loaded_options.get("clip_duration_seconds")
            duration_mismatch = (
                saved_duration is not None and int(saved_duration) != int(max_clip_seconds)
            )
            count_insufficient = (
                requested_clip_count is not None
                and loaded_options.get("clip_count") is not None
                and len(clips) < requested_clip_count
            )
            if (
                clips
                and not is_old_mock_analysis
                and not duration_mismatch
                and not count_insufficient
                and not mode_mismatch
            ):
                analysis = loaded
                # Ensure any abnormally short teaser fragment (< 14s) in cached analysis is expanded
                if any(
                    isinstance(c, dict)
                    and isinstance(c.get("start"), (int, float))
                    and isinstance(c.get("end"), (int, float))
                    and (float(c["end"]) - float(c["start"])) < 14.0
                    for c in clips
                ):
                    segs = _load_transcript_segments(project_directory)
                    if segs:
                        from app.services.ai_analyzer import _relocate_and_expand_clip_bounds
                        for c in clips:
                            if isinstance(c, dict) and isinstance(c.get("start"), (int, float)) and isinstance(c.get("end"), (int, float)):
                                s_val, e_val = _relocate_and_expand_clip_bounds(
                                    float(c["start"]),
                                    float(c["end"]),
                                    segs,
                                    max_clip_seconds=int(max_clip_seconds),
                                )
                                c["start"] = s_val
                                c["end"] = e_val
            else:
                analysis = None
    if not analysis:
        target_count = requested_clip_count or 10
        required_max_duration = (
            None if generation_mode == "ai" else (target_count * max_clip_seconds * 1.15)
        )
        # Check if a usable transcript exists or can be reused from an identical source video
        transcript_candidates = [
            project_directory / "transcription" / "transcript.json",
            project_directory / "transcript.json",
        ]
        has_transcript = any(
            _is_transcript_usable(t, required_max_duration) for t in transcript_candidates
        )
        if not has_transcript:
            source_candidates = [
                project_directory / f"source{ext}"
                for ext in [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]
            ]
            source_video = next((p for p in source_candidates if p.is_file()), source_path)
            if source_video and source_video.is_file():
                reused_transcript = False
                source_size = source_video.stat().st_size
                projects_parent = project_directory.parent
                if projects_parent.is_dir():
                    for other_proj in projects_parent.glob("project_*"):
                        if other_proj == project_directory:
                            continue
                        other_t = other_proj / "transcription" / "transcript.json"
                        if not other_t.is_file():
                            other_t = other_proj / "transcript.json"
                        if _is_transcript_usable(other_t, required_max_duration):
                            other_src = next(
                                (
                                    other_proj / f"source{ext}"
                                    for ext in [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]
                                    if (other_proj / f"source{ext}").is_file()
                                ),
                                None,
                            )
                            if other_src and other_src.stat().st_size == source_size:
                                import hashlib
                                with source_video.open("rb") as f1, other_src.open("rb") as f2:
                                    if hashlib.md5(f1.read(1024 * 1024)).hexdigest() == hashlib.md5(f2.read(1024 * 1024)).hexdigest():
                                        target_t_dir = project_directory / "transcription"
                                        target_t_dir.mkdir(parents=True, exist_ok=True)
                                        shutil.copy2(str(other_t), str(target_t_dir / "transcript.json"))
                                        other_txt = other_t.parent / "transcript.txt"
                                        if other_txt.is_file():
                                            shutil.copy2(str(other_txt), str(target_t_dir / "transcript.txt"))
                                        reused_transcript = True
                                        break
                if not reused_transcript:
                    from app.services.transcriber import transcribe_video
                    if progress_callback:
                        progress_callback("Transcribing video audio...", 0, 0)
                    def report_transcription(step_name: str, pct: float) -> None:
                        if progress_callback:
                            progress_callback(f"Transcribing audio ({round(pct)}%)", 0, 0)
                    transcribe_video(
                        source_video,
                        project_directory / "transcription",
                        progress_callback=report_transcription,
                        cancel_event=cancel_event,
                        max_duration=required_max_duration,
                    )

        if cancel_event is not None and cancel_event.is_set():
            raise ClipGenerationCancelled("Clip generation was cancelled")

        if progress_callback:
            progress_callback("Analyzing transcript", 0, 0)
        if generation_mode == "ai":
            from app.services.ai_analyzer import analyze_transcript

            transcript_path = _find_project_transcript_path(project_directory)
            if transcript_path is None:
                raise FileNotFoundError("Transcript not found for AI analysis")
            transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
            try:
                analysis = analyze_transcript(
                    transcript,
                    provider="gemini",
                    max_clip_seconds=int(max_clip_seconds),
                    max_clips=requested_clip_count,
                )
            except Exception as e:
                logger.warning("Gemini AI analysis failed after retries (%s); falling back to heuristic clip generator", e)
                analysis = create_mock_analysis(
                    project_directory,
                    max_clip_seconds=max_clip_seconds,
                    max_clips=requested_clip_count,
                )
        else:
            analysis = create_mock_analysis(
                project_directory,
                max_clip_seconds=max_clip_seconds,
                max_clips=requested_clip_count,
            )

        if existing_top_lines and isinstance(analysis, dict):
            for new_clip in analysis.get("clips", []):
                if isinstance(new_clip, dict) and not new_clip.get("top_line"):
                    try:
                        key = (
                            round(float(new_clip["start"]), 1),
                            round(float(new_clip["end"]), 1),
                        )
                        if key in existing_top_lines:
                            new_clip["top_line"] = existing_top_lines[key]
                    except (KeyError, TypeError, ValueError):
                        pass

    saved_options = analysis.get("generation_options", {}) if isinstance(analysis, dict) else {}
    if framing_mode is not None:
        use_framing_mode = framing_mode
    elif "framing_mode" in saved_options:
        use_framing_mode = str(saved_options["framing_mode"])
    else:
        use_framing_mode = "standard"

    if caption_style is not None:
        use_caption_style = caption_style
    elif "caption_style" in saved_options:
        use_caption_style = str(saved_options["caption_style"])
    else:
        use_caption_style = "classic"

    if caption_animation is not None:
        use_caption_animation = caption_animation
    elif "caption_animation" in saved_options and saved_options["caption_animation"] is not None:
        use_caption_animation = str(saved_options["caption_animation"])
    else:
        use_caption_animation = None

    if face_tracking is not None:
        use_face_tracking = face_tracking
    elif "face_tracking" in saved_options:
        use_face_tracking = bool(saved_options["face_tracking"])
    else:
        use_face_tracking = True

    analysis["generation_options"] = {
        "generation_mode": generation_mode,
        "show_subtitles": show_subtitles,
        "show_watermark": show_watermark,
        "framing_mode": use_framing_mode,
        "caption_style": use_caption_style,
        "caption_animation": use_caption_animation,
        "face_tracking": use_face_tracking,
        "clip_duration_seconds": int(max_clip_seconds),
        "clip_count": requested_clip_count,
    }
    _atomic_write_json(analysis_path, analysis)

    if cancel_event is not None and cancel_event.is_set():
        raise ClipGenerationCancelled("Clip generation was cancelled")
    transcript_segments = _load_transcript_segments(project_directory)
    transcript_language = _load_transcript_language(project_directory)
    generated = []
    analysis_clips = analysis.get("clips", [])
    if requested_clip_count is not None and len(analysis_clips) > requested_clip_count:
        analysis_clips = analysis_clips[:requested_clip_count]
    if not analysis_clips:
        raise ValueError("Analysis contains no clips")
    # If True 9:16 is requested, run speaker tracking analysis with live progress BEFORE rendering
    if use_framing_mode == "true_9_16":
        from app.services.smart_framing import analyze_speaker_tracking
        from app.services.video_editor import find_ffmpeg
        if progress_callback:
            progress_callback("Analyzing speaker tracking (True 9:16): 0%", 0, len(analysis_clips))

        def track_progress(step_str: str, cur_f: int, tot_f: int) -> None:
            if progress_callback:
                progress_callback(step_str, 0, len(analysis_clips))

        max_tracking_duration = max((c.get("end", 0.0) for c in analysis_clips), default=100.0) + 1.0
        analyze_speaker_tracking(
            project_directory=project_directory,
            ffmpeg_path=find_ffmpeg(),
            cancel_event=cancel_event,
            progress_callback=track_progress,
            max_duration=max_tracking_duration,
            face_tracking=use_face_tracking,
        )

    if progress_callback:
        progress_callback("Rendering clips", 0, len(analysis_clips))

    existing_clips = [p for p in clips_directory.glob("*.mp4") if not p.name.startswith(".")]
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
                render_kwargs: dict[str, Any] = {
                    "subtitle_segments": subtitle_segments if show_subtitles else None,
                    "show_subtitles": show_subtitles,
                    "show_watermark": show_watermark,
                    "top_line": clip.get("top_line"),
                    "cancel_event": cancel_event,
                    "framing_mode": use_framing_mode,
                    "caption_style": use_caption_style,
                    "caption_animation": use_caption_animation,
                    "face_tracking": use_face_tracking,
                }
                if transcript_language:
                    render_kwargs["language"] = transcript_language
                create_clip(
                    source_path,
                    temp_output,
                    clip["start"],
                    clip["end"],
                    **render_kwargs,
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
                    "v": _clip_version_token(final_output),
                    "top_line": clip.get("top_line", ""),
                    "framing_mode": use_framing_mode,
                    "caption_style": use_caption_style,
                    "caption_animation": use_caption_animation,
                    "face_tracking": use_face_tracking,
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
    caption_style: str | None = None,
    caption_animation: str | None = None,
    face_tracking: bool | None = None,
) -> dict[str, Any]:
    source_files = [
        p for p in project_directory.glob("source.*")
        if p.is_file() and not p.name.lower().endswith((".part", ".ytdl", ".json", ".txt", ".tmp"))
    ]
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
    elif target_clip.get("framing_mode"):
        use_framing_mode = str(target_clip["framing_mode"])
    elif "framing_mode" in saved_options:
        use_framing_mode = str(saved_options["framing_mode"])
    else:
        use_framing_mode = "standard"

    if caption_style is not None:
        use_caption_style = caption_style
    elif target_clip.get("caption_style"):
        use_caption_style = str(target_clip["caption_style"])
    elif "caption_style" in saved_options:
        use_caption_style = str(saved_options["caption_style"])
    else:
        use_caption_style = "classic"

    if caption_animation is not None:
        use_caption_animation = caption_animation
    elif target_clip.get("caption_animation"):
        use_caption_animation = str(target_clip["caption_animation"])
    elif "caption_animation" in saved_options and saved_options["caption_animation"] is not None:
        use_caption_animation = str(saved_options["caption_animation"])
    else:
        use_caption_animation = None

    if face_tracking is not None:
        use_face_tracking = face_tracking
    elif "face_tracking" in target_clip:
        use_face_tracking = bool(target_clip["face_tracking"])
    elif "face_tracking" in saved_options:
        use_face_tracking = bool(saved_options["face_tracking"])
    else:
        use_face_tracking = True

    if "generation_options" not in analysis:
        analysis["generation_options"] = {}
    analysis["generation_options"]["show_watermark"] = use_watermark
    analysis["generation_options"]["show_subtitles"] = use_subtitles
    analysis["generation_options"]["framing_mode"] = use_framing_mode
    analysis["generation_options"]["caption_style"] = use_caption_style
    analysis["generation_options"]["caption_animation"] = use_caption_animation
    analysis["generation_options"]["face_tracking"] = use_face_tracking

    transcript_segments = _load_transcript_segments(project_directory)
    transcript_language = _load_transcript_language(project_directory)
    subtitle_segments = [
        segment for segment in transcript_segments
        if segment["end"] > target_clip["start"] and segment["start"] < target_clip["end"]
    ]

    clips_directory = project_directory / "clips"
    clips_directory.mkdir(parents=True, exist_ok=True)
    actual_id = target_clip.get("id") or clip_id.replace(".mp4", "")
    final_output = clips_directory / f"{actual_id}.mp4"
    temp_output = clips_directory / f".rendering_{actual_id}_{uuid.uuid4().hex[:6]}.mp4"

    render_kwargs: dict[str, Any] = {
        "source_path": source_path,
        "output_path": temp_output,
        "start_time": target_clip["start"],
        "end_time": target_clip["end"],
        "subtitle_segments": subtitle_segments if use_subtitles else None,
        "show_subtitles": use_subtitles,
        "show_watermark": use_watermark,
        "top_line": cleaned_top_line,
        "framing_mode": use_framing_mode,
        "caption_style": use_caption_style,
        "caption_animation": use_caption_animation,
        "face_tracking": use_face_tracking,
    }
    if transcript_language:
        render_kwargs["language"] = transcript_language

    try:
        create_clip(**render_kwargs)
        if temp_output.is_file():
            temp_output.replace(final_output)
    finally:
        if temp_output.is_file():
            temp_output.unlink(missing_ok=True)

    target_clip["top_line"] = cleaned_top_line or ""
    target_clip["framing_mode"] = use_framing_mode
    target_clip["caption_style"] = use_caption_style
    target_clip["caption_animation"] = use_caption_animation
    target_clip["face_tracking"] = use_face_tracking
    _atomic_write_json(analysis_path, analysis)

    return {
        **target_clip,
        "id": actual_id,
        "duration": round(target_clip["end"] - target_clip["start"], 3),
        "file": final_output.name,
        "v": _clip_version_token(final_output),
        "top_line": cleaned_top_line or "",
        "framing_mode": use_framing_mode,
        "caption_style": use_caption_style,
        "caption_animation": use_caption_animation,
        "face_tracking": use_face_tracking,
        "status": "ready",
    }

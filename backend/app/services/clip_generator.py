import json
import logging
import os
import re
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Callable

from app.services.ai_analyzer import is_safe_clip_id
from app.services.mock_analyzer import create_mock_analysis
from app.services.video_editor import ClipGenerationCancelled, VideoEditorError, create_clip, probe_video_duration

logger = logging.getLogger(__name__)
_PROJECT_WRITE_LOCKS: dict[str, threading.Lock] = {}
_PROJECT_WRITE_LOCKS_GUARD = threading.Lock()


def _get_project_write_lock(project_directory: Path) -> threading.Lock:
    key = str(project_directory.resolve())
    with _PROJECT_WRITE_LOCKS_GUARD:
        return _PROJECT_WRITE_LOCKS.setdefault(key, threading.Lock())


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


def _ensure_contained_path(base_directory: Path, target_path: Path) -> Path:
    base_resolved = base_directory.resolve()
    target_resolved = target_path.resolve()
    if not target_resolved.is_relative_to(base_resolved) or target_resolved == base_resolved:
        raise ValueError(f"Output path '{target_path}' escapes target directory '{base_directory}'")
    return target_resolved


def _allocate_safe_clip_ids(clips: list[Any]) -> list[dict[str, Any]]:
    """Ensure every clip entry uses a unique filesystem-safe ID; preserve safe non-duplicate IDs."""
    used_ids: set[str] = set()
    allocated: list[dict[str, Any]] = []
    next_seq = 1
    for raw_clip in clips:
        if not isinstance(raw_clip, dict):
            continue
        clip = dict(raw_clip)
        raw_id = clip.get("id")
        if is_safe_clip_id(raw_id) and raw_id not in used_ids:
            safe_id = str(raw_id)
        else:
            while f"clip_{next_seq:03d}" in used_ids:
                next_seq += 1
            safe_id = f"clip_{next_seq:03d}"
            next_seq += 1
            if isinstance(raw_id, str) and raw_id.strip() and not clip.get("provider_id"):
                clip["provider_id"] = raw_id.strip()
        used_ids.add(safe_id)
        clip["id"] = safe_id
        allocated.append(clip)
    return allocated


def _bounded_fallback_reason(error: Exception) -> str:
    raw = str(error or error.__class__.__name__).strip()
    # Strip query strings or key parameters if an HTTP exception slipped through
    raw = re.sub(r"\?key=[^\s&'\"]+", "?key=[redacted]", raw)
    if len(raw) > 220:
        raw = raw[:217].rstrip() + "..."
    return f"{raw} (used Fast Interval selection instead)"


def recover_project_generation_state(
    project_directory: Path,
    active_stage_ids: set[str] | None = None,
) -> None:
    """Restore any interrupted atomic commit and prune stale staging directories."""
    if not project_directory.is_dir():
        return
    with _get_project_write_lock(project_directory):
        active = active_stage_ids or set()
        clips_directory = project_directory / "clips"
        analysis_path = project_directory / "analysis.json"

        for manifest_path in sorted(project_directory.glob(".commit_manifest_*.json")):
            stage_id = manifest_path.stem[len(".commit_manifest_"):]
            if stage_id in active:
                continue
            backup_dir = project_directory / f".commit_backup_{stage_id}"
            staging_dir = project_directory / f".staging_{stage_id}"
            state = "unknown"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if isinstance(manifest, dict):
                    state = str(manifest.get("state", "unknown"))
            except Exception:
                state = "unknown"

            if state != "committed" and backup_dir.is_dir():
                backup_clips = backup_dir / "clips"
                if backup_clips.is_dir():
                    clips_directory.mkdir(exist_ok=True)
                    # Remove any half-swapped uncommitted MP4s before restoring previous committed set
                    for existing_mp4 in clips_directory.glob("*.mp4"):
                        existing_mp4.unlink(missing_ok=True)
                    for old_mp4 in backup_clips.glob("*.mp4"):
                        target = _ensure_contained_path(clips_directory, clips_directory / old_mp4.name)
                        shutil.move(str(old_mp4), str(target))
                backup_analysis = backup_dir / "analysis.json"
                if backup_analysis.is_file():
                    tmp_restore = project_directory / f".restore_analysis.{os.getpid()}.tmp"
                    shutil.copyfile(str(backup_analysis), str(tmp_restore))
                    os.replace(tmp_restore, analysis_path)

            manifest_path.unlink(missing_ok=True)
            if backup_dir.is_dir():
                shutil.rmtree(backup_dir, ignore_errors=True)
            if staging_dir.is_dir():
                shutil.rmtree(staging_dir, ignore_errors=True)

        for snapshot_path in sorted(project_directory.glob(".regeneration_snapshot_*.json")):
            stage_id = snapshot_path.stem[len(".regeneration_snapshot_"):]
            if stage_id in active:
                continue
            try:
                snap = json.loads(snapshot_path.read_text(encoding="utf-8"))
                if isinstance(snap, dict):
                    if snap.get("had_analysis") and isinstance(snap.get("raw"), str):
                        tmp_restore = project_directory / f".restore_snap.{os.getpid()}.tmp"
                        tmp_restore.write_text(snap["raw"], encoding="utf-8")
                        os.replace(tmp_restore, analysis_path)
                    elif snap.get("had_analysis") is False and analysis_path.is_file():
                        analysis_path.unlink(missing_ok=True)
            except Exception:
                pass
            snapshot_path.unlink(missing_ok=True)

        for staging_dir in project_directory.glob(".staging_*"):
            if not staging_dir.is_dir():
                continue
            stage_id = staging_dir.name[len(".staging_"):]
            if stage_id not in active:
                shutil.rmtree(staging_dir, ignore_errors=True)

        for backup_dir in project_directory.glob(".commit_backup_*"):
            if not backup_dir.is_dir():
                continue
            stage_id = backup_dir.name[len(".commit_backup_"):]
            if stage_id not in active:
                shutil.rmtree(backup_dir, ignore_errors=True)


def cleanup_staged_job(project_directory: Path, job_id: str) -> None:
    safe_job_id = re.sub(r"[^A-Za-z0-9_-]", "", job_id or "")
    if not safe_job_id:
        return
    staging_dir = project_directory / f".staging_{safe_job_id}"
    if staging_dir.is_dir():
        shutil.rmtree(staging_dir, ignore_errors=True)
    snap_path = project_directory / f".regeneration_snapshot_{safe_job_id}.json"
    snap_path.unlink(missing_ok=True)


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
    job_id: str | None = None,
    tracking_mode: str | None = None,
    crop_anchor_x: float | None = None,
    hosted_hook_token: str | None = None,
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

    stage_id = re.sub(r"[^A-Za-z0-9_-]", "", job_id or "") or uuid.uuid4().hex[:12]
    recover_project_generation_state(project_directory, active_stage_ids={stage_id})
    staging_directory = project_directory / f".staging_{stage_id}"
    staging_directory.mkdir(parents=True, exist_ok=True)
    snapshot_path = project_directory / f".regeneration_snapshot_{stage_id}.json"

    if progress_callback:
        progress_callback("Preparing clip analysis", 0, 0)
    analysis_path = project_directory / "analysis.json"
    prior_analysis_raw: str | None = None
    if analysis_path.is_file():
        try:
            prior_analysis_raw = analysis_path.read_text(encoding="utf-8")
        except OSError:
            prior_analysis_raw = None

    def _restore_prior_analysis() -> None:
        if prior_analysis_raw is not None:
            tmp_r = project_directory / f".restore.{os.getpid()}.{threading.get_ident()}.tmp"
            try:
                tmp_r.write_text(prior_analysis_raw, encoding="utf-8")
                os.replace(tmp_r, analysis_path)
            except OSError:
                tmp_r.unlink(missing_ok=True)
        else:
            analysis_path.unlink(missing_ok=True)

    analysis: dict[str, Any] | None = None
    existing_top_lines: dict[tuple[float, float], str] = {}
    existing_top_lines_by_id: dict[str, str] = {}
    if prior_analysis_raw is not None:
        try:
            loaded = json.loads(prior_analysis_raw)
        except json.JSONDecodeError:
            loaded = None
        if isinstance(loaded, dict):
            clips = loaded.get("clips", [])
            for existing_clip in clips:
                if isinstance(existing_clip, dict) and existing_clip.get("top_line"):
                    if is_safe_clip_id(existing_clip.get("id")):
                        existing_top_lines_by_id[str(existing_clip["id"])] = str(existing_clip["top_line"])
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
            saved_applied_mode = loaded_options.get(
                "applied_generation_mode",
                loaded_options.get("generation_mode", "random"),
            )
            mode_mismatch = saved_applied_mode != generation_mode
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

    requested_generation_mode = generation_mode
    applied_generation_mode = (
        str(analysis.get("generation_options", {}).get("applied_generation_mode") or analysis.get("generation_options", {}).get("generation_mode") or generation_mode)
        if analysis
        else generation_mode
    )
    ai_provider: str | None = (
        str(analysis.get("generation_options", {}).get("ai_provider"))
        if analysis and analysis.get("generation_options", {}).get("ai_provider")
        else None
    )
    ai_model: str | None = (
        str(analysis.get("generation_options", {}).get("ai_model"))
        if analysis and analysis.get("generation_options", {}).get("ai_model")
        else None
    )
    ai_fallback_reason: str | None = None

    try:
        if not analysis:
            _atomic_write_json(
                snapshot_path,
                {
                    "had_analysis": prior_analysis_raw is not None,
                    "raw": prior_analysis_raw,
                },
            )
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
                from app.services.ai_analyzer import analyze_included_hooks, analyze_transcript

                transcript_path = _find_project_transcript_path(project_directory)
                if transcript_path is None:
                    raise FileNotFoundError("Transcript not found for AI analysis")
                transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
                has_segments = bool(isinstance(transcript, dict) and transcript.get("segments"))
                if not has_segments:
                    applied_generation_mode = "random"
                    ai_fallback_reason = "No speech segments in source video; used time-based slicing instead."
                    analysis = create_mock_analysis(
                        project_directory,
                        max_clip_seconds=max_clip_seconds,
                        max_clips=requested_clip_count,
                    )
                    _restore_prior_analysis()
                else:
                    try:
                        if hosted_hook_token:
                            analysis = analyze_included_hooks(
                                transcript, hosted_hook_token, probe_video_duration(source_path),
                                int(max_clip_seconds), requested_clip_count or 10,
                            )
                        else:
                            analysis = analyze_transcript(
                                transcript,
                                provider="gemini",
                                max_clip_seconds=int(max_clip_seconds),
                                max_clips=requested_clip_count,
                            )
                        applied_generation_mode = "ai"
                        ai_provider = str(analysis.get("provider") or "gemini")
                        ai_model = str(analysis.get("model") or os.getenv("GEMINI_MODEL") or "gemini-3.5-flash-lite")
                        ai_fallback_reason = None
                    except Exception as error:
                        logger.warning(
                            "Gemini AI analysis failed (%s); falling back to Fast Interval clip selection",
                            error.__class__.__name__,
                        )
                        applied_generation_mode = "random"
                        ai_provider = None
                        ai_model = None
                        ai_fallback_reason = _bounded_fallback_reason(error)
                        analysis = create_mock_analysis(
                            project_directory,
                            max_clip_seconds=max_clip_seconds,
                            max_clips=requested_clip_count,
                        )
                        _restore_prior_analysis()
            else:
                applied_generation_mode = "random"
                analysis = create_mock_analysis(
                    project_directory,
                    max_clip_seconds=max_clip_seconds,
                    max_clips=requested_clip_count,
                )
                _restore_prior_analysis()

            if existing_top_lines or existing_top_lines_by_id:
                if isinstance(analysis, dict):
                    for new_clip in analysis.get("clips", []):
                        if isinstance(new_clip, dict) and not new_clip.get("top_line"):
                            cid = str(new_clip.get("id") or "")
                            try:
                                key = (
                                    round(float(new_clip["start"]), 1),
                                    round(float(new_clip["end"]), 1),
                                )
                                if key in existing_top_lines:
                                    new_clip["top_line"] = existing_top_lines[key]
                                    continue
                            except (KeyError, TypeError, ValueError):
                                pass
                            if cid and cid in existing_top_lines_by_id and not existing_top_lines:
                                new_clip["top_line"] = existing_top_lines_by_id[cid]

        # Treat all clip entries (from AI OR cache) as untrusted and allocate/enforce safe local IDs
        raw_analysis_clips = analysis.get("clips", []) if isinstance(analysis, dict) else []
        safe_clips = _allocate_safe_clip_ids(raw_analysis_clips)
        if applied_generation_mode != "ai":
            for c in safe_clips:
                c.pop("score", None)
                c.setdefault("selection_method", "interval")
        else:
            for c in safe_clips:
                c.setdefault("selection_method", "ai")
        analysis["clips"] = safe_clips

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

        if tracking_mode is not None and tracking_mode in {"locked", "cuts", "follow"}:
            use_tracking_mode = tracking_mode
            use_face_tracking = use_tracking_mode == "follow"
        elif face_tracking is not None:
            use_face_tracking = bool(face_tracking)
            use_tracking_mode = "follow" if use_face_tracking else "locked"
        elif "tracking_mode" in saved_options and saved_options["tracking_mode"] in {"locked", "cuts", "follow"}:
            use_tracking_mode = str(saved_options["tracking_mode"])
            use_face_tracking = use_tracking_mode == "follow"
        elif "face_tracking" in saved_options:
            use_face_tracking = bool(saved_options["face_tracking"])
            use_tracking_mode = "follow" if use_face_tracking else "locked"
        else:
            use_tracking_mode = "locked"
            use_face_tracking = False

        if crop_anchor_x is not None:
            use_crop_anchor_x = max(0.0, min(1.0, float(crop_anchor_x)))
        elif "crop_anchor_x" in saved_options:
            try:
                use_crop_anchor_x = max(0.0, min(1.0, float(saved_options["crop_anchor_x"])))
            except (TypeError, ValueError):
                use_crop_anchor_x = 0.5
        else:
            use_crop_anchor_x = 0.5

        generation_options_payload: dict[str, Any] = {
            "generation_mode": applied_generation_mode,
            "requested_generation_mode": requested_generation_mode,
            "applied_generation_mode": applied_generation_mode,
            "ai_provider": ai_provider,
            "ai_model": ai_model,
            "ai_fallback_reason": ai_fallback_reason,
            "show_subtitles": show_subtitles,
            "show_watermark": show_watermark,
            "framing_mode": use_framing_mode,
            "caption_style": use_caption_style,
            "caption_animation": use_caption_animation,
            "face_tracking": use_face_tracking,
            "tracking_mode": use_tracking_mode,
            "crop_anchor_x": round(use_crop_anchor_x, 3),
            "clip_duration_seconds": int(max_clip_seconds),
            "clip_count": requested_clip_count,
        }
        analysis["generation_options"] = generation_options_payload

        if cancel_event is not None and cancel_event.is_set():
            raise ClipGenerationCancelled("Clip generation was cancelled")

        transcript_segments = _load_transcript_segments(project_directory)
        transcript_language = _load_transcript_language(project_directory)
        analysis_clips = list(safe_clips)
        if requested_clip_count is not None and len(analysis_clips) > requested_clip_count:
            analysis_clips = analysis_clips[:requested_clip_count]
        if not analysis_clips:
            raise ValueError("Analysis contains no clips")

        tracking_data: dict[str, Any] | None = None
        if use_framing_mode == "true_9_16":
            from app.services.smart_framing import analyze_speaker_tracking, build_clip_crop_preview
            from app.services.video_editor import find_ffmpeg
            if progress_callback and use_tracking_mode != "locked":
                progress_callback("Analyzing speaker tracking (True 9:16): 0%", 0, len(analysis_clips))

            def track_progress(step_str: str, cur_f: int, tot_f: int) -> None:
                if progress_callback:
                    progress_callback(step_str, 0, len(analysis_clips))

            max_tracking_duration = max((c.get("end", 0.0) for c in analysis_clips), default=100.0) + 1.0
            tracking_data = analyze_speaker_tracking(
                project_directory=project_directory,
                ffmpeg_path=find_ffmpeg(),
                cancel_event=cancel_event,
                progress_callback=track_progress,
                max_duration=max_tracking_duration,
                face_tracking=use_face_tracking,
                tracking_mode=use_tracking_mode,
                crop_anchor_x=use_crop_anchor_x,
            )
            generation_options_payload["requested_tracking_mode"] = tracking_data.get("requested_tracking_mode", use_tracking_mode)
            generation_options_payload["applied_tracking_mode"] = tracking_data.get("applied_tracking_mode", use_tracking_mode)
            generation_options_payload["tracking_fallback_reason"] = tracking_data.get("fallback_reason")

        if progress_callback:
            progress_callback("Rendering clips", 0, len(analysis_clips))

        generated: list[dict[str, Any]] = []
        for index, clip in enumerate(analysis_clips, start=1):
            if cancel_event is not None and cancel_event.is_set():
                raise ClipGenerationCancelled("Clip generation was cancelled")
            clip_id = str(clip["id"])
            if not is_safe_clip_id(clip_id):
                raise ValueError(f"Unsafe clip ID '{clip_id}'")
            temp_output = _ensure_contained_path(
                staging_directory,
                staging_directory / f".rendering_{clip_id}.mp4",
            )
            staged_output = _ensure_contained_path(
                staging_directory,
                staging_directory / f"{clip_id}.mp4",
            )
            try:
                subtitle_segments = [
                    segment for segment in transcript_segments
                    if segment["end"] > clip["start"] and segment["start"] < clip["end"]
                ]
                clip_has_subtitles = bool(show_subtitles and subtitle_segments)
                render_kwargs: dict[str, Any] = {
                    "subtitle_segments": subtitle_segments if clip_has_subtitles else None,
                    "show_subtitles": clip_has_subtitles,
                    "show_watermark": show_watermark,
                    "top_line": clip.get("top_line"),
                    "cancel_event": cancel_event,
                    "framing_mode": use_framing_mode,
                    "caption_style": use_caption_style,
                    "caption_animation": use_caption_animation,
                    "face_tracking": use_face_tracking,
                    "tracking_mode": use_tracking_mode,
                    "crop_anchor_x": use_crop_anchor_x,
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
                    temp_output.unlink(missing_ok=True)
                    raise ClipGenerationCancelled("Clip generation was cancelled")

                if temp_output.is_file():
                    temp_output.replace(staged_output)

                clip_metadata: dict[str, Any] = {
                    **clip,
                    "id": clip_id,
                    "duration": round(clip["end"] - clip["start"], 3),
                    "file": staged_output.name,
                    "v": _clip_version_token(staged_output),
                    "top_line": clip.get("top_line", ""),
                    "framing_mode": use_framing_mode,
                    "caption_style": use_caption_style,
                    "caption_animation": use_caption_animation,
                    "face_tracking": use_face_tracking,
                    "tracking_mode": use_tracking_mode,
                    "crop_anchor_x": round(use_crop_anchor_x, 3),
                    "requested_generation_mode": requested_generation_mode,
                    "applied_generation_mode": applied_generation_mode,
                    "staged": True,
                    "stage_job_id": stage_id,
                    "status": "ready",
                }
                if tracking_data is not None and use_framing_mode == "true_9_16":
                    from app.services.smart_framing import build_clip_crop_preview
                    clip_metadata["applied_tracking_mode"] = tracking_data.get("applied_tracking_mode", use_tracking_mode)
                    clip_metadata["tracking_fallback_reason"] = tracking_data.get("fallback_reason")
                    clip_metadata["crop_preview"] = build_clip_crop_preview(
                        tracking_data, float(clip["start"]), float(clip["end"])
                    )
                    clip["crop_preview"] = clip_metadata["crop_preview"]
                    clip["applied_tracking_mode"] = clip_metadata["applied_tracking_mode"]
                    clip["tracking_fallback_reason"] = clip_metadata["tracking_fallback_reason"]
                clip["framing_mode"] = use_framing_mode
                clip["caption_style"] = use_caption_style
                clip["caption_animation"] = use_caption_animation
                clip["face_tracking"] = use_face_tracking
                clip["tracking_mode"] = use_tracking_mode
                clip["crop_anchor_x"] = round(use_crop_anchor_x, 3)

                generated.append(clip_metadata)
            except (KeyError, TypeError, ValueError, VideoEditorError) as error:
                temp_output.unlink(missing_ok=True)
                raise VideoEditorError(f"Could not render clip {index} of {len(analysis_clips)}: {error}") from error
            except Exception:
                temp_output.unlink(missing_ok=True)
                raise

            if progress_callback:
                progress_callback("Rendering clips", index, len(analysis_clips), clip_metadata)

        # Stage matching analysis metadata alongside rendered files before committing
        staged_analysis_path = staging_directory / "analysis.json"
        _atomic_write_json(staged_analysis_path, analysis)

        # Atomic recoverable commit step under per-project write lock
        with _get_project_write_lock(project_directory):
            if cancel_event is not None and cancel_event.is_set():
                raise ClipGenerationCancelled("Clip generation was cancelled")

            backup_dir = project_directory / f".commit_backup_{stage_id}"
            backup_clips_dir = backup_dir / "clips"
            manifest_path = project_directory / f".commit_manifest_{stage_id}.json"

            existing_clips = [p for p in clips_directory.glob("*.mp4") if not p.name.startswith(".")]
            if existing_clips or analysis_path.is_file():
                backup_clips_dir.mkdir(parents=True, exist_ok=True)
                if analysis_path.is_file():
                    shutil.copyfile(str(analysis_path), str(backup_dir / "analysis.json"))
                for ec in existing_clips:
                    shutil.move(str(ec), str(backup_clips_dir / ec.name))

            _atomic_write_json(
                manifest_path,
                {
                    "stage_id": stage_id,
                    "state": "swapping",
                    "clips": [item["id"] for item in generated],
                },
            )

            for item in generated:
                staged_file = _ensure_contained_path(staging_directory, staging_directory / item["file"])
                dest_file = _ensure_contained_path(clips_directory, clips_directory / item["file"])
                shutil.move(str(staged_file), str(dest_file))
                item["v"] = _clip_version_token(dest_file)
                item.pop("staged", None)
                item.pop("stage_job_id", None)

            staged_meta_tmp = project_directory / f".commit_analysis.{os.getpid()}.{threading.get_ident()}.tmp"
            shutil.copyfile(str(staged_analysis_path), str(staged_meta_tmp))
            os.replace(staged_meta_tmp, analysis_path)

            _atomic_write_json(manifest_path, {"stage_id": stage_id, "state": "committed"})
            manifest_path.unlink(missing_ok=True)
            if backup_dir.is_dir():
                shutil.rmtree(backup_dir, ignore_errors=True)

        snapshot_path.unlink(missing_ok=True)
        shutil.rmtree(staging_directory, ignore_errors=True)
    except Exception:
        _restore_prior_analysis()
        snapshot_path.unlink(missing_ok=True)
        if staging_directory.is_dir():
            shutil.rmtree(staging_directory, ignore_errors=True)
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
    tracking_mode: str | None = None,
    crop_anchor_x: float | None = None,
    preserve_project_options: bool = False,
    keep_existing_top_line: bool = False,
) -> dict[str, Any]:
    with _get_project_write_lock(project_directory):
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
            (c for c in clips if isinstance(c, dict) and (c.get("id") == clip_id or f"{c.get('id')}.mp4" == clip_id)),
            None,
        )
        if not target_clip:
            raise ValueError(f"Clip '{clip_id}' not found in project")

        raw_actual_id = str(target_clip.get("id") or clip_id.replace(".mp4", ""))
        if not is_safe_clip_id(raw_actual_id):
            raise ValueError(f"Unsafe clip identifier '{raw_actual_id}'")
        actual_id = raw_actual_id

        if keep_existing_top_line and top_line is None:
            existing_tl = str(target_clip.get("top_line") or "").strip()
            cleaned_top_line = existing_tl or None
        else:
            cleaned_top_line = None
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

        if tracking_mode is not None and tracking_mode in {"locked", "cuts", "follow"}:
            use_tracking_mode = tracking_mode
            use_face_tracking = use_tracking_mode == "follow"
        elif face_tracking is not None:
            use_face_tracking = bool(face_tracking)
            use_tracking_mode = "follow" if use_face_tracking else "locked"
        elif target_clip.get("tracking_mode") in {"locked", "cuts", "follow"}:
            use_tracking_mode = str(target_clip["tracking_mode"])
            use_face_tracking = use_tracking_mode == "follow"
        elif "face_tracking" in target_clip:
            use_face_tracking = bool(target_clip["face_tracking"])
            use_tracking_mode = "follow" if use_face_tracking else "locked"
        elif saved_options.get("tracking_mode") in {"locked", "cuts", "follow"}:
            use_tracking_mode = str(saved_options["tracking_mode"])
            use_face_tracking = use_tracking_mode == "follow"
        elif "face_tracking" in saved_options:
            use_face_tracking = bool(saved_options["face_tracking"])
            use_tracking_mode = "follow" if use_face_tracking else "locked"
        else:
            use_tracking_mode = "locked"
            use_face_tracking = False

        if crop_anchor_x is not None:
            use_crop_anchor_x = max(0.0, min(1.0, float(crop_anchor_x)))
        elif "crop_anchor_x" in target_clip:
            try:
                use_crop_anchor_x = max(0.0, min(1.0, float(target_clip["crop_anchor_x"])))
            except (TypeError, ValueError):
                use_crop_anchor_x = 0.5
        elif "crop_anchor_x" in saved_options:
            try:
                use_crop_anchor_x = max(0.0, min(1.0, float(saved_options["crop_anchor_x"])))
            except (TypeError, ValueError):
                use_crop_anchor_x = 0.5
        else:
            use_crop_anchor_x = 0.5

        if not preserve_project_options:
            if "generation_options" not in analysis:
                analysis["generation_options"] = {}
            analysis["generation_options"]["show_watermark"] = use_watermark
            analysis["generation_options"]["show_subtitles"] = use_subtitles
            analysis["generation_options"]["framing_mode"] = use_framing_mode
            analysis["generation_options"]["caption_style"] = use_caption_style
            analysis["generation_options"]["caption_animation"] = use_caption_animation
            analysis["generation_options"]["face_tracking"] = use_face_tracking
            analysis["generation_options"]["tracking_mode"] = use_tracking_mode
            analysis["generation_options"]["crop_anchor_x"] = round(use_crop_anchor_x, 3)

        transcript_segments = _load_transcript_segments(project_directory)
        transcript_language = _load_transcript_language(project_directory)
        subtitle_segments = [
            segment for segment in transcript_segments
            if segment["end"] > target_clip["start"] and segment["start"] < target_clip["end"]
        ]
        clip_has_subtitles = bool(use_subtitles and subtitle_segments)

        clips_directory = project_directory / "clips"
        clips_directory.mkdir(parents=True, exist_ok=True)
        final_output = _ensure_contained_path(clips_directory, clips_directory / f"{actual_id}.mp4")
        temp_output = _ensure_contained_path(
            clips_directory,
            clips_directory / f".rendering_{actual_id}_{uuid.uuid4().hex[:6]}.mp4",
        )

        render_kwargs: dict[str, Any] = {
            "source_path": source_path,
            "output_path": temp_output,
            "start_time": target_clip["start"],
            "end_time": target_clip["end"],
            "subtitle_segments": subtitle_segments if clip_has_subtitles else None,
            "show_subtitles": clip_has_subtitles,
            "show_watermark": use_watermark,
            "top_line": cleaned_top_line,
            "framing_mode": use_framing_mode,
            "caption_style": use_caption_style,
            "caption_animation": use_caption_animation,
            "face_tracking": use_face_tracking,
            "tracking_mode": use_tracking_mode,
            "crop_anchor_x": use_crop_anchor_x,
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
        target_clip["tracking_mode"] = use_tracking_mode
        target_clip["crop_anchor_x"] = round(use_crop_anchor_x, 3)

        if use_framing_mode == "true_9_16":
            try:
                from app.services.smart_framing import analyze_speaker_tracking, build_clip_crop_preview
                from app.services.video_editor import find_ffmpeg
                td = analyze_speaker_tracking(
                    project_directory=project_directory,
                    ffmpeg_path=find_ffmpeg(),
                    max_duration=float(target_clip["end"]) + 1.0,
                    face_tracking=use_face_tracking,
                    tracking_mode=use_tracking_mode,
                    crop_anchor_x=use_crop_anchor_x,
                )
                target_clip["applied_tracking_mode"] = td.get("applied_tracking_mode", use_tracking_mode)
                target_clip["tracking_fallback_reason"] = td.get("fallback_reason")
                target_clip["crop_preview"] = build_clip_crop_preview(
                    td, float(target_clip["start"]), float(target_clip["end"])
                )
            except Exception:
                pass

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
            "tracking_mode": use_tracking_mode,
            "crop_anchor_x": round(use_crop_anchor_x, 3),
            "status": "ready",
        }

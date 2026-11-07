import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

try:
    import av
    import faster_whisper.audio

    # PyAV 19.0.0+ removed the 'metadata_errors' parameter from av.open().
    # faster-whisper <= 1.2.1 still passes metadata_errors="ignore", which causes
    # TypeError: open() got an unexpected keyword argument 'metadata_errors'.
    # This shim ensures complete forward compatibility with all PyAV versions.
    _orig_av_open = av.open

    def _safe_av_open(*args, **kwargs):
        try:
            return _orig_av_open(*args, **kwargs)
        except TypeError as exc:
            if "metadata_errors" in str(exc):
                kwargs.pop("metadata_errors", None)
                return _orig_av_open(*args, **kwargs)
            raise

    av.open = _safe_av_open
    if hasattr(faster_whisper, "audio") and hasattr(faster_whisper.audio, "av"):
        faster_whisper.audio.av.open = _safe_av_open
except Exception:
    pass

from faster_whisper import WhisperModel
from app.services.process_utils import get_no_window_subprocess_kwargs


MODEL_NAME = "tiny"
_MODEL_INSTANCE: WhisperModel | None = None
_MODEL_LOCK = threading.Lock()


def get_whisper_model(model_name: str | None = None) -> WhisperModel:
    global _MODEL_INSTANCE
    resolved_model = (model_name or os.environ.get("WHISPER_MODEL") or MODEL_NAME).strip()
    if _MODEL_INSTANCE is None:
        with _MODEL_LOCK:
            if _MODEL_INSTANCE is None:
                # Detect GPU acceleration if available
                device = "cpu"
                compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "").strip() or "int8"
                try:
                    import ctranslate2
                    if ctranslate2.get_cuda_device_count() > 0:
                        device = "cuda"
                        if not os.environ.get("WHISPER_COMPUTE_TYPE"):
                            compute_type = "float16"
                except Exception:
                    pass

                # Allocate optimal CPU threads across available cores
                threads = min(8, max(4, (os.cpu_count() or 4)))
                _MODEL_INSTANCE = WhisperModel(
                    resolved_model,
                    device=device,
                    compute_type=compute_type,
                    cpu_threads=threads,
                )
    return _MODEL_INSTANCE


def _atomic_write_text(target: Path, content: str) -> None:
    tmp = target.with_name(f".{target.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, target)
    except OSError:
        tmp.unlink(missing_ok=True)
        target.write_text(content, encoding="utf-8")


def extract_audio_wav(
    video_path: Path,
    output_wav: Path,
    max_duration: float | None = None,
) -> bool:
    """Pre-extract 16kHz mono audio track using FFmpeg to avoid slow video decoding during inference."""
    try:
        from app.services.video_editor import find_ffmpeg
        ffmpeg_bin = find_ffmpeg()
    except Exception:
        ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"

    try:
        cmd = [
            ffmpeg_bin,
            "-y",
            "-v", "error",
            "-i", str(video_path),
        ]
        if max_duration is not None and max_duration > 0:
            cmd.extend(["-t", f"{max_duration + 5.0:.2f}"])
        cmd.extend([
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            str(output_wav),
        ])
        res = subprocess.run(
            cmd,
            capture_output=True,
            timeout=120,
            **get_no_window_subprocess_kwargs(),
        )
        return res.returncode == 0 and output_wav.is_file() and output_wav.stat().st_size > 0
    except Exception:
        return False


def transcribe_video(
    video_path: Path,
    output_directory: Path,
    progress_callback: Callable[[str, float], None] | None = None,
    cancel_event: threading.Event | None = None,
    max_duration: float | None = None,
    segment_callback: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    if cancel_event is not None and cancel_event.is_set():
        raise RuntimeError("Transcription cancelled")

    output_directory.mkdir(parents=True, exist_ok=True)
    if progress_callback:
        progress_callback("Loading speech model", 0)

    full_media_duration = 0.0
    if max_duration is not None:
        try:
            from app.services.video_editor import probe_video_duration
            full_media_duration = probe_video_duration(video_path)
        except Exception:
            full_media_duration = 0.0

    # Only cap WAV extraction when max_duration is meaningfully shorter than the full video
    extract_cap: float | None = None
    if max_duration is not None and max_duration > 0:
        if full_media_duration <= 0.0 or max_duration + 5.0 < full_media_duration:
            extract_cap = max_duration

    # 1. Fast audio pre-extraction with FFmpeg (bypasses heavy video demuxing in Python)
    temp_audio_wav: Path | None = None
    audio_source = str(video_path)
    try:
        temp_dir = Path(tempfile.gettempdir())
        candidate_wav = temp_dir / f"cliprobin_audio_{uuid.uuid4().hex[:8]}.wav"
        if extract_audio_wav(video_path, candidate_wav, max_duration=extract_cap):
            temp_audio_wav = candidate_wav
            audio_source = str(candidate_wav)
    except Exception:
        audio_source = str(video_path)

    try:
        model = get_whisper_model()
        # 2. High-speed greedy decoding (beam_size=1, best_of=1) with VAD filter & word timestamps
        segments, info = model.transcribe(
            audio_source,
            beam_size=1,
            best_of=1,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            word_timestamps=True,
        )

        transcript_segments: list[dict[str, Any]] = []
        duration = max(full_media_duration, info.duration, 0.001)
        effective_duration = min(duration, max_duration) if max_duration is not None else duration
        stopped_early = extract_cap is not None
        if progress_callback:
            progress_callback("Transcribing audio", 0)

        def _flush_transcript(is_final: bool = False) -> None:
            if cancel_event is not None and cancel_event.is_set():
                return
            transcript_text = "\n".join(
                f"[{segment['start']:.3f} - {segment['end']:.3f}] {segment['text']}"
                for segment in transcript_segments
            )
            last_end = transcript_segments[-1]["end"] if transcript_segments else 0.0
            is_complete = bool(is_final and not stopped_early)
            covered = duration if is_complete else max(last_end, effective_duration if is_final else last_end)
            transcript_json = {
                "language": info.language,
                "language_probability": info.language_probability,
                "segments": transcript_segments,
                "duration": duration,
                "is_complete": is_complete,
                "covered_duration": round(covered, 3),
            }
            output_directory.mkdir(parents=True, exist_ok=True)
            _atomic_write_text(output_directory / "transcript.txt", transcript_text + "\n")
            _atomic_write_text(output_directory / "transcript.json", json.dumps(transcript_json, indent=2))

        last_flush_time = time.monotonic()
        for segment in segments:
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("Transcription cancelled")
            transcript_segment: dict[str, Any] = {
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
            }
            if segment.words:
                transcript_segment["words"] = [
                    {
                        "start": round(word.start, 3),
                        "end": round(word.end, 3),
                        "text": word.word.strip(),
                    }
                    for word in segment.words
                    if word.start is not None and word.end is not None and word.word.strip()
                ]
            transcript_segments.append(transcript_segment)

            if segment_callback:
                segment_callback(transcript_segment)

            # 3. Throttle disk writes to every 3.5s to prevent disk I/O thrashing
            now = time.monotonic()
            if now - last_flush_time >= 3.5:
                _flush_transcript(is_final=False)
                last_flush_time = now

            if progress_callback:
                pct = min(99, round(segment.end / max(effective_duration, 0.001) * 100))
                progress_callback(
                    "Transcribing audio",
                    pct,
                )

            if max_duration is not None and segment.end >= max_duration:
                if segment.end < duration - 0.5:
                    stopped_early = True
                break

        if cancel_event is not None and cancel_event.is_set():
            raise RuntimeError("Transcription cancelled")

        if progress_callback:
            progress_callback("Saving transcript", 100)
        _flush_transcript(is_final=True)

        return {
            "text_file": "transcript.txt",
            "json_file": "transcript.json",
            "segments": len(transcript_segments),
            "duration": duration,
            "is_complete": not stopped_early,
        }
    finally:
        if temp_audio_wav and temp_audio_wav.is_file():
            try:
                temp_audio_wav.unlink(missing_ok=True)
            except OSError:
                pass

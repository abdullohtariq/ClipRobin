import json
import threading
from pathlib import Path
from typing import Any, Callable

from faster_whisper import WhisperModel


MODEL_NAME = "tiny"
_MODEL_INSTANCE: WhisperModel | None = None
_MODEL_LOCK = threading.Lock()


def get_whisper_model(model_name: str = MODEL_NAME) -> WhisperModel:
    global _MODEL_INSTANCE
    if _MODEL_INSTANCE is None:
        with _MODEL_LOCK:
            if _MODEL_INSTANCE is None:
                _MODEL_INSTANCE = WhisperModel(model_name, device="cpu", compute_type="int8")
    return _MODEL_INSTANCE


def transcribe_video(
    video_path: Path,
    output_directory: Path,
    progress_callback: Callable[[str, float], None] | None = None,
) -> dict[str, Any]:
    output_directory.mkdir(parents=True, exist_ok=True)
    if progress_callback:
        progress_callback("Loading speech model", 0)
    model = get_whisper_model()
    segments, info = model.transcribe(
        str(video_path),
        vad_filter=True,
        word_timestamps=True,
    )

    transcript_segments = []
    duration = max(info.duration, 0.001)
    if progress_callback:
        progress_callback("Transcribing audio", 0)

    for segment in segments:
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
        if progress_callback:
            progress_callback(
                "Transcribing audio",
                min(99, round(segment.end / duration * 100)),
            )

    if progress_callback:
        progress_callback("Saving transcript", 0)
    transcript_text = "\n".join(
        f"[{segment['start']:.3f} - {segment['end']:.3f}] {segment['text']}"
        for segment in transcript_segments
    )
    transcript_json = {
        "language": info.language,
        "language_probability": info.language_probability,
        "segments": transcript_segments,
    }

    (output_directory / "transcript.txt").write_text(transcript_text + "\n", encoding="utf-8")
    (output_directory / "transcript.json").write_text(
        json.dumps(transcript_json, indent=2),
        encoding="utf-8",
    )

    return {
        "text_file": "transcript.txt",
        "json_file": "transcript.json",
        "segments": len(transcript_segments),
    }

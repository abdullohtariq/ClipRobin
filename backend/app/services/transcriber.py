import json
from pathlib import Path
from typing import Any

from faster_whisper import WhisperModel


MODEL_NAME = "tiny"


def transcribe_video(video_path: Path, output_directory: Path) -> dict[str, Any]:
    output_directory.mkdir(parents=True, exist_ok=True)
    model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(video_path), vad_filter=True)

    transcript_segments = [
        {
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "text": segment.text.strip(),
        }
        for segment in segments
    ]
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

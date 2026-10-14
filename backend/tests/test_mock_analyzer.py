import json
from pathlib import Path
import pytest

from app.services.mock_analyzer import create_mock_analysis


def test_create_mock_analysis_generates_clips(tmp_path: Path):
    transcript_dir = tmp_path / "transcription"
    transcript_dir.mkdir(parents=True)
    transcript_file = transcript_dir / "transcript.json"

    # Create a 70 second transcript across 5 segments
    segments = [
        {"start": 0.0, "end": 15.0, "text": "Segment one starts here."},
        {"start": 15.0, "end": 35.0, "text": "Segment two continues."},
        {"start": 35.0, "end": 50.0, "text": "Segment three explains the idea."},
        {"start": 50.0, "end": 65.0, "text": "Segment four adds details."},
        {"start": 65.0, "end": 80.0, "text": "Segment five wraps up."},
    ]
    transcript_file.write_text(json.dumps({"segments": segments}), encoding="utf-8")

    analysis = create_mock_analysis(tmp_path, max_clip_seconds=60.0)
    assert "clips" in analysis
    clips = analysis["clips"]
    assert len(clips) >= 1
    for clip in clips:
        assert clip["id"].startswith("clip_")
        assert clip["end"] > clip["start"]
        assert clip["end"] - clip["start"] <= 60.0

    # Verify analysis.json was written
    saved_analysis_file = tmp_path / "analysis.json"
    assert saved_analysis_file.is_file()
    saved = json.loads(saved_analysis_file.read_text(encoding="utf-8"))
    assert len(saved["clips"]) == len(clips)


def test_create_mock_analysis_tolerates_overlapping_segments(tmp_path: Path):
    transcript_dir = tmp_path / "transcription"
    transcript_dir.mkdir(parents=True)
    transcript_file = transcript_dir / "transcript.json"

    # Segment 2 starts slightly before segment 1 ends
    segments = [
        {"start": 0.0, "end": 20.0, "text": "Segment one."},
        {"start": 19.8, "end": 45.0, "text": "Overlapping segment two."},
    ]
    transcript_file.write_text(json.dumps({"segments": segments}), encoding="utf-8")

    analysis = create_mock_analysis(tmp_path, max_clip_seconds=60.0)
    assert len(analysis["clips"]) >= 1
    assert analysis["clips"][0]["id"] == "clip_001"


def test_create_mock_analysis_missing_transcript(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="Transcript not found"):
        create_mock_analysis(tmp_path)

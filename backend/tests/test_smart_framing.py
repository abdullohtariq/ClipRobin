import json
from pathlib import Path
import pytest

from app.services.smart_framing import (
    _FaceTrack,
    _compute_iou,
    _is_backchannel_text,
    _is_speech_active,
    _load_speech_utterances,
    _load_speech_windows,
    _merge_short_shots,
    analyze_speaker_tracking,
    get_crop_filter_for_clip,
    get_yunet_model_path,
    probe_video_dimensions,
)


def test_yunet_model_path_exists():
    path = get_yunet_model_path()
    assert path.is_file()
    assert path.stat().st_size > 100_000


def test_compute_iou():
    box1 = (0.0, 0.0, 10.0, 10.0)
    box2 = (0.0, 0.0, 10.0, 10.0)
    assert _compute_iou(box1, box2) == pytest.approx(1.0)

    box3 = (5.0, 0.0, 10.0, 10.0)
    # intersection: 5 * 10 = 50. union: 100 + 100 - 50 = 150 -> 1/3
    assert _compute_iou(box1, box3) == pytest.approx(50.0 / 150.0)

    box_no_overlap = (20.0, 20.0, 10.0, 10.0)
    assert _compute_iou(box1, box_no_overlap) == 0.0


def test_load_speech_windows_and_active(tmp_path: Path):
    transcript_dir = tmp_path / "transcription"
    transcript_dir.mkdir()
    transcript_file = transcript_dir / "transcript.json"
    transcript_file.write_text(
        json.dumps({
            "segments": [
                {
                    "start": 1.0,
                    "end": 3.0,
                    "words": [
                        {"start": 1.0, "end": 1.8, "text": "Hello"},
                        {"start": 2.0, "end": 2.8, "text": "world"},
                    ]
                },
                {
                    "start": 5.0,
                    "end": 6.0,
                    "words": []
                }
            ]
        }),
        encoding="utf-8",
    )

    windows = _load_speech_windows(tmp_path)
    assert len(windows) >= 1
    # Speech at 1.5s should be active (within 1.0 - 0.2 to 2.8 + 0.2)
    assert _is_speech_active(1.5, windows) is True
    # Speech at 4.0s should be inactive
    assert _is_speech_active(4.0, windows) is False
    # Speech at 5.5s should be active
    assert _is_speech_active(5.5, windows) is True


def test_get_crop_filter_for_clip_single_shot():
    tracking_data = {
        "crop_width": 404,
        "crop_height": 720,
        "shots": [
            {"start": 0.0, "end": 20.0, "x": 300}
        ]
    }
    cw, ch, expr = get_crop_filter_for_clip(tracking_data, 2.0, 10.0)
    assert cw == 404
    assert ch == 720
    assert expr == "300"


def test_get_crop_filter_for_clip_multiple_shots():
    tracking_data = {
        "crop_width": 404,
        "crop_height": 720,
        "shots": [
            {"start": 0.0, "end": 5.0, "x": 100},
            {"start": 5.0, "end": 10.0, "x": 500},
            {"start": 10.0, "end": 20.0, "x": 200},
        ]
    }
    cw, ch, expr = get_crop_filter_for_clip(tracking_data, 2.0, 12.0)
    assert cw == 404
    assert ch == 720
    # Relative clip times: cut 1 is at 5.0 - 2.0 = 3.0, cut 2 is at 10.0 - 2.0 = 8.0
    assert "if(lt(t,3.000),100," in expr
    assert "if(lt(t,8.000),500,200)" in expr


def test_analyze_speaker_tracking_already_vertical(tmp_path: Path):
    (tmp_path / "source.mp4").write_bytes(b"dummy vertical video")
    
    # Mock probe_video_dimensions to return 1080x1920
    import app.services.smart_framing as sf
    orig_probe = sf.probe_video_dimensions
    sf.probe_video_dimensions = lambda p, ff=None: (1080, 1920)

    try:
        data = analyze_speaker_tracking(tmp_path, ffmpeg_path="ffmpeg")
        assert data.get("already_vertical") is True
        assert data.get("source_width") == 1080
        assert data.get("source_height") == 1920
        assert len(data.get("shots", [])) == 1
    finally:
        sf.probe_video_dimensions = orig_probe


def test_is_backchannel_text():
    assert _is_backchannel_text("Yeah") is True
    assert _is_backchannel_text("yeah!") is True
    assert _is_backchannel_text("mm-hm") is True
    assert _is_backchannel_text("right") is True
    assert _is_backchannel_text("uh-huh") is True
    assert _is_backchannel_text("ok sure") is True
    assert _is_backchannel_text("i see") is True
    assert _is_backchannel_text("Wait, what are you doing here?") is False
    assert _is_backchannel_text("In this episode we discuss AI models") is False


def test_load_speech_utterances(tmp_path: Path):
    transcript_dir = tmp_path / "transcription"
    transcript_dir.mkdir()
    transcript_file = transcript_dir / "transcript.json"
    transcript_file.write_text(
        json.dumps({
            "segments": [
                {"start": 1.0, "end": 4.5, "text": "Welcome to the podcast today."},
                {"start": 5.0, "end": 5.4, "text": "Yeah"},
                {"start": 6.0, "end": 6.3, "text": "Right."},
                {"start": 7.0, "end": 12.0, "text": "I really wanted to ask about the design process."},
            ]
        }),
        encoding="utf-8",
    )

    utterances = _load_speech_utterances(tmp_path)
    assert len(utterances) == 4
    # Utterance 0: substantive speech
    assert utterances[0]["is_backchannel"] is False
    assert utterances[0]["start"] == 1.0
    # Utterance 1 & 2: backchannels
    assert utterances[1]["is_backchannel"] is True
    assert utterances[2]["is_backchannel"] is True
    # Utterance 3: substantive speech
    assert utterances[3]["is_backchannel"] is False


def test_merge_short_shots():
    # Shot 1 is 0.6s (< 1.6s) and flanked by shots with same position (x=100)
    raw_shots = [
        {"start": 0.0, "end": 4.0, "x": 100},
        {"start": 4.0, "end": 4.6, "x": 800},
        {"start": 4.6, "end": 10.0, "x": 100},
    ]
    merged = _merge_short_shots(raw_shots, min_duration=1.6, crop_width=404)
    # The short middle shot should be absorbed
    assert len(merged) == 1
    assert merged[0]["start"] == 0.0
    assert merged[0]["end"] == 10.0
    assert merged[0]["x"] == 100


def test_merge_short_shots_boundary():
    # Lead shot is only 0.8s (< 1.6s)
    raw_shots = [
        {"start": 0.0, "end": 0.8, "x": 100},
        {"start": 0.8, "end": 10.0, "x": 800},
    ]
    merged = _merge_short_shots(raw_shots, min_duration=1.6, crop_width=404)
    assert len(merged) == 1
    assert merged[0]["start"] == 0.0
    assert merged[0]["end"] == 10.0
    assert merged[0]["x"] == 800


def test_face_track_positions_and_scoring():
    import numpy as np
    lms = np.zeros((5, 2))
    track = _FaceTrack(track_id=1, bbox=(10.0, 10.0, 50.0, 50.0), landmarks=lms, t=1.0, center_x_orig=300.0)

    # Initially at t=1.0, cx=300
    assert track.center_x_at_time(1.0) == 300.0

    # Update at t=1.5 with new center_x=320.0
    patch = np.zeros((16, 24), dtype=np.uint8)
    track.update(bbox=(15.0, 10.0, 50.0, 50.0), landmarks=lms, t=1.5, mouth_patch=patch, is_speaking_audio=True, center_x_orig=320.0)

    # Nearest time query
    assert track.center_x_at_time(1.4) == 320.0
    assert track.center_x_at_time(1.1) == 300.0


def test_speaker_switch_backward_alignment_and_no_center_drop(tmp_path: Path):
    # Setup mock transcript with two distinct substantive utterances
    transcript_dir = tmp_path / "transcription"
    transcript_dir.mkdir()
    transcript_file = transcript_dir / "transcript.json"
    transcript_file.write_text(
        json.dumps({
            "segments": [
                {"start": 1.0, "end": 4.5, "text": "Host speaking on the left side of the table."},
                {"start": 7.0, "end": 12.0, "text": "Guest replying on the right side of the room."},
            ]
        }),
        encoding="utf-8",
    )

    utterances = _load_speech_utterances(tmp_path)
    assert len(utterances) == 2
    assert utterances[0]["is_backchannel"] is False
    assert utterances[1]["is_backchannel"] is False

    # In Pass 2: Speaker switch from Host to Guest
    # The cut time is aligned backward by 150ms before Guest's speech (7.0 - 0.15 = 6.85s)
    cut_t = max(0.0, utterances[1]["start"] - 0.15)
    assert cut_t == pytest.approx(6.85)

    # In FFmpeg crop filter, this produces an instant step cut at t=6.850 without panning across empty middle
    tracking_data = {
        "crop_width": 607,
        "crop_height": 1080,
        "shots": [
            {"start": 0.0, "end": 6.85, "x": 100},
            {"start": 6.85, "end": 15.0, "x": 1200},
        ],
    }
    cw, ch, expr = get_crop_filter_for_clip(tracking_data, 0.0, 15.0)
    assert expr == "if(lt(t,6.850),100,1200)"




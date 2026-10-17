import json
from pathlib import Path
import pytest

from app.services.smart_framing import (
    _compute_iou,
    _is_speech_active,
    _load_speech_windows,
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

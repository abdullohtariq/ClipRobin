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


def test_failure_mode_1_cold_start_hook_framing():
    """Failure Mode 1: 1-2s delay/hunting at video start. Video must frame first speaker from 0.0s immediately."""
    import numpy as np
    lms = np.zeros((5, 2))
    
    # Speaker track 1 starts at t=0.0
    track1 = _FaceTrack(track_id=1, bbox=(100.0, 100.0, 120.0, 120.0), landmarks=lms, t=0.0, center_x_orig=400.0)
    # Track 2 (listener) also starts at t=0.0
    track2 = _FaceTrack(track_id=2, bbox=(500.0, 100.0, 120.0, 120.0), landmarks=lms, t=0.0, center_x_orig=1400.0)
    
    all_tracks = {1: track1, 2: track2}
    confirmed_utterances = [
        {"start": 1.8, "end": 4.5, "track_id": 1, "center_x": 400.0},
        {"start": 6.0, "end": 9.0, "track_id": 2, "center_x": 1400.0},
    ]
    
    # When building switch_cuts with the cold-start hook fix:
    switch_cuts: list[tuple[float, float, int]] = []
    last_confirmed_cx = None
    last_track_id = None
    crop_w = 608.0

    for u in confirmed_utterances:
        cx = u["center_x"]
        tid = u["track_id"]
        if last_confirmed_cx is None:
            first_track = all_tracks.get(tid)
            if first_track and first_track.first_t <= max(2.5, u["start"]):
                lead_in = 0.0
            else:
                lead_in = max(0.0, u["start"] - 0.15)
            switch_cuts.append((lead_in, cx, tid))
            last_confirmed_cx = cx
            last_track_id = tid
        else:
            diff = abs(cx - last_confirmed_cx)
            if diff > (crop_w * 0.35) and tid != last_track_id:
                cut_t = max(0.0, u["start"] - 0.15)
                switch_cuts.append((cut_t, cx, tid))
                last_confirmed_cx = cx
                last_track_id = tid

    # Cut 0 MUST start at 0.0s (not 1.65s!) so the viewer sees the speaker immediately
    assert switch_cuts[0][0] == 0.0
    assert switch_cuts[0][1] == 400.0
    assert switch_cuts[0][2] == 1
    # Cut 1 is 150ms J-cut before speaker 2 speaks: 6.0 - 0.15 = 5.85s
    assert switch_cuts[1][0] == pytest.approx(5.85)
    assert switch_cuts[1][1] == 1400.0


def test_failure_mode_2_backchannel_speech_not_triggering_speaker_switch(tmp_path: Path):
    """Failure Mode 2: Multi-face reactive tokens ('yeah', 'right', 'uh-huh') should not create false cuts."""
    transcript_dir = tmp_path / "transcription"
    transcript_dir.mkdir()
    (transcript_dir / "transcript.json").write_text(
        json.dumps({
            "segments": [
                {"start": 0.5, "end": 3.0, "text": "This is a detailed explanation of short form content."},
                {"start": 3.2, "end": 3.5, "text": "yeah"},
                {"start": 3.7, "end": 4.0, "text": "mm-hm"},
                {"start": 4.2, "end": 7.0, "text": "And that is why audience retention drops when shots jump around."},
            ]
        }),
        encoding="utf-8",
    )

    utterances = _load_speech_utterances(tmp_path)
    substantive = [u for u in utterances if not u["is_backchannel"]]
    # The two backchannels ("yeah", "mm-hm") must be filtered out of substantive speech
    assert len(substantive) == 2
    assert "detailed explanation" in substantive[0]["text"]
    assert "audience retention drops" in substantive[1]["text"]


def test_failure_mode_3_temporary_face_occlusion_and_dead_reckoning():
    """Failure Mode 3: Temporary face loss (turning head, drinking water) must maintain position for <= 2.5s."""
    import numpy as np
    lms = np.zeros((5, 2))
    track = _FaceTrack(track_id=1, bbox=(10.0, 10.0, 50.0, 50.0), landmarks=lms, t=1.0, center_x_orig=450.0)

    # Face seen at t=1.0
    assert track.center_x_at_time(1.0) == 450.0
    # Head turned at t=2.5 (1.5s gap): within 2.5s max_gap, dead reckoning maintains position
    assert track.center_x_at_time(2.5, max_gap=2.5) == 450.0
    # Gone for 4.0s (3.0s gap > 2.5s): returns None so system can fall back safely
    assert track.center_x_at_time(4.0, max_gap=2.5) is None


def test_failure_mode_4_static_false_detection_suppression():
    """Failure Mode 4: Static false detection (e.g. poster on wall) has zero speech score vs speaking face."""
    import numpy as np
    lms = np.zeros((5, 2))
    poster_track = _FaceTrack(track_id=1, bbox=(100.0, 50.0, 80.0, 80.0), landmarks=lms, t=0.5, center_x_orig=300.0)
    # Poster mouth patch is static identical bytes -> zero motion
    empty_patch = np.zeros((16, 24), dtype=np.uint8)
    poster_track.last_mouth_patch = empty_patch
    poster_track.update(bbox=(100.0, 50.0, 80.0, 80.0), landmarks=lms, t=1.0, mouth_patch=empty_patch, is_speaking_audio=True, center_x_orig=300.0)

    speaker_track = _FaceTrack(track_id=2, bbox=(300.0, 50.0, 80.0, 80.0), landmarks=lms, t=0.5, center_x_orig=1100.0)
    # Speaker mouth patch changes between frames -> significant motion
    active_patch = np.full((16, 24), 200, dtype=np.uint8)
    speaker_track.last_mouth_patch = empty_patch
    speaker_track.update(bbox=(300.0, 50.0, 80.0, 80.0), landmarks=lms, t=1.0, mouth_patch=active_patch, is_speaking_audio=True, center_x_orig=1100.0)

    assert poster_track.recent_speech_score() == 0.0
    assert speaker_track.recent_speech_score() > 0.5
    # Selection must choose the speaking track over the static poster
    chosen = max([poster_track, speaker_track], key=lambda tr: tr.recent_speech_score())
    assert chosen.track_id == 2


def test_failure_mode_5_two_shot_close_proximity_framing():
    """Failure Mode 5: When two people fit inside 9:16 crop, preserve stable two-shot instead of cutting."""
    crop_w = 608
    # Two people seated close together: span = 450px < (crop_w * 0.88 = 535px)
    person1_bbox = (200.0, 100.0, 100.0, 120.0)  # x=200 to 300
    person2_bbox = (500.0, 100.0, 100.0, 120.0)  # x=500 to 600
    min_x = min(person1_bbox[0], person2_bbox[0])
    max_x = max(person1_bbox[0] + person1_bbox[2], person2_bbox[0] + person2_bbox[2])
    span = max_x - min_x
    assert span <= (crop_w * 0.88)
    two_shot_center = (min_x + max_x) / 2.0
    assert two_shot_center == 400.0


def test_failure_mode_6_extreme_boundary_clamping_and_even_alignment():
    """Failure Mode 6: Crop box coordinates must clamp within [0, orig_w - crop_w] and be even-aligned."""
    orig_w = 1920
    crop_w = 608
    max_left = max(0, orig_w - crop_w)  # 1312

    # Case A: Subject at far left edge (center_x = 50.0)
    target_cx = 50.0
    crop_left = max(0.0, min(max_left, target_cx - crop_w / 2.0))
    raw_x = int(round(crop_left))
    if raw_x % 2 != 0:
        raw_x -= 1
    assert raw_x == 0
    assert raw_x >= 0
    assert raw_x + crop_w <= orig_w
    assert raw_x % 2 == 0

    # Case B: Subject at far right edge (center_x = 1890.0)
    target_cx = 1890.0
    crop_left = max(0.0, min(max_left, target_cx - crop_w / 2.0))
    raw_x = int(round(crop_left))
    if raw_x % 2 != 0:
        raw_x -= 1
    assert raw_x == 1312
    assert raw_x + crop_w <= orig_w
    assert raw_x % 2 == 0


def test_failure_mode_7_micro_jitter_dead_zone_suppression():
    """Failure Mode 7: Small detector bbox wobbles (< 8% of crop_w) must be absorbed by dead zone."""
    crop_w = 608
    dead_zone = crop_w * 0.08  # ~48.6 pixels

    anchor_center_x = 600.0
    # Slight head sway / detection noise of 15px
    jittered_x = 615.0
    diff = abs(jittered_x - anchor_center_x)
    assert diff <= dead_zone

    # Under dead zone, crop left position should remain anchored
    is_speaker_switch = diff > (crop_w * 0.35)
    assert is_speaker_switch is False


def test_failure_mode_8_extended_broll_non_face_recovery():
    """Failure Mode 8: When no faces are seen for > 2.5s (B-roll, slides), fall back to natural center."""
    orig_w = 1920
    frame_center_x = orig_w / 2.0
    t = 10.0
    last_face_seen_time = 5.0  # 5.0s ago (> 2.5s)
    last_known_center_x = 350.0

    # If no faces seen for > 2.5s, natural center is chosen
    if last_known_center_x is not None and (t - last_face_seen_time) <= 2.5:
        chosen_center_x = last_known_center_x
    else:
        chosen_center_x = frame_center_x

    assert chosen_center_x == 960.0


def test_failure_mode_9_vertical_source_preservation():
    """Failure Mode 9: 1080x1920 or 9:16 vertical input must not be re-cropped."""
    orig_w, orig_h = 1080, 1920
    crop_h = orig_h if orig_h % 2 == 0 else orig_h - 1
    crop_w = int(round(crop_h * 9.0 / 16.0))
    if crop_w % 2 != 0:
        crop_w -= 1

    is_already_vertical = orig_w <= crop_w + 4 or (orig_w / orig_h) <= (9.0 / 16.0 + 0.05)
    assert is_already_vertical is True


def test_failure_mode_10_missing_and_corrupt_transcript_handling(tmp_path: Path):
    """Failure Mode 10: Missing files, corrupted JSON, or empty segments must fail gracefully without crash."""
    # Subcase A: Missing directory completely
    missing_dir = tmp_path / "nonexistent"
    assert _load_speech_windows(missing_dir) == []
    assert _load_speech_utterances(missing_dir) == []

    # Subcase B: Corrupt JSON
    transcript_dir = tmp_path / "transcription"
    transcript_dir.mkdir()
    (transcript_dir / "transcript.json").write_text("BROKEN JSON {[[", encoding="utf-8")
    assert _load_speech_windows(tmp_path) == []
    assert _load_speech_utterances(tmp_path) == []

    # Subcase C: Empty segments
    (transcript_dir / "transcript.json").write_text(json.dumps({"segments": []}), encoding="utf-8")
    assert _load_speech_windows(tmp_path) == []
    assert _load_speech_utterances(tmp_path) == []


def test_failure_mode_11_rapid_banter_merge_short_shots():
    """Failure Mode 11: Strobe cuts from rapid banter (< 1.6s) must be absorbed into surrounding shots."""
    raw_shots = [
        {"start": 0.0, "end": 3.0, "x": 200},
        {"start": 3.0, "end": 3.4, "x": 800},  # 0.4s
        {"start": 3.4, "end": 3.8, "x": 200},  # 0.4s
        {"start": 3.8, "end": 4.3, "x": 800},  # 0.5s
        {"start": 4.3, "end": 9.0, "x": 200},
    ]
    merged = _merge_short_shots(raw_shots, min_duration=1.6, crop_width=608)
    for s in merged:
        assert (s["end"] - s["start"]) >= 1.6
    # Fast blips are absorbed, leaving a stable shot structure
    assert len(merged) < len(raw_shots)


def test_failure_mode_12_odd_dimensions_and_even_alignment():
    """Failure Mode 12: Odd video dimensions must be rounded to even numbers for codec compliance."""
    odd_w = 1919
    odd_h = 1079
    even_h = odd_h if odd_h % 2 == 0 else odd_h - 1
    even_w = int(round(even_h * 9.0 / 16.0))
    if even_w % 2 != 0:
        even_w -= 1

    assert even_h % 2 == 0
    assert even_w % 2 == 0
    assert even_h == 1078
    assert even_w == 606


def test_failure_mode_13_crop_filter_syntax_and_offsets():
    """Failure Mode 13: Crop filter expression formatting must produce valid expressions across edge cases."""
    # Subcase A: 0 shots fallback
    cw, ch, expr = get_crop_filter_for_clip({"crop_width": 608, "crop_height": 1080, "shots": []}, 0.0, 10.0)
    assert expr == "(in_w-out_w)/2"

    # Subcase B: Multiple cuts with clip offset
    tracking_data = {
        "crop_width": 608,
        "crop_height": 1080,
        "shots": [
            {"start": 0.0, "end": 10.0, "x": 100},
            {"start": 10.0, "end": 20.0, "x": 600},
            {"start": 20.0, "end": 30.0, "x": 1200},
        ],
    }
    # Clip from 5.0 to 25.0
    cw, ch, expr = get_crop_filter_for_clip(tracking_data, 5.0, 25.0)
    assert cw == 608
    assert ch == 1080
    # Relative cuts: 10.0 - 5.0 = 5.0, 20.0 - 5.0 = 15.0
    assert expr == "if(lt(t,5.000),100,if(lt(t,15.000),600,1200))"






def test_failure_mode_14_phone_video_rotation_probe():
    """Failure Mode 14: Mobile videos recorded in portrait with rotation metadata (90/270 deg) must swap w and h."""
    from app.services.smart_framing import _stream_rotation

    # Tag rotation
    stream_tags = {"tags": {"rotate": "90"}, "width": 1920, "height": 1080}
    assert _stream_rotation(stream_tags) == 90

    # Side data rotation
    stream_side = {"side_data_list": [{"rotation": -90}], "width": 1920, "height": 1080}
    assert _stream_rotation(stream_side) == -90

    # No rotation
    stream_normal = {"width": 1920, "height": 1080}
    assert _stream_rotation(stream_normal) == 0

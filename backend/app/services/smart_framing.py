import json
import logging
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Generator

import numpy as np

logger = logging.getLogger(__name__)


def get_yunet_model_path() -> Path:
    """Find or return the path to face_detection_yunet_2023mar.onnx."""
    # 1. PyInstaller frozen path
    if hasattr(sys, "_MEIPASS"):
        meipass_path = Path(sys._MEIPASS) / "app" / "models" / "face_detection_yunet_2023mar.onnx"
        if meipass_path.is_file():
            return meipass_path

    # 2. Relative to this service file
    service_model = Path(__file__).resolve().parent.parent / "models" / "face_detection_yunet_2023mar.onnx"
    if service_model.is_file():
        return service_model

    # 3. Project root relative
    root_model = Path(__file__).resolve().parents[3] / "backend" / "app" / "models" / "face_detection_yunet_2023mar.onnx"
    if root_model.is_file():
        return root_model

    # 4. Working directory relative
    cwd_model = Path("backend/app/models/face_detection_yunet_2023mar.onnx").resolve()
    if cwd_model.is_file():
        return cwd_model

    raise FileNotFoundError("YuNet face detection ONNX model not found")


def probe_video_dimensions(source_path: Path, ffmpeg_path: str | None = None) -> tuple[int, int]:
    """Probe the original video width and height using ffprobe or ffmpeg."""
    ffprobe_path = shutil.which("ffprobe")
    if not ffprobe_path and os.name == "nt":
        winget_packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
        matches = list(winget_packages.glob("Gyan.FFmpeg.Shared*/*/bin/ffprobe.exe"))
        if matches and matches[0].is_file():
            ffprobe_path = str(matches[0])

    if ffprobe_path:
        try:
            cmd = [
                ffprobe_path,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "json",
                str(source_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                data = json.loads(result.stdout)
                streams = data.get("streams", [])
                if streams:
                    w = int(streams[0].get("width", 0))
                    h = int(streams[0].get("height", 0))
                    if w > 0 and h > 0:
                        return w, h
        except Exception as e:
            logger.warning("ffprobe check failed: %s", e)

    # Fallback using ffmpeg -i inspection
    ff_exec = ffmpeg_path or shutil.which("ffmpeg") or "ffmpeg"
    try:
        res = subprocess.run([ff_exec, "-i", str(source_path)], capture_output=True, text=True, timeout=10)
        import re
        match = re.search(r"(\d{3,5})x(\d{3,5})", res.stderr)
        if match:
            return int(match.group(1)), int(match.group(2))
    except Exception:
        pass

    # Default fallback 16:9
    return 1920, 1080


def _load_speech_windows(project_directory: Path) -> list[tuple[float, float]]:
    """Load transcript segments or word timestamps with +/- 200ms lag tolerance."""
    transcript_path = project_directory / "transcription" / "transcript.json"
    if not transcript_path.is_file():
        transcript_path = project_directory / "transcript.json"
    if not transcript_path.is_file():
        return []

    try:
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    segments = transcript.get("segments", [])
    if not isinstance(segments, list):
        return []

    windows: list[tuple[float, float]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        words = seg.get("words")
        if isinstance(words, list) and words:
            for w in words:
                if isinstance(w, dict) and "start" in w and "end" in w:
                    try:
                        s = float(w["start"]) - 0.2
                        e = float(w["end"]) + 0.2
                        windows.append((max(0.0, s), max(0.0, e)))
                    except (ValueError, TypeError):
                        pass
        else:
            try:
                s = float(seg.get("start", 0)) - 0.2
                e = float(seg.get("end", 0)) + 0.2
                windows.append((max(0.0, s), max(0.0, e)))
            except (ValueError, TypeError):
                pass

    if not windows:
        return []

    # Merge overlapping speech windows
    windows.sort(key=lambda x: x[0])
    merged = [windows[0]]
    for cur_s, cur_e in windows[1:]:
        prev_s, prev_e = merged[-1]
        if cur_s <= prev_e:
            merged[-1] = (prev_s, max(prev_e, cur_e))
        else:
            merged.append((cur_s, cur_e))
    return merged


def _is_speech_active(t: float, speech_windows: list[tuple[float, float]]) -> bool:
    """Check if speech is happening at timestamp t."""
    for s, e in speech_windows:
        if s <= t <= e:
            return True
        if s > t:
            break
    return False


BACKCHANNEL_WORDS = {
    "yeah", "yep", "yes", "mm", "hm", "hmm", "mm-hm", "mmhm", "mhm", "mmhmm",
    "uh", "huh", "uh-huh", "uhhuh", "right", "okay", "ok", "sure", "ah",
    "cool", "wow", "yup", "ha", "haha", "got", "it", "got it", "i see",
    "exactly", "definitely", "totally", "true",
}


def _is_backchannel_text(text: str) -> bool:
    """Check if text is purely a reactive token or backchannel utterance."""
    raw_cleaned = "".join(c for c in text.lower() if c.isalnum() or c in " -").strip()
    if raw_cleaned in BACKCHANNEL_WORDS:
        return True
    normalized = text.lower().replace("-", " ")
    cleaned = "".join(c for c in normalized if c.isalnum() or c.isspace()).strip()
    if not cleaned:
        return True
    if cleaned in BACKCHANNEL_WORDS:
        return True
    words = cleaned.split()
    if len(words) <= 2 and all(w in BACKCHANNEL_WORDS for w in words):
        return True
    return False


def _load_speech_utterances(project_directory: Path) -> list[dict[str, Any]]:
    """Load transcript segments with backchannel classification."""
    transcript_path = project_directory / "transcription" / "transcript.json"
    if not transcript_path.is_file():
        transcript_path = project_directory / "transcript.json"
    if not transcript_path.is_file():
        return []

    try:
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    raw_segments = transcript.get("segments", [])
    if not isinstance(raw_segments, list):
        return []

    utterances: list[dict[str, Any]] = []
    for seg in raw_segments:
        if not isinstance(seg, dict):
            continue
        try:
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", 0.0))
        except (ValueError, TypeError):
            continue

        duration = end - start
        if duration <= 0:
            continue

        text = str(seg.get("text", "")).strip()

        # Classify backchannels: short acknowledgment utterances (< 0.7s or recognized reactive phrases)
        is_backchannel = False
        if duration < 0.4:
            is_backchannel = True
        elif duration < 0.8 and _is_backchannel_text(text):
            is_backchannel = True
        elif duration < 1.2 and _is_backchannel_text(text):
            is_backchannel = True

        utterances.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(duration, 3),
            "text": text,
            "is_backchannel": is_backchannel,
        })

    utterances.sort(key=lambda u: u["start"])
    return utterances


def _merge_short_shots(
    shots: list[dict[str, Any]],
    min_duration: float = 1.6,
    crop_width: float = 400.0,
) -> list[dict[str, Any]]:
    """
    Merge shots shorter than min_duration into adjacent dominant shots in Pass 2.
    Eliminates forward-locking during frame tracking and absorbs transient blips.
    """
    if len(shots) <= 1:
        return shots

    shots = [dict(s) for s in shots]
    changed = True
    while changed and len(shots) > 1:
        changed = False
        for i in range(len(shots)):
            shot = shots[i]
            dur = shot["end"] - shot["start"]
            if dur < min_duration:
                if i == 0:
                    shots[1]["start"] = shot["start"]
                    shots.pop(0)
                elif i == len(shots) - 1:
                    shots[i - 1]["end"] = shot["end"]
                    shots.pop(i)
                else:
                    prev_s = shots[i - 1]
                    next_s = shots[i + 1]
                    # If flanked by same speaker / position, absorb into prev
                    if abs(prev_s["x"] - next_s["x"]) <= (crop_width * 0.35):
                        prev_s["end"] = next_s["end"]
                        shots.pop(i + 1)
                        shots.pop(i)
                    else:
                        diff_prev = abs(shot["x"] - prev_s["x"])
                        diff_next = abs(shot["x"] - next_s["x"])
                        if diff_prev <= diff_next:
                            prev_s["end"] = shot["end"]
                            shots.pop(i)
                        else:
                            next_s["start"] = shot["start"]
                            shots.pop(i)
                changed = True
                break

    return shots


def _compute_iou(box1: tuple[float, float, float, float], box2: tuple[float, float, float, float]) -> float:
    """Compute IoU between [x, y, w, h] boxes."""
    x1, y1, w1, h1 = box1
    x2, y2, w2, h2 = box2

    xi1 = max(x1, x2)
    yi1 = max(y1, y2)
    xi2 = min(x1 + w1, x2 + w2)
    yi2 = min(y1 + h1, y2 + h2)

    inter_w = max(0.0, xi2 - xi1)
    inter_h = max(0.0, yi2 - yi1)
    inter_area = inter_w * inter_h

    area1 = w1 * h1
    area2 = w2 * h2
    union_area = area1 + area2 - inter_area
    if union_area <= 0:
        return 0.0
    return inter_area / union_area


class _FaceTrack:
    def __init__(self, track_id: int, bbox: tuple[float, float, float, float], landmarks: np.ndarray, t: float, center_x_orig: float):
        self.track_id = track_id
        self.last_bbox = bbox
        self.last_landmarks = landmarks
        self.last_t = t
        self.first_t = t
        self.frame_count = 1
        self.last_mouth_patch: np.ndarray | None = None
        self.mouth_motion_history: list[tuple[float, float]] = []  # (t, motion)
        self.speech_score_history: list[tuple[float, float]] = []  # (t, score)
        self.positions: list[tuple[float, float]] = [(t, center_x_orig)]  # (t, orig_center_x)

    def update(
        self,
        bbox: tuple[float, float, float, float],
        landmarks: np.ndarray,
        t: float,
        mouth_patch: np.ndarray | None,
        is_speaking_audio: bool,
        center_x_orig: float,
    ):
        self.last_bbox = bbox
        self.last_landmarks = landmarks
        self.last_t = t
        self.frame_count += 1
        self.positions.append((t, center_x_orig))
        if len(self.positions) > 3000:
            self.positions.pop(0)

        motion = 0.0
        if mouth_patch is not None and self.last_mouth_patch is not None:
            # Measure normalized absolute difference between consecutive mouth patches
            diff = np.abs(mouth_patch.astype(np.float32) - self.last_mouth_patch.astype(np.float32))
            motion = float(np.mean(diff)) / 255.0

        if mouth_patch is not None:
            self.last_mouth_patch = mouth_patch

        self.mouth_motion_history.append((t, motion))
        if len(self.mouth_motion_history) > 30:
            self.mouth_motion_history.pop(0)

        # Correlate with audio speech window
        speech_score = motion * (1.5 if is_speaking_audio else 0.1)
        self.speech_score_history.append((t, speech_score))
        if len(self.speech_score_history) > 30:
            self.speech_score_history.pop(0)

    def recent_speech_score(self, window_seconds: float = 1.0) -> float:
        if not self.speech_score_history:
            return 0.0
        cutoff = self.last_t - window_seconds
        recent = [score for t, score in self.speech_score_history if t >= cutoff]
        return float(np.mean(recent)) if recent else 0.0

    def speech_score_in_window(self, start_t: float, end_t: float) -> float:
        """Calculate mean speech score in a given time window."""
        scores = [score for t, score in self.speech_score_history if (start_t - 0.25) <= t <= (end_t + 0.25)]
        return float(np.mean(scores)) if scores else 0.0

    def center_x_at_time(self, target_t: float) -> float:
        """Return the closest known center X position for this track."""
        if not self.positions:
            return float(self.last_bbox[0] + self.last_bbox[2] / 2.0)
        closest = min(self.positions, key=lambda pt: abs(pt[0] - target_t))
        return closest[1]


def analyze_speaker_tracking(
    project_directory: Path,
    ffmpeg_path: str,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """
    Run YuNet face detection and mouth-movement speech correlation across the video.
    Caches the resulting shot/crop tracking timeline in tracking_analysis.json.
    """
    analysis_cache = project_directory / "tracking_analysis.json"
    if analysis_cache.is_file():
        try:
            cached = json.loads(analysis_cache.read_text(encoding="utf-8"))
            if isinstance(cached, dict) and "shots" in cached:
                return cached
        except Exception:
            pass

    source_files = list(project_directory.glob("source.*"))
    if not source_files:
        raise FileNotFoundError("Source video not found in project directory")
    source_path = source_files[0]

    orig_w, orig_h = probe_video_dimensions(source_path, ffmpeg_path)
    crop_h = orig_h
    crop_w = int(round(orig_h * 9.0 / 16.0))
    if crop_w % 2 != 0:
        crop_w -= 1

    # If already vertical (e.g. 1080x1920 or width <= crop_w + 4), skip reframing
    if orig_w <= crop_w + 4 or (orig_w / orig_h) <= (9.0 / 16.0 + 0.05):
        result = {
            "already_vertical": True,
            "source_width": orig_w,
            "source_height": orig_h,
            "crop_width": orig_w,
            "crop_height": orig_h,
            "shots": [{"start": 0.0, "end": 999999.0, "x": 0}],
        }
        analysis_cache.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return result

    # Prepare speech windows and utterances from VAD / faster-whisper transcript
    speech_windows = _load_speech_windows(project_directory)
    speech_utterances = _load_speech_utterances(project_directory)

    # Initialize OpenCV FaceDetectorYN
    import cv2

    model_path = get_yunet_model_path()
    sample_w = 640
    sample_h = int(round(sample_w * orig_h / orig_w))
    if sample_h % 2 != 0:
        sample_h += 1

    scale_to_orig = orig_w / float(sample_w)

    detector = cv2.FaceDetectorYN.create(
        model=str(model_path),
        config="",
        input_size=(sample_w, sample_h),
        score_threshold=0.55,
        nms_threshold=0.3,
        top_k=5000,
    )

    # Pipe downsampled frames from FFmpeg at 5 fps
    fps = 5.0
    frame_interval = 1.0 / fps
    frame_bytes = sample_w * sample_h * 3

    ffmpeg_cmd = [
        ffmpeg_path,
        "-i", str(source_path),
        "-vf", f"fps={fps:.1f},scale={sample_w}:{sample_h}",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "pipe:",
    ]

    process = subprocess.Popen(
        ffmpeg_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    all_tracks: dict[int, _FaceTrack] = {}
    active_tracks: dict[int, _FaceTrack] = {}
    next_track_id = 1
    frame_idx = 0

    per_frame_target_x: list[tuple[float, float]] = []  # (t, orig_x_center)

    last_active_speaker_track_id: int | None = None
    last_speaker_time = -10.0
    last_known_center_x: float | None = None

    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                process.kill()
                raise RuntimeError("Smart framing analysis cancelled")

            raw = process.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:
                break

            t = frame_idx * frame_interval
            frame = np.frombuffer(raw, dtype=np.uint8).reshape((sample_h, sample_w, 3))
            is_speech = _is_speech_active(t, speech_windows)

            # Detect faces
            _, faces = detector.detect(frame)
            current_frame_detections: list[tuple[tuple[float, float, float, float], np.ndarray, np.ndarray | None]] = []

            if faces is not None:
                for f in faces:
                    x, y, w, h = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                    # Filter out tiny noise / background faces
                    if w < 22 or h < 22:
                        continue
                    landmarks = f[4:14].reshape((5, 2))  # right_eye, left_eye, nose, right_mouth, left_mouth
                    rm = landmarks[3]
                    lm = landmarks[4]

                    # Extract mouth patch
                    mx = float((rm[0] + lm[0]) / 2.0)
                    my = float((rm[1] + lm[1]) / 2.0)
                    mw = max(16, int(abs(lm[0] - rm[0]) * 1.5))
                    mh = max(12, int(mw * 0.7))

                    x1 = max(0, int(mx - mw // 2))
                    y1 = max(0, int(my - mh // 2))
                    x2 = min(sample_w, x1 + mw)
                    y2 = min(sample_h, y1 + mh)

                    mouth_patch = None
                    if x2 > x1 and y2 > y1:
                        patch = frame[y1:y2, x1:x2]
                        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
                        mouth_patch = cv2.resize(gray, (24, 16))

                    current_frame_detections.append(((x, y, w, h), landmarks, mouth_patch))

            # Match detections to active tracks
            unmatched_detections = list(range(len(current_frame_detections)))
            matched_tracks = set()

            for track_id, track in list(active_tracks.items()):
                # Drop stale tracks not seen for > 1.0s
                if t - track.last_t > 1.0:
                    active_tracks.pop(track_id, None)
                    continue

                best_iou = 0.0
                best_det_idx = -1
                for det_idx in unmatched_detections:
                    bbox, _, _ = current_frame_detections[det_idx]
                    iou = _compute_iou(track.last_bbox, bbox)
                    if iou > best_iou:
                        best_iou = iou
                        best_det_idx = det_idx

                if best_iou >= 0.20 and best_det_idx >= 0:
                    bbox, lms, mpatch = current_frame_detections[best_det_idx]
                    det_cx_orig = (bbox[0] + bbox[2] / 2.0) * scale_to_orig
                    track.update(bbox, lms, t, mpatch, is_speech, det_cx_orig)
                    unmatched_detections.remove(best_det_idx)
                    matched_tracks.add(track_id)

            # Create new tracks for unmatched detections
            for det_idx in unmatched_detections:
                bbox, lms, mpatch = current_frame_detections[det_idx]
                det_cx_orig = (bbox[0] + bbox[2] / 2.0) * scale_to_orig
                new_track = _FaceTrack(next_track_id, bbox, lms, t, det_cx_orig)
                if mpatch is not None:
                    new_track.last_mouth_patch = mpatch
                active_tracks[next_track_id] = new_track
                all_tracks[next_track_id] = new_track
                next_track_id += 1

            # Determine who to frame in this frame (Fallback Order)
            frame_center_x = orig_w / 2.0
            chosen_center_x = frame_center_x

            # Filter tracks active in this frame
            recent_tracks = [tr for tr in active_tracks.values() if abs(tr.last_t - t) <= 0.25 and tr.frame_count >= 2]

            if not recent_tracks:
                # Layer 1 fix: Do NOT jump to dead center (orig_w / 2.0) when detections drop!
                # Hold the last known face position. Only fall back to center if no face has EVER been detected.
                chosen_center_x = last_known_center_x if last_known_center_x is not None else frame_center_x
            elif len(recent_tracks) >= 2:
                # Check Fallback 4: Both people fit in the crop
                boxes_orig = [
                    (tr.last_bbox[0] * scale_to_orig, tr.last_bbox[1] * scale_to_orig, tr.last_bbox[2] * scale_to_orig, tr.last_bbox[3] * scale_to_orig)
                    for tr in recent_tracks[:2]
                ]
                min_x = min(b[0] for b in boxes_orig)
                max_x = max(b[0] + b[2] for b in boxes_orig)
                span = max_x - min_x
                if span <= (crop_w * 0.88):
                    # Both fit in the crop! Center the pair
                    chosen_center_x = (min_x + max_x) / 2.0
                    last_known_center_x = chosen_center_x
                else:
                    # Score speaker between the tracks
                    speaker_track = max(recent_tracks, key=lambda tr: tr.recent_speech_score())
                    if speaker_track.recent_speech_score() > 0.04 and is_speech:
                        # Fallback 1: Active speaker
                        chosen_center_x = speaker_track.center_x_at_time(t)
                        last_active_speaker_track_id = speaker_track.track_id
                        last_speaker_time = t
                        last_known_center_x = chosen_center_x
                    elif last_active_speaker_track_id:
                        # Fallback 2: Hold last confirmed speaker during speech or short pause
                        hold_tr = active_tracks.get(last_active_speaker_track_id)
                        if hold_tr and abs(hold_tr.last_t - t) <= 0.3:
                            chosen_center_x = hold_tr.center_x_at_time(t)
                        elif last_known_center_x is not None:
                            chosen_center_x = last_known_center_x
                        else:
                            # Fallback 3: Most prominent face
                            prominent = max(recent_tracks, key=lambda tr: tr.last_bbox[2] * tr.last_bbox[3])
                            chosen_center_x = (prominent.last_bbox[0] + prominent.last_bbox[2] / 2.0) * scale_to_orig
                        last_known_center_x = chosen_center_x
                    else:
                        # Fallback 3: Most prominent face
                        prominent = max(recent_tracks, key=lambda tr: tr.last_bbox[2] * tr.last_bbox[3])
                        chosen_center_x = (prominent.last_bbox[0] + prominent.last_bbox[2] / 2.0) * scale_to_orig
                        last_known_center_x = chosen_center_x
            else:
                # Single face track
                tr = recent_tracks[0]
                chosen_center_x = tr.center_x_at_time(t)
                last_known_center_x = chosen_center_x
                if tr.recent_speech_score() > 0.03:
                    last_active_speaker_track_id = tr.track_id
                    last_speaker_time = t

            per_frame_target_x.append((t, chosen_center_x))
            frame_idx += 1

    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except Exception:
                process.kill()

    if not per_frame_target_x:
        # Fallback if no frames were read
        result = {
            "source_width": orig_w,
            "source_height": orig_h,
            "crop_width": crop_w,
            "crop_height": crop_h,
            "shots": [{"start": 0.0, "end": 999999.0, "x": int(max(0, (orig_w - crop_w) // 2))}],
        }
        analysis_cache.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return result

    # -----------------------------------------------------------------
    # Pass 2: Backward Alignment to Whisper/VAD Speech Starts
    # -----------------------------------------------------------------
    substantive_utterances = [u for u in speech_utterances if not u.get("is_backchannel", False)]

    if substantive_utterances and all_tracks:
        # Determine confirmed speaker track for each substantive utterance
        confirmed_utterances: list[dict[str, Any]] = []
        for u in substantive_utterances:
            u_start = u["start"]
            u_end = u["end"]

            # Candidate tracks active near or during this utterance
            candidate_tracks = [
                tr for tr in all_tracks.values()
                if any((u_start - 0.6) <= pt[0] <= (u_end + 0.6) for pt in tr.positions)
            ]
            if not candidate_tracks:
                continue

            if len(candidate_tracks) == 1:
                best_track = candidate_tracks[0]
            else:
                best_track = max(candidate_tracks, key=lambda tr: tr.speech_score_in_window(u_start, u_end))
                # If speech score is negligible, fallback to the one with largest face or keep previous speaker
                if best_track.speech_score_in_window(u_start, u_end) < 0.02 and confirmed_utterances:
                    prev_id = confirmed_utterances[-1].get("track_id")
                    match_prev = [tr for tr in candidate_tracks if tr.track_id == prev_id]
                    if match_prev:
                        best_track = match_prev[0]

            speaker_cx = best_track.center_x_at_time(u_start)
            confirmed_utterances.append({
                "start": u_start,
                "end": u_end,
                "track_id": best_track.track_id,
                "center_x": speaker_cx,
            })

        # Identify speaker switch cuts with ~150ms J-cut lead-in
        switch_cuts: list[tuple[float, float, int]] = []  # (cut_time, speaker_center_x, track_id)
        last_confirmed_cx: float | None = None
        last_track_id: int | None = None

        for u in confirmed_utterances:
            cx = u["center_x"]
            tid = u["track_id"]
            if last_confirmed_cx is None:
                lead_in = max(0.0, u["start"] - 0.15)
                switch_cuts.append((lead_in, cx, tid))
                last_confirmed_cx = cx
                last_track_id = tid
            else:
                diff = abs(cx - last_confirmed_cx)
                if diff > (crop_w * 0.35) and tid != last_track_id:
                    # Confirmed speaker switch! Cut backwards ~150ms before speech start
                    cut_t = max(0.0, u["start"] - 0.15)
                    switch_cuts.append((cut_t, cx, tid))
                    last_confirmed_cx = cx
                    last_track_id = tid

        # Align the per_frame_target_x timeline backwards
        if switch_cuts:
            refined_frame_targets: list[tuple[float, float]] = []
            cut_idx = 0
            current_target = switch_cuts[0][1]
            current_track = all_tracks.get(switch_cuts[0][2])

            for t, orig_cx in per_frame_target_x:
                while cut_idx + 1 < len(switch_cuts) and t >= switch_cuts[cut_idx + 1][0]:
                    cut_idx += 1
                    current_target = switch_cuts[cut_idx][1]
                    current_track = all_tracks.get(switch_cuts[cut_idx][2])

                if t < switch_cuts[0][0]:
                    chosen = switch_cuts[0][1]
                else:
                    if current_track:
                        chosen = current_track.center_x_at_time(t)
                    else:
                        chosen = current_target
                refined_frame_targets.append((t, chosen))
            per_frame_target_x = refined_frame_targets

    # Convert target center X to crop left X with Dead Zones
    max_left = max(0, orig_w - crop_w)
    dead_zone_pixels = crop_w * 0.08  # 8% dead zone to eliminate micro-jitter

    raw_shots: list[dict[str, Any]] = []

    current_shot_start = 0.0
    current_center_x = per_frame_target_x[0][1]
    current_crop_left = max(0.0, min(max_left, current_center_x - crop_w / 2.0))

    for i in range(len(per_frame_target_x)):
        t, target_center_x = per_frame_target_x[i]
        diff_from_current = abs(target_center_x - current_center_x)
        is_speaker_switch = diff_from_current > (crop_w * 0.35)

        if is_speaker_switch:
            # Cut directly! (No forward lock here; min_shot_duration is handled in Pass 2 via merging)
            raw_shots.append({
                "start": round(current_shot_start, 3),
                "end": round(t, 3),
                "x": int(round(current_crop_left)),
            })
            current_shot_start = t
            current_center_x = target_center_x
            current_crop_left = max(0.0, min(max_left, target_center_x - crop_w / 2.0))
        elif diff_from_current > dead_zone_pixels and not is_speaker_switch:
            # Same speaker moved beyond dead zone: re-center gently
            current_center_x = target_center_x
            current_crop_left = max(0.0, min(max_left, target_center_x - crop_w / 2.0))

    # Append final shot
    final_t = per_frame_target_x[-1][0] + frame_interval
    raw_shots.append({
        "start": round(current_shot_start, 3),
        "end": round(final_t + 10.0, 3),
        "x": int(round(current_crop_left)),
    })

    # Pass 2: Merge shots shorter than min_shot_duration (1.6s)
    merged_shots = _merge_short_shots(raw_shots, min_duration=1.6, crop_width=crop_w)

    # Consolidate adjacent shots with near-identical x
    consolidated_shots: list[dict[str, Any]] = []
    for shot in merged_shots:
        if not consolidated_shots:
            consolidated_shots.append(shot)
        else:
            prev = consolidated_shots[-1]
            if abs(prev["x"] - shot["x"]) <= 4:
                prev["end"] = shot["end"]
            else:
                consolidated_shots.append(shot)

    result = {
        "source_width": orig_w,
        "source_height": orig_h,
        "crop_width": crop_w,
        "crop_height": crop_h,
        "shots": consolidated_shots,
    }
    analysis_cache.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def get_crop_filter_for_clip(
    tracking_data: dict[str, Any],
    clip_start: float,
    clip_end: float,
) -> tuple[int, int, str]:
    """
    Returns (crop_width, crop_height, x_expression) for FFmpeg crop filter.
    Example expression:
      Single shot: "320"
      Multiple cuts: "if(lt(t,4.520),320,if(lt(t,8.120),860,540))"
    """
    crop_w = int(tracking_data.get("crop_width", 720))
    crop_h = int(tracking_data.get("crop_height", 1280))
    shots = tracking_data.get("shots", [])

    if not shots:
        return crop_w, crop_h, "(in_w-out_w)/2"

    # Filter shots overlapping [clip_start, clip_end]
    relevant_shots: list[tuple[float, int]] = []  # (rel_cut_time, x)
    clip_duration = clip_end - clip_start

    for s in shots:
        s_start = float(s.get("start", 0.0))
        s_end = float(s.get("end", 0.0))
        x = int(s.get("x", 0))

        if s_end > clip_start and s_start < clip_end:
            rel_end = min(clip_duration, s_end - clip_start)
            relevant_shots.append((rel_end, x))

    if not relevant_shots:
        return crop_w, crop_h, str(shots[0].get("x", "(in_w-out_w)/2"))

    # If only 1 shot or all relevant shots have the same x
    unique_xs = set(x for _, x in relevant_shots)
    if len(unique_xs) == 1:
        return crop_w, crop_h, str(relevant_shots[0][1])

    # Build nested if(lt(t, cut), x_cur, ...) expression
    # Remove the last cut threshold since it covers the remainder of the clip
    expr = str(relevant_shots[-1][1])
    for cut_t, x in reversed(relevant_shots[:-1]):
        expr = f"if(lt(t,{cut_t:.3f}),{x},{expr})"

    return crop_w, crop_h, expr


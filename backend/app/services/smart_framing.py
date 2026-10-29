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

from app.services.process_utils import get_no_window_subprocess_kwargs

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


def _stream_rotation(stream: dict[str, Any]) -> int:
    """Rotation in degrees from ffprobe stream JSON (legacy 'rotate' tag or display matrix)."""
    rotation = 0
    try:
        rotation = int(float((stream.get("tags") or {}).get("rotate", 0)))
    except (TypeError, ValueError):
        pass
    for side_data in stream.get("side_data_list") or []:
        if isinstance(side_data, dict) and "rotation" in side_data:
            try:
                rotation = int(float(side_data["rotation"]))
            except (TypeError, ValueError):
                pass
    return rotation


def probe_video_dimensions(source_path: Path, ffmpeg_path: str | None = None) -> tuple[int, int]:
    """Probe the original video width and height using ffprobe or ffmpeg."""
    try:
        from app.services.video_editor import find_ffprobe
        ffprobe_path = find_ffprobe(ffmpeg_path)
    except Exception:
        ffprobe_path = shutil.which("ffprobe")

    if ffprobe_path:
        try:
            cmd = [
                ffprobe_path,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
                "-of", "json",
                str(source_path),
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10,
                **get_no_window_subprocess_kwargs(),
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                streams = data.get("streams", [])
                if streams:
                    w = int(streams[0].get("width", 0))
                    h = int(streams[0].get("height", 0))
                    if w > 0 and h > 0:
                        if abs(_stream_rotation(streams[0])) % 180 == 90:
                            w, h = h, w
                        return w, h
        except Exception as e:
            logger.warning("ffprobe check failed: %s", e)

    # Fallback using ffmpeg -i inspection
    try:
        from app.services.video_editor import find_ffmpeg
        ff_exec = ffmpeg_path or find_ffmpeg()
    except Exception:
        ff_exec = ffmpeg_path or shutil.which("ffmpeg") or "ffmpeg"
    try:
        res = subprocess.run(
            [ff_exec, "-i", str(source_path)],
            capture_output=True,
            text=True,
            timeout=10,
            **get_no_window_subprocess_kwargs(),
        )
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
    """Check if speech is happening at timestamp t using binary search."""
    if not speech_windows:
        return False
    import bisect
    idx = bisect.bisect_right(speech_windows, (t, float("inf")))
    if idx > 0:
        prev_s, prev_e = speech_windows[idx - 1]
        if prev_s <= t <= prev_e:
            return True
    if idx < len(speech_windows):
        next_s, next_e = speech_windows[idx]
        if next_s <= t <= next_e:
            return True
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


# ---------------------------------------------------------------------------
# Tuning constants (all distances are fractions of the 9:16 crop width)
# ---------------------------------------------------------------------------
# Bump whenever the analysis algorithm changes so stale tracking_analysis.json
# caches produced by older code are recomputed instead of silently reused.
ANALYSIS_VERSION = 3

SAMPLE_FPS = 4.0             # face sampling cadence (250 ms) - enough for lip-motion cues
SAMPLE_WIDTH = 640           # detector input width; faces >= ~20px here are reliable for YuNet
MIN_FACE_PX = 20             # ignore detections smaller than this (in sample pixels)
DETECTION_THRESHOLD = 0.6    # YuNet confidence
MIN_TRACK_FRAMES = 3         # tracks seen < 3 samples (0.75 s) are treated as detector noise
TRACK_LOST_SECONDS = 1.5     # track leaves the active set after this long unseen
REID_SECONDS = 4.0           # a lost track can be re-identified (same id) within this window
HOLD_SECONDS = 2.5           # keep framing a speaker this long after their face disappears
SWITCH_FRACTION = 0.35       # target moves > 35% of crop width => hard cut
DEAD_ZONE_FRACTION = 0.08    # target moves < 8% of crop width => ignore (micro jitter)
TWO_SHOT_ENTER = 0.85        # enter two-shot when both faces span <= 85% of the crop
TWO_SHOT_EXIT = 0.92         # leave two-shot only when span grows past 92% (hysteresis)
MIN_SHOT_SECONDS = 1.6       # no shot shorter than this survives (anti strobe-cut)
PAN_SECONDS = 0.6            # same-subject re-framing eases over this long instead of jumping
J_CUT_LEAD = 0.15            # cut to the new speaker 150 ms before their first word
SPEECH_SCORE_FLOOR = 0.02    # minimum lip-motion score to call someone the active speaker
SPEAKER_MARGIN = 1.3         # winner must beat the runner-up by 30% or we keep the current speaker

_VIDEO_SUFFIXES = {
    ".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".flv", ".ts", ".mpg", ".mpeg", ".wmv",
}

_ANALYSIS_LOCKS: dict[str, threading.Lock] = {}
_ANALYSIS_LOCKS_GUARD = threading.Lock()


def _normalize_patch(patch: np.ndarray) -> np.ndarray:
    """Zero-mean / unit-contrast patch so lighting & exposure changes don't look like motion."""
    p = patch.astype(np.float32)
    std = max(float(p.std()), 6.0)  # floor stops flat (featureless) patches amplifying noise
    return (p - float(p.mean())) / std


def _patch_motion(current: np.ndarray | None, previous: np.ndarray | None) -> float:
    """Texture and intensity change between two patches, normalized in [0, 1]."""
    if current is None or previous is None or current.shape != previous.shape:
        return 0.0
    c_f = current.astype(np.float32)
    p_f = previous.astype(np.float32)
    raw_diff = float(np.mean(np.abs(c_f - p_f))) / 255.0
    norm_diff = float(np.mean(np.abs(_normalize_patch(current) - _normalize_patch(previous)))) / 4.0
    return max(raw_diff, min(1.0, norm_diff))


class _FaceTrack:
    def __init__(
        self,
        track_id: int,
        bbox: tuple[float, float, float, float],
        landmarks: np.ndarray,
        t: float,
        center_x_orig: float,
        width_orig: float | None = None,
    ):
        self.track_id = track_id
        self.last_bbox = bbox
        self.last_landmarks = landmarks
        self.last_t = t
        self.first_t = t
        self.frame_count = 1
        self.last_mouth_patch: np.ndarray | None = None
        self.last_nose_patch: np.ndarray | None = None
        # Full-length histories (no caps): Pass 2 needs scores/positions for the whole video.
        self.timestamps: list[float] = [t]
        self.centers: list[float] = [center_x_orig]
        self.widths: list[float] = [float(width_orig if width_orig is not None else bbox[2])]
        self.score_times: list[float] = []
        self.scores: list[float] = []

    def update(
        self,
        bbox: tuple[float, float, float, float],
        landmarks: np.ndarray,
        t: float,
        mouth_patch: np.ndarray | None,
        is_speaking_audio: bool,
        center_x_orig: float,
        nose_patch: np.ndarray | None = None,
        width_orig: float | None = None,
    ):
        gap = t - self.last_t
        self.last_bbox = bbox
        self.last_landmarks = landmarks
        self.last_t = t
        self.frame_count += 1
        self.timestamps.append(t)
        self.centers.append(center_x_orig)
        self.widths.append(float(width_orig if width_orig is not None else bbox[2]))

        # Patches more than ~1 s apart are not comparable (head turned, re-identified track):
        # comparing them would produce fake "mouth motion".
        if gap <= 1.0:
            motion = _patch_motion(mouth_patch, self.last_mouth_patch)
            if nose_patch is not None and self.last_nose_patch is not None:
                # The nose region is rigid: its change measures head motion / nodding / camera
                # shake. Subtracting it isolates genuine mouth articulation, so nodding
                # listeners are not mistaken for speakers.
                motion = max(0.0, motion - _patch_motion(nose_patch, self.last_nose_patch))
            speech_score = motion * (1.5 if is_speaking_audio else 0.1)
            self.score_times.append(t)
            self.scores.append(speech_score)

        if mouth_patch is not None:
            self.last_mouth_patch = mouth_patch
        if nose_patch is not None:
            self.last_nose_patch = nose_patch

    def recent_speech_score(self, window_seconds: float = 1.0) -> float:
        if not self.scores:
            return 0.0
        import bisect
        lo = bisect.bisect_left(self.score_times, self.last_t - window_seconds)
        recent = self.scores[lo:]
        return float(np.mean(recent)) if recent else 0.0

    def speech_score_in_window(self, start_t: float, end_t: float) -> float:
        """Calculate mean speech score in a given time window."""
        import bisect
        lo = bisect.bisect_left(self.score_times, start_t - 0.25)
        hi = bisect.bisect_right(self.score_times, end_t + 0.25)
        scores = self.scores[lo:hi]
        return float(np.mean(scores)) if scores else 0.0

    def samples_in_window(self, start_t: float, end_t: float) -> int:
        import bisect
        return bisect.bisect_right(self.timestamps, end_t) - bisect.bisect_left(self.timestamps, start_t)

    def mean_width_in_window(self, start_t: float, end_t: float) -> float:
        import bisect
        lo = bisect.bisect_left(self.timestamps, start_t)
        hi = bisect.bisect_right(self.timestamps, end_t)
        ws = self.widths[lo:hi]
        return float(np.mean(ws)) if ws else 0.0

    def center_x_at_time(self, target_t: float, max_gap: float = 3.0) -> float | None:
        """Return the closest known center X position for this track if within max_gap seconds, else None."""
        if not self.timestamps:
            return float(self.last_bbox[0] + self.last_bbox[2] / 2.0)
        import bisect
        n = len(self.timestamps)
        idx = bisect.bisect_left(self.timestamps, target_t)
        best_idx = min(idx, n - 1)
        if idx > 0 and abs(self.timestamps[idx - 1] - target_t) < abs(self.timestamps[best_idx] - target_t):
            best_idx = idx - 1
        if abs(self.timestamps[best_idx] - target_t) > max_gap:
            return None
        return self.centers[best_idx]


# A visible face in one sampled frame: (track_id, center_x_orig, width_orig)
_Visible = tuple[int, float, float]


class _FaceTracker:
    """Associates per-frame detections into persistent face tracks.

    Detections are dicts with keys: bbox (sample px), landmarks, mouth_patch, nose_patch.
    """

    def __init__(self, scale_to_orig: float = 1.0):
        self.scale_to_orig = scale_to_orig
        self.all_tracks: dict[int, _FaceTrack] = {}
        self.active: dict[int, _FaceTrack] = {}
        self.next_id = 1

    @staticmethod
    def _match_score(track_bbox, det_bbox) -> float:
        """> 0 means 'same face'. IoU first; center distance fallback survives fast motion."""
        iou = _compute_iou(track_bbox, det_bbox)
        if iou >= 0.2:
            return 1.0 + iou
        tw, dw = track_bbox[2], det_bbox[2]
        if tw <= 0 or dw <= 0:
            return 0.0
        ratio = dw / tw
        if not (0.6 <= ratio <= 1.67):
            return 0.0
        tcx, tcy = track_bbox[0] + tw / 2.0, track_bbox[1] + track_bbox[3] / 2.0
        dcx, dcy = det_bbox[0] + dw / 2.0, det_bbox[1] + det_bbox[3] / 2.0
        dist = ((tcx - dcx) ** 2 + (tcy - dcy) ** 2) ** 0.5 / max(tw, dw)
        return (1.0 - dist) if dist < 0.6 else 0.0

    def process(self, t: float, detections: list[dict[str, Any]], is_speech: bool) -> list[_Visible]:
        for tid, tr in list(self.active.items()):
            if t - tr.last_t > TRACK_LOST_SECONDS:
                self.active.pop(tid, None)

        # Global greedy assignment (best pairs first) - independent of dict iteration order.
        pairs = []
        for tid, tr in self.active.items():
            for di, det in enumerate(detections):
                s = self._match_score(tr.last_bbox, det["bbox"])
                if s > 0:
                    pairs.append((s, tid, di))
        pairs.sort(key=lambda p: p[0], reverse=True)
        used_tracks: set[int] = set()
        assigned: dict[int, int] = {}
        for _, tid, di in pairs:
            if tid in used_tracks or di in assigned:
                continue
            used_tracks.add(tid)
            assigned[di] = tid

        # Re-identify unmatched detections against recently lost tracks (same person
        # re-appearing after a head turn / occlusion keeps their id and history).
        for di, det in enumerate(detections):
            if di in assigned:
                continue
            best_tid, best_s = None, 0.0
            for tid, tr in self.all_tracks.items():
                if tid in self.active or tid in used_tracks:
                    continue
                if not (0 < t - tr.last_t <= REID_SECONDS):
                    continue
                s = self._match_score(tr.last_bbox, det["bbox"])
                if s > best_s:
                    best_tid, best_s = tid, s
            if best_tid is not None:
                assigned[di] = best_tid
                used_tracks.add(best_tid)
                self.active[best_tid] = self.all_tracks[best_tid]

        visible: list[_Visible] = []
        for di, det in enumerate(detections):
            bbox = det["bbox"]
            cx = (bbox[0] + bbox[2] / 2.0) * self.scale_to_orig
            w = bbox[2] * self.scale_to_orig
            tid = assigned.get(di)
            if tid is not None:
                self.active[tid].update(
                    bbox, det.get("landmarks"), t, det.get("mouth_patch"), is_speech, cx,
                    nose_patch=det.get("nose_patch"), width_orig=w,
                )
            else:
                tid = self.next_id
                self.next_id += 1
                tr = _FaceTrack(tid, bbox, det.get("landmarks"), t, cx, width_orig=w)
                tr.last_mouth_patch = det.get("mouth_patch")
                tr.last_nose_patch = det.get("nose_patch")
                self.active[tid] = tr
                self.all_tracks[tid] = tr
            visible.append((tid, cx, w))
        return visible


class _Pass1Director:
    """Real-time fallback framing used when no transcript/speaker assignment applies."""

    def __init__(self, orig_w: int, crop_w: int):
        self.frame_center = orig_w / 2.0
        self.crop_w = crop_w
        self.last_cx: float | None = None
        self.last_face_t = -1e9
        self.speaker_id: int | None = None

    def choose(self, t: float, visible: list[_Visible], tracks: dict[int, _FaceTrack], is_speech: bool) -> float:
        if not visible:
            if self.last_cx is not None and t - self.last_face_t <= HOLD_SECONDS:
                return self.last_cx
            # No face for a while (B-roll, slides, screen share): natural center.
            self.speaker_id = None
            return self.frame_center
        self.last_face_t = t

        if len(visible) == 1:
            tid, cx, _ = visible[0]
            self.speaker_id = tid
            self.last_cx = cx
            return cx

        # Two largest faces (not just the first two found) decide the two-shot.
        top2 = sorted(visible, key=lambda v: v[2], reverse=True)[:2]
        left = min(cx - w / 2.0 for _, cx, w in top2)
        right = max(cx + w / 2.0 for _, cx, w in top2)
        if right - left <= TWO_SHOT_ENTER * self.crop_w:
            self.last_cx = (left + right) / 2.0
            return self.last_cx

        scored = sorted(((tracks[v[0]].recent_speech_score(), v) for v in visible), key=lambda s: s[0], reverse=True)
        (best, best_v), (second, _) = scored[0], scored[1]
        if is_speech and best >= SPEECH_SCORE_FLOOR and best >= SPEAKER_MARGIN * second:
            chosen = best_v
        else:
            chosen = next((v for v in visible if v[0] == self.speaker_id), None) or max(visible, key=lambda v: v[2])
        self.speaker_id = chosen[0]
        self.last_cx = chosen[1]
        return chosen[1]


def _assign_speakers(
    utterances: list[dict[str, Any]],
    tracks: dict[int, _FaceTrack],
) -> list[tuple[float, int]]:
    """Map substantive utterances to face tracks.

    Returns speaker changes as (start_time, track_id). The first entry always starts at
    0.0 so a clip opens on its first speaker immediately (no hunting during the hook).
    """
    eligible = [tr for tr in tracks.values() if tr.frame_count >= MIN_TRACK_FRAMES]
    assignments: list[tuple[float, int]] = []
    prev_id: int | None = None

    for u in utterances:
        if u.get("is_backchannel", False):
            continue
        s, e = float(u["start"]), float(u["end"])
        cands = [
            tr for tr in eligible
            if tr.first_t <= e + 0.6 and tr.last_t >= s - 0.6 and tr.samples_in_window(s - 0.6, e + 0.6) > 0
        ]
        if not cands:
            continue
        if len(cands) == 1:
            best = cands[0]
        else:
            scored = sorted(((tr.speech_score_in_window(s, e), tr) for tr in cands), key=lambda x: x[0], reverse=True)
            (top, top_tr), (second, _) = scored[0], scored[1]
            if top >= SPEECH_SCORE_FLOOR and top >= SPEAKER_MARGIN * second:
                best = top_tr
            else:
                # Ambiguous lip evidence: keep the current speaker (stability beats guessing),
                # otherwise the most prominent (largest) face.
                best = next((tr for tr in cands if tr.track_id == prev_id), None) or max(
                    cands, key=lambda tr: tr.mean_width_in_window(s, e)
                )
        if best.track_id != prev_id:
            assignments.append((max(0.0, s - J_CUT_LEAD), best.track_id))
            prev_id = best.track_id

    if assignments:
        assignments[0] = (0.0, assignments[0][1])
    return assignments


def _build_target_timeline(
    frames: list[tuple[float, list[_Visible], float]],
    tracks: dict[int, _FaceTrack],
    assignments: list[tuple[float, int]],
    crop_w: int,
) -> list[tuple[float, float, bool]]:
    """Per-sample desired crop center: [(t, center_x, is_speaker_switch)].

    Speaker switches are emitted at their exact J-cut time (not snapped to the sample grid).
    """
    if not assignments:
        return [(t, p1, False) for t, _, p1 in frames]

    eligible_ids = {tid for tid, tr in tracks.items() if tr.frame_count >= MIN_TRACK_FRAMES}
    timeline: list[tuple[float, float, bool]] = []
    ai = 0
    in_two_shot = False

    for t, visible, pass1_cx in frames:
        switched = False
        while ai + 1 < len(assignments) and assignments[ai + 1][0] <= t:
            ai += 1
            switched = True
        speaker = assignments[ai][1]

        vis = {tid: (cx, w) for tid, cx, w in visible if tid in eligible_ids or tid == speaker}
        if speaker in vis:
            scx, sw = vis[speaker]
            target = scx
            others = sorted(((abs(cx - scx), cx, w) for tid, (cx, w) in vis.items() if tid != speaker))
            if others:
                _, ocx, ow = others[0]
                left = min(scx - sw / 2.0, ocx - ow / 2.0)
                right = max(scx + sw / 2.0, ocx + ow / 2.0)
                limit = (TWO_SHOT_EXIT if in_two_shot else TWO_SHOT_ENTER) * crop_w
                in_two_shot = (right - left) <= limit
                if in_two_shot:
                    target = (left + right) / 2.0
            else:
                in_two_shot = False
        else:
            in_two_shot = False
            held = tracks[speaker].center_x_at_time(t, max_gap=HOLD_SECONDS) if speaker in tracks else None
            # Speaker briefly off-screen: hold on them. Long gone (B-roll): Pass 1 framing.
            target = held if held is not None else pass1_cx

        if switched:
            cut_t = assignments[ai][0]
            prev_t = timeline[-1][0] if timeline else -1.0
            if prev_t < cut_t < t:
                timeline.append((cut_t, target, True))
                timeline.append((t, target, False))
                continue
        timeline.append((t, target, switched))
    return timeline


def _even_left(cx: float, crop_w: int, orig_w: int) -> int:
    max_left = max(0, orig_w - crop_w)
    x = int(round(min(float(max_left), max(0.0, cx - crop_w / 2.0))))
    return max(0, x - (x % 2))


def _build_shots(
    timeline: list[tuple[float, float, bool]],
    crop_w: int,
    orig_w: int,
    frame_interval: float,
) -> list[dict[str, Any]]:
    """Turn the target timeline into shots: hard cuts for speaker changes, eased pans for
    same-subject re-framing, nothing for micro-jitter."""
    switch_px = SWITCH_FRACTION * crop_w
    dead_px = DEAD_ZONE_FRACTION * crop_w

    shots: list[dict[str, Any]] = []
    start = 0.0
    anchor = timeline[0][1]
    pending = 0
    for t, cx, is_switch in timeline[1:]:
        d = abs(cx - anchor)
        reframe = False
        if d > switch_px or (is_switch and d > dead_px):
            reframe = True
        elif d > dead_px:
            # Subject drifted: only re-frame once the new position persists for 2 samples,
            # so a single bad detection never moves the camera.
            pending += 1
            reframe = pending >= 2
        else:
            pending = 0
        if reframe:
            shots.append({"start": round(start, 3), "end": round(t, 3), "x": _even_left(anchor, crop_w, orig_w)})
            start, anchor, pending = t, cx, 0

    shots.append({
        "start": round(start, 3),
        "end": round(timeline[-1][0] + frame_interval + 10.0, 3),
        "x": _even_left(anchor, crop_w, orig_w),
    })

    merged = _merge_short_shots(shots, min_duration=MIN_SHOT_SECONDS, crop_width=crop_w)

    consolidated: list[dict[str, Any]] = []
    for shot in merged:
        if consolidated and abs(consolidated[-1]["x"] - shot["x"]) <= 4:
            consolidated[-1]["end"] = shot["end"]
        else:
            consolidated.append(dict(shot))

    # Small moves ease (pan) instead of jumping; large moves stay hard cuts.
    for prev, shot in zip(consolidated, consolidated[1:]):
        if abs(shot["x"] - prev["x"]) <= switch_px:
            shot["pan_from"] = prev["x"]
            shot["pan_seconds"] = round(min(PAN_SECONDS, (shot["end"] - shot["start"]) / 2.0), 3)
    return consolidated


def _find_source_video(project_directory: Path) -> Path:
    candidates = [p for p in project_directory.glob("source.*") if p.is_file()]
    videos = [p for p in candidates if p.suffix.lower() in _VIDEO_SUFFIXES]
    if not videos:
        # Unknown container: accept anything that is not an obvious partial/metadata file.
        videos = [p for p in candidates if not p.name.lower().endswith((".part", ".ytdl", ".json", ".txt", ".tmp"))]
    if not videos:
        raise FileNotFoundError("Source video not found in project directory")
    return max(videos, key=lambda p: p.stat().st_size)


def _source_signature(path: Path) -> dict[str, Any]:
    st = path.stat()
    return {"name": path.name, "size": st.st_size, "mtime": int(st.st_mtime)}


def _write_cache(path: Path, result: dict[str, Any]) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(json.dumps(result, indent=2), encoding="utf-8")
        os.replace(tmp, path)  # atomic: a crash never leaves a half-written cache
    except OSError as e:
        logger.warning("Could not write tracking cache %s: %s", path, e)
        tmp.unlink(missing_ok=True)


def _crop_patch(gray: np.ndarray, cx: float, cy: float, w: int, h: int, out: tuple[int, int]) -> np.ndarray | None:
    import cv2
    H, W = gray.shape[:2]
    x1 = max(0, int(cx - w / 2))
    y1 = max(0, int(cy - h / 2))
    x2 = min(W, x1 + w)
    y2 = min(H, y1 + h)
    if x2 - x1 < 4 or y2 - y1 < 4:
        return None
    return cv2.resize(gray[y1:y2, x1:x2], out, interpolation=cv2.INTER_AREA)


def _scan_faces(
    source_path: Path,
    ffmpeg_path: str,
    orig_w: int,
    orig_h: int,
    crop_w: int,
    speech_windows: list[tuple[float, float]],
    video_duration: float,
    cancel_event: threading.Event | None,
    progress_callback: Any | None,
    max_duration: float | None = None,
) -> tuple[list[tuple[float, list[_Visible], float]], dict[int, _FaceTrack], float]:
    """Decode sampled frames, detect faces, track them and record Pass 1 targets."""
    import cv2

    sample_w = min(SAMPLE_WIDTH, orig_w)
    sample_w -= sample_w % 2
    sample_h = int(round(sample_w * orig_h / orig_w))
    sample_h += sample_h % 2
    scale_to_orig = orig_w / float(sample_w)

    detector = cv2.FaceDetectorYN.create(
        model=str(get_yunet_model_path()),
        config="",
        input_size=(sample_w, sample_h),
        score_threshold=DETECTION_THRESHOLD,
        nms_threshold=0.3,
        top_k=5000,
    )

    frame_interval = 1.0 / SAMPLE_FPS
    frame_bytes = sample_w * sample_h * 3
    ffmpeg_cmd = [
        ffmpeg_path,
        "-hide_banner", "-loglevel", "error",
        "-threads", "0",
        "-i", str(source_path),
        "-an", "-sn", "-dn",  # never demux/decode audio, subs or data for this pass
        "-vf", f"fps={SAMPLE_FPS:g},scale={sample_w}:{sample_h}:flags=area",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "pipe:",
    ]
    process = subprocess.Popen(
        ffmpeg_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        **get_no_window_subprocess_kwargs(),
    )

    tracker = _FaceTracker(scale_to_orig)
    director = _Pass1Director(orig_w, crop_w)
    frames: list[tuple[float, list[_Visible], float]] = []
    report_every = max(1, int(SAMPLE_FPS * 5))
    frame_idx = 0
    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                process.kill()
                from app.services.video_editor import ClipGenerationCancelled
                raise ClipGenerationCancelled("Clip generation was cancelled")

            raw = process.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:
                break

            t = frame_idx * frame_interval
            if max_duration is not None and t >= max_duration:
                process.terminate()
                break
            if progress_callback and frame_idx % report_every == 0:
                pct = min(99, int(round((t / max(1.0, video_duration)) * 100)))
                progress_callback(f"Analyzing speaker tracking (True 9:16): {pct}%", int(t), int(video_duration))

            frame = np.frombuffer(raw, dtype=np.uint8).reshape((sample_h, sample_w, 3))
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            is_speech = _is_speech_active(t, speech_windows)

            _, faces = detector.detect(frame)
            detections: list[dict[str, Any]] = []
            if faces is not None:
                for f in faces:
                    x, y, w, h = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                    if w < MIN_FACE_PX or h < MIN_FACE_PX:
                        continue
                    lms = f[4:14].reshape((5, 2))  # right_eye, left_eye, nose, right_mouth, left_mouth
                    reye, leye, nose, rm, lm = lms
                    mouth_w = max(12, int(abs(lm[0] - rm[0]) * 1.5))
                    eye_dist = max(8.0, float(np.hypot(*(leye - reye))))
                    nose_sz = max(8, int(eye_dist * 0.5))
                    detections.append({
                        "bbox": (x, y, w, h),
                        "landmarks": lms,
                        "mouth_patch": _crop_patch(
                            gray, (rm[0] + lm[0]) / 2.0, (rm[1] + lm[1]) / 2.0, mouth_w, max(10, int(mouth_w * 0.7)), (24, 16)
                        ),
                        "nose_patch": _crop_patch(gray, nose[0], nose[1], nose_sz, nose_sz, (16, 16)),
                    })

            visible = tracker.process(t, detections, is_speech)
            frames.append((t, visible, director.choose(t, visible, tracker.all_tracks, is_speech)))
            frame_idx += 1
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except Exception:
                process.kill()

    return frames, tracker.all_tracks, frame_interval


def analyze_speaker_tracking(
    project_directory: Path,
    ffmpeg_path: str,
    cancel_event: threading.Event | None = None,
    progress_callback: Any | None = None,
    max_duration: float | None = None,
) -> dict[str, Any]:
    """
    Run YuNet face detection and mouth-movement speech correlation across the video.
    Caches the resulting shot/crop tracking timeline in tracking_analysis.json.
    """
    key = str(Path(project_directory).resolve())
    with _ANALYSIS_LOCKS_GUARD:
        lock = _ANALYSIS_LOCKS.setdefault(key, threading.Lock())
    # One analysis per project at a time: a concurrent caller waits and then hits the cache
    # instead of decoding the whole video a second time.
    with lock:
        return _analyze_speaker_tracking_locked(project_directory, ffmpeg_path, cancel_event, progress_callback, max_duration=max_duration)


def _analyze_speaker_tracking_locked(
    project_directory: Path,
    ffmpeg_path: str,
    cancel_event: threading.Event | None,
    progress_callback: Any | None,
    max_duration: float | None = None,
) -> dict[str, Any]:
    source_path = _find_source_video(project_directory)
    signature = _source_signature(source_path)
    analysis_cache = project_directory / "tracking_analysis.json"
    if analysis_cache.is_file():
        try:
            cached = json.loads(analysis_cache.read_text(encoding="utf-8"))
            if (
                isinstance(cached, dict)
                and "shots" in cached
                and cached.get("version") == ANALYSIS_VERSION
                and cached.get("source") == signature
            ):
                return cached
        except Exception:
            pass

    orig_w, orig_h = probe_video_dimensions(source_path, ffmpeg_path)
    crop_h = orig_h if orig_h % 2 == 0 else orig_h - 1
    crop_w = int(round(crop_h * 9.0 / 16.0))
    if crop_w % 2 != 0:
        crop_w -= 1

    base = {
        "version": ANALYSIS_VERSION,
        "source": signature,
        "source_width": orig_w,
        "source_height": orig_h,
        "crop_width": crop_w,
        "crop_height": crop_h,
    }

    # If already vertical (e.g. 1080x1920 or width <= crop_w + 4), skip reframing
    if orig_w <= crop_w + 4 or (orig_w / orig_h) <= (9.0 / 16.0 + 0.05):
        result = {
            **base,
            "already_vertical": True,
            "crop_width": orig_w,
            "crop_height": orig_h,
            "shots": [{"start": 0.0, "end": 999999.0, "x": 0}],
        }
        _write_cache(analysis_cache, result)
        return result

    center_fallback = {**base, "shots": [{"start": 0.0, "end": 999999.0, "x": _even_left(orig_w / 2.0, crop_w, orig_w)}]}

    # Prepare speech windows and utterances from VAD / faster-whisper transcript
    speech_windows = _load_speech_windows(project_directory)
    speech_utterances = _load_speech_utterances(project_directory)

    video_duration = 100.0
    try:
        from app.services.video_editor import get_media_duration
        d = get_media_duration(source_path, ffmpeg_path)
        if d and d > 0:
            video_duration = float(d)
    except Exception:
        pass

    from app.services.video_editor import ClipGenerationCancelled
    try:
        effective_duration = min(video_duration, max_duration) if max_duration is not None else video_duration
        frames, tracks, frame_interval = _scan_faces(
            source_path, ffmpeg_path, orig_w, orig_h, crop_w,
            speech_windows, effective_duration, cancel_event, progress_callback,
            max_duration=max_duration,
        )
    except ClipGenerationCancelled:
        raise
    except Exception as e:
        # Missing OpenCV/model, unreadable video... Cache a centered result so each of the
        # N clip renders does not re-run (and re-fail) a full-video scan.
        logger.exception("Smart framing analysis failed; using centered crop")
        result = {**center_fallback, "fallback_reason": f"{type(e).__name__}: {e}"}
        _write_cache(analysis_cache, result)
        return result

    if cancel_event is not None and cancel_event.is_set():
        raise ClipGenerationCancelled("Clip generation was cancelled")

    if progress_callback:
        progress_callback("Optimizing camera cuts and speaker alignment...", int(video_duration), int(video_duration))

    if not frames:
        result = {**center_fallback, "fallback_reason": "no frames decoded"}
        _write_cache(analysis_cache, result)
        return result

    assignments = _assign_speakers(speech_utterances, tracks)
    timeline = _build_target_timeline(frames, tracks, assignments, crop_w)
    shots = _build_shots(timeline, crop_w, orig_w, frame_interval)

    result = {**base, "shots": shots}
    _write_cache(analysis_cache, result)
    return result


def _shot_value_expr(rel_start: float, x: int, pan_from: int | None, pan_seconds: float) -> str:
    """FFmpeg expression for one shot's x: constant, or a smoothstep ease from pan_from."""
    if pan_from is None or pan_from == x or pan_seconds <= 0 or rel_start + pan_seconds <= 0:
        return str(x)
    u = f"((t-({rel_start:.3f}))/{pan_seconds:.3f})"
    return f"if(lt(t,{rel_start + pan_seconds:.3f}),{pan_from}+({x - pan_from})*{u}*{u}*(3-2*{u}),{x})"


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
    Shots carrying "pan_from" ease into their x over "pan_seconds" instead of jumping.
    """
    crop_w = int(tracking_data.get("crop_width", 720))
    crop_h = int(tracking_data.get("crop_height", 1280))
    shots = tracking_data.get("shots", [])

    if not shots:
        return crop_w, crop_h, "(in_w-out_w)/2"

    # Filter shots overlapping [clip_start, clip_end]
    relevant: list[tuple[float, str, int, bool]] = []  # (rel_end, value_expr, x, is_static)
    clip_duration = clip_end - clip_start

    for s in shots:
        s_start = float(s.get("start", 0.0))
        s_end = float(s.get("end", 0.0))
        x = int(s.get("x", 0))

        if s_end > clip_start and s_start < clip_end:
            rel_end = min(clip_duration, s_end - clip_start)
            pan_from = s.get("pan_from")
            value = _shot_value_expr(
                s_start - clip_start, x,
                int(pan_from) if pan_from is not None else None,
                float(s.get("pan_seconds", PAN_SECONDS)),
            )
            relevant.append((rel_end, value, x, value == str(x)))

    if not relevant:
        return crop_w, crop_h, str(shots[0].get("x", "(in_w-out_w)/2"))

    # If only 1 shot or all relevant shots have the same static x
    if all(r[3] for r in relevant) and len({r[2] for r in relevant}) == 1:
        return crop_w, crop_h, str(relevant[0][2])

    # Build nested if(lt(t, cut), x_cur, ...) expression
    # Remove the last cut threshold since it covers the remainder of the clip
    expr = relevant[-1][1]
    for cut_t, value, _, _ in reversed(relevant[:-1]):
        expr = f"if(lt(t,{cut_t:.3f}),{value},{expr})"

    return crop_w, crop_h, expr

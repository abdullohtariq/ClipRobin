import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from app.services.process_utils import get_no_window_subprocess_kwargs

logger = logging.getLogger(__name__)


def _find_model_file(filename: str) -> Path:
    """Locate an ONNX model file across PyInstaller bundle, service dir, or workspace."""
    # 1. PyInstaller frozen path
    if hasattr(sys, "_MEIPASS"):
        meipass_path = Path(sys._MEIPASS) / "app" / "models" / filename
        if meipass_path.is_file():
            return meipass_path

    # 2. Relative to this service file
    service_model = Path(__file__).resolve().parent.parent / "models" / filename
    if service_model.is_file():
        return service_model

    # 3. Project root relative
    root_model = Path(__file__).resolve().parents[3] / "backend" / "app" / "models" / filename
    if root_model.is_file():
        return root_model

    # 4. Working directory relative
    cwd_model = (Path("backend/app/models") / filename).resolve()
    if cwd_model.is_file():
        return cwd_model

    raise FileNotFoundError(f"Face detection ONNX model '{filename}' not found")


def get_yunet_model_path() -> Path:
    """Find or return the path to face_detection_yunet_2023mar.onnx."""
    return _find_model_file("face_detection_yunet_2023mar.onnx")


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
            "words": seg.get("words") if isinstance(seg.get("words"), list) else [],
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
    Eliminates forward-locking during frame tracking and absorbs transient blips,
    while respecting hard visual scene cuts (`scene_locked=True`).
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
            if shot.get("scene_locked") and dur >= 0.75:
                continue
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
ANALYSIS_VERSION = 8

SAMPLE_FPS = 4.0             # face sampling cadence (250 ms) - enough for lip-motion cues
SAMPLE_WIDTH = 640           # width in pixels for face detection
MIN_FACE_PX = 10             # ignore detections smaller than this (in sample pixels; ~20px in 720p)
DETECTION_THRESHOLD = 0.52   # SCRFD confidence threshold
YUNET_THRESHOLD = 0.62       # YuNet confidence threshold
MIN_TRACK_FRAMES = 3         # tracks seen < 3 samples (0.75 s) are treated as detector noise
TRACK_LOST_SECONDS = 1.5     # track leaves the active set after this long unseen
REID_SECONDS = 4.0           # a lost track can be re-identified (same id) within this window
HOLD_SECONDS = 2.5           # keep framing a speaker this long after their face disappears
SWITCH_FRACTION = 0.35       # target moves > 35% of crop width => hard cut
DEAD_ZONE_FRACTION = 0.08    # target moves < 8% of crop width => ignore (micro jitter)
TWO_SHOT_ENTER = 0.78        # when two faces + padding fit within 78% of crop_w, frame both
TWO_SHOT_EXIT = 0.86         # hysteresis exit threshold for two-shot framing
MIN_SHOT_SECONDS = 1.6       # no shot shorter than this survives (anti strobe-cut)
PAN_SECONDS = 0.6            # same-subject re-framing eases over this long instead of jumping
J_CUT_LEAD = 0.15            # cut to the new speaker 150 ms before their first word
SPEECH_SCORE_FLOOR = 0.012   # minimum lip-motion score to call someone the active speaker
SPEAKER_MARGIN = 1.22        # winner must beat the runner-up by 22% or we keep the current speaker

_VIDEO_SUFFIXES = {
    ".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".flv", ".ts", ".mpg", ".mpeg", ".wmv",
}

_ANALYSIS_LOCKS: dict[str, threading.Lock] = {}
_ANALYSIS_LOCKS_GUARD = threading.Lock()
_MODEL_LOCK = threading.Lock()
_EXTERNAL_FACE_MODELS_ENV = "CLIPROBIN_FACE_MODEL_DIR"


def _is_plausible_face(
    bbox: tuple[float, float, float, float],
    landmarks: np.ndarray | None,
    frame_w: int = 640,
    frame_h: int = 360,
) -> bool:
    """Validate bounding box aspect ratio and anatomical 5-point landmark geometry.

    Eliminates false positives on circular wall decorations, backs of heads/necks,
    or background objects where landmarks are inverted, collapsed, or squished into a corner.
    """
    x, y, w, h = bbox
    if w < MIN_FACE_PX or h < MIN_FACE_PX:
        return False
    if w > frame_w * 0.92 or h > frame_h * 0.95:
        return False
    aspect = w / max(1.0, h)
    if not (0.40 <= aspect <= 1.45):
        return False

    if landmarks is None or landmarks.shape != (5, 2) or not np.any(landmarks != 0):
        return True

    reye, leye, nose, rm, lm = landmarks
    margin_x = w * 0.20
    margin_y = h * 0.20
    for lx, ly in landmarks:
        if not ((x - margin_x) <= lx <= (x + w + margin_x) and (y - margin_y) <= ly <= (y + h + margin_y)):
            return False

    eye_cy = 0.5 * (float(reye[1]) + float(leye[1]))
    mouth_cy = 0.5 * (float(rm[1]) + float(lm[1]))
    # Eyes must be meaningfully above the mouth
    if (mouth_cy - eye_cy) < 0.14 * h:
        return False

    # Nose must sit vertically between eye line and mouth line (with pitch tolerance)
    nose_y = float(nose[1])
    if nose_y < (eye_cy - 0.10 * h) or nose_y > (mouth_cy + 0.12 * h):
        return False

    # Total vertical span of landmarks must cover a reasonable fraction of the box height
    ys = landmarks[:, 1]
    if float(np.max(ys) - np.min(ys)) < 0.16 * h:
        return False

    return True


def _suppress_parasite_detections(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Suppress smaller overlapping or halo detections attached to a real higher-confidence face."""
    if len(detections) <= 1:
        return detections

    ranked = sorted(
        detections,
        key=lambda d: float(d.get("score", 0.7)) * ((d["bbox"][2] * d["bbox"][3]) ** 0.25),
        reverse=True,
    )
    kept: list[dict[str, Any]] = []
    for cand in ranked:
        cx, cy, cw, ch = cand["bbox"]
        c_area = max(1.0, cw * ch)
        c_center_x = cx + cw * 0.5
        c_center_y = cy + ch * 0.5
        c_score = float(cand.get("score", 0.7))
        is_parasite = False

        for k in kept:
            kx, ky, kw, kh = k["bbox"]
            k_area = max(1.0, kw * kh)
            k_center_x = kx + kw * 0.5
            k_center_y = ky + kh * 0.5
            k_score = float(k.get("score", 0.7))

            iou = _compute_iou(cand["bbox"], k["bbox"])
            if iou >= 0.30:
                is_parasite = True
                break

            xi1 = max(cx, kx)
            yi1 = max(cy, ky)
            xi2 = min(cx + cw, kx + kw)
            yi2 = min(cy + ch, ky + kh)
            inter = max(0.0, xi2 - xi1) * max(0.0, yi2 - yi1)
            overlap_small = inter / min(c_area, k_area)

            # Parasite halo attached to edge of a larger face (e.g. wall plate behind speaker's ear)
            if cw < 0.78 * kw and (
                overlap_small >= 0.18
                or (
                    abs(c_center_x - k_center_x) < 0.85 * kw
                    and abs(c_center_y - k_center_y) < 0.65 * kh
                    and c_score < k_score - 0.05
                )
            ):
                is_parasite = True
                break

        if not is_parasite:
            kept.append(cand)
    return kept


class _SCRFDDetector:
    """Local InsightFace SCRFD-2.5G ONNX face & 5-point keypoint detector."""

    def __init__(self, model_path: Path):
        import onnxruntime as ort

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = min(4, max(1, os.cpu_count() or 2))
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_opts.log_severity_level = 3

        available = ort.get_available_providers()
        preferred = [
            p for p in ("CUDAExecutionProvider", "DmlExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider")
            if p in available
        ] or ["CPUExecutionProvider"]

        self.session = ort.InferenceSession(str(model_path), sess_options=sess_opts, providers=preferred)
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]
        self.strides = (8, 16, 32)
        self.num_anchors = 2
        self._center_cache: dict[tuple[int, int, int], np.ndarray] = {}
        self._pad_buffer: np.ndarray | None = None

    def _get_anchor_centers(self, h: int, w: int, stride: int) -> np.ndarray:
        key = (h, w, stride)
        cached = self._center_cache.get(key)
        if cached is not None:
            return cached
        anchor_centers = np.stack(np.mgrid[:h, :w][::-1], axis=-1).astype(np.float32)
        anchor_centers = (anchor_centers * stride).reshape((-1, 2))
        if self.num_anchors > 1:
            anchor_centers = np.stack([anchor_centers] * self.num_anchors, axis=1).reshape((-1, 2))
        self._center_cache[key] = anchor_centers
        return anchor_centers

    def detect(
        self,
        frame_bgr: np.ndarray,
        score_thresh: float = DETECTION_THRESHOLD,
        nms_thresh: float = 0.40,
    ) -> list[dict[str, Any]]:
        import cv2

        orig_h, orig_w = frame_bgr.shape[:2]
        pad_w = (orig_w + 31) & ~31
        pad_h = (orig_h + 31) & ~31
        if (orig_w, orig_h) == (pad_w, pad_h):
            inp_img = frame_bgr
        else:
            if self._pad_buffer is None or self._pad_buffer.shape != (pad_h, pad_w, 3):
                self._pad_buffer = np.zeros((pad_h, pad_w, 3), dtype=np.uint8)
            else:
                self._pad_buffer.fill(0)
            self._pad_buffer[:orig_h, :orig_w] = frame_bgr
            inp_img = self._pad_buffer

        blob = cv2.dnn.blobFromImage(
            inp_img, 1.0 / 128.0, (pad_w, pad_h), (127.5, 127.5, 127.5), swapRB=True
        )
        outs = self.session.run(self.output_names, {self.input_name: blob})

        scores_list: list[np.ndarray] = []
        bboxes_list: list[np.ndarray] = []
        kpss_list: list[np.ndarray] = []
        fmc = 3

        for idx, stride in enumerate(self.strides):
            scores = outs[idx]
            bbox_preds = outs[idx + fmc] * stride
            kps_preds = outs[idx + fmc * 2] * stride
            if scores.ndim == 3:
                scores = scores[0]
                bbox_preds = bbox_preds[0]
                kps_preds = kps_preds[0]

            fh, fw = pad_h // stride, pad_w // stride
            anchor_centers = self._get_anchor_centers(fh, fw, stride)

            pos_inds = np.where(scores[:, 0] >= score_thresh)[0]
            if pos_inds.size == 0:
                continue
            pos_scores = scores[pos_inds, 0]
            pos_bbox_preds = bbox_preds[pos_inds]
            pos_anchors = anchor_centers[pos_inds]

            x1 = np.clip(pos_anchors[:, 0] - pos_bbox_preds[:, 0], 0.0, float(orig_w))
            y1 = np.clip(pos_anchors[:, 1] - pos_bbox_preds[:, 1], 0.0, float(orig_h))
            x2 = np.clip(pos_anchors[:, 0] + pos_bbox_preds[:, 2], 0.0, float(orig_w))
            y2 = np.clip(pos_anchors[:, 1] + pos_bbox_preds[:, 3], 0.0, float(orig_h))
            bboxes = np.stack([x1, y1, x2 - x1, y2 - y1], axis=-1)

            pos_kps_preds = kps_preds[pos_inds].reshape((-1, 5, 2))
            kpss = np.empty_like(pos_kps_preds)
            kpss[:, :, 0] = pos_anchors[:, 0:1] + pos_kps_preds[:, :, 0]
            kpss[:, :, 1] = pos_anchors[:, 1:2] + pos_kps_preds[:, :, 1]

            scores_list.append(pos_scores)
            bboxes_list.append(bboxes)
            kpss_list.append(kpss)

        if not scores_list:
            return []

        all_scores = np.concatenate(scores_list, axis=0)
        all_bboxes = np.concatenate(bboxes_list, axis=0)
        all_kpss = np.concatenate(kpss_list, axis=0)

        indices = cv2.dnn.NMSBoxes(
            all_bboxes.tolist(), all_scores.tolist(), score_thresh, nms_thresh
        )
        if len(indices) == 0:
            return []

        results: list[dict[str, Any]] = []
        for i in np.array(indices).flatten():
            x, y, w, h = (float(v) for v in all_bboxes[i])
            lms = all_kpss[i].astype(np.float32)  # (5, 2): right_eye(viewer left), left_eye, nose, right_mouth, left_mouth
            bbox = (x, y, w, h)
            if not _is_plausible_face(bbox, lms, frame_w=orig_w, frame_h=orig_h):
                continue
            results.append({
                "bbox": bbox,
                "score": float(all_scores[i]),
                "landmarks": lms,
            })

        return _suppress_parasite_detections(results)


class _Landmark106Predictor:
    """Local InsightFace 2d106det ONNX predictor for accurate lip/mouth articulation (MAR)."""

    def __init__(self, model_path: Path):
        import onnxruntime as ort

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = min(2, max(1, os.cpu_count() or 1))
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_opts.log_severity_level = 3

        available = ort.get_available_providers()
        preferred = [
            p for p in ("CUDAExecutionProvider", "DmlExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider")
            if p in available
        ] or ["CPUExecutionProvider"]

        self.session = ort.InferenceSession(str(model_path), sess_options=sess_opts, providers=preferred)
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def predict_lip_metrics(
        self,
        frame_bgr: np.ndarray,
        bbox: tuple[float, float, float, float],
    ) -> tuple[float, float] | None:
        """Return (inner_mar, outer_mar) from 106-point facial landmarks."""
        import cv2

        x, y, w, h = bbox
        if w < 18.0 or h < 18.0:
            return None
        cx, cy = x + w * 0.5, y + h * 0.5
        size = max(w, h) * 1.5
        x1 = int(round(cx - size * 0.5))
        y1 = int(round(cy - size * 0.5))
        x2 = int(round(cx + size * 0.5))
        y2 = int(round(cy + size * 0.5))

        H, W = frame_bgr.shape[:2]
        pad_l = max(0, -x1)
        pad_t = max(0, -y1)
        pad_r = max(0, x2 - W)
        pad_b = max(0, y2 - H)
        crop = frame_bgr[max(0, y1):min(H, y2), max(0, x1):min(W, x2)]
        if crop.size == 0:
            return None
        if pad_l or pad_t or pad_r or pad_b:
            crop = cv2.copyMakeBorder(crop, pad_t, pad_b, pad_l, pad_r, cv2.BORDER_CONSTANT, value=0)

        crop_192 = cv2.resize(crop, (192, 192), interpolation=cv2.INTER_LINEAR)
        blob = cv2.dnn.blobFromImage(crop_192, 1.0, (192, 192), (0, 0, 0), swapRB=True)
        pred = self.session.run([self.output_name], {self.input_name: blob})[0].reshape((106, 2))
        pts = (pred + 1.0) * (0.5 * size)
        pts[:, 0] += x1
        pts[:, 1] += y1

        mouth_w = float(np.hypot(*(pts[61] - pts[52])))
        if mouth_w < 3.0:
            return None
        inner_v1 = float(np.hypot(*(pts[66] - pts[54])))
        inner_v2 = float(np.hypot(*(pts[62] - pts[60])))
        inner_v3 = float(np.hypot(*(pts[70] - pts[57])))
        outer_v = float(np.hypot(*(pts[63] - pts[53])))
        inner_mar = (inner_v1 + inner_v2 + inner_v3) / (3.0 * mouth_w)
        outer_mar = outer_v / mouth_w
        return inner_mar, outer_mar


@lru_cache(maxsize=1)
def _load_external_face_models(model_dir: Path) -> tuple[_SCRFDDetector | None, _Landmark106Predictor | None]:
    try:
        detector = _SCRFDDetector(model_dir / "scrfd_2.5g_bnkps.onnx")
    except Exception as error:
        logger.warning("Could not initialize the configured SCRFD detector; using YuNet: %s", error)
        return None, None
    try:
        landmarks = _Landmark106Predictor(model_dir / "2d106det.onnx")
    except Exception as error:
        logger.warning("Could not initialize the configured landmark model: %s", error)
        landmarks = None
    return detector, landmarks


def _get_models() -> tuple[_SCRFDDetector | None, _Landmark106Predictor | None]:
    """Use external experimental models only when explicitly configured."""
    directory = os.environ.get(_EXTERNAL_FACE_MODELS_ENV, "").strip()
    if not directory or getattr(sys, "frozen", False):
        return None, None
    with _MODEL_LOCK:
        return _load_external_face_models(Path(directory).expanduser().resolve())


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


def _compute_jaw_ratio(landmarks: np.ndarray | None) -> float | None:
    """Compute vertical mouth-to-nose distance normalized by inter-ocular distance."""
    if landmarks is None or landmarks.shape != (5, 2) or not np.any(landmarks != 0):
        return None
    reye, leye, nose, rm, lm = landmarks
    eye_dist = float(np.hypot(*(leye - reye)))
    if eye_dist < 4.0:
        return None
    mouth_cy = (float(rm[1]) + float(lm[1])) / 2.0
    return (mouth_cy - float(nose[1])) / eye_dist


class _FaceTrack:
    def __init__(
        self,
        track_id: int,
        bbox: tuple[float, float, float, float],
        landmarks: np.ndarray | None,
        t: float,
        center_x_orig: float,
        width_orig: float | None = None,
        inner_mar: float | None = None,
        outer_mar: float | None = None,
    ):
        self.track_id = track_id
        self.last_bbox = bbox
        self.last_landmarks = landmarks
        self.last_t = t
        self.first_t = t
        self.frame_count = 1
        self.last_mouth_patch: np.ndarray | None = None
        self.last_nose_patch: np.ndarray | None = None
        self.last_jaw_ratio: float | None = _compute_jaw_ratio(landmarks)
        self.last_inner_mar: float | None = inner_mar
        self.last_outer_mar: float | None = outer_mar
        # Full-length histories (no caps): Pass 2 needs scores/positions for the whole video.
        self.timestamps: list[float] = [t]
        self.centers: list[float] = [center_x_orig]
        self.widths: list[float] = [float(width_orig if width_orig is not None else bbox[2])]
        self.score_times: list[float] = []
        self.scores: list[float] = []

    def update(
        self,
        bbox: tuple[float, float, float, float],
        landmarks: np.ndarray | None,
        t: float,
        mouth_patch: np.ndarray | None,
        is_speaking_audio: bool,
        center_x_orig: float,
        nose_patch: np.ndarray | None = None,
        width_orig: float | None = None,
        inner_mar: float | None = None,
        outer_mar: float | None = None,
    ):
        gap = t - self.last_t
        self.last_bbox = bbox
        self.last_landmarks = landmarks
        self.last_t = t
        self.frame_count += 1
        self.timestamps.append(t)
        self.centers.append(center_x_orig)
        self.widths.append(float(width_orig if width_orig is not None else bbox[2]))

        cur_jaw_ratio = _compute_jaw_ratio(landmarks)

        # Patches/landmarks more than ~1 s apart are not comparable (head turned, re-identified track):
        # comparing them would produce fake "mouth motion".
        if gap <= 1.0:
            patch_m = _patch_motion(mouth_patch, self.last_mouth_patch)
            if nose_patch is not None and self.last_nose_patch is not None:
                # Subtract a damped fraction of rigid nose motion so nodding listeners are
                # suppressed without zeroing out an active speaker who moves their head while talking.
                patch_m = max(0.0, patch_m - 0.45 * _patch_motion(nose_patch, self.last_nose_patch))

            if (
                inner_mar is not None
                and outer_mar is not None
                and self.last_inner_mar is not None
                and self.last_outer_mar is not None
            ):
                # 106-landmark Mouth Aspect Ratio (MAR) temporal articulation
                d_outer = abs(outer_mar - self.last_outer_mar)
                d_inner = abs(inner_mar - self.last_inner_mar)
                mar_delta = min(0.35, d_outer * 2.2 + d_inner * 2.6)
                # Active lip-parting bonus only when mouth is actually articulating (never rewards static open mouths)
                open_bonus = (
                    min(0.10, max(0.0, inner_mar - 0.025) * 1.1)
                    if (d_outer > 0.008 or d_inner > 0.006 or patch_m > 0.015)
                    else 0.0
                )
                motion = 0.65 * (mar_delta + open_bonus) + 0.35 * patch_m
            else:
                motion = patch_m
                if cur_jaw_ratio is not None and self.last_jaw_ratio is not None:
                    jaw_delta = min(0.25, abs(cur_jaw_ratio - self.last_jaw_ratio) * 1.2)
                    motion = motion + jaw_delta

            speech_score = motion * (1.5 if is_speaking_audio else 0.1)
            self.score_times.append(t)
            self.scores.append(speech_score)

        if mouth_patch is not None:
            self.last_mouth_patch = mouth_patch
        if nose_patch is not None:
            self.last_nose_patch = nose_patch
        if cur_jaw_ratio is not None:
            self.last_jaw_ratio = cur_jaw_ratio
        if inner_mar is not None:
            self.last_inner_mar = inner_mar
        if outer_mar is not None:
            self.last_outer_mar = outer_mar

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

    def interpolated_center_x_at_time(self, target_t: float, max_gap: float = 3.0) -> float | None:
        """Linearly interpolate center X across brief detection dropouts when bracketed within max_gap."""
        if not self.timestamps:
            return float(self.last_bbox[0] + self.last_bbox[2] / 2.0)
        import bisect
        n = len(self.timestamps)
        idx = bisect.bisect_left(self.timestamps, target_t)
        if idx == 0:
            return self.centers[0] if abs(self.timestamps[0] - target_t) <= max_gap else None
        if idx >= n:
            return self.centers[-1] if abs(target_t - self.timestamps[-1]) <= max_gap else None
        t0, t1 = self.timestamps[idx - 1], self.timestamps[idx]
        x0, x1 = self.centers[idx - 1], self.centers[idx]
        if (target_t - t0) <= max_gap and (t1 - target_t) <= max_gap and (t1 - t0) <= max_gap * 1.5:
            alpha = (target_t - t0) / max(1e-6, t1 - t0)
            return float(x0 + alpha * (x1 - x0))
        return self.center_x_at_time(target_t, max_gap=max_gap)


# A visible face in one sampled frame: (track_id, center_x_orig, width_orig)
_Visible = tuple[int, float, float]


class _FaceTracker:
    """Associates per-frame detections into persistent face tracks.

    Detections are dicts with keys: bbox (sample px), landmarks, mouth_patch, nose_patch,
    inner_mar, outer_mar.
    Resets active tracks on hard visual scene cuts so two different camera angles are never
    merged into the same track.
    """

    def __init__(self, scale_to_orig: float = 1.0):
        self.scale_to_orig = scale_to_orig
        self.all_tracks: dict[int, _FaceTrack] = {}
        self.active: dict[int, _FaceTrack] = {}
        self.next_id = 1
        self.last_scene_cut_t: float = -1e9

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

    def process(
        self,
        t: float,
        detections: list[dict[str, Any]],
        is_speech: bool,
        is_scene_cut: bool = False,
    ) -> list[_Visible]:
        if is_scene_cut:
            self.active.clear()
            self.last_scene_cut_t = t
        else:
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

        # Re-identify unmatched detections against recently lost tracks ONLY within the same visual scene
        if not is_scene_cut:
            for di, det in enumerate(detections):
                if di in assigned:
                    continue
                best_tid, best_s = None, 0.0
                for tid, tr in self.all_tracks.items():
                    if tid in self.active or tid in used_tracks:
                        continue
                    if tr.last_t < self.last_scene_cut_t:
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
                    bbox,
                    det.get("landmarks"),
                    t,
                    det.get("mouth_patch"),
                    is_speech,
                    cx,
                    nose_patch=det.get("nose_patch"),
                    width_orig=w,
                    inner_mar=det.get("inner_mar"),
                    outer_mar=det.get("outer_mar"),
                )
            else:
                tid = self.next_id
                self.next_id += 1
                tr = _FaceTrack(
                    tid,
                    bbox,
                    det.get("landmarks"),
                    t,
                    cx,
                    width_orig=w,
                    inner_mar=det.get("inner_mar"),
                    outer_mar=det.get("outer_mar"),
                )
                tr.last_mouth_patch = det.get("mouth_patch")
                tr.last_nose_patch = det.get("nose_patch")
                self.active[tid] = tr
                self.all_tracks[tid] = tr
            visible.append((tid, cx, w))
        return visible


def _detect_scene_cut(curr_grid: np.ndarray, prev_grid: np.ndarray | None) -> bool:
    """Detect a hard editorial camera cut between two downsampled 32x18 BGR grids."""
    if prev_grid is None or curr_grid.shape != prev_grid.shape:
        return False
    cell_diff = np.mean(np.abs(curr_grid - prev_grid), axis=2)
    mean_l1 = float(np.mean(cell_diff))
    frac_changed = float(np.mean(cell_diff > 15.0))
    if mean_l1 >= 14.0 and frac_changed >= 0.50:
        return True
    if mean_l1 >= 22.0 and float(np.mean(cell_diff > 12.0)) >= 0.40:
        return True
    return False


def _frame_has_vertical_center_divider(gray: np.ndarray) -> bool:
    """Detect an actual vertical split-screen divider bar or hard 50/50 seam near orig_w / 2."""
    H, W = gray.shape[:2]
    if W < 32 or H < 32:
        return False
    y0 = max(0, int(H * 0.10))
    y1 = min(H, int(H * 0.90))
    if y1 - y0 < 16:
        return False
    mid = W // 2
    band = gray[y0:y1, max(0, mid - 3) : min(W, mid + 4)].astype(np.float32)
    center_diffs = np.abs(np.diff(band, axis=1))
    center_edges = np.mean(center_diffs, axis=0)
    continuity = np.mean(center_diffs >= 18.0, axis=0)
    l_band = gray[y0:y1, max(0, mid - 24) : max(1, mid - 8)].astype(np.float32)
    r_band = gray[y0:y1, min(W - 1, mid + 8) : min(W, mid + 24)].astype(np.float32)
    bg_diffs: list[float] = []
    if l_band.shape[1] >= 2:
        bg_diffs.append(float(np.median(np.abs(np.diff(l_band, axis=1)))))
    if r_band.shape[1] >= 2:
        bg_diffs.append(float(np.median(np.abs(np.diff(r_band, axis=1)))))
    bg_med = max(bg_diffs) if bg_diffs else 0.0
    return bool(np.any((continuity >= 0.75) & (center_edges >= max(22.0, bg_med * 3.0))))


def _try_two_shot_center(
    visible: list[_Visible],
    crop_w: int,
    split_divider_present: bool = False,
) -> float | None:
    """When two co-subjects sit close enough that both faces + margin fit inside the 9:16 crop,
    return their shared midpoint so neither person is cut in half.
    """
    if split_divider_present or len(visible) != 2:
        return None
    (_, cx1, w1), (_, cx2, w2) = visible[0], visible[1]
    left_edge = min(cx1 - w1 * 0.60, cx2 - w2 * 0.60)
    right_edge = max(cx1 + w1 * 0.60, cx2 + w2 * 0.60)
    span = right_edge - left_edge
    if span <= crop_w * TWO_SHOT_ENTER:
        return 0.5 * (left_edge + right_edge)
    return None


def _clamp_split_screen_target(
    target_cx: float,
    visible: list[_Visible],
    orig_w: int,
    crop_w: int,
    split_divider_present: bool = True,
) -> float:
    """
    When a real 50/50 split-screen vertical divider is present near orig_w / 2 and faces sit on
    opposite halves, keep the 9:16 crop window strictly on the active speaker's side so the
    vertical divider bar is never visible in the output.
    """
    if not split_divider_present or len(visible) < 2 or crop_w > (orig_w // 2) - 4:
        return target_cx
    cxs = [v[1] for v in visible]
    if min(cxs) < orig_w * 0.48 and max(cxs) > orig_w * 0.52:
        mid_x = orig_w / 2.0
        half_crop = crop_w / 2.0
        if target_cx < mid_x:
            return min(target_cx, mid_x - half_crop - 2.0)
        return max(target_cx, mid_x + half_crop + 2.0)
    return target_cx


class _Pass1Director:
    """Real-time fallback framing used when no transcript/speaker assignment applies."""

    def __init__(self, orig_w: int, crop_w: int):
        self.frame_center = orig_w / 2.0
        self.crop_w = crop_w
        self.last_cx: float | None = None
        self.last_face_t = -1e9
        self.speaker_id: int | None = None
        self.last_switch_t = -1e9
        self.last_scene_cut_t = -1e9

    def choose(
        self,
        t: float,
        visible: list[_Visible],
        tracks: dict[int, _FaceTrack],
        is_speech: bool,
        split_divider_present: bool = False,
        is_scene_cut: bool = False,
    ) -> float:
        if is_scene_cut:
            self.last_scene_cut_t = t
            self.speaker_id = None

        if not visible:
            if (
                not is_scene_cut
                and self.last_cx is not None
                and (t - self.last_face_t) <= HOLD_SECONDS
                and self.last_face_t >= self.last_scene_cut_t
            ):
                return self.last_cx
            # No face for a while (B-roll, slides, screen share) or clean scene cut to B-roll: natural center.
            self.speaker_id = None
            return self.frame_center
        self.last_face_t = t

        if len(visible) == 1:
            tid, cx, _ = visible[0]
            if not is_scene_cut and self.speaker_id is not None and tid != self.speaker_id:
                prev_tr = tracks.get(self.speaker_id)
                if (
                    prev_tr is not None
                    and prev_tr.last_t >= self.last_scene_cut_t
                    and (t - prev_tr.last_t) <= HOLD_SECONDS
                    and (t - self.last_switch_t) < MIN_SHOT_SECONDS
                ):
                    held_cx = prev_tr.center_x_at_time(t, max_gap=HOLD_SECONDS)
                    if held_cx is not None:
                        self.last_cx = held_cx
                        return held_cx
                self.last_switch_t = t
            self.speaker_id = tid
            self.last_cx = cx
            return cx

        two_shot_cx = _try_two_shot_center(visible, self.crop_w, split_divider_present=split_divider_present)
        if two_shot_cx is not None:
            self.last_cx = two_shot_cx
            return two_shot_cx

        scored = sorted(((tracks[v[0]].recent_speech_score(), v) for v in visible), key=lambda s: s[0], reverse=True)
        (best, best_v), (second, _) = scored[0], scored[1]
        can_switch = is_scene_cut or (t - self.last_switch_t) >= MIN_SHOT_SECONDS or self.speaker_id is None

        if is_speech and best >= SPEECH_SCORE_FLOOR and best >= SPEAKER_MARGIN * second and can_switch:
            chosen = best_v
        else:
            current_v = next((v for v in visible if v[0] == self.speaker_id), None)
            if current_v is not None:
                chosen = current_v
            else:
                prev_tr = tracks.get(self.speaker_id) if (self.speaker_id is not None and not is_scene_cut) else None
                held_cx = (
                    prev_tr.center_x_at_time(t, max_gap=HOLD_SECONDS)
                    if (prev_tr is not None and prev_tr.last_t >= self.last_scene_cut_t)
                    else None
                )
                if held_cx is not None:
                    self.last_cx = held_cx
                    return held_cx
                chosen = best_v if best >= SPEECH_SCORE_FLOOR else max(visible, key=lambda v: v[2])

        if chosen[0] != self.speaker_id:
            self.last_switch_t = t
        self.speaker_id = chosen[0]
        clamped_cx = _clamp_split_screen_target(
            chosen[1],
            visible,
            int(self.frame_center * 2),
            self.crop_w,
            split_divider_present=split_divider_present,
        )
        self.last_cx = clamped_cx
        return clamped_cx


def _expand_utterance_windows(utterances: list[dict[str, Any]], target_chunk: float = 1.8) -> list[dict[str, Any]]:
    """Split long substantive utterances into ~1.8s sub-windows so speaker changes mid-segment are caught."""
    expanded: list[dict[str, Any]] = []
    for u in utterances:
        if u.get("is_backchannel", False):
            continue
        s, e = float(u["start"]), float(u["end"])
        dur = e - s
        if dur <= target_chunk * 1.5:
            expanded.append({"start": s, "end": e})
            continue

        words = u.get("words") or []
        valid_words = [
            (float(w["start"]), float(w["end"]))
            for w in words
            if isinstance(w, dict) and "start" in w and "end" in w and float(w["end"]) > float(w["start"])
        ]
        if valid_words:
            win_s = valid_words[0][0]
            win_e = valid_words[0][1]
            for ws, we in valid_words[1:]:
                if (we - win_s) >= target_chunk and (win_e - win_s) >= 0.8:
                    expanded.append({"start": win_s, "end": win_e})
                    win_s = ws
                win_e = we
            if win_e > win_s:
                expanded.append({"start": win_s, "end": win_e})
        else:
            n_chunks = max(1, int(round(dur / target_chunk)))
            step = dur / n_chunks
            for i in range(n_chunks):
                expanded.append({"start": s + i * step, "end": s + (i + 1) * step})
    return expanded


def _assign_speakers(
    utterances: list[dict[str, Any]],
    tracks: dict[int, _FaceTrack],
    start_offset: float = 0.0,
    scene_cuts: list[float] | None = None,
) -> list[tuple[float, int]]:
    """Map substantive utterances to face tracks while aligning transitions to visual scene cuts.

    Returns speaker changes as (start_time, track_id). The first entry always starts at
    start_offset (0.0 for full scans) so a clip opens on its first speaker immediately.
    """
    eligible = [tr for tr in tracks.values() if tr.frame_count >= MIN_TRACK_FRAMES]
    assignments: list[tuple[float, int]] = []
    prev_id: int | None = None
    last_switch_t: float = -1e9
    cuts = sorted(scene_cuts or [])

    windows = _expand_utterance_windows(utterances)
    for w in windows:
        s, e = float(w["start"]), float(w["end"])
        cands = [
            tr for tr in eligible
            if tr.first_t <= e + 0.5 and tr.last_t >= s - 0.5 and tr.samples_in_window(s - 0.4, e + 0.4) > 0
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
                # Ambiguous lip evidence: keep the current speaker if still present in this scene,
                # otherwise prefer the track with higher overall scene speech score, then largest width.
                best = next((tr for tr in cands if tr.track_id == prev_id), None) or max(
                    cands,
                    key=lambda tr: (
                        round(float(np.mean(tr.scores)) if tr.scores else 0.0, 3),
                        tr.mean_width_in_window(s, e),
                    ),
                )

        if best.track_id != prev_id:
            cut_t = max(start_offset, s - J_CUT_LEAD)
            # Snap speaker cut to visual camera cut if the new track began at a scene cut
            best_scene_cut = None
            for sc in cuts:
                if abs(best.first_t - sc) <= 0.30 and (sc - 0.50 <= cut_t <= sc + 1.80):
                    best_scene_cut = sc
                    break
            if best_scene_cut is not None:
                cut_t = max(start_offset, best_scene_cut)
            else:
                # Never let a 150ms J-cut step backward across a visual scene cut where best wasn't visible yet
                if best.first_t > cut_t and (best.first_t - cut_t) <= 0.50:
                    for sc in cuts:
                        if cut_t < sc <= best.first_t + 0.05:
                            cut_t = sc
                            break

            if prev_id is not None and best_scene_cut is None and (cut_t - last_switch_t) < MIN_SHOT_SECONDS:
                # Suppress rapid ping-pong switches within the same camera angle
                continue
            assignments.append((cut_t, best.track_id))
            prev_id = best.track_id
            last_switch_t = cut_t

    if assignments:
        assignments[0] = (start_offset, assignments[0][1])

    # Absorb brief A -> B -> A listener-reaction blips (< 3.5s) within the same visual scene
    if len(assignments) >= 3:
        cleaned_assignments = list(assignments)
        changed = True
        while changed and len(cleaned_assignments) >= 3:
            changed = False
            for i in range(1, len(cleaned_assignments) - 1):
                t_prev, tid_prev = cleaned_assignments[i - 1]
                t_curr, tid_curr = cleaned_assignments[i]
                t_next, tid_next = cleaned_assignments[i + 1]
                blip_dur = t_next - t_curr
                if tid_prev == tid_next and tid_curr != tid_prev and blip_dur < 3.5:
                    # Only absorb if no visual scene cut occurred inside [t_curr, t_next]
                    has_cut_inside = any((t_curr - 0.15) <= sc <= (t_next + 0.15) for sc in cuts)
                    tr_prev = tracks.get(tid_prev)
                    if (
                        not has_cut_inside
                        and tr_prev is not None
                        and tr_prev.samples_in_window(t_curr, t_next) > 0
                    ):
                        cleaned_assignments.pop(i + 1)
                        cleaned_assignments.pop(i)
                        changed = True
                        break
        assignments = cleaned_assignments

    return assignments


def _build_target_timeline(
    frames: list[tuple[Any, ...]],
    tracks: dict[int, _FaceTrack],
    assignments: list[tuple[float, int]],
    crop_w: int,
    orig_w: int = 1280,
) -> list[tuple[float, float, bool]]:
    """Per-sample desired crop center: [(t, center_x, is_speaker_switch)].

    Centers on the active speaker's face (or a clean two-shot when two faces sit shoulder-to-shoulder).
    Respects visual scene cuts so pre-cut positions are never held across camera changes.
    """
    switch_px = SWITCH_FRACTION * crop_w
    if not assignments:
        timeline_p1: list[tuple[float, float, bool]] = []
        prev_p1: float | None = None
        for item in frames:
            t, _, p1 = item[0], item[1], item[2]
            is_scene_cut = bool(item[4]) if len(item) >= 5 else False
            is_cut = is_scene_cut or (prev_p1 is not None and abs(p1 - prev_p1) > switch_px)
            timeline_p1.append((t, p1, is_cut))
            prev_p1 = p1
        return timeline_p1

    eligible_ids = {tid for tid, tr in tracks.items() if tr.frame_count >= MIN_TRACK_FRAMES}
    timeline: list[tuple[float, float, bool]] = []
    ai = 0
    prev_target: float | None = None
    last_scene_cut_t = -1e9

    for item in frames:
        t, visible, pass1_cx = item[0], item[1], item[2]
        has_divider = bool(item[3]) if len(item) >= 4 else False
        is_scene_cut = bool(item[4]) if len(item) >= 5 else False
        if is_scene_cut:
            last_scene_cut_t = t

        switched = is_scene_cut
        while ai + 1 < len(assignments) and assignments[ai + 1][0] <= t + 1e-4:
            ai += 1
            switched = True
        speaker = assignments[ai][1]

        vis = {tid: (cx, w) for tid, cx, w in visible if tid in eligible_ids or tid == speaker}
        two_shot_cx = _try_two_shot_center(
            [(tid, cx, w) for tid, (cx, w) in vis.items()],
            crop_w,
            split_divider_present=has_divider,
        )

        if two_shot_cx is not None:
            target = two_shot_cx
        elif speaker in vis:
            scx, _ = vis[speaker]
            target = _clamp_split_screen_target(
                scx, visible, orig_w, crop_w, split_divider_present=has_divider
            )
        else:
            # Only dead-reckon hold if the speaker was seen in the CURRENT visual scene
            sp_track = tracks.get(speaker)
            can_hold = (
                sp_track is not None
                and sp_track.last_t >= last_scene_cut_t - 1e-4
                and sp_track.first_t <= t + 1e-4
            )
            held = sp_track.interpolated_center_x_at_time(t, max_gap=HOLD_SECONDS) if can_hold else None
            if held is not None:
                raw_target = held
            elif vis:
                # If an upcoming assignment within 1.5s uses one of the currently visible tracks, snap to it now
                upcoming_tid = None
                if ai + 1 < len(assignments) and (assignments[ai + 1][0] - t) <= 1.5:
                    cand_tid = assignments[ai + 1][1]
                    if cand_tid in vis:
                        upcoming_tid = cand_tid
                if upcoming_tid is not None:
                    raw_target = vis[upcoming_tid][0]
                else:
                    # Pick visible track with best overall speech score in this scene
                    best_vis_tid = max(
                        vis.keys(),
                        key=lambda tid: (
                            round(tracks[tid].recent_speech_score(1.5), 3) if tid in tracks else 0.0,
                            vis[tid][1],
                        ),
                    )
                    raw_target = vis[best_vis_tid][0]
            else:
                raw_target = pass1_cx

            target = _clamp_split_screen_target(
                raw_target, visible, orig_w, crop_w, split_divider_present=has_divider
            )

        # If target jumps across the frame (e.g. fallback switch or speaker change), mark as hard cut
        if prev_target is not None and abs(target - prev_target) > switch_px:
            switched = True
        prev_target = target

        if switched and not is_scene_cut:
            cut_t = assignments[ai][0] if assignments[ai][0] <= t else t
            prev_t = timeline[-1][0] if timeline else -1.0
            if max(prev_t, last_scene_cut_t) < cut_t < t and (t - cut_t) <= 0.5:
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
    allow_ease: bool = False,
) -> list[dict[str, Any]]:
    """Turn the target timeline into stationary speaker-cut shots (optional ease if enabled)."""
    switch_px = SWITCH_FRACTION * crop_w
    dead_px = DEAD_ZONE_FRACTION * crop_w
    recenter_px = max(dead_px * 2.2, 0.24 * crop_w)

    # First partition by hard switches / large cross-frame jumps so each stationary shot
    # locks onto the robust median position of the speaker rather than the first raw sample.
    segments: list[list[tuple[float, float]]] = []
    cur_seg: list[tuple[float, float]] = []
    for t, cx, is_switch in timeline:
        if cur_seg and (
            (is_switch and abs(cx - float(np.median([p[1] for p in cur_seg]))) > dead_px)
            or abs(cx - cur_seg[-1][1]) > switch_px
        ):
            segments.append(cur_seg)
            cur_seg = []
        cur_seg.append((t, cx))
    if cur_seg:
        segments.append(cur_seg)

    shots: list[dict[str, Any]] = []
    for seg_idx, seg in enumerate(segments):
        seg_end_t = (
            segments[seg_idx + 1][0][0]
            if seg_idx + 1 < len(segments)
            else (timeline[-1][0] + frame_interval + 10.0)
        )
        cxs = [p[1] for p in seg]
        if max(cxs) - min(cxs) <= recenter_px:
            med_cx = float(np.median(cxs))
            shots.append({
                "start": round(seg[0][0], 3),
                "end": round(seg_end_t, 3),
                "x": _even_left(med_cx, crop_w, orig_w),
            })
        else:
            # Speaker genuinely walked across the frame within a single segment: step only on large sustained shifts
            sub_start = seg[0][0]
            anchor = seg[0][1]
            sub_cxs = [anchor]
            pending = 0
            for t, cx in seg[1:]:
                if abs(cx - anchor) > recenter_px:
                    pending += 1
                    if pending >= 3:
                        shots.append({
                            "start": round(sub_start, 3),
                            "end": round(t, 3),
                            "x": _even_left(float(np.median(sub_cxs)), crop_w, orig_w),
                        })
                        sub_start, anchor, sub_cxs, pending = t, cx, [cx], 0
                else:
                    pending = 0
                    sub_cxs.append(cx)
            shots.append({
                "start": round(sub_start, 3),
                "end": round(seg_end_t, 3),
                "x": _even_left(float(np.median(sub_cxs)), crop_w, orig_w),
            })

    merged = _merge_short_shots(shots, min_duration=MIN_SHOT_SECONDS, crop_width=crop_w)

    consolidated: list[dict[str, Any]] = []
    for shot in merged:
        shot_clean = {k: v for k, v in shot.items() if k != "scene_locked"}
        if consolidated and abs(consolidated[-1]["x"] - shot_clean["x"]) <= 8:
            consolidated[-1]["end"] = shot_clean["end"]
        else:
            consolidated.append(shot_clean)

    # Stationary Speaker Cuts mode keeps crop stationary between cuts unless allow_ease=True.
    if allow_ease:
        for prev, shot in zip(consolidated, consolidated[1:]):
            if abs(shot["x"] - prev["x"]) <= switch_px:
                shot["pan_from"] = prev["x"]
                shot["pan_seconds"] = round(min(PAN_SECONDS, (shot["end"] - shot["start"]) / 2.0), 3)
    return consolidated


def _rdp_indices(points: list[tuple[float, float]], eps: float) -> list[int]:
    """Ramer-Douglas-Peucker simplification returning sorted keyframe indices."""
    n = len(points)
    if n <= 2:
        return list(range(n))

    keep = [False] * n
    keep[0] = True
    keep[-1] = True
    stack: list[tuple[int, int]] = [(0, n - 1)]

    # Normalize time axis so 1.0s has comparable weight to ~40px of horizontal movement
    t_scale = 40.0
    while stack:
        i0, i1 = stack.pop()
        if i1 - i0 <= 1:
            continue
        t0, x0 = points[i0][0] * t_scale, points[i0][1]
        t1, x1 = points[i1][0] * t_scale, points[i1][1]
        dt = t1 - t0
        dx = x1 - x0
        norm = (dt * dt + dx * dx) ** 0.5

        max_d = -1.0
        best_k = -1
        for k in range(i0 + 1, i1):
            tk, xk = points[k][0] * t_scale, points[k][1]
            if norm < 1e-6:
                d = abs(xk - x0)
            else:
                d = abs(dx * (t0 - tk) - (x0 - xk) * dt) / norm
            if d > max_d:
                max_d = d
                best_k = k

        if max_d > eps and best_k != -1:
            keep[best_k] = True
            stack.append((i0, best_k))
            stack.append((best_k, i1))

    return [idx for idx, flag in enumerate(keep) if flag]


def _smooth_and_simplify_segment(
    seg: list[tuple[float, int]],
    crop_w: int,
    max_left: int,
) -> list[tuple[float, int]]:
    """Convert raw 4 Hz single-speaker samples into smooth, low-count camera keyframes.

    Uses a generous conversational comfort deadzone so seated speakers who naturally gesture
    with their head do not trigger sea-sick back-and-forth camera swaying, while genuine
    subject movements across the frame are tracked with smooth gimbal glides.
    """
    n = len(seg)
    if n <= 1:
        return list(seg)

    times = [p[0] for p in seg]
    xs = [float(p[1]) for p in seg]

    # 1. 3-point median filter to strip single-frame detector glitches
    med_xs = list(xs)
    if n >= 3:
        med_xs[0] = sorted([xs[0], xs[1], xs[2]])[1]
        for i in range(1, n - 1):
            med_xs[i] = sorted([xs[i - 1], xs[i], xs[i + 1]])[1]
        med_xs[-1] = sorted([xs[-3], xs[-2], xs[-1]])[1]

    # 2. Zero-phase Gaussian low-pass filter (sigma = 0.75s) for lag-free trajectory smoothing
    import bisect

    sigma = 0.75
    inv_two_sigma_sq = -0.5 / (sigma * sigma)
    smooth_xs: list[float] = []
    for i in range(n):
        ti = times[i]
        lo = bisect.bisect_left(times, ti - 2.2)
        hi = bisect.bisect_right(times, ti + 2.2)
        w_sum = 0.0
        x_sum = 0.0
        for j in range(lo, hi):
            dt = times[j] - ti
            if abs(dt) > 2.2:
                continue
            w = float(np.exp(inv_two_sigma_sq * (dt * dt)))
            w_sum += w
            x_sum += w * med_xs[j]
        val = x_sum / w_sum if w_sum > 0 else med_xs[i]
        smooth_xs.append(max(0.0, min(float(max_left), val)))

    # 3. Conversational comfort deadzone (~22% of crop_w): if the speaker stays within this zone
    # for the entire shot, lock the virtual tripod at the median position (zero swaying).
    tripod_span_limit = max(32.0, 0.22 * crop_w)
    span = max(smooth_xs) - min(smooth_xs)
    if span <= tripod_span_limit:
        steady_x = int(round(float(np.median(smooth_xs)))) & ~1
        steady_x = max(0, min(max_left, steady_x))
        return [(times[0], steady_x), (times[-1], steady_x)]

    # 4. Apply hysteresis deadband filter so small conversational head bobbles during a larger pan
    # are absorbed before RDP simplification.
    deadband = max(14.0, 0.065 * crop_w)
    stabilized_xs: list[float] = [smooth_xs[0]]
    anchor = smooth_xs[0]
    for sx in smooth_xs[1:]:
        diff = sx - anchor
        if abs(diff) > deadband:
            anchor = sx - (deadband if diff > 0 else -deadband)
        stabilized_xs.append(anchor)

    pts = list(zip(times, stabilized_xs))
    rdp_eps = max(18.0, 0.055 * crop_w)
    kf_indices = _rdp_indices(pts, rdp_eps)

    # 5. Enforce minimum pan duration (>= 1.0s) between consecutive keyframes to prevent stepping
    min_pan_dt = 1.0
    filtered_indices = [kf_indices[0]]
    for idx in kf_indices[1:-1]:
        if (times[idx] - times[filtered_indices[-1]]) >= min_pan_dt:
            filtered_indices.append(idx)
    if kf_indices[-1] != filtered_indices[-1]:
        if len(filtered_indices) > 1 and (times[kf_indices[-1]] - times[filtered_indices[-1]]) < 0.5:
            filtered_indices[-1] = kf_indices[-1]
        else:
            filtered_indices.append(kf_indices[-1])

    waypoints: list[tuple[float, int]] = []
    snap_px = max(22, int(round(0.08 * crop_w)))
    for idx in filtered_indices:
        t = times[idx]
        x = max(0, min(max_left, int(round(smooth_xs[idx])) & ~1))
        if waypoints and abs(x - waypoints[-1][1]) <= snap_px:
            # Snap micro-drifts to the previous waypoint so stationary holds are completely still
            x = waypoints[-1][1]
        waypoints.append((t, x))

    return waypoints


def _build_smooth_tracking_shots(
    timeline: list[tuple[float, float, bool]],
    crop_w: int,
    orig_w: int,
    frame_interval: float,
) -> list[dict[str, Any]]:
    """Build smooth tracking shots with continuous camera gliding for speaker face tracking in 9:16.

    - Hard cuts on speaker switches, scene cuts, or large cross-frame jumps (> 35% of crop_w).
    - Absorbs short transient segments (< MIN_SHOT_SECONDS) to prevent whip-pans and strobe cuts.
    - Zero-phase Gaussian smoothing + Ramer-Douglas-Peucker keyframe simplification within each shot.
    - Smoothstep (3u^2 - 2u^3) easing between inflection keyframes for continuous gimbal-like follow.
    """
    if not timeline:
        return [{"start": 0.0, "end": 999999.0, "x": _even_left(orig_w / 2.0, crop_w, orig_w)}]

    max_left = max(0, orig_w - crop_w)
    switch_px = SWITCH_FRACTION * crop_w

    # 1. Partition timeline into continuous single-subject segments
    raw_segments: list[list[tuple[float, int]]] = []
    current_seg: list[tuple[float, int]] = []
    prev_left: int | None = None

    for t, cx, is_switch in timeline:
        raw_left = max(0.0, min(float(max_left), cx - crop_w / 2.0))
        even_left = int(round(raw_left)) & ~1

        if current_seg and prev_left is not None and (
            (is_switch and abs(even_left - prev_left) > switch_px * 0.30)
            or abs(even_left - prev_left) > switch_px
        ):
            raw_segments.append(current_seg)
            current_seg = []

        current_seg.append((t, even_left))
        prev_left = even_left

    if current_seg:
        raw_segments.append(current_seg)

    # 2. Absorb short segments (< MIN_SHOT_SECONDS) into adjacent segments so 1-2 frame glitches
    # never cause the camera to cut or whip across the room and back.
    segments = [list(s) for s in raw_segments if s]
    changed = True
    while changed and len(segments) > 1:
        changed = False
        for i in range(len(segments)):
            seg = segments[i]
            seg_start = seg[0][0]
            seg_end = segments[i + 1][0][0] if i + 1 < len(segments) else (seg[-1][0] + frame_interval)
            dur = seg_end - seg_start
            if dur < MIN_SHOT_SECONDS:
                if i == 0:
                    next_seg = segments[1]
                    fill_x = next_seg[0][1]
                    segments[1] = [(t, fill_x) for t, _ in seg] + next_seg
                    segments.pop(0)
                elif i == len(segments) - 1:
                    prev_seg = segments[i - 1]
                    fill_x = prev_seg[-1][1]
                    segments[i - 1] = prev_seg + [(t, fill_x) for t, _ in seg]
                    segments.pop(i)
                else:
                    prev_seg = segments[i - 1]
                    next_seg = segments[i + 1]
                    prev_med = float(np.median([x for _, x in prev_seg]))
                    next_med = float(np.median([x for _, x in next_seg]))
                    if abs(prev_med - next_med) <= switch_px:
                        fill_x = int(round(prev_med)) & ~1
                        segments[i - 1] = prev_seg + [(t, fill_x) for t, _ in seg] + next_seg
                        segments.pop(i + 1)
                        segments.pop(i)
                    else:
                        seg_med = float(np.median([x for _, x in seg]))
                        if abs(seg_med - prev_med) <= abs(seg_med - next_med):
                            fill_x = prev_seg[-1][1]
                            segments[i - 1] = prev_seg + [(t, fill_x) for t, _ in seg]
                            segments.pop(i)
                        else:
                            fill_x = next_seg[0][1]
                            segments[i + 1] = [(t, fill_x) for t, _ in seg] + next_seg
                            segments.pop(i)
                changed = True
                break

    # 3. Smooth and simplify each continuous segment into clean camera shots
    all_shots: list[dict[str, Any]] = []
    for seg_idx, seg in enumerate(segments):
        if not seg:
            continue
        waypoints = _smooth_and_simplify_segment(seg, crop_w, max_left)
        # Extend the final waypoint of this segment to the start of the next segment
        if seg_idx + 1 < len(segments) and segments[seg_idx + 1]:
            next_start_t = segments[seg_idx + 1][0][0]
            if waypoints[-1][0] < next_start_t:
                waypoints[-1] = (next_start_t, waypoints[-1][1])

        if len(waypoints) == 1:
            t_a, x_a = waypoints[0]
            t_b = segments[seg_idx + 1][0][0] if seg_idx + 1 < len(segments) else (t_a + frame_interval)
            all_shots.append({"start": round(t_a, 3), "end": round(t_b, 3), "x": x_a})
            continue

        for i in range(len(waypoints) - 1):
            t_a, x_a = waypoints[i]
            t_b, x_b = waypoints[i + 1]
            dt = max(0.05, round(t_b - t_a, 3))
            shot: dict[str, Any] = {
                "start": round(t_a, 3),
                "end": round(t_b, 3),
                "x": x_b,
            }
            if x_a != x_b and dt > 0.08:
                shot["pan_from"] = x_a
                # Glide at a natural gimbal speed (~30 px/s minimum) so long holds don't creep for 20s
                shot["pan_seconds"] = round(min(dt, max(0.8, abs(x_b - x_a) / 30.0)), 3)
            all_shots.append(shot)

    consolidated: list[dict[str, Any]] = []
    for s in all_shots:
        if (
            consolidated
            and "pan_from" not in consolidated[-1]
            and "pan_from" not in s
            and consolidated[-1]["x"] == s["x"]
        ):
            consolidated[-1]["end"] = s["end"]
        else:
            consolidated.append(dict(s))

    if consolidated:
        consolidated[-1]["end"] = round(timeline[-1][0] + frame_interval + 10.0, 3)
    else:
        consolidated.append({
            "start": 0.0,
            "end": round(timeline[-1][0] + frame_interval + 10.0, 3),
            "x": _even_left(timeline[0][1], crop_w, orig_w),
        })

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
    start_offset: float = 0.0,
) -> tuple[list[tuple[Any, ...]], dict[int, _FaceTrack], float]:
    """Decode sampled frames, detect faces and camera cuts, and record speaking targets.
    """
    import cv2

    sample_w = min(SAMPLE_WIDTH, orig_w)
    sample_w -= sample_w % 2
    sample_h = int(round(sample_w * orig_h / orig_w))
    sample_h += sample_h % 2
    scale_to_orig = orig_w / float(sample_w)

    scrfd_detector, lm106_predictor = _get_models()
    yunet_detector = None
    if scrfd_detector is None:
        yunet_detector = cv2.FaceDetectorYN.create(
            model=str(get_yunet_model_path()),
            config="",
            input_size=(sample_w, sample_h),
            score_threshold=YUNET_THRESHOLD,
            nms_threshold=0.3,
            top_k=5000,
        )

    frame_interval = 1.0 / SAMPLE_FPS
    frame_bytes = sample_w * sample_h * 3
    seek_args = ["-ss", f"{start_offset:.2f}"] if start_offset > 0.0 else []
    duration_args = (
        ["-t", f"{max(1.0, max_duration - start_offset + 1.0):.2f}"]
        if (max_duration is not None and max_duration > 0)
        else []
    )
    ffmpeg_cmd = [
        ffmpeg_path,
        "-hide_banner", "-loglevel", "error",
        "-threads", "0",
        *seek_args,
        "-i", str(source_path),
        *duration_args,
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
    frames: list[tuple[Any, ...]] = []
    report_every = max(1, int(SAMPLE_FPS * 5))
    frame_idx = 0
    prev_grid: np.ndarray | None = None
    prev_was_split: bool = False

    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                process.kill()
                from app.services.video_editor import ClipGenerationCancelled
                raise ClipGenerationCancelled("Clip generation was cancelled")

            raw = process.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:
                break

            t = start_offset + frame_idx * frame_interval
            if max_duration is not None and t >= max_duration:
                process.terminate()
                break
            if progress_callback and frame_idx % report_every == 0:
                pct = min(99, int(round((t / max(1.0, video_duration)) * 100)))
                progress_callback(f"Analyzing speaker tracking (True 9:16): {pct}%", int(t), int(video_duration))

            frame = np.frombuffer(raw, dtype=np.uint8).reshape((sample_h, sample_w, 3))
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            curr_grid = cv2.resize(frame, (32, 18), interpolation=cv2.INTER_AREA).astype(np.float32)
            is_scene_cut = _detect_scene_cut(curr_grid, prev_grid)
            prev_grid = curr_grid

            is_speech = _is_speech_active(t, speech_windows)

            raw_dets: list[dict[str, Any]] = []
            if scrfd_detector is not None:
                raw_dets = scrfd_detector.detect(frame, score_thresh=DETECTION_THRESHOLD)
            elif yunet_detector is not None:
                _, faces = yunet_detector.detect(frame)
                if faces is not None:
                    for f in faces:
                        x, y, w, h = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                        lms = f[4:14].reshape((5, 2)).astype(np.float32)
                        score = float(f[14]) if len(f) > 14 else 0.7
                        bbox = (x, y, w, h)
                        if _is_plausible_face(bbox, lms, frame_w=sample_w, frame_h=sample_h):
                            raw_dets.append({"bbox": bbox, "score": score, "landmarks": lms})
                    raw_dets = _suppress_parasite_detections(raw_dets)

            # Run 106-point lip landmark predictor when disambiguating multiple faces or active speech
            run_lm106 = lm106_predictor is not None and (len(raw_dets) >= 2 or is_speech)
            detections: list[dict[str, Any]] = []
            for di, d in enumerate(raw_dets):
                x, y, w, h = d["bbox"]
                lms = d["landmarks"]
                reye, leye, nose, rm, lm = lms
                mouth_w = max(12, int(abs(lm[0] - rm[0]) * 1.5))
                eye_dist = max(8.0, float(np.hypot(*(leye - reye))))
                nose_sz = max(8, int(eye_dist * 0.5))

                inner_mar: float | None = None
                outer_mar: float | None = None
                if run_lm106 and di < 3:
                    lip_res = lm106_predictor.predict_lip_metrics(frame, d["bbox"])
                    if lip_res is not None:
                        inner_mar, outer_mar = lip_res

                detections.append({
                    "bbox": d["bbox"],
                    "score": d.get("score", 0.7),
                    "landmarks": lms,
                    "mouth_patch": _crop_patch(
                        gray, (rm[0] + lm[0]) / 2.0, (rm[1] + lm[1]) / 2.0, mouth_w, max(10, int(mouth_w * 0.7)), (24, 16)
                    ),
                    "nose_patch": _crop_patch(gray, nose[0], nose[1], nose_sz, nose_sz, (16, 16)),
                    "inner_mar": inner_mar,
                    "outer_mar": outer_mar,
                })

            is_split = _frame_has_vertical_center_divider(gray)
            if frame_idx > 0 and is_split != prev_was_split:
                is_scene_cut = True
            prev_was_split = is_split

            visible = tracker.process(t, detections, is_speech, is_scene_cut=is_scene_cut)
            p1_cx = director.choose(
                t,
                visible,
                tracker.all_tracks,
                is_speech,
                split_divider_present=is_split,
                is_scene_cut=is_scene_cut,
            )
            frames.append((t, visible, p1_cx, is_split, is_scene_cut))
            frame_idx += 1
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except Exception:
                process.kill()

    return frames, tracker.all_tracks, frame_interval


def _stitch_shot_lists(
    prefix_shots: list[dict[str, Any]],
    tail_shots: list[dict[str, Any]],
    seam_time: float,
) -> list[dict[str, Any]]:
    if not prefix_shots:
        return tail_shots
    if not tail_shots:
        return prefix_shots
    stitched: list[dict[str, Any]] = []
    for s in prefix_shots:
        s_start = float(s.get("start", 0.0))
        s_end = float(s.get("end", 0.0))
        if s_start >= seam_time:
            continue
        clipped = dict(s)
        if s_end > seam_time:
            clipped["end"] = round(seam_time, 3)
        if clipped["end"] > clipped["start"]:
            stitched.append(clipped)
    for idx, s in enumerate(tail_shots):
        s_start = float(s.get("start", 0.0))
        s_end = float(s.get("end", 0.0))
        if s_end <= seam_time:
            continue
        clipped = dict(s)
        if idx == 0 or s_start < seam_time:
            clipped["start"] = round(seam_time, 3)
        if clipped["end"] > clipped["start"]:
            stitched.append(clipped)
    return stitched


def _transcript_signature(project_directory: Path) -> dict[str, Any]:
    for candidate in (
        project_directory / "transcription" / "transcript.json",
        project_directory / "transcript.json",
    ):
        if candidate.is_file():
            try:
                raw = candidate.read_bytes()
                st = candidate.stat()
                return {
                    "exists": True,
                    "size": st.st_size,
                    "mtime_ns": st.st_mtime_ns,
                    "sha256_prefix": hashlib.sha256(raw).hexdigest()[:16],
                }
            except OSError:
                return {"exists": True}
    return {"exists": False}


def _locked_crop_left(crop_anchor_x: float, crop_w: int, orig_w: int) -> int:
    anchor = max(0.0, min(1.0, float(crop_anchor_x)))
    max_left = max(0, orig_w - crop_w)
    x = int(round(max_left * anchor))
    return max(0, x - (x % 2))


def normalize_tracking_mode(face_tracking: bool = True, tracking_mode: str | None = None) -> str:
    mode = (tracking_mode or "").strip().lower()
    if mode in {"locked", "cuts", "follow"}:
        return mode
    return "follow" if face_tracking else "locked"


def build_clip_crop_preview(
    tracking_data: dict[str, Any],
    clip_start: float,
    clip_end: float,
) -> dict[str, Any]:
    orig_w = max(1, int(tracking_data.get("source_width", 1280)))
    orig_h = max(1, int(tracking_data.get("source_height", 720)))
    crop_w = max(1, int(tracking_data.get("crop_width", int(round(orig_h * 9.0 / 16.0)))))
    crop_h = max(1, int(tracking_data.get("crop_height", orig_h)))
    shots = tracking_data.get("shots", [])
    segments: list[dict[str, Any]] = []
    for s in shots:
        s_start = float(s.get("start", 0.0))
        s_end = float(s.get("end", 0.0))
        if s_end > clip_start and s_start < clip_end:
            x = int(s.get("x", 0))
            segments.append({
                "start": round(max(0.0, s_start - clip_start), 2),
                "end": round(max(0.0, min(clip_end, s_end) - clip_start), 2),
                "x": x,
                "x_ratio": round(x / float(orig_w), 4),
            })
    first_x = segments[0]["x"] if segments else _even_left(orig_w / 2.0, crop_w, orig_w)
    return {
        "source_width": orig_w,
        "source_height": orig_h,
        "crop_width": crop_w,
        "crop_height": crop_h,
        "already_vertical": bool(tracking_data.get("already_vertical", False)),
        "requested_tracking_mode": tracking_data.get("requested_tracking_mode", "locked"),
        "applied_tracking_mode": tracking_data.get("applied_tracking_mode", "locked"),
        "fallback_reason": tracking_data.get("fallback_reason"),
        "crop_anchor_x": tracking_data.get("crop_anchor_x", 0.5),
        "x": first_x,
        "x_ratio": round(first_x / float(orig_w), 4),
        "w_ratio": round(crop_w / float(orig_w), 4),
        "segments": segments[:12],
    }


def analyze_speaker_tracking(
    project_directory: Path,
    ffmpeg_path: str,
    cancel_event: threading.Event | None = None,
    progress_callback: Any | None = None,
    max_duration: float | None = None,
    face_tracking: bool = True,
    tracking_mode: str | None = None,
    crop_anchor_x: float = 0.5,
) -> dict[str, Any]:
    """
    Resolve 9:16 crop timeline for a project:
    - 'locked': Fixed stationary crop at crop_anchor_x without invoking face detection.
    - 'cuts': Stationary speaker-cut framing between active speakers (no pan motion).
    - 'follow': Smooth active-speaker camera gliding.
    """
    key = str(Path(project_directory).resolve())
    with _ANALYSIS_LOCKS_GUARD:
        lock = _ANALYSIS_LOCKS.setdefault(key, threading.Lock())
    with lock:
        return _analyze_speaker_tracking_locked(
            project_directory,
            ffmpeg_path,
            cancel_event,
            progress_callback,
            max_duration=max_duration,
            face_tracking=face_tracking,
            tracking_mode=tracking_mode,
            crop_anchor_x=crop_anchor_x,
        )


def _analyze_speaker_tracking_locked(
    project_directory: Path,
    ffmpeg_path: str,
    cancel_event: threading.Event | None,
    progress_callback: Any | None,
    max_duration: float | None = None,
    face_tracking: bool = True,
    tracking_mode: str | None = None,
    crop_anchor_x: float = 0.5,
) -> dict[str, Any]:
    source_path = _find_source_video(project_directory)
    signature = _source_signature(source_path)
    transcript_sig = _transcript_signature(project_directory)
    effective_mode = normalize_tracking_mode(face_tracking=face_tracking, tracking_mode=tracking_mode)
    anchor_ratio = max(0.0, min(1.0, float(crop_anchor_x)))
    analysis_cache = project_directory / "tracking_analysis.json"

    cached_data: dict[str, Any] | None = None
    partial_cached: dict[str, Any] | None = None
    partial_scanned_dur: float = 0.0
    if analysis_cache.is_file():
        try:
            loaded = json.loads(analysis_cache.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and loaded.get("source") == signature:
                cached_data = loaded
        except Exception:
            cached_data = None

    # Locked Crop: stationary horizontal framing with ZERO face scanning.
    if effective_mode == "locked":
        if cached_data and cached_data.get("source_width") and cached_data.get("source_height"):
            orig_w = int(cached_data["source_width"])
            orig_h = int(cached_data["source_height"])
        else:
            orig_w, orig_h = probe_video_dimensions(source_path, ffmpeg_path)
        crop_h = orig_h if orig_h % 2 == 0 else orig_h - 1
        crop_w = int(round(crop_h * 9.0 / 16.0))
        if crop_w % 2 != 0:
            crop_w -= 1
        already_vertical = orig_w <= crop_w + 4 or (orig_w / max(1, orig_h)) <= (9.0 / 16.0 + 0.05)
        locked_x = 0 if already_vertical else _locked_crop_left(anchor_ratio, crop_w, orig_w)
        return {
            "version": ANALYSIS_VERSION,
            "source": signature,
            "transcript": transcript_sig,
            "source_width": orig_w,
            "source_height": orig_h,
            "crop_width": orig_w if already_vertical else crop_w,
            "crop_height": orig_h if already_vertical else crop_h,
            "already_vertical": already_vertical,
            "face_tracking": False,
            "tracking_mode": "locked",
            "requested_tracking_mode": "locked",
            "applied_tracking_mode": "locked",
            "crop_anchor_x": round(anchor_ratio, 3),
            "fallback_reason": None,
            "shots": [{"start": 0.0, "end": 999999.0, "x": locked_x}],
        }

    model_directory = os.environ.get(_EXTERNAL_FACE_MODELS_ENV, "").strip()
    model_signature = (
        hashlib.sha256(model_directory.encode()).hexdigest()
        if model_directory and not getattr(sys, "frozen", False)
        else None
    )
    if cached_data is not None:
        try:
            cached_transcript = cached_data.get("transcript") or {"exists": False}
            if (
                cached_data.get("version") == ANALYSIS_VERSION
                and cached_transcript == transcript_sig
                and cached_data.get("face_model_signature") == model_signature
                and not cached_data.get("fallback_reason")
            ):
                if cached_data.get("already_vertical") and "shots" in cached_data:
                    return {
                        **cached_data,
                        "face_tracking": effective_mode == "follow",
                        "tracking_mode": effective_mode,
                        "requested_tracking_mode": effective_mode,
                        "applied_tracking_mode": "already_vertical",
                        "fallback_reason": None,
                    }

                scanned_val = float(cached_data.get("scanned_duration", 0.0) or 0.0)
                if scanned_val <= 0.0:
                    raw_shots = cached_data.get("shots") or cached_data.get("shots_tracked") or []
                    scanned_val = max(
                        (
                            float(s.get("end", 0.0))
                            for s in raw_shots
                            if isinstance(s, dict) and float(s.get("end", 0.0)) < 900000.0
                        ),
                        default=0.0,
                    )
                if cached_data.get("is_full_scan"):
                    duration_ok = True
                else:
                    cached_vid_dur = float(cached_data.get("video_duration", 0.0) or 0.0)
                    if max_duration is None:
                        duration_ok = cached_vid_dur > 0 and scanned_val >= cached_vid_dur - 0.5
                    else:
                        needed = min(cached_vid_dur, max_duration) if cached_vid_dur > 0 else max_duration
                        duration_ok = scanned_val >= needed - 0.5

                if duration_ok:
                    if "shots_tracked" in cached_data and "shots_static" in cached_data:
                        selected_shots = cached_data["shots_tracked" if effective_mode == "follow" else "shots_static"]
                        return {
                            **cached_data,
                            "face_tracking": effective_mode == "follow",
                            "tracking_mode": effective_mode,
                            "requested_tracking_mode": effective_mode,
                            "applied_tracking_mode": cached_data.get("applied_tracking_mode") or effective_mode,
                            "fallback_reason": cached_data.get("fallback_reason"),
                            "shots": selected_shots,
                        }
                    if "shots" in cached_data and cached_data.get("tracking_mode") == effective_mode:
                        return cached_data
                elif scanned_val >= 30.0 and ("shots" in cached_data or "shots_tracked" in cached_data):
                    partial_cached = cached_data
                    partial_scanned_dur = scanned_val
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
        "transcript": transcript_sig,
        "face_model_signature": model_signature,
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
            "face_tracking": effective_mode == "follow",
            "tracking_mode": effective_mode,
            "requested_tracking_mode": effective_mode,
            "applied_tracking_mode": "already_vertical",
            "fallback_reason": None,
            "shots": [{"start": 0.0, "end": 999999.0, "x": 0}],
        }
        _write_cache(analysis_cache, result)
        return result

    center_x = _locked_crop_left(anchor_ratio, crop_w, orig_w)
    center_fallback = {
        **base,
        "face_tracking": effective_mode == "follow",
        "tracking_mode": effective_mode,
        "requested_tracking_mode": effective_mode,
        "applied_tracking_mode": "fallback_center",
        "crop_anchor_x": round(anchor_ratio, 3),
        "shots": [{"start": 0.0, "end": 999999.0, "x": center_x}],
    }

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
    resume_seam = round(max(0.0, partial_scanned_dur - 10.0), 3) if partial_cached is not None else 0.0
    scan_start_offset = max(0.0, resume_seam - 2.0) if resume_seam > 0.0 else 0.0
    try:
        effective_duration = min(video_duration, max_duration) if max_duration is not None else video_duration
        frames, tracks, frame_interval = _scan_faces(
            source_path, ffmpeg_path, orig_w, orig_h, crop_w,
            speech_windows, effective_duration, cancel_event, progress_callback,
            max_duration=max_duration,
            start_offset=scan_start_offset,
        )
    except ClipGenerationCancelled:
        raise
    except Exception as e:
        logger.exception("Smart framing analysis failed; using centered crop")
        result = {**center_fallback, "fallback_reason": f"{type(e).__name__}: {e}"}
        _write_cache(analysis_cache, result)
        return result

    if cancel_event is not None and cancel_event.is_set():
        raise ClipGenerationCancelled("Clip generation was cancelled")

    if progress_callback:
        progress_callback("Optimizing camera cuts and speaker alignment...", int(video_duration), int(video_duration))

    if not frames:
        if partial_cached is not None:
            return partial_cached
        result = {**center_fallback, "fallback_reason": "No video frames could be decoded for face detection."}
        _write_cache(analysis_cache, result)
        return result

    scene_cuts = [float(f[0]) for f in frames if len(f) >= 5 and f[4]]
    relevant_utterances = (
        [u for u in speech_utterances if float(u.get("end", 0.0)) >= scan_start_offset]
        if scan_start_offset > 0.0
        else speech_utterances
    )
    assignments = _assign_speakers(
        relevant_utterances,
        tracks,
        start_offset=scan_start_offset,
        scene_cuts=scene_cuts,
    )
    timeline = _build_target_timeline(frames, tracks, assignments, crop_w, orig_w=orig_w)
    shots_tracked = _build_smooth_tracking_shots(timeline, crop_w, orig_w, frame_interval)
    shots_static = _build_shots(timeline, crop_w, orig_w, frame_interval, allow_ease=False)
    if partial_cached is not None and resume_seam > 0.0:
        prev_tracked = partial_cached.get("shots_tracked") or partial_cached.get("shots") or []
        prev_static = partial_cached.get("shots_static") or partial_cached.get("shots") or []
        shots_tracked = _stitch_shot_lists(prev_tracked, shots_tracked, resume_seam)
        shots_static = _stitch_shot_lists(prev_static, shots_static, resume_seam)

    no_usable_faces = not any(tr.frame_count >= MIN_TRACK_FRAMES for tr in tracks.values()) and partial_cached is None
    if no_usable_faces:
        applied_mode = "fallback_center"
        fallback_reason: str | None = "No usable faces detected; using centered crop."
    else:
        applied_mode = effective_mode
        fallback_reason = None

    shots = shots_tracked if effective_mode == "follow" else shots_static
    is_full_scan = bool(max_duration is None or max_duration >= video_duration - 0.5)

    result = {
        **base,
        "face_tracking": effective_mode == "follow",
        "tracking_mode": effective_mode,
        "requested_tracking_mode": effective_mode,
        "applied_tracking_mode": applied_mode,
        "fallback_reason": fallback_reason,
        "scanned_duration": round(effective_duration, 3),
        "video_duration": round(video_duration, 3),
        "is_full_scan": is_full_scan,
        "shots_tracked": shots_tracked,
        "shots_static": shots_static,
        "shots": shots,
    }
    _write_cache(analysis_cache, result)
    return result


def _shot_value_expr(rel_start: float, rel_end: float, x: int, pan_from: int | None, pan_seconds: float) -> str:
    """FFmpeg expression for one shot's x: constant, or a clamped smoothstep ease from pan_from."""
    if pan_from is None or pan_from == x or pan_seconds <= 0 or rel_start + pan_seconds <= 0:
        return str(x)
    # Clamp u in [0, 1] so out-of-window evaluation can never overshoot [pan_from, x]
    u = f"clip((t-({rel_start:.3f}))/{pan_seconds:.3f},0,1)"
    ease_expr = f"{pan_from}+({x - pan_from})*{u}*{u}*(3-2*{u})"
    if rel_start + pan_seconds < rel_end - 0.02:
        return f"if(lt(t,{rel_start + pan_seconds:.3f}),{ease_expr},{x})"
    return ease_expr


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

    # Filter shots overlapping [clip_start, clip_end] BEFORE building expressions
    clip_duration = clip_end - clip_start
    clip_shots: list[dict[str, Any]] = []

    for s in shots:
        s_start = float(s.get("start", 0.0))
        s_end = float(s.get("end", 0.0))
        x = int(s.get("x", 0))

        if s_end > clip_start and s_start < clip_end:
            rel_start = max(0.0, s_start - clip_start)
            rel_end = min(clip_duration, s_end - clip_start)
            pan_from = s.get("pan_from")
            pan_sec = float(s.get("pan_seconds", PAN_SECONDS))
            # If the shot started before clip_start while panning, interpolate pan_from at clip_start
            if pan_from is not None and s_start < clip_start:
                elapsed = clip_start - s_start
                if elapsed >= pan_sec or pan_sec <= 0:
                    pan_from = None
                else:
                    u0 = max(0.0, min(1.0, elapsed / pan_sec))
                    s0 = u0 * u0 * (3.0 - 2.0 * u0)
                    pan_from = int(round(int(pan_from) + (x - int(pan_from)) * s0)) & ~1
                    pan_sec = max(0.05, pan_sec - elapsed)

            clip_shots.append({
                "rel_start": rel_start,
                "rel_end": rel_end,
                "x": x,
                "pan_from": int(pan_from) if pan_from is not None else None,
                "pan_seconds": pan_sec,
            })

    if not clip_shots:
        fallback_shot = shots[-1] if float(shots[-1].get("end", 0.0)) <= clip_start else shots[0]
        return crop_w, crop_h, str(fallback_shot.get("x", "(in_w-out_w)/2"))

    # Guard against exceeding FFmpeg expression parser depth limits on long clips:
    # Merge adjacent shots with the smallest movement and recompute rel_start / pan_from / pan_seconds
    # so the merged shot smoothly spans the combined time window.
    max_safe_segments = 25
    switch_px = SWITCH_FRACTION * crop_w
    while len(clip_shots) > max_safe_segments:
        best_idx = 0
        min_move = float("inf")
        for i in range(len(clip_shots) - 1):
            move = abs(clip_shots[i + 1]["x"] - clip_shots[i]["x"])
            if move < min_move:
                min_move = move
                best_idx = i
        dropped = clip_shots.pop(best_idx)
        nxt = clip_shots[best_idx]
        nxt["rel_start"] = dropped["rel_start"]
        start_x = dropped["pan_from"] if dropped["pan_from"] is not None else dropped["x"]
        if start_x != nxt["x"] and abs(nxt["x"] - start_x) <= switch_px:
            nxt["pan_from"] = start_x
            nxt["pan_seconds"] = max(0.05, round(nxt["rel_end"] - nxt["rel_start"], 3))
        else:
            nxt["pan_from"] = None

    relevant: list[tuple[float, str, int, bool]] = []
    for cs in clip_shots:
        value = _shot_value_expr(
            cs["rel_start"],
            cs["rel_end"],
            cs["x"],
            cs["pan_from"],
            cs["pan_seconds"],
        )
        relevant.append((cs["rel_end"], value, cs["x"], value == str(cs["x"])))

    # If only 1 shot or all relevant shots have the same static x
    if all(r[3] for r in relevant) and len({r[2] for r in relevant}) == 1:
        return crop_w, crop_h, str(relevant[0][2])

    # Build nested if(lt(t, cut), x_cur, ...) expression
    # Remove the last cut threshold since it covers the remainder of the clip
    expr = relevant[-1][1]
    for cut_t, value, _, _ in reversed(relevant[:-1]):
        expr = f"if(lt(t,{cut_t:.3f}),{value},{expr})"

    return crop_w, crop_h, expr

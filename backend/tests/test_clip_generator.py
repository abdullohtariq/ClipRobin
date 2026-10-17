import json
from pathlib import Path
import threading
import pytest

from app.services.clip_generator import generate_clips, render_single_clip
from app.services.video_editor import ClipGenerationCancelled, VideoEditorError


def test_generate_clips_missing_source_video(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="Source video not found"):
        generate_clips(tmp_path)


def test_generate_clips_preserves_existing_clips_on_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Setup project with source video and transcript
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    existing_clip = clips_dir / "clip_old.mp4"
    existing_clip.write_bytes(b"previous working clip")

    # Add analysis
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"},
                {"id": "clip_002", "title": "Clip 2", "start": 10.0, "end": 20.0, "reason": "Test"},
            ]
        }),
        encoding="utf-8",
    )

    # Mock create_clip to fail on clip 2
    def mock_create_clip(source, output, start, end, **kwargs):
        if "clip_002" in output.name:
            raise VideoEditorError("Simulated FFmpeg failure")
        output.write_bytes(b"rendered clip 1")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    with pytest.raises(VideoEditorError, match="Simulated FFmpeg failure"):
        generate_clips(tmp_path)

    # Verify original clip was NOT purged when render failed
    assert existing_clip.is_file()
    assert existing_clip.read_bytes() == b"previous working clip"


def test_generate_clips_cancellation_preserves_existing_clips(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    existing_clip = clips_dir / "clip_old.mp4"
    existing_clip.write_bytes(b"previous working clip")

    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    cancel_event = threading.Event()
    cancel_event.set()

    with pytest.raises(ClipGenerationCancelled):
        generate_clips(tmp_path, cancel_event=cancel_event)

    assert existing_clip.is_file()
    assert existing_clip.read_bytes() == b"previous working clip"


def test_generate_clips_successful_atomic_swap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    existing_clip = clips_dir / "clip_old.mp4"
    existing_clip.write_bytes(b"old clip")

    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 15.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    def mock_create_clip(source, output, start, end, **kwargs):
        output.write_bytes(b"new clip content")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    results = generate_clips(tmp_path)
    assert len(results) == 1
    assert results[0]["id"] == "clip_001"
    assert results[0]["status"] == "ready"

    # Old clip should now be gone, and new clip in place
    assert not existing_clip.is_file()
    new_clip = clips_dir / "clip_001.mp4"
    assert new_clip.is_file()
    assert new_clip.read_bytes() == b"new clip content"


def test_generate_clips_passes_show_watermark(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    captured_kwargs = {}

    def mock_create_clip(source, output, start, end, **kwargs):
        captured_kwargs.update(kwargs)
        output.write_bytes(b"content")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    generate_clips(tmp_path, show_watermark=True)
    assert captured_kwargs.get("show_watermark") is True


def test_render_single_clip_updates_analysis_and_creates_clip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.services.clip_generator import render_single_clip

    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ],
            "generation_options": {"show_subtitles": True, "show_watermark": True},
        }),
        encoding="utf-8",
    )

    captured = {}

    def mock_create_clip(source_path, output_path, start_time, end_time, **kwargs):
        captured["source"] = source_path
        captured["output"] = output_path
        captured["start"] = start_time
        captured["end"] = end_time
        captured["kwargs"] = kwargs
        output_path.write_bytes(b"single clip with top line")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    result = render_single_clip(
        tmp_path,
        "clip_001",
        top_line="POV: When the code works on first try",
    )

    assert result["id"] == "clip_001"
    assert result["top_line"] == "POV: When the code works on first try"
    assert result["file"] == "clip_001.mp4"
    assert (tmp_path / "clips" / "clip_001.mp4").is_file()
    assert captured["kwargs"]["top_line"] == "POV: When the code works on first try"
    assert captured["kwargs"]["show_watermark"] is True

    # Check analysis.json was persisted
    saved_analysis = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved_analysis["clips"][0]["top_line"] == "POV: When the code works on first try"


def test_render_single_clip_enforces_word_limit(tmp_path: Path):
    from app.services.clip_generator import render_single_clip

    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    sixteen_words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"
    with pytest.raises(ValueError, match="15 words or fewer"):
        render_single_clip(tmp_path, "clip_001", top_line=sixteen_words)


def test_render_single_clip_preserves_passed_show_watermark(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.services.clip_generator import render_single_clip

    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    captured = {}

    def mock_create_clip(source_path, output_path, start_time, end_time, **kwargs):
        captured.update(kwargs)
        output_path.write_bytes(b"single clip with top line")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    result = render_single_clip(
        tmp_path,
        "clip_001",
        top_line="POV: Coding",
        show_watermark=True,
    )

    assert result["top_line"] == "POV: Coding"
    assert captured.get("show_watermark") is True
    saved = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved.get("generation_options", {}).get("show_watermark") is True


def test_render_subtitles_and_top_line_with_special_characters(tmp_path: Path):
    from app.services.video_editor import _build_subtitle_filters, _build_top_line_filters
    sub_dir = tmp_path / "subtitles"
    sub_dir.mkdir()

    # Test top line with ', %, :, \
    tricky_top_line = "POV: It's 100% true (C:\\test)!"
    filters = _build_top_line_filters(tricky_top_line, sub_dir, font_file="subtitle-font.ttf")
    assert len(filters) > 0
    line_file = sub_dir / "top-line-0.txt"
    assert line_file.is_file()
    assert "100%" in line_file.read_text(encoding="utf-8")
    assert "drawtext=textfile=" in filters[0]
    assert "expansion=none" in filters[0]

    # Test subtitle segments with tricky quotes, colons, percentages, and backslashes
    segments = [{
        "start": 0.0,
        "end": 4.0,
        "text": "He said: 'It's 100% fine\\good'!",
        "words": [
            {"start": 0.0, "end": 1.0, "text": "He"},
            {"start": 1.0, "end": 2.0, "text": "said:"},
            {"start": 2.0, "end": 3.0, "text": "'It's"},
            {"start": 3.0, "end": 4.0, "text": "100%\\fine"},
        ]
    }]
    sub_filters = _build_subtitle_filters(
        0.0,
        5.0,
        subtitle_segments=segments,
        show_subtitles=True,
        subtitle_directory=sub_dir,
    )
    assert len(sub_filters) > 0
    assert any("expansion=none" in f for f in sub_filters)


def test_generate_rounded_corner_mask(tmp_path: Path):
    from app.services.video_editor import _generate_rounded_corner_mask
    from PIL import Image

    mask_path = _generate_rounded_corner_mask(tmp_path, size=660, radius=36)
    assert mask_path.is_file()
    assert mask_path.name == "rounded-mask.png"

    with Image.open(mask_path) as img:
        assert img.size == (660, 660)
        # Center should be fully opaque (255)
        assert img.getpixel((330, 330)) == 255
        # Outer corner (0, 0) should be transparent/black (0)
        assert img.getpixel((0, 0)) == 0


def test_generate_clips_with_square_rounded_framing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 15.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    captured = {}

    def mock_create_clip(source, output, start, end, **kwargs):
        captured.update(kwargs)
        output.write_bytes(b"square clip content")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    results = generate_clips(tmp_path, framing_mode="square_rounded")
    assert len(results) == 1
    assert captured.get("framing_mode") == "square_rounded"

    saved_analysis = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved_analysis.get("generation_options", {}).get("framing_mode") == "square_rounded"


def test_render_single_clip_square_rounded_framing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.services.clip_generator import render_single_clip

    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ],
            "generation_options": {
                "framing_mode": "square_rounded"
            }
        }),
        encoding="utf-8",
    )

    captured = {}

    def mock_create_clip(source_path, output_path, start_time, end_time, **kwargs):
        captured.update(kwargs)
        output_path.write_bytes(b"square single clip")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    result = render_single_clip(tmp_path, "clip_001")
    assert captured.get("framing_mode") == "square_rounded"
    saved = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved.get("generation_options", {}).get("framing_mode") == "square_rounded"


def test_generate_clips_with_true_9_16_framing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 15.0, "reason": "Test"}
            ]
        }),
        encoding="utf-8",
    )

    captured = {}

    def mock_create_clip(source, output, start, end, **kwargs):
        captured.update(kwargs)
        output.write_bytes(b"true 9:16 clip content")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    results = generate_clips(tmp_path, framing_mode="true_9_16")
    assert len(results) == 1
    assert captured.get("framing_mode") == "true_9_16"
    assert results[0].get("framing_mode") == "true_9_16"

    saved_analysis = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved_analysis.get("generation_options", {}).get("framing_mode") == "true_9_16"


def test_render_single_clip_true_9_16_framing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.services.clip_generator import render_single_clip

    (tmp_path / "source.mp4").write_bytes(b"mock video")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 10.0, "reason": "Test"}
            ],
            "generation_options": {
                "framing_mode": "true_9_16"
            }
        }),
        encoding="utf-8",
    )

    captured = {}

    def mock_create_clip(source_path, output_path, start_time, end_time, **kwargs):
        captured.update(kwargs)
        output_path.write_bytes(b"true 9:16 single clip")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip)

    result = render_single_clip(tmp_path, "clip_001")
    assert captured.get("framing_mode") == "true_9_16"
    assert result.get("framing_mode") == "true_9_16"
    saved = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved.get("generation_options", {}).get("framing_mode") == "true_9_16"


def test_create_clip_true_9_16_audio_mapping_with_watermark(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.services.video_editor import create_clip

    source = tmp_path / "source.mp4"
    source.write_bytes(b"dummy")
    output = tmp_path / "output.mp4"
    watermark = tmp_path / "watermark.png"
    watermark.write_bytes(b"dummy_wm")

    monkeypatch.setattr("app.services.video_editor.find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.video_editor.has_audio_stream", lambda *args: True)
    monkeypatch.setattr("app.services.video_editor.find_watermark_file", lambda: watermark)
    monkeypatch.setattr(
        "app.services.smart_framing.analyze_speaker_tracking",
        lambda *args, **kwargs: {"crop_width": 404, "crop_height": 720, "shots": [{"start": 0.0, "end": 10.0, "x": 100}]},
    )

    captured_command = []

    class MockProcess:
        returncode = 0
        def communicate(self, timeout=None):
            return ("", "")

    def mock_popen(cmd, *args, **kwargs):
        captured_command.extend(cmd)
        output.write_bytes(b"rendered")
        return MockProcess()

    monkeypatch.setattr("subprocess.Popen", mock_popen)

    create_clip(
        source_path=source,
        output_path=output,
        start_time=0.0,
        end_time=5.0,
        show_watermark=True,
        framing_mode="true_9_16",
    )

    # When watermark is present and has_audio is True, -map 0:a? MUST be present alongside -map [v]
    assert "-map" in captured_command
    assert "[v]" in captured_command
    assert "0:a?" in captured_command
    assert "libmp3lame" in captured_command


def test_generate_rounded_corner_mask_16_9(tmp_path: Path):
    from app.services.video_editor import _generate_rounded_corner_mask
    from PIL import Image

    mask_path = _generate_rounded_corner_mask(
        tmp_path,
        width=672,
        height=378,
        radius=28,
        filename="rounded-mask-16-9.png",
    )
    assert mask_path.is_file()
    assert mask_path.name == "rounded-mask-16-9.png"

    with Image.open(mask_path) as img:
        assert img.size == (672, 378)
        # Center should be fully opaque (255)
        assert img.getpixel((336, 189)) == 255
        # Outer corner (0, 0) should be transparent/black (0)
        assert img.getpixel((0, 0)) == 0


def test_create_clip_standard_16_9_rounded_framing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.services.video_editor import create_clip

    source = tmp_path / "source.mp4"
    source.write_bytes(b"dummy")
    output = tmp_path / "output.mp4"

    monkeypatch.setattr("app.services.video_editor.find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.video_editor.has_audio_stream", lambda *args: True)
    monkeypatch.setattr("app.services.video_editor.find_watermark_file", lambda: None)

    captured_command = []
    captured_filter_content = []

    class MockProcess:
        returncode = 0
        def communicate(self, timeout=None):
            return ("", "")

    def mock_popen(cmd, *args, **kwargs):
        captured_command.extend(cmd)
        cwd = kwargs.get("cwd")
        if cwd and (Path(cwd) / "filter-complex.txt").is_file():
            captured_filter_content.append((Path(cwd) / "filter-complex.txt").read_text(encoding="utf-8"))
        output.write_bytes(b"rendered")
        return MockProcess()

    monkeypatch.setattr("subprocess.Popen", mock_popen)

    create_clip(
        source_path=source,
        output_path=output,
        start_time=0.0,
        end_time=5.0,
        framing_mode="standard",
    )

    # Standard mode now uses 16:9 rounded corners with filter_complex
    assert "-/filter_complex" in captured_command
    assert "-map" in captured_command
    assert "[v]" in captured_command
    assert "0:a?" in captured_command
    assert "libmp3lame" in captured_command

    # Check filter content includes 16:9 scale and rounded mask
    assert len(captured_filter_content) == 1
    filter_text = captured_filter_content[0]
    assert "scale=672:378" in filter_text
    assert "rounded-mask-16-9.png" in filter_text
    assert "alphamerge" in filter_text
    assert "overlay=x=(W-w)/2:y=(H-h)/2" in filter_text


def test_create_clip_standard_16_9_rounded_framing_with_watermark(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.services.video_editor import create_clip

    source = tmp_path / "source.mp4"
    source.write_bytes(b"dummy")
    output = tmp_path / "output.mp4"
    watermark = tmp_path / "watermark.png"
    watermark.write_bytes(b"dummy_wm")

    monkeypatch.setattr("app.services.video_editor.find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.video_editor.has_audio_stream", lambda *args: True)
    monkeypatch.setattr("app.services.video_editor.find_watermark_file", lambda: watermark)

    captured_command = []
    captured_filter_content = []

    class MockProcess:
        returncode = 0
        def communicate(self, timeout=None):
            return ("", "")

    def mock_popen(cmd, *args, **kwargs):
        captured_command.extend(cmd)
        cwd = kwargs.get("cwd")
        if cwd and (Path(cwd) / "filter-complex.txt").is_file():
            captured_filter_content.append((Path(cwd) / "filter-complex.txt").read_text(encoding="utf-8"))
        output.write_bytes(b"rendered")
        return MockProcess()

    monkeypatch.setattr("subprocess.Popen", mock_popen)

    create_clip(
        source_path=source,
        output_path=output,
        start_time=0.0,
        end_time=5.0,
        show_watermark=True,
        framing_mode="standard",
    )

    assert "-/filter_complex" in captured_command
    assert "-map" in captured_command
    assert "[v]" in captured_command
    assert "0:a?" in captured_command
    assert len(captured_filter_content) == 1
    assert "rounded-mask-16-9.png" in captured_filter_content[0]
    assert "scale=240:-2[wm]" in captured_filter_content[0]


def test_build_subtitle_filters_caption_styles(tmp_path: Path):
    from app.services.video_editor import _build_subtitle_filters

    segments = [
        {
            "start": 0.0,
            "end": 2.0,
            "text": "Hello world test",
            "words": [
                {"start": 0.0, "end": 0.5, "text": "Hello"},
                {"start": 0.5, "end": 1.0, "text": "world"},
                {"start": 1.0, "end": 2.0, "text": "test"},
            ],
        }
    ]

    # 1. Classic style
    classic_filters = _build_subtitle_filters(
        0.0, 2.0, subtitle_segments=segments, subtitle_directory=tmp_path, caption_style="classic"
    )
    assert any("box=1:boxcolor=black@0.55" in f for f in classic_filters)
    assert any("fontcolor=yellow" in f for f in classic_filters)
    assert any("fontsize=34" in f for f in classic_filters)

    # 2. Bold Emerald style
    emerald_filters = _build_subtitle_filters(
        0.0, 2.0, subtitle_segments=segments, subtitle_directory=tmp_path, caption_style="bold_emerald"
    )
    assert any("fontcolor=0x10b981" in f for f in emerald_filters)
    assert any("borderw=4" in f for f in emerald_filters)
    assert any("fontsize=36" in f for f in emerald_filters)
    assert not any("box=1" in f for f in emerald_filters)

    # 3. Clean Gold style
    gold_filters = _build_subtitle_filters(
        0.0, 2.0, subtitle_segments=segments, subtitle_directory=tmp_path, caption_style="clean_gold"
    )
    assert any("fontcolor=0xfbbf24" in f for f in gold_filters)
    assert any("borderw=2" in f for f in gold_filters)
    assert any("fontsize=33" in f for f in gold_filters)
    assert not any("box=1" in f for f in gold_filters)


def test_generate_and_render_clip_caption_style(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "source.mp4").write_bytes(b"dummy")
    analysis_file = tmp_path / "analysis.json"
    analysis_file.write_text(
        json.dumps({
            "clips": [
                {"id": "clip_001", "title": "Clip 1", "start": 0.0, "end": 5.0, "reason": "Test"}
            ],
            "generation_options": {}
        }),
        encoding="utf-8",
    )

    captured_generate = {}
    def mock_create_clip_gen(source_path, output_path, start_time, end_time, **kwargs):
        captured_generate.update(kwargs)
        output_path.write_bytes(b"generated clip")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip_gen)

    clips = generate_clips(tmp_path, caption_style="bold_emerald")
    assert len(clips) == 1
    assert clips[0]["caption_style"] == "bold_emerald"
    assert captured_generate.get("caption_style") == "bold_emerald"

    saved = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved.get("generation_options", {}).get("caption_style") == "bold_emerald"

    # Now render_single_clip with clean_gold
    captured_render = {}
    def mock_create_clip_render(source_path, output_path, start_time, end_time, **kwargs):
        captured_render.update(kwargs)
        output_path.write_bytes(b"re-rendered clip")

    monkeypatch.setattr("app.services.clip_generator.create_clip", mock_create_clip_render)

    updated = render_single_clip(tmp_path, "clip_001", caption_style="clean_gold")
    assert updated["caption_style"] == "clean_gold"
    assert captured_render.get("caption_style") == "clean_gold"

    saved2 = json.loads(analysis_file.read_text(encoding="utf-8"))
    assert saved2.get("generation_options", {}).get("caption_style") == "clean_gold"






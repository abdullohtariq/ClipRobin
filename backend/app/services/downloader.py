from pathlib import Path
from typing import Any, Callable

import yt_dlp


def download_video(
    url: str,
    output_path: Path,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    if progress_callback:
        progress_callback({
            "status": "downloading",
            "step": "Extracting video info...",
            "progress": 5.0,
        })

    def progress_hook(d: dict[str, Any]) -> None:
        if not progress_callback:
            return
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            speed = d.get("speed")  # bytes/second
            eta = d.get("eta")  # seconds

            speed_str = ""
            if speed:
                if speed >= 1024 * 1024:
                    speed_str = f"{speed / (1024 * 1024):.1f} MB/s"
                else:
                    speed_str = f"{speed / 1024:.0f} KB/s"

            if total > 0:
                percent = round(min(97.0, 5.0 + (downloaded / total) * 92.0), 1)
                step = f"Downloading video: {percent}%"
            else:
                downloaded_mb = downloaded / (1024 * 1024)
                percent = 20.0
                step = f"Downloading video: {downloaded_mb:.1f} MB"

            if speed_str:
                step += f" ({speed_str})"
            if eta:
                step += f" · {eta}s left"

            info_dict = d.get("info_dict") or {}
            title = info_dict.get("title")

            progress_callback({
                "status": "downloading",
                "step": step,
                "progress": percent,
                "title": title,
                "downloaded_bytes": downloaded,
                "total_bytes": total,
            })
        elif status == "finished":
            progress_callback({
                "status": "processing",
                "step": "Processing downloaded stream...",
                "progress": 98.0,
                "title": (d.get("info_dict") or {}).get("title"),
            })

    def postprocessor_hook(d: dict[str, Any]) -> None:
        if not progress_callback:
            return
        post_status = d.get("status")
        if post_status == "started":
            progress_callback({
                "status": "processing",
                "step": "Merging video and audio...",
                "progress": 99.0,
            })
        elif post_status == "finished":
            progress_callback({
                "status": "processing",
                "step": "Finalizing video...",
                "progress": 100.0,
            })

    options = {
        "format": "bestvideo*+bestaudio/best",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "outtmpl": str(output_path),
        "quiet": True,
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [postprocessor_hook],
    }

    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
        return {
            "title": (info or {}).get("title") or output_path.name,
            "duration": (info or {}).get("duration"),
        }

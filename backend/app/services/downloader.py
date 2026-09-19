from pathlib import Path

import yt_dlp


def download_video(url: str, output_path: Path) -> None:
    options = {
        "format": "bestvideo*+bestaudio/best",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "outtmpl": str(output_path),
    }

    with yt_dlp.YoutubeDL(options) as downloader:
        downloader.download([url])

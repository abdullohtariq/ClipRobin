"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { downloadVideo, transcribeLocalVideo } from "@/src/lib/api";

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [localVideoName, setLocalVideoName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    setDownloadStatus("Downloading...");

    try {
      const result = await downloadVideo(youtubeUrl);
      setDownloadStatus(`Saved ${result.file} in ${result.project_id}`);
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "Video download failed",
      );
    }
  };

  const handleLocalVideo = async (video: File) => {
    setLocalVideoName(video.name);
    setDownloadStatus("Transcribing local video...");

    try {
      const result = await transcribeLocalVideo(video);
      setDownloadStatus(
        `Transcribed ${result.segments} segments in ${result.project_id}`,
      );
    } catch (error) {
      setDownloadStatus(
        error instanceof Error
          ? error.message
          : "Local video transcription failed",
      );
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const video = event.target.files?.[0];
    if (video) {
      void handleLocalVideo(video);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const video = event.dataTransfer.files[0];
    if (video) {
      void handleLocalVideo(video);
    }
  };

  return (
    <main className="p-10">
      <h2 className="text-3xl font-semibold">
        Dashboard
      </h2>

      <p className="mt-2 text-zinc-400">
        Turn long videos into short clips with AI.
      </p>

      <div className="mt-10 max-w-2xl">
        <label className="block text-sm text-zinc-400 mb-2">
          YouTube URL
        </label>

        <input
          type="text"
          value={youtubeUrl}
          onChange={(event) => setYoutubeUrl(event.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-white"
        />

        <p className="mt-3 text-sm text-zinc-500">
          Current URL: {youtubeUrl}
        </p>

        <button
          onClick={handleDownload}
          className="mt-4 rounded-lg bg-white px-5 py-3 font-medium text-black hover:bg-zinc-200"
        >
          Generate Clips
        </button>

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          className="mt-6 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 p-6 text-center"
        >
          <p className="text-sm text-zinc-400">
            Drop a local video here to transcribe it directly
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 rounded-lg border border-zinc-700 px-5 py-3 font-medium text-white hover:bg-zinc-800"
          >
            Choose Video File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
          />
          {localVideoName && (
            <p className="mt-3 truncate text-sm text-zinc-500">
              Selected: {localVideoName}
            </p>
          )}
        </div>

        {downloadStatus && (
          <p className="mt-3 text-sm text-zinc-400">{downloadStatus}</p>
        )}
      </div>
    </main>
  );
}

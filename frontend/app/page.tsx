"use client";

import { useState } from "react";
import { checkBackend, downloadVideo } from "@/src/lib/api";

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");

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

  const testBackend = async () => {
    try {
      const result = await checkBackend();
      console.log("Backend:", result);
    } catch (error) {
      console.error("Backend connection failed:", error);
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

        {downloadStatus && (
          <p className="mt-3 text-sm text-zinc-400">{downloadStatus}</p>
        )}

        <button
          onClick={testBackend}
          className="mt-4 ml-3 rounded-lg border border-zinc-700 px-5 py-3 font-medium text-white hover:bg-zinc-800"
        >
          Test Backend
        </button>
      </div>
    </main>
  );
}

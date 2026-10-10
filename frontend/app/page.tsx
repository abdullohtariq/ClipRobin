"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import {
  downloadVideo,
  getLocalTranscriptionJob,
  LocalTranscriptionJob,
  transcribeLocalVideo,
} from "@/src/lib/api";

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [localVideoName, setLocalVideoName] = useState("");
  const [transcriptionProgress, setTranscriptionProgress] = useState<{
    step: string;
    progress: number;
    projectId?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTranscribing = Boolean(
    transcriptionProgress
    && transcriptionProgress.step !== "Complete"
    && transcriptionProgress.step !== "Transcription failed",
  );

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
    setDownloadStatus("");
    setTranscriptionProgress({ step: "Uploading video", progress: 0 });

    try {
      const job = await transcribeLocalVideo(video, (progress) => {
        setTranscriptionProgress({
          step: "Uploading video",
          progress: Math.round(progress * 0.25),
        });
      });
      setTranscriptionProgress({
        step: job.step,
        progress: 25 + Math.round(job.progress * 0.75),
        projectId: job.project_id,
      });

      let completedJob: LocalTranscriptionJob = job;
      while (completedJob.status !== "completed" && completedJob.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        completedJob = await getLocalTranscriptionJob(job.project_id);
        setTranscriptionProgress({
          step: completedJob.step,
          progress: 25 + Math.round(completedJob.progress * 0.75),
          projectId: completedJob.project_id,
        });
      }

      if (completedJob.status === "failed") {
        throw new Error(completedJob.error ?? "Local video transcription failed");
      }
      const result = completedJob.result;
      if (!result) {
        throw new Error("Transcription completed without a result");
      }
      setDownloadStatus(
        `Transcribed ${result.segments} segments in ${result.project_id}`,
      );
      setTranscriptionProgress({
        step: "Complete",
        progress: 100,
        projectId: result.project_id,
      });
    } catch (error) {
      setDownloadStatus(
        error instanceof Error
          ? error.message
          : "Local video transcription failed",
      );
      setTranscriptionProgress((current) => current
        ? { ...current, step: "Transcription failed" }
        : null);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const video = event.target.files?.[0];
    event.target.value = "";
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
            disabled={isTranscribing}
            className="mt-3 rounded-lg border border-zinc-700 px-5 py-3 font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isTranscribing ? "Processing Video..." : "Choose Video File"}
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

        {transcriptionProgress && (
          <section
            aria-live="polite"
            className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900 p-5"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-medium text-white">{transcriptionProgress.step}</h3>
              <span className="text-sm tabular-nums text-zinc-400">
                {transcriptionProgress.progress}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Local video processing progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={transcriptionProgress.progress}
              className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-700"
            >
              <div
                className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
                style={{ width: `${transcriptionProgress.progress}%` }}
              />
            </div>
            <ol className="mt-5 grid gap-3 sm:grid-cols-2">
              {["Uploading video", "Loading speech model", "Transcribing audio", "Saving transcript", "Complete"].map((step) => {
                const activeStep = step === transcriptionProgress.step;
                const done = step === "Uploading video"
                  ? transcriptionProgress.progress >= 25
                  : step === "Loading speech model"
                    ? ["Transcribing audio", "Saving transcript", "Complete"].includes(transcriptionProgress.step)
                    : step === "Transcribing audio"
                      ? ["Saving transcript", "Complete"].includes(transcriptionProgress.step)
                      : step === "Saving transcript"
                        ? transcriptionProgress.step === "Complete"
                        : transcriptionProgress.step === "Complete";
                return (
                  <li
                    key={step}
                    className={`flex items-center gap-2 text-sm ${
                      activeStep ? "text-emerald-300" : done ? "text-zinc-300" : "text-zinc-500"
                    }`}
                  >
                    <span aria-hidden="true">{done ? "✓" : activeStep ? "●" : "○"}</span>
                    {step}
                  </li>
                );
              })}
            </ol>
            {transcriptionProgress.projectId && (
              <p className="mt-4 text-xs text-zinc-500">
                Project: {transcriptionProgress.projectId}
              </p>
            )}
          </section>
        )}

        {downloadStatus && (
          <p className={`mt-3 text-sm ${downloadStatus.includes("failed") || downloadStatus.includes("Could not") ? "text-red-400" : "text-zinc-400"}`}>
            {downloadStatus}
          </p>
        )}
      </div>
    </main>
  );
}

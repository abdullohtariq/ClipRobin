"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import {
  ActiveJob,
  downloadVideo,
  generateClips,
  getActiveJobs,
  getLatestClipGenerationJob,
  getLocalTranscriptionJob,
  LocalTranscriptionJob,
  transcribeLocalVideo,
} from "@/src/lib/api";

type VideoProcessingProgress = {
  kind: "transcription" | "generation" | "complete" | "failed";
  step: string;
  progress: number;
  projectId?: string;
};

const CLIP_DURATIONS = [15, 30, 60, 90] as const;

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [clipDurationSeconds, setClipDurationSeconds] = useState<15 | 30 | 60 | 90>(30);
  const [showCaptions, setShowCaptions] = useState(true);
  const [transcriptionProgress, setTranscriptionProgress] = useState<VideoProcessingProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptionProgressRef = useRef(transcriptionProgress);
  useEffect(() => {
    transcriptionProgressRef.current = transcriptionProgress;
  }, [transcriptionProgress]);
  const isProcessingVideo = Boolean(
    transcriptionProgress
    && ["transcription", "generation"].includes(transcriptionProgress.kind),
  );
  const activeVideoJob = isProcessingVideo ? transcriptionProgress : null;

  useEffect(() => {
    let isCurrent = true;
    let timeoutId: number | undefined;

    const restoreProgress = async () => {
      try {
        const jobs: ActiveJob[] = await getActiveJobs();
        if (isCurrent) {
          const current = transcriptionProgressRef.current;
          const job = jobs.find((activeJob) =>
            (activeJob.kind === "transcription" || activeJob.kind === "generation")
            && (!current?.projectId || activeJob.project_id === current.projectId));
          if (job) {
            setTranscriptionProgress({
              kind: job.kind,
              step: job.step,
              progress: job.kind === "transcription"
                ? 25 + Math.round(job.progress * 0.75)
                : job.progress,
              projectId: job.project_id,
            });
          } else if (current?.projectId && current.kind === "transcription") {
            const transcription = await getLocalTranscriptionJob(current.projectId);
            if (!isCurrent) return;
            if (transcription.status === "failed") {
              setTranscriptionProgress({
                ...current,
                kind: "failed",
                step: transcription.step,
              });
            } else if (transcription.status === "completed") {
              setTranscriptionProgress({
                ...current,
                kind: "generation",
                step: "Clip generation started",
                progress: 0,
              });
            } else {
              setTranscriptionProgress({
                ...current,
                step: transcription.step,
                progress: 25 + Math.round(transcription.progress * 0.75),
              });
            }
          } else if (current?.projectId && current.kind === "generation") {
            const generation = await getLatestClipGenerationJob(current.projectId);
            if (!isCurrent || !generation) return;
            if (generation.status === "completed") {
              setTranscriptionProgress({
                kind: "complete",
                step: "Clip generation complete",
                progress: 100,
                projectId: current.projectId,
              });
            } else if (generation.status === "failed" || generation.status === "cancelled") {
              setTranscriptionProgress({
                kind: "failed",
                step: generation.error ?? generation.step,
                progress: generation.progress,
                projectId: current.projectId,
              });
            } else {
              setTranscriptionProgress({
                kind: "generation",
                step: generation.step,
                progress: generation.progress,
                projectId: current.projectId,
              });
            }
          }
        }
      } catch (error) {
        console.error("Could not restore active video progress", error);
      } finally {
        if (isCurrent) {
          timeoutId = window.setTimeout(() => void restoreProgress(), 1000);
        }
      }
    };

    void restoreProgress();
    return () => {
      isCurrent = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const handleDownload = async () => {
    if (isDownloading || isProcessingVideo) return;
    setIsDownloading(true);
    setDownloadStatus("Downloading...");

    try {
      const result = await downloadVideo(youtubeUrl);
      setDownloadStatus(`Saved ${result.file} in ${result.project_id}`);
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "Video download failed",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleLocalVideo = async () => {
    if (!selectedVideo || isProcessingVideo) return;
    setDownloadStatus("");
    setTranscriptionProgress({
      kind: "transcription",
      step: "Uploading video",
      progress: 0,
    });

    try {
      const job = await transcribeLocalVideo(selectedVideo, (progress) => {
        setTranscriptionProgress({
          kind: "transcription",
          step: "Uploading video",
          progress: Math.round(progress * 0.25),
        });
      });
      setTranscriptionProgress({
        kind: "transcription",
        step: job.step,
        progress: 25 + Math.round(job.progress * 0.75),
        projectId: job.project_id,
      });

      let completedJob: LocalTranscriptionJob = job;
      while (completedJob.status !== "completed" && completedJob.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        completedJob = await getLocalTranscriptionJob(job.project_id);
        setTranscriptionProgress({
          kind: "transcription",
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
      setTranscriptionProgress({
        kind: "generation",
        step: "Clip generation started",
        progress: 0,
        projectId: result.project_id,
      });
      setDownloadStatus(`Transcribed ${result.segments} segments. Generating clips...`);
      const generation = await generateClips(
        result.project_id,
        showCaptions,
        (job) => {
          setTranscriptionProgress({
            kind: "generation",
            step: job.step,
            progress: job.progress,
            projectId: result.project_id,
          });
        },
        clipDurationSeconds,
      );
      if (generation.cancelled) {
        throw new Error("Clip generation was cancelled");
      }
      setTranscriptionProgress({
        kind: "complete",
        step: "Clip generation started — go to Projects to see clips",
        progress: 100,
        projectId: result.project_id,
      });
      setDownloadStatus("Clips are ready.");
    } catch (error) {
      setDownloadStatus(
        error instanceof Error
          ? error.message
          : "Local video transcription failed",
      );
      setTranscriptionProgress((current) => current
        ? { ...current, kind: "failed", step: "Video processing failed" }
        : null);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const video = event.target.files?.[0];
    event.target.value = "";
    if (video) {
      if (!video.type.startsWith("video/")) {
        setSelectedVideo(null);
        setDownloadStatus("Please choose a video file.");
        return;
      }
      setSelectedVideo(video);
      setDownloadStatus("");
      setTranscriptionProgress(null);
    }
  };

  const handleClipDurationChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const duration = CLIP_DURATIONS.find(
      (seconds) => seconds === Number(event.target.value),
    );
    if (duration !== undefined) {
      setClipDurationSeconds(duration);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (isProcessingVideo) return;
    const video = event.dataTransfer.files[0];
    if (video) {
      if (!video.type.startsWith("video/")) {
        setSelectedVideo(null);
        setDownloadStatus("Please drop a video file.");
        return;
      }
      setSelectedVideo(video);
      setDownloadStatus("");
      setTranscriptionProgress(null);
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
          disabled={isDownloading || isProcessingVideo}
          className="mt-4 rounded-lg bg-white px-5 py-3 font-medium text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDownloading ? "Downloading..." : activeVideoJob?.kind === "transcription"
            ? "Transcribing..."
            : activeVideoJob?.kind === "generation" ? "Generating..." : "Download video"}
        </button>

        <div
          onDragOver={(event) => {
            if (!isProcessingVideo) event.preventDefault();
          }}
          onDrop={handleDrop}
          className={`mt-6 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 p-6 text-center ${
            isProcessingVideo ? "opacity-60" : ""
          }`}
        >
          <p className="text-sm text-zinc-400">
            Choose or drop a local video to prepare it for clip generation
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingVideo}
            className="mt-3 rounded-lg border border-zinc-700 px-5 py-3 font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedVideo ? "Choose a different video" : "Choose Video File"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            disabled={isProcessingVideo}
            className="hidden"
          />
          {selectedVideo && (
            <div
              role="status"
              className="mx-auto mt-4 max-w-xl rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 text-left"
            >
              <p className="truncate text-sm font-medium text-emerald-300">
                Video ready: {selectedVideo.name}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {(selectedVideo.size / (1024 * 1024)).toFixed(1)} MB · Choose your options, then select Start generating below.
              </p>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <label className="flex items-center gap-3 text-sm text-zinc-300">
              <span>Clip length</span>
              <select
                value={clipDurationSeconds}
                onChange={handleClipDurationChange}
                disabled={isProcessingVideo}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white disabled:opacity-50"
              >
                {CLIP_DURATIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds} seconds</option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={showCaptions}
                onChange={(event) => setShowCaptions(event.target.checked)}
                disabled={isProcessingVideo}
                className="size-4 accent-emerald-400 disabled:opacity-50"
              />
              Burn captions into clips
            </label>
          </div>
          <button
            type="button"
            onClick={() => void handleLocalVideo()}
            disabled={!selectedVideo || isProcessingVideo}
            className="mt-5 rounded-lg bg-emerald-400 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {activeVideoJob?.kind === "transcription"
              ? "Transcribing..."
              : activeVideoJob?.kind === "generation" ? "Generating..." : "Start generating"}
          </button>
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
              {(transcriptionProgress.kind === "transcription"
                ? ["Uploading video", "Loading speech model", "Transcribing audio", "Saving transcript", "Complete"]
                : ["Transcription complete", "Clip generation started", "Clips ready"]
              ).map((step, index) => {
                const activeStep = step === transcriptionProgress.step
                  || (step === "Generating clips" && transcriptionProgress.kind === "generation");
                const done = transcriptionProgress.kind !== "transcription"
                  ? transcriptionProgress.kind === "complete" || index < 1
                  : step === "Uploading video"
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
            {["generation", "complete"].includes(transcriptionProgress.kind) && transcriptionProgress.projectId && (
              <Link
                href="/projects"
                className="mt-4 inline-block text-sm text-emerald-300 underline hover:text-emerald-200"
              >
                {transcriptionProgress.kind === "complete"
                  ? "Clip generation complete"
                  : "Clip generation started"}
                {" — go to Projects to see clips for "}
                {transcriptionProgress.projectId}
              </Link>
            )}
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

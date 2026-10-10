"use client";

import Link from "next/link";
import { FormEvent, memo, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Clip,
  ClipGenerationJob,
  cancelClipGeneration,
  clipDownloadUrl,
  clipUrl,
  generateClips,
  getClips,
  getLatestClipGenerationJob,
} from "@/src/lib/api";

const ClipCard = memo(function ClipCard({ clip, projectId }: { clip: Clip; projectId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStatus, setAudioStatus] = useState("");

  const playWithSound = async () => {
    const video = videoRef.current;
    if (!video) return;
    const nextVolume = volume || 1;
    video.defaultMuted = false;
    video.muted = false;
    video.volume = nextVolume;
    setVolume(nextVolume);
    setMuted(false);
    setAudioStatus("");
    try {
      await video.play();
    } catch (error) {
      setAudioStatus(
        error instanceof Error
          ? `Could not start playback: ${error.message}`
          : "Could not start playback. Use the video controls to play the clip.",
      );
    }
  };

  const togglePlaybackSound = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && !video.muted) {
      video.muted = true;
      setMuted(true);
      return;
    }
    void playWithSound();
  };

  const handleVolumeChange = (nextVolume: number) => {
    setVolume(nextVolume);
    const video = videoRef.current;
    if (!video) return;
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    setMuted(video.muted);
  };

  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <video
        ref={videoRef}
        controls
        crossOrigin="anonymous"
        preload="metadata"
        className="aspect-[9/16] w-full max-w-xs rounded-md bg-black"
        onLoadedMetadata={() => {
          const video = videoRef.current;
          if (!video) return;
          video.defaultMuted = false;
          video.muted = false;
          video.volume = volume;
          setMuted(false);
        }}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          setVolume(event.currentTarget.volume);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      >
        <source src={clipUrl(projectId, clip.file)} type="video/mp4" />
      </video>
      <div className="mt-3 flex max-w-xs items-center gap-3">
        <button
          type="button"
          onClick={togglePlaybackSound}
          className="shrink-0 rounded-md border border-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-800"
        >
          {isPlaying && !muted ? "Mute audio" : "Play with sound"}
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-zinc-400">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            aria-label={`Volume for ${clip.title}`}
            onChange={(event) => handleVolumeChange(Number(event.target.value))}
            className="min-w-0 flex-1 accent-emerald-400"
          />
          <span className="w-9 text-right tabular-nums">{Math.round(volume * 100)}%</span>
        </label>
      </div>
      {audioStatus && (
        <p role="status" className="mt-2 max-w-xs text-xs text-amber-300">
          {audioStatus}
        </p>
      )}
      <a
        href={clipDownloadUrl(projectId, clip.file)}
        className="mt-3 inline-block rounded-md border border-zinc-700 px-4 py-2 text-sm text-white hover:bg-zinc-800"
      >
        Download video
      </a>
      <h3 className="mt-4 text-lg font-medium">{clip.title}</h3>
      <p className="mt-2 text-sm text-zinc-400">
        {clip.start.toFixed(2)}s → {clip.end.toFixed(2)}s · {clip.duration.toFixed(2)}s
      </p>
      <p className="mt-1 text-sm text-emerald-400">{clip.status}</p>
    </article>
  );
});

function ProjectClips({ projectId }: { projectId: string }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [status, setStatus] = useState(
    projectId ? `Loading clips for ${projectId}...` : "Choose a project to view its clips.",
  );
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [generationProgress, setGenerationProgress] = useState<ClipGenerationJob | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let isCurrentRequest = true;
    let interval: number | undefined;
    const loadProgressAndClips = async () => {
      try {
        const [result, job] = await Promise.all([
          getClips(projectId),
          getLatestClipGenerationJob(projectId),
        ]);
        if (!isCurrentRequest) return;
        setClips((current) =>
          JSON.stringify(current) === JSON.stringify(result.clips) ? current : result.clips,
        );
        setGenerationProgress(job);
        if (job?.status === "queued" || job?.status === "processing" || job?.status === "cancelling") {
          setGenerating(true);
          setStatus("");
        } else if (job?.status === "cancelled") {
          setGenerating(false);
          setStatus(job.step);
        } else if (job?.status === "failed") {
          setGenerating(false);
          setStatus(job.error ?? `Clip generation failed for ${projectId}.`);
        } else {
          setGenerating(false);
          setStatus(result.clips.length ? "" : `No clips generated yet for ${projectId}.`);
        }
        const isGenerating = job?.status === "queued"
          || job?.status === "processing"
          || job?.status === "cancelling";
        if (isGenerating && interval === undefined) {
          interval = window.setInterval(() => void loadProgressAndClips(), 1200);
        } else if (!isGenerating && interval !== undefined) {
          window.clearInterval(interval);
          interval = undefined;
        }
      } catch (error) {
        if (!isCurrentRequest) return;
        setStatus(error instanceof Error ? error.message : "Could not load clips");
      }
    };
    void loadProgressAndClips();

    return () => {
      isCurrentRequest = false;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [projectId]);

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectId || generating) return;
    setGenerating(true);
    setClips([]);
    setStatus("");
    setGenerationProgress({
      job_id: "",
      project_id: projectId,
      status: "queued",
      step: "Starting clip generation",
      progress: 0,
      completed_clips: 0,
      total_clips: 0,
    });
    try {
      const result = await generateClips(projectId, showSubtitles, setGenerationProgress);
      setClips(result.clips);
      setStatus(result.cancelled
        ? "Generation cancelled. Generated clips were removed."
        : `${result.clips.length} clips generated for ${projectId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Clip generation failed");
      setGenerationProgress((current) => current
        ? { ...current, status: "failed", step: "Clip generation failed" }
        : null);
    } finally {
      setGenerating(false);
    }
  };

  const handleCancel = async () => {
    const job = generationProgress;
    if (!projectId || !job?.job_id || job.status === "cancelling") return;
    if (!window.confirm("Cancel generation and remove all generated clips for this project? The source video and transcript will be kept.")) {
      return;
    }
    try {
      const updatedJob = await cancelClipGeneration(projectId, job.job_id);
      setGenerationProgress(updatedJob);
      setStatus("Cancelling generation and removing generated clips...");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not cancel clip generation");
    }
  };

  return (
    <main className="min-h-screen p-10">
      <h2 className="text-3xl font-semibold">Clips</h2>
      <p className="mt-2 text-zinc-400">
        {projectId ? `Previewing clips from ${projectId}.` : "Select a project to preview its clips."}
      </p>

      {status && <p className="mt-4 text-sm text-zinc-400">{status}</p>}

      {!projectId && (
        <Link href="/projects" className="mt-4 inline-block text-sm text-white underline">
          Choose a project
        </Link>
      )}

      {projectId && (
        <form onSubmit={handleGenerate} className="mt-6 flex max-w-2xl flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={generating}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {generating ? "Generating..." : clips.length ? "Regenerate Clips" : "Generate Clips"}
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={showSubtitles}
              onChange={(event) => setShowSubtitles(event.target.checked)}
              disabled={generating}
              className="size-4 accent-white"
            />
            Burn animated captions into clips
          </label>
        </form>
      )}

      {generationProgress && ["queued", "processing", "cancelling"].includes(generationProgress.status) && (
        <section aria-live="polite" className="mt-5 max-w-2xl rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-zinc-200">{generationProgress.step}</p>
            <p className="text-sm tabular-nums text-zinc-400">{generationProgress.progress}%</p>
          </div>
          <div
            role="progressbar"
            aria-label={`Clip generation progress for ${projectId}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={generationProgress.progress}
            className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-700"
          >
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
              style={{ width: `${generationProgress.progress}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            {generationProgress.total_clips > 0
              ? `Rendered ${generationProgress.completed_clips} of ${generationProgress.total_clips} clips`
              : "Preparing transcript analysis"}
          </p>
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={!generationProgress.job_id || generationProgress.status === "cancelling"}
            className="mt-4 rounded-md border border-red-500/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/50 disabled:opacity-50"
          >
            {generationProgress.status === "cancelling" ? "Cancelling..." : "Cancel generation"}
          </button>
        </section>
      )}

      <div className="mt-8 grid max-w-5xl gap-6 md:grid-cols-2">
        {clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} projectId={projectId} />
        ))}
      </div>
    </main>
  );
}

function ClipsContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project")?.trim() ?? "";
  return <ProjectClips key={projectId} projectId={projectId} />;
}

export default function ClipsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen p-10 text-zinc-400">Loading clips...</main>}>
      <ClipsContent />
    </Suspense>
  );
}

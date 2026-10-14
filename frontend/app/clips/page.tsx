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
  clipsArchiveDownloadUrl,
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
  const [mediaUrls, setMediaUrls] = useState<{ clip: string; download: string } | null>(null);
  const [mediaUrlError, setMediaUrlError] = useState("");

  useEffect(() => {
    let isActive = true;
    void Promise.all([
      clipUrl(projectId, clip.file),
      clipDownloadUrl(projectId, clip.file),
    ]).then(([clip, download]) => {
      if (isActive) {
        setMediaUrls({ clip, download });
        setMediaUrlError("");
      }
    }).catch((error: unknown) => {
      if (isActive) {
        setMediaUrlError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      isActive = false;
    };
  }, [clip.file, projectId]);

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
    <article className="rounded-[12px] border border-[#232326] bg-[#111113] p-5 shadow-sm transition-all duration-150">
      <video
        ref={videoRef}
        controls
        crossOrigin="anonymous"
        preload="metadata"
        className="aspect-[9/16] w-full max-w-xs rounded-[10px] bg-black"
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
        {mediaUrls && <source src={mediaUrls.clip} type="video/mp4" />}
      </video>
      <div className="mt-3 flex max-w-xs items-center gap-2">
        <button
          type="button"
          onClick={togglePlaybackSound}
          className="shrink-0 rounded-[8px] border border-[#232326] px-2.5 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
        >
          {isPlaying && !muted ? "Mute audio" : "Play with sound"}
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-zinc-400">
          <span>Vol</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            aria-label={`Volume for ${clip.title}`}
            onChange={(event) => handleVolumeChange(Number(event.target.value))}
            className="min-w-0 flex-1 accent-[#10b981]"
          />
          <span className="w-8 text-right font-mono tabular-nums">{Math.round(volume * 100)}%</span>
        </label>
      </div>
      {audioStatus && (
        <p role="status" className="mt-2 max-w-xs text-xs text-amber-300">
          {audioStatus}
        </p>
      )}
      <div className="mt-3">
        <a
          href={mediaUrls?.download}
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#232326] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-all duration-150 hover:border-zinc-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#10b981]"
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download clip
        </a>
      </div>
      {mediaUrlError && (
        <p role="status" className="mt-2 text-xs text-amber-300">
          Could not load clip URL: {mediaUrlError}
        </p>
      )}
      <h3 className="mt-3.5 text-sm font-semibold text-white line-clamp-2">{clip.title}</h3>
      <p className="mt-1 text-xs text-zinc-400 font-mono">
        {clip.start.toFixed(1)}s → {clip.end.toFixed(1)}s · {clip.duration.toFixed(1)}s
      </p>
      <p className="mt-1 text-xs font-medium text-emerald-400">{clip.status}</p>
    </article>
  );
});

function ProjectClips({ projectId }: { projectId: string }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [status, setStatus] = useState(
    projectId ? `Loading clips for ${projectId}...` : "Choose a project to view its clips.",
  );
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);
  const [generationProgress, setGenerationProgress] = useState<ClipGenerationJob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

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
      const result = await generateClips(
        projectId,
        showSubtitles,
        setGenerationProgress,
        60,
        showWatermark,
      );
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

  const handleDownloadAll = async () => {
    if (!projectId || downloadingAll || generating || clips.length === 0) return;
    setDownloadingAll(true);
    try {
      window.location.assign(await clipsArchiveDownloadUrl(projectId));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not download clips");
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-6 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Clips</h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            {projectId ? `Previewing clips from project ${projectId}.` : "Select a project to preview its clips."}
          </p>
          {status && <p className="mt-2 text-xs text-zinc-500">{status}</p>}
        </header>

        {!projectId && (
          <div className="rounded-[12px] border border-[#232326] bg-[#111113] p-8 text-center">
            <p className="text-sm text-zinc-400">No project selected.</p>
            <Link
              href="/projects"
              className="mt-3 inline-block rounded-[10px] bg-[#10b981] px-4 py-2 text-xs font-semibold text-zinc-950 transition-all duration-150 hover:bg-[#059669]"
            >
              Choose a project &rarr;
            </Link>
          </div>
        )}

        {projectId && (
          <form onSubmit={handleGenerate} className="mb-8 flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={generating}
              className="rounded-[10px] bg-[#10b981] px-4 py-2 text-xs font-semibold text-zinc-950 transition-all duration-150 hover:bg-[#059669] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
            >
              {generating ? "Generating..." : clips.length ? "Regenerate Clips" : "Generate Clips"}
            </button>
            {clips.length > 0 && (
              <button
                type="button"
                onClick={() => void handleDownloadAll()}
                disabled={generating || downloadingAll}
                className="rounded-[10px] border border-[#232326] bg-transparent px-4 py-2 text-xs font-medium text-zinc-200 transition-all duration-150 hover:border-zinc-700 hover:text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
              >
                {downloadingAll ? "Preparing download..." : "Download all clips (ZIP)"}
              </button>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={showSubtitles}
                onChange={(event) => setShowSubtitles(event.target.checked)}
                disabled={generating}
                className="size-4 rounded border-[#232326] bg-zinc-900 accent-[#10b981]"
              />
              Burn animated captions into clips
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={showWatermark}
                onChange={(event) => setShowWatermark(event.target.checked)}
                disabled={generating}
                className="size-4 rounded border-[#232326] bg-zinc-900 accent-[#10b981]"
              />
              Add a watermark: Made with Clip Robin
            </label>
          </form>
        )}

        {generationProgress && ["queued", "processing", "cancelling"].includes(generationProgress.status) && (
          <section aria-live="polite" className="mb-8 rounded-[12px] border border-[#232326] bg-[#111113] p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-medium text-zinc-200">{generationProgress.step}</p>
              <p className="text-xs font-mono font-medium text-emerald-400">{generationProgress.progress}%</p>
            </div>
            <div
              role="progressbar"
              aria-label={`Clip generation progress for ${projectId}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={generationProgress.progress}
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800"
            >
              <div
                className="h-full rounded-full bg-[#10b981] transition-[width] duration-300"
                style={{ width: `${generationProgress.progress}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {generationProgress.total_clips > 0
                ? `Rendered ${generationProgress.completed_clips} of ${generationProgress.total_clips} clips`
                : "Preparing transcript analysis"}
            </p>
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={!generationProgress.job_id || generationProgress.status === "cancelling"}
              className="mt-3 rounded-[8px] border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
            >
              {generationProgress.status === "cancelling" ? "Cancelling..." : "Cancel generation"}
            </button>
          </section>
        )}

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} projectId={projectId} />
          ))}
        </div>
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

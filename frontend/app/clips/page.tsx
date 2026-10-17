"use client";

import Link from "next/link";
import { FormEvent, memo, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CaptionStyle,
  Clip,
  ClipGenerationJob,
  cancelClipGeneration,
  clipDownloadUrl,
  clipUrl,
  clipsArchiveDownloadUrl,
  FramingMode,
  generateClips,
  getClips,
  getLatestClipGenerationJob,
  removeClipTopLine,
  saveAllClipsWithExplorer,
  saveClipWithExplorer,
  setClipTopLine,
} from "@/src/lib/api";
import { ClipSkeletonCard } from "@/src/components/skeletons";
import {
  CaptionStylePicker,
  CAPTION_STYLE_OPTIONS,
  getPreviewUrls,
} from "@/src/components/caption-style-picker";

const ClipCard = memo(function ClipCard({
  clip,
  projectId,
  showWatermark = true,
  showSubtitles = true,
  onClipUpdated,
}: {
  clip: Clip;
  projectId: string;
  showWatermark?: boolean;
  showSubtitles?: boolean;
  onClipUpdated?: (updatedClip: Clip) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStatus, setAudioStatus] = useState("");
  const [mediaUrls, setMediaUrls] = useState<{ clip: string; download: string } | null>(null);
  const [mediaUrlError, setMediaUrlError] = useState("");
  const [isEditingTopLine, setIsEditingTopLine] = useState(false);
  const [topLineInput, setTopLineInput] = useState(clip.top_line || "");
  const [isSavingTopLine, setIsSavingTopLine] = useState(false);
  const [topLineError, setTopLineError] = useState("");

  const wordCount = topLineInput.trim().split(/\s+/).filter(Boolean).length;
  const isTrue916 = clip.framing_mode === "true_9_16";

  useEffect(() => {
    setTopLineInput(clip.top_line || "");
  }, [clip.top_line]);

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

  const handleSaveTopLine = async () => {
    const trimmed = topLineInput.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      setTopLineError("Please enter a top line");
      return;
    }
    if (words.length > 15) {
      setTopLineError("Top line cannot exceed 15 words");
      return;
    }
    setIsSavingTopLine(true);
    setTopLineError("");
    try {
      const response = await setClipTopLine(projectId, clip.id, trimmed, {
        show_watermark: showWatermark,
        show_subtitles: showSubtitles,
      });
      setIsEditingTopLine(false);
      onClipUpdated?.(response.clip);
      const timestamp = Date.now();
      const [cUrl, dUrl] = await Promise.all([
        clipUrl(projectId, clip.file),
        clipDownloadUrl(projectId, clip.file),
      ]);
      setMediaUrls({
        clip: `${cUrl}?t=${timestamp}`,
        download: `${dUrl}&t=${timestamp}`,
      });
      if (videoRef.current) {
        videoRef.current.load();
      }
    } catch (error) {
      setTopLineError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingTopLine(false);
    }
  };

  const handleRemoveTopLine = async () => {
    setIsSavingTopLine(true);
    setTopLineError("");
    try {
      const response = await removeClipTopLine(projectId, clip.id, {
        show_watermark: showWatermark,
        show_subtitles: showSubtitles,
      });
      setIsEditingTopLine(false);
      setTopLineInput("");
      onClipUpdated?.(response.clip);
      const timestamp = Date.now();
      const [cUrl, dUrl] = await Promise.all([
        clipUrl(projectId, clip.file),
        clipDownloadUrl(projectId, clip.file),
      ]);
      setMediaUrls({
        clip: `${cUrl}?t=${timestamp}`,
        download: `${dUrl}&t=${timestamp}`,
      });
      if (videoRef.current) {
        videoRef.current.load();
      }
    } catch (error) {
      setTopLineError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingTopLine(false);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");

  const handleDownloadClip = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadMessage("");
    try {
      const res = await saveClipWithExplorer(projectId, clip.file, `${clip.id}.mp4`);
      if (res.saved) {
        setDownloadMessage("Saved successfully");
        setTimeout(() => setDownloadMessage(""), 4000);
      }
    } catch (err) {
      setDownloadMessage(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <article className="rounded-[12px] border border-[#232326] bg-[#111113] p-5 shadow-sm transition-all duration-150">
      {/* Top line editor space above video */}
      {isEditingTopLine && (
        <div className="mb-3 max-w-xs rounded-[10px] border border-zinc-700/80 bg-zinc-900/95 p-3 shadow-lg">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-[#10b981]" />
              Top Line (Hook / Context)
            </span>
            <span
              className={`font-mono text-[11px] font-medium ${
                wordCount > 15
                  ? "text-rose-400 font-bold"
                  : wordCount >= 12
                  ? "text-amber-400"
                  : "text-zinc-400"
              }`}
            >
              {wordCount} / 15 words
            </span>
          </div>

          <textarea
            value={topLineInput}
            onChange={(e) => {
              setTopLineInput(e.target.value);
              if (topLineError) setTopLineError("");
            }}
            placeholder="e.g. MrBeast reacted this way when Ronaldo said it"
            rows={2}
            maxLength={100}
            className="w-full rounded-[8px] border border-zinc-700 bg-black/60 px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-[#10b981] focus:outline-none focus:ring-1 focus:ring-[#10b981] resize-none"
          />

          <p className="mt-1 text-[10px] text-zinc-400">
            Enforces 15-word limit &amp; safe margins so line never touches video, watermark, or sides.
          </p>

          {topLineError && (
            <p role="alert" className="mt-1.5 text-xs text-rose-400">
              {topLineError}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSavingTopLine || wordCount === 0 || wordCount > 15}
              onClick={handleSaveTopLine}
              className="inline-flex items-center gap-1.5 rounded-[7px] bg-[#10b981] px-2.5 py-1.5 text-xs font-semibold text-black transition-all hover:bg-[#059669] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSavingTopLine ? (
                <>
                  <svg className="size-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Burning...
                </>
              ) : (
                "Burn top line"
              )}
            </button>

            {clip.top_line && (
              <button
                type="button"
                disabled={isSavingTopLine}
                onClick={handleRemoveTopLine}
                className="rounded-[7px] border border-rose-900/60 bg-rose-950/40 px-2 py-1.5 text-xs font-medium text-rose-300 transition-all hover:bg-rose-900/60 hover:text-white disabled:opacity-50"
              >
                Remove
              </button>
            )}

            <button
              type="button"
              disabled={isSavingTopLine}
              onClick={() => {
                setIsEditingTopLine(false);
                setTopLineInput(clip.top_line || "");
                setTopLineError("");
              }}
              className="rounded-[7px] border border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Video element with safe-zone live preview overlay */}
      <div className="relative aspect-[9/16] w-full max-w-xs overflow-hidden rounded-[10px] bg-black">
        <video
          ref={videoRef}
          controls
          crossOrigin="anonymous"
          preload="metadata"
          className="size-full object-contain"
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

        {/* Live overlay showing safe margin positioning while editing */}
        {isEditingTopLine && (
          <>
            {showWatermark && (
              <div className="pointer-events-none absolute inset-x-0 top-[7%] z-10 flex justify-center px-4">
                <div className="rounded-[4px] border border-white/20 bg-black/80 px-2 py-0.5 text-center font-medium text-[9px] text-zinc-300 shadow backdrop-blur-xs">
                  Watermark moves here &uarr;
                </div>
              </div>
            )}
            {topLineInput.trim() && (
              <div className="pointer-events-none absolute inset-x-0 top-[20%] z-10 flex justify-center px-4">
                <div className="rounded-[6px] border border-black/70 bg-black/95 px-3 py-1.5 text-center font-bold text-white text-[11px] leading-tight shadow-xl max-w-[85%] mx-auto backdrop-blur-md">
                  {topLineInput.trim().split("\n").map((line, idx) => (
                    <div key={idx}>{line}</div>
                  ))}
                  <span className="block mt-0.5 text-[8px] font-normal text-emerald-400">Top line safe zone</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

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

      {/* Action buttons: Download clip and Add/Edit top line */}
      <div className="mt-3 flex max-w-xs flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleDownloadClip()}
          disabled={isDownloading}
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#232326] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-all duration-150 hover:border-zinc-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-60"
        >
          {isDownloading ? (
            <>
              <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Saving...</span>
            </>
          ) : (
            <>
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span>Download clip</span>
            </>
          )}
        </button>

        <div className="relative group inline-block">
          <button
            type="button"
            disabled={isTrue916}
            aria-disabled={isTrue916}
            onClick={() => {
              if (isTrue916) return;
              setIsEditingTopLine((prev) => !prev);
              setTopLineInput(clip.top_line || "");
              setTopLineError("");
            }}
            className={`inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
              isTrue916
                ? "border-zinc-800 bg-zinc-900/40 text-zinc-500 cursor-not-allowed opacity-50"
                : clip.top_line
                ? "border-emerald-600/40 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500 hover:text-white"
                : "border-[#232326] text-zinc-200 hover:border-zinc-700 hover:text-white"
            }`}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            {clip.top_line ? "Edit top line" : "Add top line"}
          </button>
          {isTrue916 && (
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex items-center justify-center rounded-[6px] bg-zinc-950 border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-amber-300 shadow-xl whitespace-nowrap z-30">
              Top line generally doesn&apos;t go with 9:16. Try 1:1 or 16:9 for that
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-950" />
            </div>
          )}
        </div>
      </div>

      {downloadMessage && (
        <p
          role="status"
          className={`mt-2 max-w-xs text-xs font-medium ${
            downloadMessage.includes("failed") ? "text-rose-400" : "text-emerald-400"
          }`}
        >
          {downloadMessage}
        </p>
      )}

      {mediaUrlError && (
        <p role="status" className="mt-2 text-xs text-amber-300">
          Could not load clip URL: {mediaUrlError}
        </p>
      )}

      {clip.top_line && (
        <div className="mt-2.5 flex max-w-xs items-center gap-1.5 rounded-[6px] border border-emerald-900/40 bg-emerald-950/20 px-2 py-1 text-[11px] text-emerald-300">
          <span className="font-semibold text-emerald-400 shrink-0">Top line:</span>
          <span className="truncate italic">&ldquo;{clip.top_line}&rdquo;</span>
        </div>
      )}

      <h3 className="mt-3 text-sm font-semibold text-white line-clamp-2">{clip.title}</h3>
      <p className="mt-1 text-xs text-zinc-400 font-mono">
        {clip.start.toFixed(1)}s → {clip.end.toFixed(1)}s · {clip.duration.toFixed(1)}s
      </p>
      <p className="mt-1 text-xs font-medium text-emerald-400">{clip.status}</p>
    </article>
  );
});

function ProjectClips({ projectId }: { projectId: string }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(projectId));
  const [status, setStatus] = useState(
    projectId ? "" : "Choose a project to view its clips.",
  );
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);
  const [framingMode, setFramingMode] = useState<FramingMode>("standard");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("classic");
  const [isCaptionPickerOpen, setIsCaptionPickerOpen] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<ClipGenerationJob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    try {
      const savedFraming = localStorage.getItem("cliprobin_framing_mode");
      if (savedFraming && ["standard", "square_rounded", "true_9_16"].includes(savedFraming)) {
        setFramingMode(savedFraming as FramingMode);
      }
      const savedStyle = localStorage.getItem("cliprobin_caption_style");
      if (savedStyle && ["classic", "robin", "clean", "punch", "pill", "karaoke", "bold_emerald", "clean_gold"].includes(savedStyle)) {
        setCaptionStyle(savedStyle as CaptionStyle);
      } else {
        const stored = localStorage.getItem("cliprobin.settings");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.defaultCaptionStyle) setCaptionStyle(parsed.defaultCaptionStyle);
        }
      }
    } catch {}
  }, []);

  const handleFramingModeChange = (mode: FramingMode) => {
    setFramingMode(mode);
    try {
      localStorage.setItem("cliprobin_framing_mode", mode);
    } catch {}
  };

  const handleCaptionStyleChange = (styleId: CaptionStyle) => {
    setCaptionStyle(styleId);
    try {
      localStorage.setItem("cliprobin_caption_style", styleId);
    } catch {}
  };

  const activeStyleOption =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === captionStyle) || CAPTION_STYLE_OPTIONS[0];
  const previewUrls = getPreviewUrls(captionStyle);

  useEffect(() => {
    if (!projectId) {
      setIsLoading(false);
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
        setIsLoading(false);
        const currentClips = (job?.ready_clips && job.ready_clips.length > result.clips.length)
          ? job.ready_clips
          : result.clips;
        setClips((current) =>
          JSON.stringify(current) === JSON.stringify(currentClips) ? current : currentClips,
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
          setStatus(currentClips.length ? "" : `No clips generated yet for ${projectId}.`);
        }
        const isGenerating = job?.status === "queued"
          || job?.status === "processing"
          || job?.status === "cancelling";
        if (isGenerating && interval === undefined) {
          interval = window.setInterval(() => void loadProgressAndClips(), 1000);
        } else if (!isGenerating && interval !== undefined) {
          window.clearInterval(interval);
          interval = undefined;
        }
      } catch (error) {
        if (!isCurrentRequest) return;
        setIsLoading(false);
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
        (job) => {
          setGenerationProgress(job);
          if (job.ready_clips && job.ready_clips.length > 0) {
            setClips((current) =>
              JSON.stringify(current) === JSON.stringify(job.ready_clips)
                ? current
                : (job.ready_clips ?? current)
            );
          }
        },
        60,
        showWatermark,
        framingMode,
        captionStyle,
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
    setStatus("");
    try {
      const res = await saveAllClipsWithExplorer(projectId);
      if (res.saved) {
        setStatus("All clips archive saved successfully.");
      }
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
          <section className="mb-8 rounded-[12px] border border-[#232326] bg-[#111113] p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232326] pb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={(e) => void handleGenerate(e as unknown as FormEvent)}
                  disabled={generating}
                  className="rounded-[10px] bg-[#10b981] px-5 py-2.5 text-xs font-semibold text-zinc-950 transition-all duration-150 hover:bg-[#059669] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                >
                  {generating ? "Generating..." : clips.length ? "Regenerate Clips" : "Generate Clips"}
                </button>
                {clips.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleDownloadAll()}
                    disabled={generating || downloadingAll}
                    className="rounded-[10px] border border-[#232326] bg-transparent px-4 py-2.5 text-xs font-medium text-zinc-200 transition-all duration-150 hover:border-zinc-700 hover:text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                  >
                    {downloadingAll ? "Preparing download..." : "Download all clips (ZIP)"}
                  </button>
                )}
              </div>

              {/* Watermark Toggle */}
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-zinc-400 font-medium">Watermark</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showWatermark}
                  disabled={generating}
                  onClick={() => setShowWatermark((prev) => !prev)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-50 ${
                    showWatermark ? "bg-[#10b981]" : "bg-zinc-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                      showWatermark ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Controls Grid: Aspect Ratio (16:9, 1:1, 9:16) + Caption Style */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* Ratio Selector: 16:9, 1:1, 9:16 */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-400">
                  Aspect ratio & framing
                </label>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Aspect ratio">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={framingMode === "standard"}
                    disabled={generating}
                    onClick={() => handleFramingModeChange("standard")}
                    className={`flex flex-col items-center justify-center rounded-[10px] border p-2.5 text-center transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                      framingMode === "standard"
                        ? "border-[#10b981] bg-[#10b981]/10 text-white ring-1 ring-[#10b981]"
                        : "border-[#232326] bg-[#0a0a0a] text-zinc-400 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    <span className="text-xs font-semibold">16:9</span>
                    <span className="text-[10px] text-zinc-500 mt-0.5">Rounded</span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={framingMode === "square_rounded"}
                    disabled={generating}
                    onClick={() => handleFramingModeChange("square_rounded")}
                    className={`flex flex-col items-center justify-center rounded-[10px] border p-2.5 text-center transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                      framingMode === "square_rounded"
                        ? "border-[#10b981] bg-[#10b981]/10 text-white ring-1 ring-[#10b981]"
                        : "border-[#232326] bg-[#0a0a0a] text-zinc-400 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    <span className="text-xs font-semibold">1:1</span>
                    <span className="text-[10px] text-emerald-400 mt-0.5">Reels / TikTok</span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={framingMode === "true_9_16"}
                    disabled={generating}
                    onClick={() => handleFramingModeChange("true_9_16")}
                    className={`flex flex-col items-center justify-center rounded-[10px] border p-2.5 text-center transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                      framingMode === "true_9_16"
                        ? "border-[#10b981] bg-[#10b981]/10 text-white ring-1 ring-[#10b981]"
                        : "border-[#232326] bg-[#0a0a0a] text-zinc-400 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    <span className="text-xs font-semibold">9:16</span>
                    <span className="text-[10px] text-purple-400 mt-0.5">AI Speaker</span>
                  </button>
                </div>
              </div>

              {/* Caption Style Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-zinc-400">
                    Captions
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showSubtitles}
                    disabled={generating}
                    onClick={() => setShowSubtitles((prev) => !prev)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-50 ${
                      showSubtitles ? "bg-[#10b981]" : "bg-zinc-800"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                        showSubtitles ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {showSubtitles ? (
                  <div className="flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-2.5 transition-all duration-150 hover:border-zinc-700">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative aspect-[9/16] w-7 h-12 shrink-0 overflow-hidden rounded border border-[#232326] bg-black">
                        <img
                          src={previewUrls.posterUrl}
                          alt={`${activeStyleOption.name} caption preview`}
                          className="size-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          Style: {activeStyleOption.name}
                        </p>
                        <p className="text-[11px] text-zinc-400 line-clamp-1">
                          {activeStyleOption.description}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={generating}
                      onClick={() => setIsCaptionPickerOpen(true)}
                      className="shrink-0 px-3 py-1 rounded-lg border border-[#232326] bg-[#111113] text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:bg-[#10b981]/10 hover:text-white transition-colors duration-150 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded-[10px] border border-dashed border-[#232326] bg-[#0a0a0a] p-3 text-xs text-zinc-500">
                    Captions disabled
                  </div>
                )}
              </div>
            </div>

            <CaptionStylePicker
              isOpen={isCaptionPickerOpen}
              onClose={() => setIsCaptionPickerOpen(false)}
              selectedStyle={captionStyle}
              onSelect={(style) => handleCaptionStyleChange(style)}
            />
          </section>
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

        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ClipSkeletonCard key={`initial-skeleton-${i}`} message="Loading clips..." />
            ))}
          </div>
        ) : clips.length > 0 || generating ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                projectId={projectId}
                showWatermark={showWatermark}
                showSubtitles={showSubtitles}
                onClipUpdated={(updatedClip) => {
                  setClips((prev) =>
                    prev.map((c) => (c.id === updatedClip.id ? updatedClip : c)),
                  );
                }}
              />
            ))}
            {generating && Array.from({
              length: Math.max(
                1,
                (generationProgress?.total_clips || 4) - clips.length
              ),
            }).map((_, i) => (
              <ClipSkeletonCard
                key={`generating-skeleton-${i}`}
                index={clips.length + i + 1}
                total={generationProgress?.total_clips || undefined}
              />
            ))}
          </div>
        ) : projectId ? (
          <div className="rounded-[12px] border border-[#232326] bg-[#111113] p-8 text-center">
            <p className="text-sm text-zinc-400">No clips generated yet for {projectId}.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Click &ldquo;Generate Clips&rdquo; above to start slicing this video into vertical shorts.
            </p>
          </div>
        ) : null}
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
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0a0a0a] text-white p-6 lg:p-10">
          <div className="mx-auto max-w-5xl">
            <header className="mb-8">
              <div className="h-8 w-36 rounded bg-zinc-800/80 skeleton-shimmer" />
              <div className="mt-2 h-4 w-60 rounded bg-zinc-800/50 skeleton-shimmer" />
            </header>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <ClipSkeletonCard key={`suspense-skeleton-${i}`} />
              ))}
            </div>
          </div>
        </main>
      }
    >
      <ClipsContent />
    </Suspense>
  );
}

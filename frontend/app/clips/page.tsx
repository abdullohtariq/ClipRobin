"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptionStyle,
  Clip,
  ClipGenerationJob,
  cancelClipGeneration,
  clipDownloadUrl,
  clipUrl,
  FramingMode,
  generateClips,
  getClips,
  getLatestClipGenerationJob,
  getProjects,
  Project,
  removeClipTopLine,
  saveAllClipsWithExplorer,
  saveClipWithExplorer,
  setClipTopLine,
} from "@/src/lib/api";
import { ClipSkeletonCard } from "@/src/components/skeletons";
import { ClipSettings, ClipDuration } from "@/src/components/clip-settings";
import { CAPTION_STYLE_OPTIONS } from "@/src/components/caption-style-picker";
import { Badge } from "@/src/components/ui/badge";
import { StatusPill } from "@/src/components/ui/status-pill";
import { IconButton } from "@/src/components/ui/icon-button";
import { YouTubeUploadModal } from "@/src/components/youtube-upload-modal";

interface AppliedProjectSettings {
  framingMode: FramingMode;
  clipDurationSeconds: ClipDuration;
  clipCount?: number;
  captionStyle: CaptionStyle;
  showWatermark: boolean;
  showCaptions: boolean;
}

// Minimal Video Player Card
const ProClipCard = memo(function ProClipCard({
  clip,
  index,
  projectId,
  globalVolume,
  globalMuted,
  activePlayingClipId,
  onPlay,
  onOpenModal,
  showWatermark,
  showSubtitles,
  onClipUpdated,
}: {
  clip: Clip;
  index: number;
  projectId: string;
  globalVolume: number;
  globalMuted: boolean;
  activePlayingClipId: string | null;
  onPlay: (clipId: string | null) => void;
  onOpenModal: (clip: Clip) => void;
  showWatermark?: boolean;
  showSubtitles?: boolean;
  onClipUpdated?: (updatedClip: Clip) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activePlayingClipIdRef = useRef<string | null>(activePlayingClipId);
  const [isInView, setIsInView] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(clip.duration || 0);
  const [mediaUrls, setMediaUrls] = useState<{ clip: string; download: string } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState("");
  const [isEditingTopLine, setIsEditingTopLine] = useState(false);
  const [topLineInput, setTopLineInput] = useState(clip.top_line || "");
  const [isSavingTopLine, setIsSavingTopLine] = useState(false);
  const [topLineError, setTopLineError] = useState("");
  const [hasVideoError, setHasVideoError] = useState(false);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    activePlayingClipIdRef.current = activePlayingClipId;
  }, [activePlayingClipId]);

  const wordCount = topLineInput.trim().split(/\s+/).filter(Boolean).length;

  // Lazy load video stream using IntersectionObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
        }
      },
      { rootMargin: "250px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fetch clip streaming & download URLs
  useEffect(() => {
    let isActive = true;
    if (isInView && !mediaUrls) {
      void Promise.all([
        clipUrl(projectId, clip.file),
        clipDownloadUrl(projectId, clip.file),
      ]).then(([cUrl, dUrl]) => {
        if (isActive) setMediaUrls({ clip: cUrl, download: dUrl });
      }).catch(() => {});
    }
    return () => {
      isActive = false;
    };
  }, [isInView, mediaUrls, clip.file, projectId]);

  // Sync global volume & mute to video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = globalVolume;
    video.muted = globalMuted;
  }, [globalVolume, globalMuted]);

  // Pause if another clip started playing or activePlayingClipId was cleared
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (activePlayingClipId !== clip.id) {
      if (!video.paused) {
        video.pause();
      }
      setIsPlaying(false);
    }
  }, [activePlayingClipId, clip.id]);

  const togglePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused || isPlaying) {
      video.pause();
      setIsPlaying(false);
      if (activePlayingClipId === clip.id) {
        onPlay(null);
      }
    } else {
      onPlay(clip.id);
      if (!hasStartedRef.current) {
        video.currentTime = 0;
        hasStartedRef.current = true;
      }
      video.play().then(() => {
        if (activePlayingClipIdRef.current && activePlayingClipIdRef.current !== clip.id) {
          video.pause();
          setIsPlaying(false);
        } else {
          setIsPlaying(true);
        }
      }).catch(() => {
        setIsPlaying(false);
      });
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadMsg("");
    try {
      const res = await saveClipWithExplorer(projectId, clip.file, `${clip.id}.mp4`);
      if (res.saved) {
        setDownloadMsg("Saved!");
        setTimeout(() => setDownloadMsg(""), 3000);
      }
    } catch {
      setDownloadMsg("Error saving");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveTopLine = async () => {
    const trimmed = topLineInput.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 15) {
      setTopLineError("Top line must be 1 to 15 words");
      return;
    }
    setIsSavingTopLine(true);
    setTopLineError("");
    try {
      const response = await setClipTopLine(projectId, clip.id, trimmed, {
        show_watermark: showWatermark,
        show_subtitles: showSubtitles,
        framing_mode: clip.framing_mode,
        caption_style: clip.caption_style,
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
      if (videoRef.current) videoRef.current.load();
    } catch (err) {
      setTopLineError(err instanceof Error ? err.message : String(err));
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
        framing_mode: clip.framing_mode,
        caption_style: clip.caption_style,
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
      if (videoRef.current) videoRef.current.load();
    } catch (err) {
      setTopLineError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingTopLine(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <article
      ref={containerRef}
      className="group relative flex flex-col justify-between rounded-2xl border border-zinc-800 bg-[#121215] p-3.5 shadow-sm transition-all duration-150 hover:border-zinc-700 hover:bg-[#141418] hover:shadow-md"
      style={{ contentVisibility: "auto" }}
    >
      {/* Top Line Editor Dropdown */}
      {isEditingTopLine && (
        <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-xl space-y-2 z-20 animate-in fade-in-0 duration-150">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-zinc-200">Headline Hook (Top Line)</span>
            <span className={wordCount > 15 ? "text-red-400 font-bold" : "text-zinc-400"}>
              {wordCount}/15 words
            </span>
          </div>
          <textarea
            value={topLineInput}
            onChange={(e) => {
              setTopLineInput(e.target.value);
              if (topLineError) setTopLineError("");
            }}
            placeholder="e.g. POV: When your code compiles on the first try"
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-black/70 p-2 text-xs text-white placeholder:text-zinc-500 focus-ring resize-none"
          />
          {topLineError && <p className="text-xs text-red-400">{topLineError}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isSavingTopLine || !wordCount || wordCount > 15}
              onClick={handleSaveTopLine}
              className="px-2.5 py-1 rounded-md bg-[#10b981] text-xs font-semibold text-zinc-950 hover:bg-[#059669] disabled:opacity-50"
            >
              {isSavingTopLine ? "Saving..." : "Save"}
            </button>
            {clip.top_line && (
              <button
                type="button"
                disabled={isSavingTopLine}
                onClick={handleRemoveTopLine}
                className="px-2 py-1 rounded-md border border-zinc-700 text-xs text-zinc-300 hover:text-red-400"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsEditingTopLine(false)}
              className="px-2 py-1 text-xs text-zinc-400 hover:text-white ml-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Video Thumbnail / Player Frame */}
      <div
        onClick={() => onOpenModal(clip)}
        className="relative aspect-[9/16] w-full rounded-xl overflow-hidden bg-black border border-zinc-800/80 cursor-pointer group/player shadow-inner"
      >
        {hasVideoError ? (
          <div className="size-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 p-4 text-center">
            <svg className="size-6 text-zinc-600 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-xs text-zinc-400 font-medium">Clip unavailable</span>
          </div>
        ) : mediaUrls && isInView ? (
          <video
            ref={videoRef}
            src={mediaUrls.clip}
            playsInline
            preload="metadata"
            onPlay={() => {
              setIsPlaying(true);
              onPlay(clip.id);
            }}
            onPause={() => {
              setIsPlaying(false);
            }}
            onTimeUpdate={() => {
              if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
            }}
            onLoadedMetadata={() => {
              if (videoRef.current) {
                setDuration(videoRef.current.duration);
                if (videoRef.current.currentTime === 0 && videoRef.current.duration > 0.3) {
                  videoRef.current.currentTime = Math.min(1.0, videoRef.current.duration / 3);
                }
              }
            }}
            onError={() => {
              setHasVideoError(true);
            }}
            onEnded={() => {
              setIsPlaying(false);
              hasStartedRef.current = false;
              if (activePlayingClipId === clip.id) {
                onPlay(null);
              }
            }}
            className="size-full object-cover"
          />
        ) : (
          <div className="size-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-600">
            <svg className="size-8 stroke-1 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M7 3v18" />
              <path d="M3 7.5h4" />
              <path d="M3 12h18" />
              <path d="M3 16.5h4" />
              <path d="M17 3v18" />
              <path d="M17 7.5h4" />
              <path d="M17 16.5h4" />
            </svg>
          </div>
        )}

        {/* Minimal Player Controls Overlay */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/player:opacity-100 focus-within:opacity-100 transition-opacity duration-150 flex flex-col justify-between p-2.5">
          {/* Top Badges */}
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 rounded-md bg-black/75 text-xs font-mono font-bold text-white border border-white/10">
              #{String(index + 1).padStart(2, "0")}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-black/75 text-xs font-mono font-medium text-emerald-400 border border-white/10">
              {clip.duration.toFixed(1)}s
            </span>
          </div>

          {/* Center Play / Pause Icon Button */}
          <button
            type="button"
            aria-label={isPlaying ? "Pause clip" : "Play clip"}
            onClick={togglePlayPause}
            className="mx-auto flex size-12 items-center justify-center rounded-full bg-black/80 border border-white/20 text-white shadow-xl hover:scale-105 active:scale-95 transition-transform"
          >
            {isPlaying ? (
              <svg className="size-5 fill-current" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg className="size-5 fill-current ml-0.5" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          {/* Bottom Scrubber & Time */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-mono text-zinc-300">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="h-1 w-full bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400"
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Card Content & Metadata */}
      <div className="mt-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-white leading-snug line-clamp-1" title={clip.title}>
            {clip.title}
          </h3>
          <StatusPill status={clip.status} />
        </div>

        {/* 2-line transcript / reason snippet */}
        {clip.reason ? (
          <p
            className="text-xs text-zinc-400 line-clamp-2 leading-relaxed"
            title={clip.reason}
          >
            {clip.reason}
          </p>
        ) : (
          <p className="text-xs text-zinc-500 italic line-clamp-1">
            Segment from source video
          </p>
        )}

        {/* Timecode badge & Hook indicator */}
        <div className="flex items-center justify-between gap-2 pt-1 text-xs font-mono text-zinc-500">
          <span>{formatTime(clip.start)} — {formatTime(clip.end)}</span>
          {clip.top_line && (
            <span className="text-xs font-sans font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded truncate max-w-[120px]" title={clip.top_line}>
              Hook active
            </span>
          )}
        </div>

        {/* Two actions: Download & Add/Edit Top Line */}
        <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDownload}
            className="flex-1 py-1.5 px-2.5 rounded-lg border border-zinc-700 bg-zinc-800/90 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors focus-ring flex items-center justify-center gap-1.5"
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span>{downloadMsg || (isDownloading ? "Saving..." : "Download")}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsEditingTopLine((prev) => !prev)}
            className="py-1.5 px-2.5 rounded-lg border border-zinc-700 bg-transparent hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors focus-ring"
          >
            {clip.top_line ? "Edit top line" : "Add top line"}
          </button>
        </div>
      </div>
    </article>
  );
});

// Fullscreen Clip Preview Modal Dialog
function ClipModalViewer({
  clip,
  projectId,
  globalVolume,
  globalMuted,
  onClose,
}: {
  clip: Clip | null;
  projectId: string;
  globalVolume: number;
  globalMuted: boolean;
  onClose: () => void;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const modalVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!clip) return;
    let active = true;
    clipUrl(projectId, clip.file).then((url) => {
      if (active) setVideoUrl(url);
    });
    return () => {
      active = false;
    };
  }, [clip, projectId]);

  useEffect(() => {
    const v = modalVideoRef.current;
    if (!v) return;
    v.volume = globalVolume;
    v.muted = globalMuted;
  }, [globalVolume, globalMuted, videoUrl]);

  if (!clip) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={clip.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in-0 duration-150"
    >
      <div className="relative flex flex-col md:flex-row items-center max-w-4xl w-full rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-2xl gap-6 overflow-y-auto md:overflow-hidden max-h-[90vh]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close clip preview"
          className="absolute top-4 right-4 z-20 size-8 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center focus-ring"
        >
          ✕
        </button>

        {/* 9:16 Video Player */}
        <div className="relative aspect-[9/16] max-h-[55vh] md:max-h-[75vh] w-auto max-w-[280px] shrink-0 rounded-xl overflow-hidden bg-black border border-zinc-800 shadow-xl">
          {videoUrl && (
            <video
              ref={modalVideoRef}
              src={videoUrl}
              controls
              autoPlay
              playsInline
              className="size-full object-cover"
            />
          )}
        </div>

        {/* Details Pane */}
        <div className="flex-1 space-y-4 overflow-y-auto max-h-[500px] pr-2">
          <div>
            <span className="text-xs font-mono font-semibold text-emerald-400">
              {clip.id}
            </span>
            <h2 className="text-lg font-bold text-white mt-1 leading-snug">
              {clip.title}
            </h2>
            <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
              <span>Duration: {clip.duration.toFixed(1)}s</span>
              <span>•</span>
              <span>Framing: {clip.framing_mode || "Standard"}</span>
            </div>
          </div>

          {clip.reason && (
            <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-4 space-y-1.5">
              <span className="text-xs font-semibold text-zinc-300">Segment Context</span>
              <p className="text-xs text-zinc-400 leading-relaxed">{clip.reason}</p>
            </div>
          )}

          {clip.top_line && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1">
              <span className="text-xs font-semibold text-emerald-400">Top Line Context</span>
              <p className="text-sm font-medium text-white">{clip.top_line}</p>
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveClipWithExplorer(projectId, clip.file, `${clip.id}.mp4`)}
              className="px-4 py-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] text-xs font-bold text-zinc-950 transition-colors focus-ring inline-flex items-center gap-2"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span>Export with Save As Dialog</span>
            </button>

            <button
              type="button"
              onClick={() => setIsYouTubeModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-[#FF0000] hover:bg-[#E50914] text-xs font-bold text-white transition-colors focus-ring inline-flex items-center gap-2 shadow-lg shadow-red-950/40"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span>Upload to YouTube</span>
            </button>
          </div>
        </div>
      </div>

      {isYouTubeModalOpen && (
        <YouTubeUploadModal
          clip={clip}
          projectId={projectId}
          onClose={() => setIsYouTubeModalOpen(false)}
        />
      )}
    </div>
  );
}

// Main Clips Studio Component
function ProjectClipsContent({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>([]);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(projectId));
  const [status, setStatus] = useState(projectId ? "" : "Choose a project to view its clips.");
  const [generating, setGenerating] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<ClipGenerationJob | null>(null);

  // Settings state
  const [framingMode, setFramingMode] = useState<FramingMode>("standard");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("classic");
  const [clipDurationSeconds, setClipDurationSeconds] = useState<ClipDuration>(30);
  const [clipCount, setClipCount] = useState<number>(3);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [generationMode, setGenerationMode] = useState<"random" | "ai">("random");

  const maxClips = useMemo(() => {
    if (!sourceDuration || sourceDuration <= 0) return 10;
    return Math.max(1, Math.floor(sourceDuration / clipDurationSeconds));
  }, [sourceDuration, clipDurationSeconds]);

  useEffect(() => {
    if (clipCount > maxClips) {
      setClipCount(maxClips);
    }
  }, [maxClips, clipCount]);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);

  // Applied generation settings for dirty detection
  const [appliedSettings, setAppliedSettings] = useState<AppliedProjectSettings | null>(null);

  // UI State: settings panel toggle, search, sort, audio
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"timeline" | "duration">("timeline");
  const [globalVolume, setGlobalVolume] = useState<number>(1);
  const [globalMuted, setGlobalMuted] = useState<boolean>(false);
  const [activePlayingClipId, setActivePlayingClipId] = useState<string | null>(null);
  const [selectedClipForModal, setSelectedClipForModal] = useState<Clip | null>(null);
  const hydratedProjectRef = useRef<string | null>(null);

  // Global document-level capture listener so at most one non-decorative video plays at a time
  useEffect(() => {
    const handleGlobalPlay = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLVideoElement)) return;
      if (target.dataset.decorativeLoop === "true") return;
      const allVideos = document.querySelectorAll("video");
      allVideos.forEach((v) => {
        if (v !== target && v.dataset.decorativeLoop !== "true" && !v.paused) {
          v.pause();
        }
      });
    };
    document.addEventListener("play", handleGlobalPlay, true);
    return () => document.removeEventListener("play", handleGlobalPlay, true);
  }, []);

  // Fetch available projects for dropdown switcher
  useEffect(() => {
    getProjects().then((res) => setProjectsList(res.projects || [])).catch(() => {});
  }, []);

  // Restore preferences & applied settings
  useEffect(() => {
    setActivePlayingClipId(null);
    setSelectedClipForModal(null);
    hydratedProjectRef.current = null;
    try {
      const savedFraming = localStorage.getItem("cliprobin_framing_mode");
      if (savedFraming && ["standard", "square_rounded", "true_9_16"].includes(savedFraming)) {
        setFramingMode(savedFraming as FramingMode);
      }
      const savedDuration = localStorage.getItem("cliprobin_clip_duration");
      if (savedDuration && [12, 15, 30, 60, 90].includes(Number(savedDuration))) {
        setClipDurationSeconds(Number(savedDuration) as ClipDuration);
      }
      const savedCount = localStorage.getItem("cliprobin_clip_count");
      if (savedCount && Number(savedCount) >= 1) {
        setClipCount(Number(savedCount));
      }
      const savedMode = localStorage.getItem("cliprobin_generation_mode");
      if (savedMode && ["random", "ai"].includes(savedMode)) {
        setGenerationMode(savedMode as "random" | "ai");
      }
      const savedSubs = localStorage.getItem("cliprobin_show_captions");
      if (savedSubs !== null) {
        setShowCaptions(savedSubs === "true");
      }
      const savedWm = localStorage.getItem("cliprobin_show_watermark");
      if (savedWm !== null) {
        setShowWatermark(savedWm === "true");
      }
      const savedStyle = localStorage.getItem("cliprobin_caption_style");
      if (savedStyle && ["classic", "robin", "clean", "punch", "pill", "karaoke", "bold_emerald", "clean_gold"].includes(savedStyle)) {
        setCaptionStyle(savedStyle as CaptionStyle);
      } else {
        const storedSettings = localStorage.getItem("cliprobin.settings");
        if (storedSettings) {
          const parsed = JSON.parse(storedSettings);
          if (parsed.defaultCaptionStyle) setCaptionStyle(parsed.defaultCaptionStyle);
        }
      }
      const savedVol = localStorage.getItem("cliprobin_volume");
      if (savedVol) setGlobalVolume(parseFloat(savedVol));
      const savedMute = localStorage.getItem("cliprobin_muted");
      if (savedMute) setGlobalMuted(savedMute === "true");

      if (projectId) {
        const stored = localStorage.getItem(`cliprobin_applied_${projectId}`);
        if (stored) {
          const parsedApplied = JSON.parse(stored) as AppliedProjectSettings;
          setAppliedSettings(parsedApplied);
        } else {
          setAppliedSettings(null);
        }
      }
    } catch {}
  }, [projectId]);

  // Check if current settings differ from applied generation settings (dirty state)
  const isDirty = useMemo(() => {
    if (!appliedSettings || !clips.length) return false;
    return (
      appliedSettings.framingMode !== framingMode ||
      appliedSettings.clipDurationSeconds !== clipDurationSeconds ||
      appliedSettings.captionStyle !== captionStyle ||
      appliedSettings.showWatermark !== showWatermark ||
      appliedSettings.showCaptions !== showCaptions
    );
  }, [appliedSettings, clips.length, framingMode, clipDurationSeconds, captionStyle, showWatermark, showCaptions]);

  // Load clips & generation status
  useEffect(() => {
    if (!projectId) {
      setIsLoading(false);
      return;
    }
    let isCurrentRequest = true;
    let interval: number | undefined;

    const loadClipsAndStatus = async () => {
      try {
        const [result, job] = await Promise.all([
          getClips(projectId),
          getLatestClipGenerationJob(projectId),
        ]);
        if (!isCurrentRequest) return;
        if (result.source_duration) {
          setSourceDuration(result.source_duration);
        }
        setIsLoading(false);
        const currentClips =
          job?.status !== "cancelled" &&
          job?.status !== "failed" &&
          job?.ready_clips &&
          job.ready_clips.length > result.clips.length
            ? job.ready_clips
            : result.clips;
        setClips(currentClips);
        setGenerationProgress(job);

        // Hydrate appliedSettings and toolbar state from backend generation_options once per project
        if (hydratedProjectRef.current !== projectId && (result.generation_options || currentClips.length > 0)) {
          const opts = result.generation_options || {};
          const hasServerOpts = Object.keys(opts).length > 0;
          if (hasServerOpts || currentClips.length > 0) {
            hydratedProjectRef.current = projectId;
            const firstClip = currentClips[0];
            const appliedFraming: FramingMode =
              (opts.framing_mode as FramingMode) || firstClip?.framing_mode || "standard";
            const appliedStyle: CaptionStyle =
              (opts.caption_style as CaptionStyle) || firstClip?.caption_style || "classic";
            const rawDur = opts.clip_duration_seconds || (firstClip ? Math.round(firstClip.duration) : 30);
            const appliedDur: ClipDuration = ([12, 30, 60, 90].includes(rawDur) ? rawDur : 30) as ClipDuration;
            const appliedWm = typeof opts.show_watermark === "boolean" ? opts.show_watermark : false;
            const appliedSubs = typeof opts.show_subtitles === "boolean" ? opts.show_subtitles : true;

            const hydrated: AppliedProjectSettings = {
              framingMode: appliedFraming,
              clipDurationSeconds: appliedDur,
              clipCount: opts.clip_count ?? undefined,
              captionStyle: appliedStyle,
              showWatermark: appliedWm,
              showCaptions: appliedSubs,
            };
            setAppliedSettings(hydrated);
            setFramingMode(appliedFraming);
            setCaptionStyle(appliedStyle);
            setClipDurationSeconds(appliedDur);
            setShowWatermark(appliedWm);
            setShowCaptions(appliedSubs);
            if (typeof opts.clip_count === "number" && opts.clip_count >= 1) {
              setClipCount(opts.clip_count);
            }
            try {
              localStorage.setItem(`cliprobin_applied_${projectId}`, JSON.stringify(hydrated));
            } catch {}
          }
        }

        const isRunning =
          job?.status === "queued" || job?.status === "processing" || job?.status === "cancelling";
        setGenerating(Boolean(isRunning));

        if (job?.status === "failed" && job.error) {
          setStatus(job.error);
        }

        if (isRunning && interval === undefined) {
          interval = window.setInterval(() => void loadClipsAndStatus(), 1000);
        } else if (!isRunning && interval !== undefined) {
          window.clearInterval(interval);
          interval = undefined;
        }
      } catch (err) {
        if (!isCurrentRequest) return;
        setIsLoading(false);
        setStatus(err instanceof Error ? err.message : "Failed to load clips");
      }
    };

    void loadClipsAndStatus();
    return () => {
      isCurrentRequest = false;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [projectId]);

  // Regenerate clips pipeline
  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId || generating) return;
    setGenerating(true);
    setClips([]);
    setStatus("");
    setGenerationProgress({
      job_id: "",
      project_id: projectId,
      status: "queued",
      step: "Starting generation pipeline",
      progress: 0,
      completed_clips: 0,
      total_clips: 0,
    });

    try {
      const result = await generateClips(
        projectId,
        showCaptions,
        (job) => {
          setGenerationProgress(job);
          if (
            job.status !== "cancelled" &&
            job.status !== "failed" &&
            job.ready_clips &&
            job.ready_clips.length > 0
          ) {
            setClips(job.ready_clips);
          }
        },
        clipDurationSeconds,
        showWatermark,
        framingMode,
        captionStyle,
        undefined,
        clipCount,
        generationMode,
      );

      setClips(result.clips);
      // Save applied settings
      const applied: AppliedProjectSettings = {
        framingMode,
        clipDurationSeconds,
        captionStyle,
        showWatermark,
        showCaptions,
      };
      setAppliedSettings(applied);
      try {
        localStorage.setItem(`cliprobin_applied_${projectId}`, JSON.stringify(applied));
      } catch {}
      setStatus(
        result.cancelled
          ? "Generation cancelled."
          : `${result.clips.length} clips generated successfully.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Clip generation failed");
      try {
        const diskClips = await getClips(projectId);
        setClips(diskClips.clips);
      } catch {}
    } finally {
      setGenerating(false);
    }
  };

  const handleCancel = async () => {
    const job = generationProgress;
    if (!projectId || !job?.job_id || job.status === "cancelling") return;
    if (!window.confirm("Cancel generation? Existing clips will be removed.")) return;
    try {
      const updated = await cancelClipGeneration(projectId, job.job_id);
      setGenerationProgress(updated);
      setStatus("Cancelling generation...");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not cancel");
    }
  };

  const handleDownloadAll = async () => {
    if (!projectId || downloadingAll) return;
    setDownloadingAll(true);
    try {
      await saveAllClipsWithExplorer(projectId);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to download zip");
    } finally {
      setDownloadingAll(false);
    }
  };

  // Filter & sort clips
  const filteredClips = useMemo(() => {
    let result = [...clips];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) => c.title.toLowerCase().includes(q) || (c.reason && c.reason.toLowerCase().includes(q)),
      );
    }
    if (sortBy === "duration") {
      result.sort((a, b) => b.duration - a.duration);
    } else {
      result.sort((a, b) => a.start - b.start);
    }
    return result;
  }, [clips, searchQuery, sortBy]);

  const activeCaptionName =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === captionStyle)?.name || "Classic";

  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] px-6 lg:px-10 py-6 lg:py-8">
      <div className="mx-auto max-w-[1560px] space-y-6">
        {/* Header with Project Switcher Dropdown */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Clips Studio
            </h1>
            <Badge variant="emerald" size="md">
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
            </Badge>
          </div>

          {/* Project Switcher Dropdown */}
          <div className="flex items-center gap-3">
            <label htmlFor="project-switcher" className="text-xs font-medium text-zinc-400">
              Project:
            </label>
            <select
              id="project-switcher"
              value={projectId || ""}
              onChange={(e) => {
                if (e.target.value) {
                  router.push(`/clips?project=${encodeURIComponent(e.target.value)}`);
                }
              }}
              className="rounded-xl border border-zinc-800 bg-[#121215] px-3.5 py-1.5 text-xs font-semibold text-white focus-ring cursor-pointer"
            >
              {projectsList.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_id} ({p.clips} clips)
                </option>
              ))}
            </select>
          </div>
        </header>

        {/* Status / Error Alert Banner */}
        {status && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-300 flex items-center justify-between gap-3 animate-in fade-in-0 duration-150">
            <div className="flex items-center gap-2">
              <svg className="size-4 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{status}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatus("")}
              className="text-red-400 hover:text-white p-1 rounded-md"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        )}

        {/* Sticky Toolbar */}
        <section className="sticky top-4 z-30 rounded-2xl border border-zinc-800 bg-[#121215]/95 backdrop-blur-md p-3.5 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Primary Regenerate & ZIP Actions */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={(e) => void handleGenerate(e as unknown as FormEvent)}
                disabled={generating || !projectId}
                className="relative min-h-[38px] rounded-xl bg-[#10b981] px-5 py-2 text-xs font-bold text-zinc-950 transition-all duration-150 hover:bg-[#059669] hover:shadow-lg disabled:opacity-40 focus-ring flex items-center gap-2"
              >
                {isDirty && (
                  <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                )}
                <span>{generating ? "Generating..." : clips.length ? "Regenerate Clips" : "Generate Clips"}</span>
              </button>

              {generating && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="min-h-[38px] rounded-xl border border-red-500/30 bg-red-950/20 px-3.5 py-2 text-xs font-semibold text-red-300 hover:bg-red-900/30 focus-ring"
                >
                  Cancel
                </button>
              )}

              {clips.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={downloadingAll}
                  className="min-h-[38px] rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-200 hover:text-white hover:bg-zinc-700 transition-colors focus-ring flex items-center gap-1.5"
                >
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  <span>{downloadingAll ? "Zipping..." : "Download all (ZIP)"}</span>
                </button>
              )}
            </div>

            {/* Settings Summary Chips (Click opens collapsible ClipSettings) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSettingsOpen((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-800 bg-[#0c0c0e] hover:border-zinc-700 transition-colors text-xs text-zinc-300 focus-ring"
              >
                <span>
                  {framingMode === "true_9_16" ? "9:16 AI" : framingMode === "square_rounded" ? "1:1 Rounded" : "16:9"} • {clipDurationSeconds}s • {showCaptions ? activeCaptionName : "No subs"} • {showWatermark ? "Watermark" : "No logo"}
                </span>
                <span className="text-zinc-500">{isSettingsOpen ? "▲" : "▼"}</span>
              </button>

              {/* Dirty State Notice */}
              {isDirty && (
                <Badge variant="amber" size="sm">
                  Settings changed — Regenerate to apply
                </Badge>
              )}

              {/* Global Audio Volume Controls */}
              <div className="flex items-center gap-1 pl-2 border-l border-zinc-800">
                <IconButton
                  label={globalMuted ? "Unmute all" : "Mute all"}
                  tooltip={globalMuted ? "Unmute all clips" : "Mute all clips"}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const nextMute = !globalMuted;
                    setGlobalMuted(nextMute);
                    try {
                      localStorage.setItem("cliprobin_muted", String(nextMute));
                    } catch {}
                  }}
                  icon={
                    globalMuted ? (
                      <svg className="size-4 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                      </svg>
                    ) : (
                      <svg className="size-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    )
                  }
                />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={globalMuted ? 0 : globalVolume}
                  onChange={(e) => {
                    const vol = parseFloat(e.target.value);
                    setGlobalVolume(vol);
                    setGlobalMuted(vol === 0);
                    try {
                      localStorage.setItem("cliprobin_volume", String(vol));
                    } catch {}
                  }}
                  aria-label="Global clip volume"
                  className="w-16 accent-[#10b981] h-1 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Collapsible ClipSettings drawer */}
          {isSettingsOpen && (
            <div className="pt-3 border-t border-zinc-800/80 max-h-[60vh] overflow-y-auto pr-1 animate-in fade-in-0 duration-150">
              <ClipSettings
                variant="compact"
                generationMode={generationMode}
                onGenerationModeChange={(mode) => {
                  setGenerationMode(mode);
                  try { localStorage.setItem("cliprobin_generation_mode", mode); } catch {}
                }}
                clipDurationSeconds={clipDurationSeconds}
                onClipDurationChange={(dur) => {
                  setClipDurationSeconds(dur);
                  try { localStorage.setItem("cliprobin_clip_duration", String(dur)); } catch {}
                }}
                clipCount={clipCount}
                onClipCountChange={(cnt) => {
                  setClipCount(cnt);
                  try { localStorage.setItem("cliprobin_clip_count", String(cnt)); } catch {}
                }}
                maxClips={maxClips}
                framingMode={framingMode}
                onFramingModeChange={(fm) => {
                  setFramingMode(fm);
                  try { localStorage.setItem("cliprobin_framing_mode", fm); } catch {}
                }}
                showCaptions={showCaptions}
                onShowCaptionsChange={(subs) => {
                  setShowCaptions(subs);
                  try { localStorage.setItem("cliprobin_show_captions", String(subs)); } catch {}
                }}
                captionStyle={captionStyle}
                onCaptionStyleChange={(st) => {
                  setCaptionStyle(st);
                  try { localStorage.setItem("cliprobin_caption_style", st); } catch {}
                }}
                showWatermark={showWatermark}
                onShowWatermarkChange={(wm) => {
                  setShowWatermark(wm);
                  try { localStorage.setItem("cliprobin_show_watermark", String(wm)); } catch {}
                }}
                disabled={generating}
              />
            </div>
          )}
        </section>

        {/* Active Generation Progress Card */}
        {generating && generationProgress && (
          <section aria-live="polite" className="rounded-2xl border border-zinc-800 bg-[#121215] p-4 shadow-md space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#10b981] animate-pulse" />
                <p className="text-xs font-semibold text-white">{generationProgress.step || "Generating clips..."}</p>
              </div>
              <p className="text-xs font-mono font-bold text-emerald-400">{generationProgress.progress}%</p>
            </div>
            <div
              role="progressbar"
              aria-label={`Clip generation progress for ${projectId}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={generationProgress.progress}
              className="h-2 overflow-hidden rounded-full bg-zinc-900 border border-zinc-800"
            >
              <div
                className="h-full rounded-full bg-[#10b981] transition-[width] duration-300"
                style={{ width: `${generationProgress.progress}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
              <span>Smart framing &amp; speaker analysis</span>
              <span>
                Rendering clips
                {generationProgress.total_clips > 0
                  ? ` (${generationProgress.completed_clips}/${generationProgress.total_clips})`
                  : ""}
              </span>
              <span>Finalizing vertical clips</span>
            </div>
          </section>
        )}

        {/* Filter, Search & Sorting Bar */}
        {clips.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search transcript text..."
                className="w-full rounded-xl border border-zinc-800 bg-[#121215] px-3.5 py-2 text-xs text-white placeholder:text-zinc-500 focus-ring"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span>Sort by:</span>
              <button
                type="button"
                onClick={() => setSortBy("timeline")}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  sortBy === "timeline"
                    ? "border-zinc-700 bg-zinc-800 text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Timeline order
              </button>
              <button
                type="button"
                onClick={() => setSortBy("duration")}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  sortBy === "duration"
                    ? "border-zinc-700 bg-zinc-800 text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Longest duration
              </button>
            </div>
          </div>
        )}

        {/* Main Clips Studio Grid: Responsive 220px auto-fill (up to 6+ columns on 2560px screen) */}
        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <ClipSkeletonCard key={`skel-${i}`} index={i + 1} total={6} />
            ))}
          </div>
        ) : filteredClips.length === 0 && !generating ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-12 text-center space-y-3">
            <div className="size-12 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 mx-auto flex items-center justify-center">
              <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-white">
              {searchQuery ? "No matching clips found" : "No clips generated yet"}
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto">
              {searchQuery
                ? `No clips containing "${searchQuery}". Clear your search query to see all clips.`
                : "Click \"Generate Clips\" above to extract short vertical clips from this video."}
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-white"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {filteredClips.map((clip, idx) => (
              <ProClipCard
                key={clip.id}
                clip={clip}
                index={idx}
                projectId={projectId}
                globalVolume={globalVolume}
                globalMuted={globalMuted}
                activePlayingClipId={activePlayingClipId}
                onPlay={(id) => setActivePlayingClipId(id)}
                onOpenModal={(c) => {
                  setActivePlayingClipId(null);
                  setSelectedClipForModal(c);
                }}
                showWatermark={appliedSettings?.showWatermark ?? showWatermark}
                showSubtitles={appliedSettings?.showCaptions ?? showCaptions}
                onClipUpdated={(updated) => {
                  setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
                }}
              />
            ))}
            {generating &&
              Array.from({
                length: Math.max(
                  1,
                  (generationProgress?.total_clips || 6) - filteredClips.length
                ),
              }).map((_, i) => {
                const itemIndex = filteredClips.length + i + 1;
                const totalItems = Math.max(generationProgress?.total_clips || 6, filteredClips.length + 1);
                return (
                  <ClipSkeletonCard
                    key={`gen-skel-${i}`}
                    index={itemIndex}
                    total={totalItems}
                    message={
                      generationProgress?.step
                        ? `${generationProgress.step.slice(0, 24)}...`
                        : `Generating clip ${itemIndex} of ${totalItems}`
                    }
                  />
                );
              })}
          </div>
        )}

        {/* Modal Player Dialog */}
        <ClipModalViewer
          clip={selectedClipForModal}
          projectId={projectId}
          globalVolume={globalVolume}
          globalMuted={globalMuted}
          onClose={() => setSelectedClipForModal(null)}
        />
      </div>
    </main>
  );
}

export default function ClipsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] px-6 lg:px-10 py-6 lg:py-8">
          <div className="mx-auto max-w-[1560px] space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
              <div className="h-8 w-44 rounded-lg bg-zinc-800/80 skeleton-shimmer" />
              <div className="h-8 w-36 rounded-xl bg-zinc-800/60 skeleton-shimmer" />
            </div>
            <div className="h-16 rounded-2xl border border-zinc-800 bg-[#121215] p-3.5 skeleton-shimmer" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <ClipSkeletonCard key={`skel-suspense-${i}`} index={i + 1} total={6} />
              ))}
            </div>
          </div>
        </div>
      }
    >
      <ClipsPageInner />
    </Suspense>
  );
}

function ClipsPageInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project") ?? "";
  return <ProjectClipsContent projectId={projectId} />;
}

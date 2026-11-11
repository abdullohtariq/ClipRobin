"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptionAnimation,
  CaptionStyle,
  Clip,
  ClipGenerationJob,
  CropPreviewResponse,
  cancelClipGeneration,
  clipDownloadUrl,
  clipUrl,
  FramingMode,
  generateClips,
  getClips,
  getLatestClipGenerationJob,
  getProjectCropPreview,
  getProjects,
  Project,
  reframeClip,
  removeClipTopLine,
  saveAllClipsWithExplorer,
  saveClipWithExplorer,
  setClipTopLine,
  TrackingMode,
} from "@/src/lib/api";
import { ModalDialog } from "@/src/components/ui/modal-dialog";
import { ClipSkeletonCard } from "@/src/components/skeletons";
import { ClipSettings, ClipDuration } from "@/src/components/clip-settings";
import { CAPTION_STYLE_OPTIONS } from "@/src/components/caption-style-picker";
import { Badge } from "@/src/components/ui/badge";
import { StatusPill } from "@/src/components/ui/status-pill";
import { IconButton } from "@/src/components/ui/icon-button";
import { YouTubeUploadModal } from "@/src/components/youtube-upload-modal";
import { TikTokUploadModal } from "@/src/components/tiktok-upload-modal";
import { InstagramUploadModal } from "@/src/components/instagram-upload-modal";
import { useAIDeveloperStatus } from "@/src/hooks/use-ai-developer-status";
import { useSubscription } from "@/src/lib/subscription-context";

const normalizeCaptionStyle = (raw: string | null | undefined): CaptionStyle => {
  if (raw === "bold_emerald") return "robin";
  if (raw === "clean_gold") return "clean";
  if (raw && ["classic", "robin", "clean", "punch", "pill", "karaoke"].includes(raw)) {
    return raw as CaptionStyle;
  }
  return "classic";
};

interface AppliedProjectSettings {
  framingMode: FramingMode;
  faceTracking?: boolean;
  trackingMode?: TrackingMode;
  cropAnchorX?: number;
  generationMode?: "random" | "ai";
  requestedGenerationMode?: "random" | "ai";
  appliedGenerationMode?: "random" | "ai";
  aiFallbackReason?: string | null;
  appliedTrackingMode?: string | null;
  trackingFallbackReason?: string | null;
  clipDurationSeconds: ClipDuration;
  clipCount?: number;
  captionStyle: CaptionStyle;
  captionAnimation?: CaptionAnimation | null;
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
  isActivePlaying,
  onPlay,
  onOpenModal,
  showWatermark,
  showSubtitles,
  defaultFaceTracking,
  actionsDisabled = false,
  onClipUpdated,
}: {
  clip: Clip;
  index: number;
  projectId: string;
  globalVolume: number;
  globalMuted: boolean;
  isActivePlaying: boolean;
  onPlay: (clipId: string | null) => void;
  onOpenModal: (clip: Clip) => void;
  showWatermark?: boolean;
  showSubtitles?: boolean;
  defaultFaceTracking?: boolean;
  actionsDisabled?: boolean;
  onClipUpdated?: (updatedClip: Clip) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isActivePlayingRef = useRef<boolean>(isActivePlaying);
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
  const [isEditingReframe, setIsEditingReframe] = useState(false);
  const [reframeMode, setReframeMode] = useState<FramingMode>(clip.framing_mode || "standard");
  const [reframeTracking, setReframeTracking] = useState<TrackingMode>(
    clip.tracking_mode || (clip.face_tracking ? "follow" : "locked"),
  );
  const [reframeAnchor, setReframeAnchor] = useState<number>(clip.crop_anchor_x ?? 0.5);
  const [reframePreview, setReframePreview] = useState<CropPreviewResponse | null>(null);
  const [isReframing, setIsReframing] = useState(false);
  const [reframeError, setReframeError] = useState("");
  const [hasVideoError, setHasVideoError] = useState(false);
  const hasStartedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<number | null>(null);

  const clipVersion =
    clip.v ||
    `${clip.start}_${clip.end}_${clip.framing_mode || ""}_${clip.caption_style || ""}_${clip.caption_animation || ""}_${clip.tracking_mode || ""}_${clip.crop_anchor_x ?? ""}_${clip.top_line || ""}`;

  useEffect(() => {
    setReframeMode(clip.framing_mode || "standard");
    setReframeTracking(clip.tracking_mode || (clip.face_tracking ? "follow" : "locked"));
    setReframeAnchor(clip.crop_anchor_x ?? 0.5);
  }, [clip.framing_mode, clip.tracking_mode, clip.face_tracking, clip.crop_anchor_x]);

  useEffect(() => {
    if (!isEditingReframe || reframeMode !== "true_9_16") {
      setReframePreview(null);
      return;
    }
    const controller = new AbortController();
    getProjectCropPreview(
      projectId,
      {
        start: clip.start,
        end: clip.end,
        trackingMode: reframeTracking,
        cropAnchorX: reframeAnchor,
      },
      controller.signal,
    )
      .then((res) => setReframePreview(res))
      .catch(() => {});
    return () => controller.abort();
  }, [isEditingReframe, reframeMode, reframeTracking, reframeAnchor, projectId, clip.start, clip.end]);

  useEffect(() => {
    isActivePlayingRef.current = isActivePlaying;
  }, [isActivePlaying]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const wordCount = topLineInput.trim().split(/\s+/).filter(Boolean).length;

  // Lazy load video stream using IntersectionObserver and disconnect once visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "250px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fetch clip streaming & download URLs and refresh whenever clip version changes
  useEffect(() => {
    let isActive = true;
    if (isInView) {
      setHasVideoError(false);
      retryCountRef.current = 0;
      void Promise.all([
        clipUrl(projectId, clip.file, clipVersion),
        clipDownloadUrl(projectId, clip.file, clipVersion),
      ]).then(([cUrl, dUrl]) => {
        if (isActive) setMediaUrls({ clip: cUrl, download: dUrl });
      }).catch(() => {});
    }
    return () => {
      isActive = false;
    };
  }, [isInView, clip.file, clipVersion, projectId]);

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
    if (!isActivePlaying) {
      if (!video.paused) {
        video.pause();
      }
      setIsPlaying(false);
    }
  }, [isActivePlaying]);

  const togglePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused || isPlaying) {
      video.pause();
      setIsPlaying(false);
      if (isActivePlaying) {
        onPlay(null);
      }
    } else {
      onPlay(clip.id);
      if (!hasStartedRef.current) {
        video.currentTime = 0;
        hasStartedRef.current = true;
      }
      video.play().then(() => {
        if (!isActivePlayingRef.current) {
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
        caption_animation: clip.caption_animation,
        face_tracking: clip.face_tracking ?? defaultFaceTracking,
      });
      setIsEditingTopLine(false);
      onClipUpdated?.(response.clip);
      const nextVersion = response.clip.v || String(Date.now());
      const [cUrl, dUrl] = await Promise.all([
        clipUrl(projectId, response.clip.file || clip.file, nextVersion),
        clipDownloadUrl(projectId, response.clip.file || clip.file, nextVersion),
      ]);
      setMediaUrls({ clip: cUrl, download: dUrl });
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
        caption_animation: clip.caption_animation,
        face_tracking: clip.face_tracking ?? defaultFaceTracking,
      });
      setIsEditingTopLine(false);
      setTopLineInput("");
      onClipUpdated?.(response.clip);
      const nextVersion = response.clip.v || String(Date.now());
      const [cUrl, dUrl] = await Promise.all([
        clipUrl(projectId, response.clip.file || clip.file, nextVersion),
        clipDownloadUrl(projectId, response.clip.file || clip.file, nextVersion),
      ]);
      setMediaUrls({ clip: cUrl, download: dUrl });
      if (videoRef.current) videoRef.current.load();
    } catch (err) {
      setTopLineError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingTopLine(false);
    }
  };

  const handleSaveReframe = async () => {
    if (isReframing) return;
    setIsReframing(true);
    setReframeError("");
    try {
      const response = await reframeClip(projectId, clip.id, {
        framing_mode: reframeMode,
        tracking_mode: reframeMode === "true_9_16" ? reframeTracking : "locked",
        crop_anchor_x: reframeAnchor,
        face_tracking: reframeMode === "true_9_16" && reframeTracking === "follow",
      });
      setIsEditingReframe(false);
      onClipUpdated?.(response.clip);
      const nextVersion = response.clip.v || String(Date.now());
      const [cUrl, dUrl] = await Promise.all([
        clipUrl(projectId, response.clip.file || clip.file, nextVersion),
        clipDownloadUrl(projectId, response.clip.file || clip.file, nextVersion),
      ]);
      setMediaUrls({ clip: cUrl, download: dUrl });
      if (videoRef.current) videoRef.current.load();
    } catch (err) {
      setReframeError(err instanceof Error ? err.message : "Could not reframe clip");
    } finally {
      setIsReframing(false);
    }
  };

  const isAiClip =
    clip.selection_method === "ai" ||
    (clip.applied_generation_mode === "ai" &&
      typeof clip.score === "number" &&
      !clip.reason?.startsWith("Evenly spaced"));
  const selectionLabel =
    clip.selection_method === "time_slice"
      ? "Time Slice"
      : isAiClip
      ? "AI Hook"
      : "Fast Interval";

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
      {/* Card top metadata bar outside watermark safe corners */}
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono font-bold text-zinc-200">
            #{String(index + 1).padStart(2, "0")}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono font-medium text-emerald-400">
            {clip.duration.toFixed(1)}s
          </span>
        </div>
        <StatusPill status={clip.status} />
      </div>

      {/* Inline Single-Clip Reframe Drawer */}
      {isEditingReframe && (
        <div className="mb-3 rounded-xl border border-purple-500/30 bg-zinc-950 p-3 shadow-xl space-y-2.5 z-20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-100">Reframe this clip</span>
            <button
              type="button"
              onClick={() => setIsEditingReframe(false)}
              className="text-xs text-zinc-400 hover:text-white cursor-pointer"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { id: "standard", label: "16:9" },
                { id: "square_rounded", label: "1:1" },
                { id: "true_9_16", label: "9:16" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setReframeMode(opt.id)}
                className={`py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                  reframeMode === opt.id
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {reframeMode === "true_9_16" && (
            <div className="space-y-2 pt-1 border-t border-zinc-800">
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: "locked", label: "Locked" },
                    { id: "cuts", label: "Cuts" },
                    { id: "follow", label: "Follow" },
                  ] as const
                ).map((tm) => (
                  <button
                    key={tm.id}
                    type="button"
                    onClick={() => setReframeTracking(tm.id)}
                    className={`py-1 rounded-md border text-[10px] font-semibold cursor-pointer ${
                      reframeTracking === tm.id
                        ? "border-purple-400 bg-purple-500/20 text-white"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {tm.label}
                  </button>
                ))}
              </div>
              {reframeTracking === "locked" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-zinc-300">
                    <label htmlFor={`reframe-anchor-${clip.id}`}>Crop anchor</label>
                    <span className="font-mono text-purple-300">
                      {Math.round(reframeAnchor * 100)}%
                    </span>
                  </div>
                  <input
                    id={`reframe-anchor-${clip.id}`}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(reframeAnchor * 100)}
                    onChange={(e) => setReframeAnchor(Number(e.target.value) / 100)}
                    className="w-full accent-purple-400 cursor-pointer"
                  />
                  {reframePreview && (
                    <div className="relative h-2.5 w-full rounded bg-zinc-800 overflow-hidden border border-zinc-700" title="Server crop window preview">
                      <div
                        className="absolute inset-y-0 bg-purple-500/70 border-x border-purple-300"
                        style={{
                          left: `${Math.round(reframePreview.x_ratio * 100)}%`,
                          width: `${Math.max(8, Math.round(reframePreview.w_ratio * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {reframeError && <p className="text-[11px] text-red-400">{reframeError}</p>}

          <button
            type="button"
            disabled={isReframing || actionsDisabled}
            onClick={() => void handleSaveReframe()}
            className="w-full py-1.5 rounded-lg bg-[#10b981] text-zinc-950 text-xs font-bold hover:bg-[#059669] disabled:opacity-50 cursor-pointer"
          >
            {isReframing ? "Applying crop..." : "Apply Reframe"}
          </button>
        </div>
      )}

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
          <div className="size-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 p-4 text-center gap-2">
            <svg className="size-6 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-xs text-zinc-400 font-medium">Clip unavailable</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                retryCountRef.current = 0;
                setHasVideoError(false);
                void Promise.all([
                  clipUrl(projectId, clip.file, `${clipVersion}_${Date.now()}`),
                  clipDownloadUrl(projectId, clip.file, `${clipVersion}_${Date.now()}`),
                ]).then(([cUrl, dUrl]) => {
                  setMediaUrls({ clip: cUrl, download: dUrl });
                }).catch(() => {});
              }}
              className="px-2.5 py-1 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-[11px] font-medium text-zinc-200 transition-colors"
            >
              Retry
            </button>
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
              retryCountRef.current = 0;
              if (videoRef.current) {
                setDuration(videoRef.current.duration);
                if (videoRef.current.currentTime === 0 && videoRef.current.duration > 0.3) {
                  videoRef.current.currentTime = Math.min(1.0, videoRef.current.duration / 3);
                }
              }
            }}
            onError={() => {
              if (retryCountRef.current < 2) {
                retryCountRef.current += 1;
                const wasPlaying = isActivePlayingRef.current;
                if (retryTimeoutRef.current !== null) {
                  window.clearTimeout(retryTimeoutRef.current);
                }
                retryTimeoutRef.current = window.setTimeout(() => {
                  retryTimeoutRef.current = null;
                  void Promise.all([
                    clipUrl(projectId, clip.file, `${clipVersion}_r${retryCountRef.current}_${Date.now()}`),
                    clipDownloadUrl(projectId, clip.file, `${clipVersion}_r${retryCountRef.current}_${Date.now()}`),
                  ]).then(([cUrl, dUrl]) => {
                    setMediaUrls({ clip: cUrl, download: dUrl });
                    if (wasPlaying && videoRef.current) {
                      videoRef.current.load();
                      void videoRef.current.play().catch(() => {});
                    }
                  }).catch(() => {
                    setHasVideoError(true);
                  });
                }, 300);
                return;
              }
              setHasVideoError(true);
            }}
            onEnded={() => {
              setIsPlaying(false);
              hasStartedRef.current = false;
              if (isActivePlaying) {
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

        {/* Minimal Player Controls Overlay (kept away from watermark corners) */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/player:opacity-100 focus-within:opacity-100 transition-opacity duration-150 flex flex-col justify-end p-2.5 gap-3">
          {/* Center Play / Pause Icon Button */}
          <button
            type="button"
            aria-label={isPlaying ? "Pause clip" : "Play clip"}
            onClick={togglePlayPause}
            className="m-auto flex size-12 items-center justify-center rounded-full bg-black/80 border border-white/20 text-white shadow-xl hover:scale-105 active:scale-95 transition-transform"
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
      <div className="mt-3 space-y-2.5">
        {/* Title on its own dedicated full-width row */}
        <h3 className="text-[13px] font-semibold text-white leading-snug line-clamp-2" title={clip.title}>
          {clip.title}
        </h3>

        {/* Timecode, selection method, & optional AI score */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
          <span className="font-mono text-zinc-400">
            {formatTime(clip.start)} — {formatTime(clip.end)}
          </span>
          <div className="flex items-center gap-1.5">
            {isAiClip && typeof clip.score === "number" ? (
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold border ${
                  clip.score >= 8.5
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-sm shadow-emerald-950/40"
                    : clip.score >= 7.0
                    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
                title={`AI Hook Score: ${clip.score}/10`}
              >
                <span>⭐</span>
                <span>{clip.score.toFixed(1)}/10</span>
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300">
                {selectionLabel}
              </span>
            )}
            {clip.top_line && (
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded truncate max-w-[90px]" title={clip.top_line}>
                Hook active
              </span>
            )}
          </div>
        </div>

        {/* AI rationale or non-AI interval summary */}
        {isAiClip && clip.reason ? (
          <div className="rounded-xl border border-zinc-800/80 bg-[#0c0c0e] p-2.5 space-y-1">
            <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
              <svg className="size-3 fill-current text-emerald-400" viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Why this clip stands out:
            </span>
            <p
              className="text-[11px] text-zinc-300 line-clamp-3 leading-relaxed"
              title={clip.reason}
            >
              {clip.reason}
            </p>
          </div>
        ) : (
          <p className="text-xs text-zinc-400 line-clamp-2">
            {clip.reason && !clip.reason.startsWith("Mock analysis")
              ? clip.reason
              : clip.selection_method === "time_slice"
              ? "Evenly sliced time window (no speech track detected)."
              : "Evenly spaced interval across detected transcript segments."}
          </p>
        )}

        {/* Actions: Download, Upload, Reframe, Top Line */}
        <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDownload}
            className="flex-1 min-w-[78px] py-1.5 px-2 rounded-lg border border-zinc-700 bg-zinc-800/90 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors focus-ring flex items-center justify-center gap-1 cursor-pointer"
          >
            <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span>{downloadMsg || (isDownloading ? "Saving..." : "Download")}</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenModal(clip)}
            className="py-1.5 px-2 rounded-lg border border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors focus-ring flex items-center gap-1 cursor-pointer"
            title="Upload to YouTube or prepare for TikTok / Instagram"
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            <span>Share</span>
          </button>

          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => {
              setIsEditingTopLine(false);
              setIsEditingReframe((prev) => !prev);
            }}
            className="py-1.5 px-2 rounded-lg border border-zinc-700 bg-transparent hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors focus-ring cursor-pointer disabled:opacity-40"
          >
            Reframe
          </button>

          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => {
              setIsEditingReframe(false);
              setIsEditingTopLine((prev) => !prev);
            }}
            className="py-1.5 px-2 rounded-lg border border-zinc-700 bg-transparent hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors focus-ring cursor-pointer disabled:opacity-40"
          >
            {clip.top_line ? "Edit line" : "Top line"}
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
  const [modalError, setModalError] = useState<string | null>(null);
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [isTikTokModalOpen, setIsTikTokModalOpen] = useState(false);
  const [isInstagramModalOpen, setIsInstagramModalOpen] = useState(false);
  const modalVideoRef = useRef<HTMLVideoElement>(null);

  const hasChildUploadModal = isYouTubeModalOpen || isTikTokModalOpen || isInstagramModalOpen;

  useEffect(() => {
    if (!clip) return;
    setModalError(null);
    let active = true;
    const clipVersion =
      clip.v ||
      `${clip.start}_${clip.end}_${clip.framing_mode || ""}_${clip.caption_style || ""}_${clip.caption_animation || ""}_${clip.tracking_mode || ""}_${clip.crop_anchor_x ?? ""}_${clip.top_line || ""}`;
    clipUrl(projectId, clip.file, clipVersion).then((url) => {
      if (active) setVideoUrl(url);
    });
    return () => {
      active = false;
    };
  }, [clip, projectId]);

  useEffect(() => {
    if (hasChildUploadModal && modalVideoRef.current && !modalVideoRef.current.paused) {
      modalVideoRef.current.pause();
    }
  }, [hasChildUploadModal]);

  useEffect(() => {
    const v = modalVideoRef.current;
    if (!v) return;
    v.volume = globalVolume;
    v.muted = globalMuted;
  }, [globalVolume, globalMuted, videoUrl]);

  const isModalAiClip = Boolean(
    clip &&
      (clip.selection_method === "ai" ||
        (clip.applied_generation_mode === "ai" &&
          typeof clip.score === "number" &&
          !clip.reason?.startsWith("Evenly spaced"))),
  );

  return (
    <ModalDialog
      open={Boolean(clip)}
      onClose={() => {
        if (!hasChildUploadModal) onClose();
      }}
      ariaLabel={clip?.title || "Clip preview"}
      className="max-w-4xl"
    >
      {clip && (
      <div className="relative flex flex-col md:flex-row items-center w-full rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-2xl gap-6 overflow-y-auto md:overflow-hidden max-h-[90vh]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close clip preview"
          className="absolute top-4 right-4 z-20 size-8 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center focus-ring cursor-pointer"
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono font-semibold text-emerald-400">
                {clip.id}
              </span>
              {isModalAiClip && typeof clip.score === "number" ? (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold border ${
                    clip.score >= 8.5
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  }`}
                >
                  <span>⭐ AI Hook Score: {clip.score.toFixed(1)}/10</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-300">
                  {clip.selection_method === "time_slice" ? "Time Slice" : "Fast Interval"}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-white mt-1 leading-snug">
              {clip.title}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-zinc-400">
              <span>Duration: {clip.duration.toFixed(1)}s</span>
              <span>•</span>
              <span>
                Framing:{" "}
                {clip.framing_mode === "true_9_16"
                  ? clip.tracking_mode === "follow"
                    ? "9:16 Follow Speaker"
                    : clip.tracking_mode === "cuts"
                    ? "9:16 Speaker Cuts"
                    : `9:16 Locked (${Math.round((clip.crop_anchor_x ?? 0.5) * 100)}%)`
                  : clip.framing_mode === "square_rounded"
                  ? "1:1 Rounded"
                  : "16:9 Letterbox"}
              </span>
            </div>
          </div>

          {isModalAiClip && clip.reason ? (
            <div className="rounded-xl border border-emerald-500/20 bg-[#0c0c0e] p-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                  <svg className="size-3.5 fill-current" viewBox="0 0 24 24">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Why this clip stands out
                </span>
                {typeof clip.score === "number" && (
                  <span className="text-xs text-zinc-400 font-mono">
                    Hook Score: <span className="text-emerald-400 font-bold">{clip.score.toFixed(1)}/10</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">{clip.reason}</p>
            </div>
          ) : (
            clip.reason && !clip.reason.startsWith("Mock analysis") && (
              <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5 text-xs text-zinc-300">
                {clip.reason}
              </div>
            )
          )}

          {modalError && (
            <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {modalError}
            </div>
          )}

          {clip.top_line && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1">
              <span className="text-xs font-semibold text-emerald-400">Top Line Context</span>
              <p className="text-sm font-medium text-white">{clip.top_line}</p>
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                void saveClipWithExplorer(projectId, clip.file, `${clip.id}.mp4`).catch((err) => {
                  setModalError(err instanceof Error ? err.message : "Could not export video");
                });
              }}
              className="px-3.5 py-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] text-xs font-bold text-zinc-950 transition-colors focus-ring inline-flex items-center gap-2 shadow-md cursor-pointer"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span>Export Video</span>
            </button>

            <button
              type="button"
              onClick={() => setIsYouTubeModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-[#FF0000] hover:bg-[#E50914] text-xs font-bold text-white transition-colors focus-ring inline-flex items-center gap-2 shadow-lg shadow-red-950/40 cursor-pointer"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span>Upload to YouTube</span>
            </button>

            <button
              type="button"
              onClick={() => setIsTikTokModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-black hover:bg-zinc-900 border border-zinc-700/80 hover:border-[#25F4EE] text-xs font-bold text-white transition-all focus-ring inline-flex items-center gap-2 shadow-lg shadow-black/60 cursor-pointer"
            >
              <svg className="size-4 text-[#25F4EE]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.46 6.27 6.27 0 0 0 1.96-4.46V8.71a8.28 8.28 0 0 0 5.1 1.77V7.03a4.88 4.88 0 0 1-1.29-.34z" />
              </svg>
              <span>Prepare for TikTok</span>
            </button>

            <button
              type="button"
              onClick={() => setIsInstagramModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-[#f09433] via-[#dc2743] to-[#bc1888] hover:opacity-95 text-xs font-bold text-white transition-opacity focus-ring inline-flex items-center gap-2 shadow-lg shadow-pink-950/30 cursor-pointer"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
              <span>Prepare for Instagram</span>
            </button>
          </div>
        </div>
      </div>
      )}

      {clip && isYouTubeModalOpen && (
        <YouTubeUploadModal
          clip={clip}
          projectId={projectId}
          onClose={() => setIsYouTubeModalOpen(false)}
        />
      )}

      {clip && isTikTokModalOpen && (
        <TikTokUploadModal
          clip={clip}
          projectId={projectId}
          onClose={() => setIsTikTokModalOpen(false)}
        />
      )}

      {clip && isInstagramModalOpen && (
        <InstagramUploadModal
          clip={clip}
          projectId={projectId}
          onClose={() => setIsInstagramModalOpen(false)}
        />
      )}
    </ModalDialog>
  );
}

// Main Clips Studio Component
function ProjectClipsContent({ projectId }: { projectId: string }) {
  const { status: aiDeveloperStatus } = useAIDeveloperStatus();
  const { isPro, openUpgradeModal, isCaptionStyleAllowed } = useSubscription();
  const aiModeEnabled = Boolean(aiDeveloperStatus?.ai_enabled);
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>([]);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(projectId));
  const [loadedProjectId, setLoadedProjectId] = useState<string>("");
  const [status, setStatus] = useState(projectId ? "" : "Choose a project to view its clips.");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");
  const [generating, setGenerating] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<ClipGenerationJob | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [trackingFallbackNotice, setTrackingFallbackNotice] = useState<string | null>(null);

  // Settings state
  const [framingMode, setFramingMode] = useState<FramingMode>("standard");
  const [trackingMode, setTrackingMode] = useState<TrackingMode>("locked");
  const [cropAnchorX, setCropAnchorX] = useState<number>(0.5);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("classic");
  const [captionAnimation, setCaptionAnimation] = useState<CaptionAnimation | null>(null);
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

  useEffect(() => {
    if (aiDeveloperStatus && !aiDeveloperStatus.ai_enabled && generationMode === "ai") {
      setGenerationMode("random");
      try { localStorage.setItem("cliprobin_generation_mode", "random"); } catch {}
    }
  }, [aiDeveloperStatus, generationMode]);
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
  const isManualGeneratingRef = useRef<boolean>(false);

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
      const savedTracking = localStorage.getItem("cliprobin_tracking_mode");
      if (savedTracking && ["locked", "cuts", "follow"].includes(savedTracking)) {
        setTrackingMode(savedTracking as TrackingMode);
      }
      const savedAnchor = localStorage.getItem("cliprobin_crop_anchor_x");
      if (savedAnchor !== null) {
        const parsedAnchor = Number(savedAnchor);
        if (!Number.isNaN(parsedAnchor) && parsedAnchor >= 0 && parsedAnchor <= 1) {
          setCropAnchorX(parsedAnchor);
        }
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
        setGenerationMode(isPro && savedMode === "ai" ? "ai" : "random");
      }
      const savedSubs = localStorage.getItem("cliprobin_show_captions");
      if (savedSubs !== null) {
        setShowCaptions(savedSubs === "true");
      }
      const savedWm = localStorage.getItem("cliprobin_show_watermark");
      if (!isPro) {
        setShowWatermark(true);
      } else if (savedWm !== null) {
        setShowWatermark(savedWm === "true");
      }
      const savedStyle = localStorage.getItem("cliprobin_caption_style");
      if (savedStyle) {
        const normalized = normalizeCaptionStyle(savedStyle);
        setCaptionStyle(isCaptionStyleAllowed(normalized) ? normalized : "classic");
      } else {
        const storedSettings = localStorage.getItem("cliprobin.settings");
        if (storedSettings) {
          const parsed = JSON.parse(storedSettings);
          if (parsed.defaultCaptionStyle) {
            const normalized = normalizeCaptionStyle(parsed.defaultCaptionStyle);
            setCaptionStyle(isCaptionStyleAllowed(normalized) ? normalized : "classic");
          }
        }
      }
      const savedAnim = localStorage.getItem("cliprobin_caption_animation");
      if (savedAnim && ["pop", "grow", "sweep", "fade", "glide"].includes(savedAnim)) {
        setCaptionAnimation(savedAnim as CaptionAnimation);
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
  }, [projectId, isPro, isCaptionStyleAllowed]);

  useEffect(() => {
    const handleSubChange = () => {
      if (!isPro) {
        setShowWatermark(true);
        setGenerationMode("random");
        setCaptionStyle((prev) => (isCaptionStyleAllowed(prev) ? prev : "classic"));
      }
    };
    window.addEventListener("cliprobin:subscription-changed", handleSubChange);
    return () => window.removeEventListener("cliprobin:subscription-changed", handleSubChange);
  }, [isPro, isCaptionStyleAllowed]);

  const effectiveShowWatermark = isPro ? showWatermark : true;

  // Check if current settings differ from applied generation settings (dirty state)
  const isDirty = useMemo(() => {
    if (!appliedSettings || !clips.length) return false;
    const prevTrackingMode: TrackingMode =
      appliedSettings.trackingMode || (appliedSettings.faceTracking ? "follow" : "locked");
    const trackingChanged =
      framingMode === "true_9_16" &&
      (prevTrackingMode !== trackingMode ||
        Math.abs((appliedSettings.cropAnchorX ?? 0.5) - cropAnchorX) > 0.02);
    const genModeChanged =
      appliedSettings.generationMode !== undefined &&
      appliedSettings.generationMode !== generationMode;
    const clipCountChanged =
      appliedSettings.clipCount !== undefined &&
      appliedSettings.clipCount !== clipCount;
    return (
      appliedSettings.framingMode !== framingMode ||
      trackingChanged ||
      genModeChanged ||
      clipCountChanged ||
      appliedSettings.clipDurationSeconds !== clipDurationSeconds ||
      appliedSettings.captionStyle !== captionStyle ||
      (appliedSettings.captionAnimation ?? null) !== (captionAnimation ?? null) ||
      appliedSettings.showWatermark !== effectiveShowWatermark ||
      appliedSettings.showCaptions !== showCaptions
    );
  }, [
    appliedSettings,
    clips.length,
    framingMode,
    trackingMode,
    cropAnchorX,
    generationMode,
    clipCount,
    clipDurationSeconds,
    captionStyle,
    captionAnimation,
    effectiveShowWatermark,
    showCaptions,
  ]);

  // Load clips & generation status
  useEffect(() => {
    if (!projectId) {
      setIsLoading(false);
      setLoadedProjectId("");
      setStatus("Choose a project to view its clips.");
      setStatusTone("info");
      return;
    }
    let isCurrentRequest = true;
    const abortController = new AbortController();
    let pollIntervalId: number | undefined;
    let retryTimeoutId: number | undefined;

    setClips([]);
    setIsLoading(true);
    setLoadedProjectId("");
    setFallbackNotice(null);
    setTrackingFallbackNotice(null);

    const loadClipsAndStatus = async () => {
      if (!isCurrentRequest) return;
      if (typeof document !== "undefined" && document.hidden && pollIntervalId !== undefined) {
        return;
      }
      try {
        const [result, job] = await Promise.all([
          getClips(projectId, abortController.signal),
          getLatestClipGenerationJob(projectId),
        ]);
        if (!isCurrentRequest) return;
        setLoadedProjectId(projectId);
        if (result.source_duration) {
          setSourceDuration(result.source_duration);
        }
        setIsLoading(false);
        setClips(result.clips);
        setGenerationProgress(job);

        const opts = result.generation_options || {};
        if (
          (job?.requested_generation_mode === "ai" &&
            job?.applied_generation_mode &&
            job.applied_generation_mode !== "ai") ||
          (opts.requested_generation_mode === "ai" &&
            opts.applied_generation_mode &&
            opts.applied_generation_mode !== "ai")
        ) {
          const reason = job?.ai_fallback_reason || opts.ai_fallback_reason || "AI service was unavailable.";
          setFallbackNotice(`AI Hook Finder fell back to Fast Interval: ${reason}`);
        } else {
          setFallbackNotice(null);
        }

        const tfReason = job?.tracking_fallback_reason || opts.tracking_fallback_reason;
        if (tfReason) {
          setTrackingFallbackNotice(tfReason);
        } else {
          setTrackingFallbackNotice(null);
        }

        // Hydrate appliedSettings and toolbar state from backend generation_options once per project
        if (hydratedProjectRef.current !== projectId && (result.generation_options || result.clips.length > 0)) {
          const hasServerOpts = Object.keys(opts).length > 0;
          if (hasServerOpts || result.clips.length > 0) {
            hydratedProjectRef.current = projectId;
            const firstClip = result.clips[0];
            const appliedFraming: FramingMode =
              (opts.framing_mode as FramingMode) || firstClip?.framing_mode || "standard";
            const rawStyle =
              (opts.caption_style as string | undefined) || firstClip?.caption_style || "classic";
            const normalizedStyle = normalizeCaptionStyle(rawStyle);
            const appliedStyle: CaptionStyle = isCaptionStyleAllowed(normalizedStyle)
              ? normalizedStyle
              : "classic";
            const appliedAnim: CaptionAnimation | null =
              (opts.caption_animation as CaptionAnimation) || firstClip?.caption_animation || null;
            const rawDur = opts.clip_duration_seconds || (firstClip ? Math.round(firstClip.duration) : 30);
            const appliedDur: ClipDuration = ([12, 15, 30, 60, 90].includes(rawDur) ? rawDur : 30) as ClipDuration;
            const appliedWm = typeof opts.show_watermark === "boolean" ? opts.show_watermark : false;
            const appliedSubs = typeof opts.show_subtitles === "boolean" ? opts.show_subtitles : true;
            const resolvedTracking: TrackingMode =
              opts.tracking_mode && ["locked", "cuts", "follow"].includes(opts.tracking_mode)
                ? opts.tracking_mode
                : firstClip?.tracking_mode && ["locked", "cuts", "follow"].includes(firstClip.tracking_mode)
                ? firstClip.tracking_mode
                : typeof opts.face_tracking === "boolean"
                ? (opts.face_tracking ? "follow" : "locked")
                : firstClip?.face_tracking !== undefined
                ? (firstClip.face_tracking ? "follow" : "locked")
                : "locked";
            const resolvedAnchor =
              typeof opts.crop_anchor_x === "number"
                ? opts.crop_anchor_x
                : typeof firstClip?.crop_anchor_x === "number"
                ? firstClip.crop_anchor_x
                : 0.5;
            const appliedMode: "random" | "ai" =
              (opts.applied_generation_mode || opts.generation_mode) === "ai" && isPro && aiModeEnabled
                ? "ai"
                : "random";

            const hydrated: AppliedProjectSettings = {
              framingMode: appliedFraming,
              faceTracking: resolvedTracking === "follow",
              trackingMode: resolvedTracking,
              cropAnchorX: resolvedAnchor,
              generationMode: appliedMode,
              requestedGenerationMode: opts.requested_generation_mode,
              appliedGenerationMode: opts.applied_generation_mode,
              aiFallbackReason: opts.ai_fallback_reason,
              appliedTrackingMode: opts.applied_tracking_mode,
              trackingFallbackReason: opts.tracking_fallback_reason,
              clipDurationSeconds: appliedDur,
              clipCount: opts.clip_count ?? undefined,
              captionStyle: appliedStyle,
              captionAnimation: appliedAnim,
              showWatermark: appliedWm,
              showCaptions: appliedSubs,
            };
            setAppliedSettings(hydrated);
            setFramingMode(appliedFraming);
            setTrackingMode(resolvedTracking);
            setCropAnchorX(resolvedAnchor);
            setGenerationMode(appliedMode);
            setCaptionStyle(appliedStyle);
            setCaptionAnimation(appliedAnim);
            setClipDurationSeconds(appliedDur);
            setShowWatermark(isPro ? appliedWm : true);
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
          setStatusTone("error");
        } else {
          // Clear transient network errors once successful
          setStatus((prev) =>
            prev === "Failed to fetch" || prev === "Failed to load clips" || prev === "Choose a project to view its clips."
              ? ""
              : prev
          );
        }

        if (isRunning && !isManualGeneratingRef.current && pollIntervalId === undefined) {
          pollIntervalId = window.setInterval(() => {
            if (!isManualGeneratingRef.current) {
              void loadClipsAndStatus();
            }
          }, 1000);
        } else if ((!isRunning || isManualGeneratingRef.current) && pollIntervalId !== undefined) {
          window.clearInterval(pollIntervalId);
          pollIntervalId = undefined;
        }
      } catch (err) {
        if (!isCurrentRequest || (err instanceof DOMException && err.name === "AbortError")) return;
        setIsLoading(false);
        const msg = err instanceof Error ? err.message : "Failed to load clips";
        setStatus(msg);
        setStatusTone("error");
        // Automatically retry transient fetch failure after 2 seconds instead of stalling forever
        if (retryTimeoutId === undefined && (msg.includes("fetch") || msg.includes("Failed"))) {
          retryTimeoutId = window.setTimeout(() => {
            retryTimeoutId = undefined;
            void loadClipsAndStatus();
          }, 2000);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void loadClipsAndStatus();
      }
    };

    void loadClipsAndStatus();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      isCurrentRequest = false;
      abortController.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (pollIntervalId !== undefined) window.clearInterval(pollIntervalId);
      if (retryTimeoutId !== undefined) window.clearTimeout(retryTimeoutId);
    };
  }, [projectId, isCaptionStyleAllowed, isPro, aiModeEnabled]);

  // Regenerate clips pipeline (stages in background without wiping existing committed clips)
  const triggerGeneration = async (overrideGenerationMode?: "random" | "ai") => {
    if (!projectId || generating || loadedProjectId !== projectId) return;
    const requestedMode = overrideGenerationMode ?? generationMode;
    const normalizedStyle = normalizeCaptionStyle(captionStyle);
    const effectiveStyle: CaptionStyle = isCaptionStyleAllowed(normalizedStyle)
      ? normalizedStyle
      : "classic";
    const effectiveGenMode: "random" | "ai" =
      isPro && aiModeEnabled && requestedMode === "ai" ? "ai" : "random";
    const effectiveTrackingMode: TrackingMode = framingMode === "true_9_16" ? trackingMode : "locked";
    const effectiveFt = effectiveTrackingMode === "follow";

    isManualGeneratingRef.current = true;
    setGenerating(true);
    setFallbackNotice(null);
    setTrackingFallbackNotice(null);
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
      let latestJobState: ClipGenerationJob | null = null;
      const result = await generateClips(
        projectId,
        showCaptions,
        (job) => {
          latestJobState = job;
          setGenerationProgress(job);
        },
        clipDurationSeconds,
        effectiveShowWatermark,
        framingMode,
        effectiveStyle,
        effectiveStyle === "classic" ? undefined : (captionAnimation || undefined),
        clipCount,
        effectiveGenMode,
        effectiveFt,
        {
          trackingMode: effectiveTrackingMode,
          cropAnchorX,
        },
      );

      if (result.cancelled) {
        const diskClips = await getClips(projectId).catch(() => null);
        if (diskClips) setClips(diskClips.clips);
        setStatusTone("info");
        setStatus("Generation cancelled. Previously saved clips were kept intact.");
        return;
      }

      const fresh = await getClips(projectId).catch(() => null);
      const committedClips = fresh ? fresh.clips : result.clips;
      setClips(committedClips);

      const appliedModeFromServer =
        fresh?.generation_options?.applied_generation_mode ||
        (latestJobState as ClipGenerationJob | null)?.applied_generation_mode ||
        effectiveGenMode;
      const aiReason =
        fresh?.generation_options?.ai_fallback_reason ||
        (latestJobState as ClipGenerationJob | null)?.ai_fallback_reason ||
        null;
      const tfReason =
        fresh?.generation_options?.tracking_fallback_reason ||
        (latestJobState as ClipGenerationJob | null)?.tracking_fallback_reason ||
        null;

      if (effectiveGenMode === "ai" && appliedModeFromServer !== "ai") {
        setFallbackNotice(`AI Hook Finder fell back to Fast Interval: ${aiReason || "AI service was unavailable."}`);
      } else {
        setFallbackNotice(null);
      }
      setTrackingFallbackNotice(tfReason);

      // Save applied settings
      const applied: AppliedProjectSettings = {
        framingMode,
        faceTracking: effectiveFt,
        trackingMode: effectiveTrackingMode,
        cropAnchorX,
        generationMode: appliedModeFromServer === "ai" ? "ai" : "random",
        requestedGenerationMode: effectiveGenMode,
        appliedGenerationMode: appliedModeFromServer === "ai" ? "ai" : "random",
        aiFallbackReason: aiReason,
        trackingFallbackReason: tfReason,
        clipDurationSeconds,
        clipCount,
        captionStyle: effectiveStyle,
        captionAnimation: effectiveStyle === "classic" ? null : captionAnimation,
        showWatermark: effectiveShowWatermark,
        showCaptions,
      };
      setAppliedSettings(applied);
      setGenerationMode(applied.generationMode ?? "random");
      try {
        localStorage.setItem(`cliprobin_applied_${projectId}`, JSON.stringify(applied));
      } catch {}
      setStatusTone("success");
      setStatus(`${committedClips.length} clips generated successfully.`);
    } catch (err) {
      setStatusTone("error");
      setStatus(err instanceof Error ? err.message : "Clip generation failed");
      try {
        const diskClips = await getClips(projectId);
        setClips(diskClips.clips);
      } catch {}
    } finally {
      isManualGeneratingRef.current = false;
      setGenerating(false);
    }
  };

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    await triggerGeneration();
  };

  const handleCancel = async () => {
    const job = generationProgress;
    if (!projectId || !job?.job_id || job.status === "cancelling") return;
    if (!window.confirm("Cancel regeneration? Previously saved clips will be kept.")) return;
    try {
      const updated = await cancelClipGeneration(projectId, job.job_id);
      setGenerationProgress(updated);
      setStatusTone("info");
      setStatus("Cancelling regeneration; keeping previous clips...");
    } catch (err) {
      setStatusTone("error");
      setStatus(err instanceof Error ? err.message : "Could not cancel");
    }
  };

  const handleDownloadAll = async () => {
    if (!projectId || downloadingAll) return;
    setDownloadingAll(true);
    try {
      await saveAllClipsWithExplorer(projectId);
    } catch (err) {
      setStatusTone("error");
      setStatus(err instanceof Error ? err.message : "Failed to download zip");
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleCardPlay = useCallback((id: string | null) => {
    setActivePlayingClipId(id);
  }, []);

  const handleOpenClipModal = useCallback((c: Clip) => {
    setActivePlayingClipId(null);
    setSelectedClipForModal(c);
  }, []);

  const handleClipUpdated = useCallback((updated: Clip) => {
    setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

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
              {(!projectId || !projectsList.some((p) => p.project_id === projectId)) && (
                <option value="" disabled>
                  {projectsList.length ? "Select a project..." : "No projects yet"}
                </option>
              )}
              {projectsList.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.title || p.project_id} ({p.clips} {p.clips === 1 ? "clip" : "clips"})
                </option>
              ))}
            </select>
          </div>
        </header>

        {/* Status / Info / Error Alert Banner */}
        {status && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 animate-in fade-in-0 duration-150 ${
              statusTone === "success"
                ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                : statusTone === "info"
                  ? "border-zinc-700/80 bg-[#121215] text-zinc-300"
                  : "border-red-500/30 bg-red-950/20 text-red-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg
                className={`size-4 shrink-0 ${
                  statusTone === "success"
                    ? "text-emerald-400"
                    : statusTone === "info"
                      ? "text-zinc-400"
                      : "text-red-400"
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                {statusTone === "success" ? (
                  <polyline points="20 6 9 17 4 12" />
                ) : (
                  <>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </>
                )}
              </svg>
              <span>{status}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatus("")}
              className="text-zinc-400 hover:text-white p-1 rounded-md"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        )}

        {/* Fallback Warning Banners (AI or Smart Framing) */}
        {fallbackNotice && (
          <div
            role="status"
            className="rounded-xl border border-amber-500/35 bg-amber-950/25 px-4 py-3 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3"
          >
            <span>{fallbackNotice}</span>
            <div className="flex items-center gap-2">
              {isPro && aiModeEnabled && !generating && (
                <button
                  type="button"
                  onClick={() => void triggerGeneration("ai")}
                  className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold cursor-pointer"
                >
                  Retry AI Analysis
                </button>
              )}
              <button
                type="button"
                onClick={() => setFallbackNotice(null)}
                className="text-amber-300/80 hover:text-white px-1 cursor-pointer"
                aria-label="Dismiss AI fallback warning"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {trackingFallbackNotice && (
          <div
            role="status"
            className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-200 flex items-center justify-between gap-3"
          >
            <span>Framing notice: {trackingFallbackNotice}</span>
            <button
              type="button"
              onClick={() => setTrackingFallbackNotice(null)}
              className="text-amber-300/80 hover:text-white px-1 cursor-pointer"
              aria-label="Dismiss framing notice"
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
                disabled={generating || !projectId || isLoading || loadedProjectId !== projectId}
                className="relative min-h-[38px] rounded-xl bg-[#10b981] px-5 py-2 text-xs font-bold text-zinc-950 transition-all duration-150 hover:bg-[#059669] hover:shadow-lg disabled:opacity-40 focus-ring flex items-center gap-2 cursor-pointer"
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
                  className="min-h-[38px] rounded-xl border border-red-500/30 bg-red-950/20 px-3.5 py-2 text-xs font-semibold text-red-300 hover:bg-red-900/30 focus-ring cursor-pointer"
                >
                  Cancel
                </button>
              )}

              {clips.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={downloadingAll || isLoading || loadedProjectId !== projectId}
                  className="min-h-[38px] rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-xs font-medium text-zinc-200 hover:text-white hover:bg-zinc-700 transition-colors focus-ring flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
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
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-800 bg-[#0c0c0e] hover:border-zinc-700 transition-colors text-xs text-zinc-300 focus-ring cursor-pointer"
              >
                <span>
                  {framingMode === "true_9_16"
                    ? trackingMode === "locked"
                      ? `9:16 Locked (${Math.round(cropAnchorX * 100)}%)`
                      : trackingMode === "cuts"
                      ? "9:16 Cuts"
                      : "9:16 Follow"
                    : framingMode === "square_rounded"
                    ? "1:1 Rounded"
                    : "16:9"} • {clipDurationSeconds}s • 720×1280 • {showCaptions ? activeCaptionName : "No subs"} • {effectiveShowWatermark ? "Watermark" : "No logo"}
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
                aiModeEnabled={aiModeEnabled}
                aiModeDisabledReason={aiDeveloperStatus?.reason}
                generationMode={generationMode}
                onGenerationModeChange={(mode) => {
                  if (mode === "ai" && !isPro) {
                    openUpgradeModal("Gemini AI Hook Finder");
                    return;
                  }
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
                faceTracking={trackingMode === "follow"}
                onFaceTrackingChange={(ft) => {
                  const next: TrackingMode = ft ? "follow" : "locked";
                  setTrackingMode(next);
                  try {
                    localStorage.setItem("cliprobin_tracking_mode", next);
                    localStorage.setItem("cliprobin_face_tracking", String(ft));
                  } catch {}
                }}
                trackingMode={trackingMode}
                onTrackingModeChange={(tm) => {
                  setTrackingMode(tm);
                  try {
                    localStorage.setItem("cliprobin_tracking_mode", tm);
                    localStorage.setItem("cliprobin_face_tracking", String(tm === "follow"));
                  } catch {}
                }}
                cropAnchorX={cropAnchorX}
                onCropAnchorXChange={(anchor) => {
                  setCropAnchorX(anchor);
                  try { localStorage.setItem("cliprobin_crop_anchor_x", String(anchor)); } catch {}
                }}
                showCaptions={showCaptions}
                onShowCaptionsChange={(subs) => {
                  setShowCaptions(subs);
                  try { localStorage.setItem("cliprobin_show_captions", String(subs)); } catch {}
                }}
                captionStyle={captionStyle}
                onCaptionStyleChange={(st) => {
                  if (!isCaptionStyleAllowed(st)) {
                    openUpgradeModal("Pro Subtitle Styles");
                    return;
                  }
                  setCaptionStyle(st);
                  try { localStorage.setItem("cliprobin_caption_style", st); } catch {}
                }}
                captionAnimation={captionAnimation}
                onCaptionAnimationChange={(anim) => {
                  setCaptionAnimation(anim);
                  try {
                    if (anim) {
                      localStorage.setItem("cliprobin_caption_animation", anim);
                    } else {
                      localStorage.removeItem("cliprobin_caption_animation");
                    }
                  } catch {}
                }}
                showWatermark={isPro ? showWatermark : true}
                onShowWatermarkChange={(wm) => {
                  if (!wm && !isPro) {
                    openUpgradeModal("Watermark Removal");
                    return;
                  }
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
                isActivePlaying={activePlayingClipId === clip.id}
                onPlay={handleCardPlay}
                onOpenModal={handleOpenClipModal}
                showWatermark={appliedSettings?.showWatermark ?? effectiveShowWatermark}
                showSubtitles={appliedSettings?.showCaptions ?? showCaptions}
                defaultFaceTracking={(appliedSettings?.trackingMode ?? trackingMode) === "follow"}
                actionsDisabled={generating || isLoading || loadedProjectId !== projectId}
                onClipUpdated={handleClipUpdated}
              />
            ))}
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
  return <ProjectClipsContent key={projectId} projectId={projectId} />;
}

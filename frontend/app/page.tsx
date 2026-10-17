"use client";

import React, { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  downloadVideo,
  generateClips,
  getActiveJobs,
  getLatestClipGenerationJob,
  getLocalTranscriptionJob,
  getProjects,
  transcribeLocalVideo,
  transcribeVideo,
  Clip,
  Project,
  FramingMode,
  CaptionStyle,
} from "@/src/lib/api";
import { RecentProjectSkeletonItem } from "@/src/components/skeletons";
import {
  CAPTION_STYLE_OPTIONS,
} from "@/src/components/caption-style-picker";
import { ClipSettings, ClipDuration } from "@/src/components/clip-settings";
import { LiveMovingCaptions } from "@/src/components/live-moving-captions";
import { Badge } from "@/src/components/ui/badge";
import { StatusPill } from "@/src/components/ui/status-pill";
import { IconButton } from "@/src/components/ui/icon-button";

type VideoProcessingProgress = {
  kind: "transcription" | "generation" | "complete" | "failed";
  step: string;
  progress: number;
  projectId?: string;
};

type ActiveVideo =
  | { kind: "file"; file: File; name: string; size: number }
  | { kind: "downloaded"; projectId: string; fileName: string; name: string };

const isValidYouTubeUrl = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}(\S*)?$/i.test(
    trimmed,
  );
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<{
    step: string;
    progress: number;
    title?: string;
  } | null>(null);
  const [activeVideo, setActiveVideo] = useState<ActiveVideo | null>(null);
  const [clipDurationSeconds, setClipDurationSeconds] = useState<ClipDuration>(30);
  const [generationMode, setGenerationMode] = useState<"random" | "ai">("random");
  const [framingMode, setFramingMode] = useState<FramingMode>("standard");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("classic");
  const [showCaptions, setShowCaptions] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);
  const [transcriptionProgress, setTranscriptionProgress] =
    useState<VideoProcessingProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [generatedClips, setGeneratedClips] = useState<Clip[]>([]);
  const [generatedProjectId, setGeneratedProjectId] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptionProgressRef = useRef(transcriptionProgress);
  const generatingProjectsRef = useRef<Set<string>>(new Set());
  const clipDurationSecondsRef = useRef(clipDurationSeconds);
  const showCaptionsRef = useRef(showCaptions);
  const showWatermarkRef = useRef(showWatermark);
  const framingModeRef = useRef(framingMode);
  const captionStyleRef = useRef(captionStyle);

  useEffect(() => {
    transcriptionProgressRef.current = transcriptionProgress;
  }, [transcriptionProgress]);
  useEffect(() => {
    clipDurationSecondsRef.current = clipDurationSeconds;
  }, [clipDurationSeconds]);
  useEffect(() => {
    showCaptionsRef.current = showCaptions;
  }, [showCaptions]);
  useEffect(() => {
    showWatermarkRef.current = showWatermark;
  }, [showWatermark]);
  useEffect(() => {
    framingModeRef.current = framingMode;
  }, [framingMode]);
  useEffect(() => {
    captionStyleRef.current = captionStyle;
  }, [captionStyle]);

  // Manage video preview object URL
  useEffect(() => {
    if (activeVideo?.kind === "file") {
      const url = URL.createObjectURL(activeVideo.file);
      setVideoPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setVideoPreviewUrl(null);
  }, [activeVideo]);

  // Sync settings with localStorage on mount
  useEffect(() => {
    try {
      const savedFraming = localStorage.getItem("cliprobin_framing_mode");
      if (savedFraming && ["standard", "square_rounded", "true_9_16"].includes(savedFraming)) {
        setFramingMode(savedFraming as FramingMode);
      }
      const savedDuration = localStorage.getItem("cliprobin_clip_duration");
      if (savedDuration && [15, 30, 60, 90].includes(Number(savedDuration))) {
        setClipDurationSeconds(Number(savedDuration) as ClipDuration);
      }
      const savedMode = localStorage.getItem("cliprobin_generation_mode");
      if (savedMode && ["random", "ai"].includes(savedMode)) {
        setGenerationMode(savedMode as "random" | "ai");
      }
      const savedStyle = localStorage.getItem("cliprobin_caption_style");
      if (
        savedStyle &&
        ["classic", "robin", "clean", "punch", "pill", "karaoke", "bold_emerald", "clean_gold"].includes(
          savedStyle,
        )
      ) {
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

  const handleClipDurationChange = (seconds: ClipDuration) => {
    setClipDurationSeconds(seconds);
    try {
      localStorage.setItem("cliprobin_clip_duration", String(seconds));
    } catch {}
  };

  const handleGenerationModeChange = (mode: "random" | "ai") => {
    setGenerationMode(mode);
    try {
      localStorage.setItem("cliprobin_generation_mode", mode);
    } catch {}
  };

  const handleCaptionStyleChange = (styleId: CaptionStyle) => {
    setCaptionStyle(styleId);
    try {
      localStorage.setItem("cliprobin_caption_style", styleId);
    } catch {}
  };

  const isProcessingVideo = Boolean(
    transcriptionProgress && ["transcription", "generation"].includes(transcriptionProgress.kind),
  );
  const activeVideoJob = isProcessingVideo ? transcriptionProgress : null;
  const canStartOrRetry = Boolean(
    (!isProcessingVideo && activeVideo) ||
    (!isProcessingVideo && transcriptionProgress?.kind === "failed" && transcriptionProgress?.projectId)
  );

  const refreshProjectsList = async () => {
    try {
      const data = await getProjects();
      setRecentProjects(data.projects || []);
    } catch {
      // Ignore background errors
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    void refreshProjectsList();
  }, []);

  // Unified clip generation runner that guards against race conditions and concurrent calls
  const triggerClipGeneration = useCallback(async (projectId: string) => {
    if (generatingProjectsRef.current.has(projectId)) return;
    generatingProjectsRef.current.add(projectId);

    const dur = clipDurationSecondsRef.current;
    const subs = showCaptionsRef.current;
    const wm = showWatermarkRef.current;
    const fm = framingModeRef.current;
    const cs = captionStyleRef.current;

    setTranscriptionProgress({
      kind: "generation",
      step: "Clip generation started",
      progress: 0,
      projectId,
    });
    setDownloadStatus("Generating vertical clips with local AI...");

    try {
      const generation = await generateClips(
        projectId,
        subs,
        (stepJob) => {
          setTranscriptionProgress({
            kind: "generation",
            step: stepJob.step,
            progress: stepJob.progress,
            projectId,
          });
          if (stepJob.ready_clips && stepJob.ready_clips.length > 0) {
            setGeneratedClips(stepJob.ready_clips);
            setGeneratedProjectId(projectId);
          }
        },
        dur,
        wm,
        fm,
        cs,
      );

      if (generation.cancelled) {
        throw new Error("Clip generation was cancelled");
      }

      setGeneratedClips(generation.clips);
      setGeneratedProjectId(projectId);
      setTranscriptionProgress({
        kind: "complete",
        step: "Clip generation complete",
        progress: 100,
        projectId,
      });
      setDownloadStatus("Clips are ready.");
      void refreshProjectsList();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Clip generation failed";
      // If generation is already running on the backend, let active polling track it
      if (msg.includes("already running")) {
        return;
      }
      setDownloadStatus(msg);
      setTranscriptionProgress((current) =>
        current ? { ...current, kind: "failed", step: "Clip generation failed" } : null,
      );
    } finally {
      generatingProjectsRef.current.delete(projectId);
    }
  }, []);

  // Poll for background generation/transcription updates
  useEffect(() => {
    let isCurrent = true;
    let timeoutId: number | undefined;

    const restoreProgress = async () => {
      try {
        const current = transcriptionProgressRef.current;
        const activeJobs = await getActiveJobs().catch(() => []);
        if (!isCurrent) return;
        const job = activeJobs[0];
        if (job) {
          setTranscriptionProgress({
            kind: job.kind as "transcription" | "generation",
            step: job.step,
            progress:
              job.kind === "transcription" ? 25 + Math.round(job.progress * 0.75) : job.progress,
            projectId: job.project_id,
          });
          if (job.kind === "generation" && job.ready_clips && job.ready_clips.length > 0) {
            setGeneratedClips(job.ready_clips);
            setGeneratedProjectId(job.project_id);
          }
        } else if (current?.projectId && current.kind === "transcription") {
          const transcription = await getLocalTranscriptionJob(current.projectId).catch(() => null);
          if (!isCurrent) return;
          if (transcription?.status === "failed") {
            setTranscriptionProgress({
              ...current,
              kind: "failed",
              step: transcription.step || "Transcription failed",
            });
          } else if (transcription?.status === "completed") {
            const generation = await getLatestClipGenerationJob(current.projectId).catch(() => null);
            if (!isCurrent) return;
            if (generation) {
              if (generation.ready_clips && generation.ready_clips.length > 0) {
                setGeneratedClips(generation.ready_clips);
                setGeneratedProjectId(current.projectId);
              }
              if (generation.status === "completed") {
                setTranscriptionProgress({
                  kind: "complete",
                  step: "Clip generation complete",
                  progress: 100,
                  projectId: current.projectId,
                });
                void refreshProjectsList();
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
            } else {
              // Transcription finished and no generation job started yet: auto-trigger generation!
              void triggerClipGeneration(current.projectId);
            }
          } else if (transcription) {
            setTranscriptionProgress({
              ...current,
              step: transcription.step,
              progress: 25 + Math.round(transcription.progress * 0.75),
            });
          }
        } else if (current?.projectId && current.kind === "generation") {
          const generation = await getLatestClipGenerationJob(current.projectId).catch(() => null);
          if (!isCurrent) return;
          if (!generation) {
            // No generation job exists yet on backend: auto-trigger generation!
            void triggerClipGeneration(current.projectId);
            return;
          }
          if (generation.ready_clips && generation.ready_clips.length > 0) {
            setGeneratedClips(generation.ready_clips);
            setGeneratedProjectId(current.projectId);
          }
          if (generation.status === "completed") {
            setTranscriptionProgress({
              kind: "complete",
              step: "Clip generation complete",
              progress: 100,
              projectId: current.projectId,
            });
            void refreshProjectsList();
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
  }, [triggerClipGeneration]);

  // Shared pipeline to transcribe and generate clips for a downloaded project
  const runGenerationPipeline = async (projectId: string, videoLabel: string) => {
    setTranscriptionProgress({
      kind: "transcription",
      step: "Loading speech model",
      progress: 5,
      projectId,
    });

    try {
      const job = await transcribeVideo(projectId);
      setTranscriptionProgress({
        kind: "transcription",
        step: job.step || "Transcribing audio",
        progress: 25 + Math.round(job.progress * 0.75),
        projectId,
      });

      let currentJob = job;
      while (currentJob.status !== "completed" && currentJob.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        currentJob = await getLocalTranscriptionJob(projectId);
        setTranscriptionProgress({
          kind: "transcription",
          step: currentJob.step,
          progress: 25 + Math.round(currentJob.progress * 0.75),
          projectId,
        });
      }

      if (currentJob.status === "failed") {
        throw new Error(currentJob.error || "Audio transcription failed");
      }

      setDownloadStatus(`Transcribed ${videoLabel}. Generating clips...`);
      await triggerClipGeneration(projectId);
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "Video processing failed",
      );
      setTranscriptionProgress((current) =>
        current ? { ...current, kind: "failed", step: "Video processing failed" } : null,
      );
    }
  };

  const handleDownload = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!youtubeUrl.trim() || isDownloading || isProcessingVideo) return;
    if (!isValidYouTubeUrl(youtubeUrl)) {
      setDownloadStatus("Please enter a valid YouTube video or Shorts link.");
      return;
    }

    setIsDownloading(true);
    setDownloadStatus("Connecting to YouTube...");
    setDownloadProgress({ step: "Downloading video from YouTube", progress: 5 });

    try {
      const result = await downloadVideo(youtubeUrl, (job) => {
        setDownloadProgress({
          step: job.step,
          progress: job.progress,
          title: job.title,
        });
      });

      const videoLabel = result.title || result.file;
      setActiveVideo({
        kind: "downloaded",
        projectId: result.project_id,
        fileName: result.file,
        name: videoLabel,
      });
      setDownloadStatus(`Downloaded ${videoLabel}.`);
      setYoutubeUrl("");
      void refreshProjectsList();
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "Video download failed",
      );
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleStartGenerating = async () => {
    if (isProcessingVideo) return;
    if (!activeVideo) {
      if (transcriptionProgress?.projectId) {
        await triggerClipGeneration(transcriptionProgress.projectId);
      }
      return;
    }

    setTranscriptionProgress(null);
    setDownloadStatus("");

    if (activeVideo.kind === "downloaded") {
      await runGenerationPipeline(activeVideo.projectId, activeVideo.name);
      return;
    }

    // Local file upload & generation
    setDownloadStatus("Uploading video for local processing...");
    setTranscriptionProgress({
      kind: "transcription",
      step: "Uploading video",
      progress: 0,
    });

    try {
      const result = await transcribeLocalVideo(activeVideo.file, (uploadProgress) => {
        setTranscriptionProgress({
          kind: "transcription",
          step: "Uploading video",
          progress: Math.round(uploadProgress * 0.25),
        });
      });

      setTranscriptionProgress({
        kind: "transcription",
        step: "Speech model loading",
        progress: 25,
        projectId: result.project_id,
      });

      let currentJob = result;
      while (currentJob.status !== "completed" && currentJob.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        currentJob = await getLocalTranscriptionJob(result.project_id);
        setTranscriptionProgress({
          kind: "transcription",
          step: currentJob.step,
          progress: 25 + Math.round(currentJob.progress * 0.75),
          projectId: result.project_id,
        });
      }

      if (currentJob.status === "failed") {
        throw new Error(currentJob.error || "Audio transcription failed");
      }

      await triggerClipGeneration(result.project_id);
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "Local video processing failed",
      );
      setTranscriptionProgress((current) =>
        current ? { ...current, kind: "failed", step: "Video processing failed" } : null,
      );
    }
  };

  const isVideoFile = (file: File) => {
    if (file.type.startsWith("video/")) return true;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return ["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(extension);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const video = event.target.files?.[0];
    event.target.value = "";
    if (video) {
      if (!isVideoFile(video)) {
        setActiveVideo(null);
        setDownloadStatus("Please choose a valid video file (MP4, MOV, MKV, WebM, AVI).");
        return;
      }
      setActiveVideo({
        kind: "file",
        file: video,
        name: video.name,
        size: video.size,
      });
      setDownloadStatus("");
      setTranscriptionProgress(null);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isProcessingVideo) return;
    const video = event.dataTransfer.files[0];
    if (video) {
      if (!isVideoFile(video)) {
        setActiveVideo(null);
        setDownloadStatus("Please drop a valid video file (MP4, MOV, MKV, WebM, AVI).");
        return;
      }
      setActiveVideo({
        kind: "file",
        file: video,
        name: video.name,
        size: video.size,
      });
      setDownloadStatus("");
      setTranscriptionProgress(null);
    }
  };

  const activeStyleName =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === captionStyle)?.name || "Classic";

  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] px-6 lg:px-10 py-6 lg:py-8">
      <div className="mx-auto max-w-[1560px] space-y-8">
        {/* Header */}
        <header className="border-b border-zinc-800/80 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Dashboard
              </h1>
              <p className="mt-1 text-[13px] text-zinc-400">
                Turn long videos into engaging, vertical short clips with local AI.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="emerald" size="md">Local Engine Ready</Badge>
            </div>
          </div>
        </header>

        {/* 2-Column Responsive Layout: Left Inputs + Right Sticky Live Preview Aside */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] gap-8 items-start">
          {/* Left Column: 1. Add video & 2. Clip settings */}
          <div className="space-y-6 min-w-0">
            {/* Step 1: Add a video */}
            <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                    1
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-white">Add a video</h2>
                    <p className="text-xs text-zinc-400">Select a local video file or download from YouTube</p>
                  </div>
                </div>
              </div>

              {/* Collapsed File Card when Video is chosen */}
              {activeVideo ? (
                <div className="rounded-xl border border-zinc-700/80 bg-[#0c0c0e] p-4 transition-all duration-150">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[#10b981]">
                        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" fillOpacity=".2" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate max-w-md" title={activeVideo.name}>
                          {activeVideo.name}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                          <span>
                            {activeVideo.kind === "downloaded"
                              ? `YouTube Project ${activeVideo.projectId}`
                              : formatFileSize(activeVideo.size)}
                          </span>
                          <span>•</span>
                          <span className="text-emerald-400 font-medium">Ready for generation</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isProcessingVideo}
                        onClick={() => {
                          if (fileInputRef.current) fileInputRef.current.click();
                        }}
                        className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-xs font-medium text-zinc-200 hover:text-white hover:bg-zinc-700 transition-colors focus-ring"
                      >
                        Replace
                      </button>
                      <IconButton
                        label="Remove video"
                        tooltip="Remove video"
                        variant="ghost"
                        size="sm"
                        disabled={isProcessingVideo}
                        onClick={() => {
                          setActiveVideo(null);
                          setDownloadStatus("");
                        }}
                        icon={
                          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* YouTube URL input */}
                  <div>
                    <label htmlFor="youtube-url-input" className="block text-xs font-medium text-zinc-400 mb-1.5">
                      YouTube URL
                    </label>
                    <div className="flex gap-2.5">
                      <input
                        id="youtube-url-input"
                        type="url"
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleDownload();
                          }
                        }}
                        placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                        disabled={isDownloading || isProcessingVideo}
                        className="flex-1 rounded-xl border border-zinc-800 bg-[#0c0c0e] px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus-ring disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={handleDownload}
                        disabled={!youtubeUrl.trim() || !isValidYouTubeUrl(youtubeUrl) || isDownloading || isProcessingVideo}
                        className="shrink-0 px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/90 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 hover:text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus-ring"
                      >
                        {isDownloading ? (
                          <span className="flex items-center gap-2">
                            <svg className="size-4 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity=".2" />
                              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                            Downloading...
                          </span>
                        ) : (
                          "Download video"
                        )}
                      </button>
                    </div>

                    {/* Inline Validation / Feedback */}
                    <div className="mt-2 text-xs">
                      {youtubeUrl.trim() && !isValidYouTubeUrl(youtubeUrl) ? (
                        <p className="text-amber-400/90 flex items-center gap-1.5">
                          <span>⚠️</span> Enter a valid YouTube video or Shorts link (e.g. https://www.youtube.com/watch?v=...)
                        </p>
                      ) : youtubeUrl.trim() && isValidYouTubeUrl(youtubeUrl) ? (
                        <p className="text-emerald-400 flex items-center gap-1.5">
                          <span>✓</span> Valid YouTube link ready for download
                        </p>
                      ) : (
                        <p className="text-zinc-400">
                          Paste any YouTube video or Shorts URL to import directly.
                        </p>
                      )}
                    </div>

                    {/* Live Download Progress Bar */}
                    {isDownloading && downloadProgress && (
                      <div
                        role="status"
                        aria-live="polite"
                        className="mt-3.5 rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5 space-y-2.5 animate-in fade-in-0 duration-150"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <svg className="size-4 animate-spin text-[#10b981] shrink-0" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity=".25" />
                              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                            <span className="font-semibold text-white truncate">
                              {downloadProgress.title || "Downloading video from YouTube..."}
                            </span>
                          </div>
                          <span className="font-mono font-medium text-emerald-400 shrink-0">
                            {Math.round(downloadProgress.progress)}%
                          </span>
                        </div>

                        <div
                          role="progressbar"
                          aria-label="YouTube video download progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(downloadProgress.progress)}
                          className="h-2 w-full overflow-hidden rounded-full bg-zinc-800"
                        >
                          <div
                            className="h-full rounded-full bg-[#10b981] transition-[width] duration-200 ease-out"
                            style={{ width: `${Math.max(4, Math.round(downloadProgress.progress))}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-zinc-400">
                          <span className="truncate">{downloadProgress.step}</span>
                          <span className="font-mono text-zinc-500 shrink-0">yt-dlp engine</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* "or" divider */}
                  <div className="relative my-4 flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-zinc-800" />
                    </div>
                    <span className="relative bg-[#121215] px-3 text-xs uppercase tracking-wider text-zinc-500 font-medium">
                      or
                    </span>
                  </div>

                  {/* Drag & Drop File Zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!isProcessingVideo) setIsDragging(true);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (!isProcessingVideo) setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => {
                      if (!isProcessingVideo) fileInputRef.current?.click();
                    }}
                    className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all duration-150 ${
                      isDragging
                        ? "border-[#10b981] bg-[#10b981]/5 text-emerald-400"
                        : "border-zinc-800 bg-[#0c0c0e]/60 hover:border-zinc-700 hover:bg-[#0c0c0e]"
                    } ${isProcessingVideo ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*,.mkv,.avi,.webm"
                      onChange={handleFileChange}
                      disabled={isProcessingVideo}
                      className="hidden"
                    />

                    <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 group-hover:text-emerald-400 group-hover:border-emerald-500/30 transition-all duration-150">
                      <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                      </svg>
                    </div>

                    <p className="text-sm font-semibold text-zinc-200">
                      Drag &amp; drop a video or <span className="text-[#10b981] underline underline-offset-4">browse files</span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      MP4, MOV, MKV, or WebM up to 4GB
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* Step 2: Clip settings */}
            <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150 space-y-6">
              <div className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                  2
                </span>
                <div>
                  <h2 className="text-base font-semibold text-white">Clip settings</h2>
                  <p className="text-xs text-zinc-400">Customize framing, caption style, and clip durations</p>
                </div>
              </div>

              {/* Single Source of Truth ClipSettings */}
              <ClipSettings
                variant="full"
                generationMode={generationMode}
                onGenerationModeChange={handleGenerationModeChange}
                clipDurationSeconds={clipDurationSeconds}
                onClipDurationChange={handleClipDurationChange}
                framingMode={framingMode}
                onFramingModeChange={handleFramingModeChange}
                showCaptions={showCaptions}
                onShowCaptionsChange={setShowCaptions}
                captionStyle={captionStyle}
                onCaptionStyleChange={handleCaptionStyleChange}
                showWatermark={showWatermark}
                onShowWatermarkChange={setShowWatermark}
                disabled={isProcessingVideo}
              />
            </section>

            {/* Active Processing Card (Progress / Failed) */}
            {transcriptionProgress && (
              <section
                aria-live="polite"
                className={`rounded-2xl border p-6 shadow-sm space-y-4 transition-all duration-150 ${
                  transcriptionProgress.kind === "failed"
                    ? "border-red-500/30 bg-red-950/15"
                    : "border-zinc-800 bg-[#121215]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className={`text-sm font-semibold ${
                      transcriptionProgress.kind === "failed" ? "text-red-300" : "text-white"
                    }`}>
                      {transcriptionProgress.step}
                    </h3>
                    {transcriptionProgress.projectId && (
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Project ID: <span className="font-mono text-zinc-300">{transcriptionProgress.projectId}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {transcriptionProgress.kind === "failed" ? (
                      <button
                        type="button"
                        onClick={() => {
                          generatingProjectsRef.current.clear();
                          setTranscriptionProgress(null);
                          setDownloadStatus("");
                        }}
                        className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20 transition-colors"
                      >
                        Dismiss &amp; Reset
                      </button>
                    ) : (
                      <span className="text-sm font-mono font-medium text-emerald-400">
                        {transcriptionProgress.progress}%
                      </span>
                    )}
                  </div>
                </div>

                {transcriptionProgress.kind === "failed" ? (
                  <div className="space-y-3 pt-1">
                    {downloadStatus && downloadStatus !== transcriptionProgress.step && (
                      <p className="text-xs text-red-300/80 bg-black/40 rounded-lg p-2.5 font-mono break-words border border-red-500/20">
                        {downloadStatus}
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-1 text-xs text-zinc-400">
                      <span>Click &quot;Dismiss &amp; Reset&quot; or press &quot;Generate Clips&quot; to retry.</span>
                      {transcriptionProgress.projectId && (
                        <Link
                          href={`/clips?project=${encodeURIComponent(transcriptionProgress.projectId)}`}
                          className="text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
                        >
                          Open in Clips Studio &rarr;
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Progress Bar */}
                    <div
                      role="progressbar"
                      aria-label="Video processing progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={transcriptionProgress.progress}
                      className="h-2 w-full overflow-hidden rounded-full bg-zinc-800"
                    >
                      <div
                        className="h-full rounded-full bg-[#10b981] transition-[width] duration-300 ease-out"
                        style={{ width: `${transcriptionProgress.progress}%` }}
                      />
                    </div>

                    {/* Steps Checklist */}
                    <ol className="grid gap-2 sm:grid-cols-2 pt-2 border-t border-zinc-800">
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
                            className={`flex items-center gap-2 text-xs transition-colors duration-150 ${
                              activeStep
                                ? "text-emerald-400 font-medium"
                                : done
                                ? "text-zinc-300"
                                : "text-zinc-500"
                            }`}
                          >
                            <span className={`flex size-4 items-center justify-center rounded-full text-[10px] ${
                              done ? "bg-[#10b981]/15 text-[#10b981]" : activeStep ? "bg-emerald-400/20 text-emerald-300 font-bold" : "text-zinc-600"
                            }`}>
                              {done ? "✓" : activeStep ? "●" : "○"}
                            </span>
                            <span>{step}</span>
                          </li>
                        );
                      })}
                    </ol>

                    {["generation", "complete"].includes(transcriptionProgress.kind) && transcriptionProgress.projectId && (
                      <div className="pt-2">
                        <Link
                          href={`/clips?project=${encodeURIComponent(transcriptionProgress.projectId)}`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
                        >
                          View clips in Project {transcriptionProgress.projectId} &rarr;
                        </Link>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {/* Generated clips preview section if ready */}
            {generatedClips.length > 0 && (
              <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-[#10b981]/15 text-[10px] text-[#10b981]">✓</span>
                    <h3 className="text-sm font-semibold text-white">
                      Generated Clips ({generatedClips.length})
                    </h3>
                  </div>
                  {generatedProjectId && (
                    <Link
                      href={`/clips?project=${encodeURIComponent(generatedProjectId)}`}
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
                    >
                      View all in Clips Studio &rarr;
                    </Link>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {generatedClips.slice(0, 4).map((clip) => (
                    <div
                      key={clip.id}
                      className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3 transition-all duration-150 hover:border-zinc-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-white truncate">
                          {clip.id}
                        </span>
                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                          {clip.duration.toFixed(1)}s
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-zinc-300 line-clamp-2" title={clip.title}>
                        {clip.title}
                      </p>
                      <div className="mt-2.5 flex items-center justify-between border-t border-zinc-800/80 pt-2 text-[11px]">
                        <span className="text-zinc-400 font-mono">
                          {Math.floor(clip.start / 60)}:{String(Math.floor(clip.start % 60)).padStart(2, "0")} - {Math.floor(clip.end / 60)}:{String(Math.floor(clip.end % 60)).padStart(2, "0")}
                        </span>
                        {generatedProjectId && (
                          <Link
                            href={`/clips?project=${encodeURIComponent(generatedProjectId)}`}
                            className="text-[#10b981] hover:underline"
                          >
                            Watch clip &rarr;
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Right Column: Sticky Aside with Live 9:16 Preview, Summary Chips & Primary CTA */}
          <aside className="sticky top-6 space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white">Live 9:16 Output Preview</span>
                <Badge variant="emerald" size="sm">Real-time</Badge>
              </div>

              {/* 9:16 Phone Mockup Container */}
              <div className="relative mx-auto aspect-[9/16] w-full max-w-[240px] rounded-2xl border-2 border-zinc-700/80 bg-[#0a0a0c] overflow-hidden shadow-2xl flex flex-col items-center justify-center p-1.5">
                {/* Phone Speaker Notch */}
                <div className="absolute top-2.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-zinc-700/80 z-20" />

                {/* Video / Graphic Area */}
                <div className="relative size-full rounded-xl overflow-hidden bg-black flex items-center justify-center">
                  {/* Dynamic Layout Representation */}
                  {framingMode === "true_9_16" ? (
                    // Full bleed True 9:16
                    videoPreviewUrl ? (
                      <video
                        src={videoPreviewUrl}
                        muted
                        autoPlay
                        loop
                        playsInline
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="size-full bg-gradient-to-b from-indigo-950/60 via-zinc-900 to-black flex items-center justify-center relative">
                        <div className="relative flex flex-col items-center">
                          <div className="size-16 rounded-full border border-dashed border-emerald-400/90 bg-emerald-500/15 flex items-center justify-center">
                            <svg className="size-8 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                            </svg>
                          </div>
                          <span className="mt-1 text-[9px] font-mono font-bold text-emerald-400">SPEAKER TRACKING</span>
                        </div>
                      </div>
                    )
                  ) : framingMode === "square_rounded" ? (
                    // 1:1 Rounded Square Card (660/720 ≈ 91.7% width, centered vertically matching FFmpeg output)
                    <div className="size-full bg-black flex items-center justify-center p-2.5">
                      <div className="w-full aspect-square rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-md relative flex items-center justify-center">
                        {videoPreviewUrl ? (
                          <video
                            src={videoPreviewUrl}
                            muted
                            autoPlay
                            loop
                            playsInline
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center text-center p-2">
                            <span className="text-xs font-semibold text-zinc-200">1:1 Square</span>
                            <span className="text-[9px] text-zinc-400">TikTok &amp; Reels</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // 16:9 Rounded Card
                    <div className="size-full bg-black flex items-center justify-center p-2.5">
                      <div className="w-full aspect-video rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-md relative flex items-center justify-center">
                        {videoPreviewUrl ? (
                          <video
                            src={videoPreviewUrl}
                            muted
                            autoPlay
                            loop
                            playsInline
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center text-center p-1.5">
                            <span className="text-xs font-semibold text-zinc-200">16:9 Card</span>
                            <span className="text-[9px] text-zinc-400">Rounded Corners</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Watermark Overlay Preview (Top-right corner with platform safe-space margins) */}
                  {showWatermark && (
                    <div className="absolute top-3.5 right-3.5 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 border border-white/10 backdrop-blur-xs shadow-sm">
                      <span className="size-2 rounded-full bg-emerald-400" />
                      <span className="text-[8px] font-semibold text-white tracking-tight">Clip Robin</span>
                    </div>
                  )}

                  {/* Live Moving Captions Overlay */}
                  {showCaptions && (
                    <div className="absolute bottom-6 inset-x-2 z-20 text-center pointer-events-none">
                      <LiveMovingCaptions captionStyle={captionStyle} />
                    </div>
                  )}
                </div>
              </div>

              {/* Summary Chips */}
              <div className="pt-2 border-t border-zinc-800 space-y-2">
                <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block">
                  Configured options
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="neutral">
                    {framingMode === "true_9_16"
                      ? "True 9:16 (AI)"
                      : framingMode === "square_rounded"
                      ? "1:1 Rounded"
                      : "16:9 Rounded"}
                  </Badge>
                  <Badge variant="neutral">{clipDurationSeconds}s length</Badge>
                  <Badge variant={showCaptions ? "emerald" : "neutral"}>
                    {showCaptions ? `${activeStyleName} captions` : "No captions"}
                  </Badge>
                  <Badge variant={showWatermark ? "neutral" : "neutral"}>
                    {showWatermark ? "Watermark on" : "No watermark"}
                  </Badge>
                </div>
              </div>

              {/* Primary Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void handleStartGenerating()}
                  disabled={!canStartOrRetry}
                  className="w-full min-h-[44px] rounded-xl bg-[#10b981] px-5 py-3 text-[13px] font-bold text-zinc-950 transition-all duration-150 hover:bg-[#059669] hover:shadow-lg hover:shadow-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#10b981] disabled:hover:shadow-none focus-ring flex items-center justify-center gap-2"
                >
                  {activeVideoJob?.kind === "transcription" ? (
                    <span className="flex items-center gap-2">
                      <svg className="size-4 animate-spin text-zinc-950" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity=".25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Transcribing audio...
                    </span>
                  ) : activeVideoJob?.kind === "generation" ? (
                    <span className="flex items-center gap-2">
                      <svg className="size-4 animate-spin text-zinc-950" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity=".25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Rendering clips ({transcriptionProgress?.progress ?? 0}%)...
                    </span>
                  ) : transcriptionProgress?.kind === "failed" && transcriptionProgress?.projectId ? (
                    <>
                      <svg className="size-4 fill-current" viewBox="0 0 24 24">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>Retry Clip Generation</span>
                    </>
                  ) : (
                    <>
                      <svg className="size-4 fill-current" viewBox="0 0 24 24">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>Generate Clips</span>
                    </>
                  )}
                </button>

                {!activeVideo && !transcriptionProgress?.projectId && (
                  <p className="mt-2 text-center text-xs text-zinc-500">
                    Select a local file or YouTube link to start.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>

        {/* Wide Lower Section: Recent Projects & Engine Guarantee Card */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4 border-t border-zinc-800/80">
          {/* Recent Projects List (Span 2 cols) */}
          <section className="lg:col-span-2 rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Recent projects</h2>
                <p className="text-xs text-zinc-400">Your recent video clip generation runs</p>
              </div>
              <Link
                href="/projects"
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
              >
                View all projects &rarr;
              </Link>
            </div>

            {isLoadingProjects ? (
              <ul className="space-y-2.5">
                <RecentProjectSkeletonItem />
                <RecentProjectSkeletonItem />
                <RecentProjectSkeletonItem />
              </ul>
            ) : recentProjects.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-400 space-y-1.5">
                <p className="font-medium text-zinc-300 text-sm">No projects created yet</p>
                <p className="text-xs text-zinc-500">
                  Import a video above to generate your first vertical clips.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recentProjects.slice(0, 4).map((project) => (
                  <div
                    key={project.project_id}
                    className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-[#0c0c0e] p-4 transition-all duration-150 hover:border-zinc-700 hover:bg-[#101014]"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white font-mono text-xs">
                          {project.project_id}
                        </span>
                        <StatusPill status={project.status} />
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {project.source_type} • {project.clips} {project.clips === 1 ? "clip" : "clips"}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                      <Link
                        href={`/clips?project=${encodeURIComponent(project.project_id)}`}
                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                      >
                        {project.clips > 0 ? "View clips →" : "Generate →"}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Local Processing Engine Card */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center gap-2.5 mb-2 text-zinc-200">
                <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[#10b981]">
                  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-white">
                  Local-First Engine
                </h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed mt-2">
                Clip Robin executes speech transcription, framing, and subtitle burn-in locally on your machine via faster-whisper and FFmpeg. Your media stays completely private and never leaves your computer.
              </p>
            </div>

            <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
              <span className="text-xs text-zinc-500">Processing Mode</span>
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <span className="size-2 rounded-full bg-[#10b981] animate-pulse" />
                <span>100% Offline Capable</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

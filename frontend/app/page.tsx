"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import {
  ActiveJob,
  CaptionAnimation,
  CaptionStyle,
  Clip,
  downloadVideo,
  FramingMode,
  generateClips,
  getActiveJobs,
  getLatestClipGenerationJob,
  getLocalTranscriptionJob,
  getProjects,
  LocalTranscriptionJob,
  Project,
  transcribeLocalVideo,
  transcribeVideo,
} from "@/src/lib/api";
import { RecentProjectSkeletonItem } from "@/src/components/skeletons";

const CAPTION_STYLES_CONFIG = [
  {
    id: "clean" as CaptionStyle,
    name: "Clean",
    font: "Montserrat Bold",
    description: "Minimalist typography with soft shadow",
    defaultAnimation: "fade" as CaptionAnimation,
    allowedAnimations: ["pop", "grow", "sweep", "fade", "glide"] as CaptionAnimation[],
  },
  {
    id: "punch" as CaptionStyle,
    name: "Punch",
    font: "Anton",
    description: "Bold impact all-caps with golden accent pop",
    defaultAnimation: "pop" as CaptionAnimation,
    allowedAnimations: ["pop", "grow", "sweep", "fade", "glide"] as CaptionAnimation[],
  },
  {
    id: "robin" as CaptionStyle,
    name: "Robin",
    font: "Montserrat Black",
    description: "Signature viral all-caps with emerald highlight",
    badge: "DEFAULT",
    defaultAnimation: "grow" as CaptionAnimation,
    allowedAnimations: ["pop", "grow", "sweep", "fade", "glide"] as CaptionAnimation[],
  },
  {
    id: "pill" as CaptionStyle,
    name: "Pill",
    font: "Poppins Bold",
    description: "Translucent dark box with active pop",
    defaultAnimation: "pop" as CaptionAnimation,
    allowedAnimations: ["pop", "grow", "sweep", "fade", "glide"] as CaptionAnimation[],
  },
  {
    id: "karaoke" as CaptionStyle,
    name: "Karaoke",
    font: "Montserrat Bold",
    description: "Phrase sweep fill across words",
    defaultAnimation: "sweep" as CaptionAnimation,
    allowedAnimations: ["pop", "grow", "sweep", "fade", "glide"] as CaptionAnimation[],
  },
];

const ANIMATION_CHIPS: { id: CaptionAnimation; name: string; description: string }[] = [
  { id: "pop", name: "Pop", description: "Bouncy active word entry" },
  { id: "grow", name: "Grow", description: "Smooth scale and accent highlight" },
  { id: "sweep", name: "Sweep", description: "Karaoke sweep across the phrase" },
  { id: "fade", name: "Fade", description: "Subtle clean fade in" },
  { id: "glide", name: "Glide", description: "Smooth upward rise and fade" },
];

type VideoProcessingProgress = {
  kind: "transcription" | "generation" | "complete" | "failed";
  step: string;
  progress: number;
  projectId?: string;
};

type ActiveVideo =
  | { kind: "file"; file: File; name: string; size: number }
  | { kind: "downloaded"; projectId: string; fileName: string; name: string };

const CLIP_DURATIONS = [15, 30, 60, 90] as const;

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<{ step: string; progress: number; title?: string } | null>(null);
  const [activeVideo, setActiveVideo] = useState<ActiveVideo | null>(null);
  const [clipDurationSeconds, setClipDurationSeconds] = useState<15 | 30 | 60 | 90>(30);
  const [generationMode, setGenerationMode] = useState<"random" | "ai">("random");
  const [framingMode, setFramingMode] = useState<FramingMode>("standard");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("robin");
  const [captionAnimation, setCaptionAnimation] = useState<CaptionAnimation>("grow");

  useEffect(() => {
    try {
      const savedFraming = localStorage.getItem("cliprobin_framing_mode");
      if (savedFraming && ["standard", "square_rounded", "true_9_16"].includes(savedFraming)) {
        setFramingMode(savedFraming as FramingMode);
      }
      const savedStyle = localStorage.getItem("cliprobin_caption_style");
      if (savedStyle && ["clean", "punch", "robin", "pill", "karaoke", "classic", "bold_emerald", "clean_gold"].includes(savedStyle)) {
        setCaptionStyle(savedStyle as CaptionStyle);
      } else {
        const stored = localStorage.getItem("cliprobin.settings");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.defaultCaptionStyle) setCaptionStyle(parsed.defaultCaptionStyle);
          if (parsed.defaultCaptionAnimation) setCaptionAnimation(parsed.defaultCaptionAnimation);
        }
      }
      const savedAnim = localStorage.getItem("cliprobin_caption_animation");
      if (savedAnim && ["pop", "grow", "sweep", "fade", "glide"].includes(savedAnim)) {
        setCaptionAnimation(savedAnim as CaptionAnimation);
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
    const found = CAPTION_STYLES_CONFIG.find((s) => s.id === styleId);
    if (found && !found.allowedAnimations.includes(captionAnimation)) {
      setCaptionAnimation(found.defaultAnimation);
      try {
        localStorage.setItem("cliprobin_caption_animation", found.defaultAnimation);
      } catch {}
    }
  };

  const handleCaptionAnimationChange = (animId: CaptionAnimation) => {
    setCaptionAnimation(animId);
    try {
      localStorage.setItem("cliprobin_caption_animation", animId);
    } catch {}
  };
  const [showCaptions, setShowCaptions] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);
  const [transcriptionProgress, setTranscriptionProgress] = useState<VideoProcessingProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [generatedClips, setGeneratedClips] = useState<Clip[]>([]);
  const [generatedProjectId, setGeneratedProjectId] = useState<string | null>(null);

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

  // Poll active jobs
  useEffect(() => {
    let isCurrent = true;
    let timeoutId: number | undefined;

    const restoreProgress = async () => {
      try {
        const jobs: ActiveJob[] = await getActiveJobs();
        if (isCurrent) {
          // Check for download jobs
          const downloadJob = jobs.find((activeJob) => activeJob.kind === "download");
          if (downloadJob) {
            setIsDownloading(true);
            setDownloadProgress({
              step: downloadJob.step,
              progress: downloadJob.progress,
              title: downloadJob.title,
            });
          }

          const current = transcriptionProgressRef.current;
          const job = jobs.find((activeJob): activeJob is ActiveJob & { kind: "transcription" | "generation" } =>
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
            if (job.kind === "generation" && job.ready_clips && job.ready_clips.length > 0) {
              setGeneratedClips(job.ready_clips);
              setGeneratedProjectId(job.project_id);
            }
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

  // Shared pipeline to transcribe and generate clips for a project
  const runGenerationPipeline = async (projectId: string, videoLabel: string) => {
    setTranscriptionProgress({
      kind: "transcription",
      step: "Loading speech model",
      progress: 5,
      projectId,
    });

    try {
      // 1. Start transcription for the project
      const job = await transcribeVideo(projectId);
      setTranscriptionProgress({
        kind: "transcription",
        step: job.step || "Transcribing audio",
        progress: 25 + Math.round((job.progress || 0) * 0.75),
        projectId,
      });

      let completedJob: LocalTranscriptionJob = job;
      while (completedJob.status !== "completed" && completedJob.status !== "failed") {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        completedJob = await getLocalTranscriptionJob(projectId);
        setTranscriptionProgress({
          kind: "transcription",
          step: completedJob.step,
          progress: 25 + Math.round(completedJob.progress * 0.75),
          projectId,
        });
      }

      if (completedJob.status === "failed") {
        throw new Error(completedJob.error ?? "Video transcription failed");
      }

      // 2. Start clip generation
      setTranscriptionProgress({
        kind: "generation",
        step: "Clip generation started",
        progress: 0,
        projectId,
      });
      setDownloadStatus(`Transcribed ${videoLabel}. Generating ${clipDurationSeconds}s clips...`);

      const generation = await generateClips(
        projectId,
        showCaptions,
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
        clipDurationSeconds,
        showWatermark,
        framingMode,
        captionStyle,
        captionAnimation,
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
      setDownloadStatus(
        error instanceof Error ? error.message : "Clip generation failed",
      );
      setTranscriptionProgress((current) =>
        current ? { ...current, kind: "failed", step: "Video processing failed" } : null,
      );
    }
  };

  // Download YouTube video -> display in drop/browse section -> automatically start generating clips!
  const handleDownload = async () => {
    const trimmedUrl = youtubeUrl.trim();
    if (!trimmedUrl || isDownloading || isProcessingVideo) return;
    setIsDownloading(true);
    setDownloadProgress({ step: "Extracting video info...", progress: 5.0 });
    setDownloadStatus("Downloading video from YouTube...");

    try {
      const result = await downloadVideo(trimmedUrl, (job) => {
        setDownloadProgress({
          step: job.step,
          progress: job.progress,
          title: job.title,
        });
        setDownloadStatus(job.step);
      });
      const videoTitle = result.title || result.file || "YouTube video";
      setIsDownloading(false);
      setDownloadProgress(null);

      // 1. Show the downloaded video in the local browse / drop section
      setActiveVideo({
        kind: "downloaded",
        name: videoTitle,
        projectId: result.project_id,
        fileName: result.file,
      });
      setYoutubeUrl(""); // Clear URL input
      setDownloadStatus(`Downloaded "${videoTitle}". Starting transcription & clip generation...`);
      void refreshProjectsList();

      // 2. Automatically start generating clips!
      await runGenerationPipeline(result.project_id, videoTitle);
    } catch (error) {
      setIsDownloading(false);
      setDownloadProgress(null);
      setDownloadStatus(
        error instanceof Error ? error.message : "Video download failed",
      );
    }
  };

  // Handle local video generation flow
  const handleStartGenerating = async () => {
    if (!activeVideo || isProcessingVideo) return;

    if (activeVideo.kind === "downloaded") {
      // Re-run pipeline for downloaded video
      await runGenerationPipeline(activeVideo.projectId, activeVideo.name);
      return;
    }

    // Local file upload flow
    const file = activeVideo.file;
    setDownloadStatus("");
    setTranscriptionProgress({
      kind: "transcription",
      step: "Uploading video",
      progress: 0,
    });

    try {
      const job = await transcribeLocalVideo(file, (progress) => {
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
        (stepJob) => {
          setTranscriptionProgress({
            kind: "generation",
            step: stepJob.step,
            progress: stepJob.progress,
            projectId: result.project_id,
          });
          if (stepJob.ready_clips && stepJob.ready_clips.length > 0) {
            setGeneratedClips(stepJob.ready_clips);
            setGeneratedProjectId(result.project_id);
          }
        },
        clipDurationSeconds,
        showWatermark,
        framingMode,
        captionStyle,
        captionAnimation,
      );

      if (generation.cancelled) {
        throw new Error("Clip generation was cancelled");
      }

      setGeneratedClips(generation.clips);
      setGeneratedProjectId(result.project_id);
      setTranscriptionProgress({
        kind: "complete",
        step: "Clip generation complete",
        progress: 100,
        projectId: result.project_id,
      });
      setDownloadStatus("Clips are ready.");
      void refreshProjectsList();
    } catch (error) {
      setDownloadStatus(
        error instanceof Error
          ? error.message
          : "Local video processing failed",
      );
      setTranscriptionProgress((current) => current
        ? { ...current, kind: "failed", step: "Video processing failed" }
        : null);
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

  return (
    <main className="min-h-screen bg-[#0a0a0a] p-6 lg:p-10">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Turn long videos into engaging, vertical short clips with local AI.
          </p>
        </header>

        {/* Layout Grid: Centered max-w-[720px] main column + Recent Projects on right */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,720px)_340px] gap-8 items-start">
          {/* Main Column (Max-width ~720px) */}
          <div className="w-full max-w-[720px] space-y-6">
            {/* Card 1: 1. Add a video */}
            <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm transition-all duration-150">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-6 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
                    1
                  </span>
                  <h2 className="text-base font-semibold text-white">Add a video</h2>
                </div>
                <span className="text-xs text-zinc-400 font-medium">YouTube or local file</span>
              </div>

              {/* YouTube URL input with inline Download video button */}
              <div className="space-y-2">
                <label htmlFor="youtube-url-input" className="block text-xs font-medium text-zinc-400">
                  YouTube URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="youtube-url-input"
                    type="url"
                    value={youtubeUrl}
                    onChange={(event) => setYoutubeUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleDownload();
                      }
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    disabled={isDownloading || isProcessingVideo}
                    className="flex-1 rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 transition-all duration-150 focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!youtubeUrl.trim() || isDownloading || isProcessingVideo}
                    className="inline-flex shrink-0 items-center justify-center rounded-[10px] border border-[#232326] bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-200 transition-all duration-150 hover:border-zinc-700 hover:bg-[#18181b] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-[#232326] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
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

                {/* Subtle helper text */}
                {youtubeUrl.trim() ? (
                  <p className="text-[12px] text-zinc-400 truncate">
                    Ready to download: <span className="text-zinc-300 font-mono">{youtubeUrl}</span>
                  </p>
                ) : (
                  <p className="text-[12px] text-zinc-400">
                    Paste any YouTube video or Shorts URL to download.
                  </p>
                )}

                {/* Live Download Progress Bar */}
                {isDownloading && downloadProgress && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mt-3 rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3.5 transition-all duration-150 space-y-2.5"
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

                    {/* Progress Bar */}
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
                      <span className="font-mono text-zinc-500 shrink-0">YouTube Download</span>
                    </div>
                  </div>
                )}
              </div>

              {/* "or" divider */}
              <div className="relative my-6 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#232326]" />
                </div>
                <span className="relative bg-[#111113] px-3 text-xs uppercase tracking-wider text-zinc-400 font-medium">
                  or
                </span>
              </div>

              {/* Dropzone / Active Video Section */}
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!isProcessingVideo) setIsDragging(true);
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!isProcessingVideo) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => {
                  if (!isProcessingVideo && !activeVideo) fileInputRef.current?.click();
                }}
                className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-[12px] border-2 border-dashed p-8 text-center transition-all duration-150 ${
                  isDragging
                    ? "border-[#10b981] bg-[#10b981]/5 text-emerald-400"
                    : activeVideo
                    ? "border-[#232326] bg-[#0a0a0a]/70 hover:border-zinc-700"
                    : "border-[#232326] bg-[#0a0a0a]/40 hover:border-zinc-700 hover:bg-[#0a0a0a]/70"
                } ${isProcessingVideo ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,.mkv,.avi,.webm"
                  onChange={handleFileChange}
                  disabled={isProcessingVideo}
                  className="hidden"
                />

                {/* Upload icon */}
                <div
                  className={`mb-3 flex size-12 items-center justify-center rounded-full transition-all duration-150 ${
                    isDragging
                      ? "bg-[#10b981]/15 text-[#10b981]"
                      : activeVideo
                      ? "bg-[#10b981]/10 border border-[#10b981]/30 text-[#10b981]"
                      : "bg-zinc-900 border border-[#232326] text-zinc-400 group-hover:text-zinc-200"
                  }`}
                >
                  {activeVideo?.kind === "downloaded" ? (
                    <svg className="size-6 text-[#10b981]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" fillOpacity=".2" />
                    </svg>
                  ) : (
                    <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                  )}
                </div>

                <p className="text-sm font-medium text-zinc-200">
                  {activeVideo ? (
                    <span>Ready for processing</span>
                  ) : (
                    <>Drag &amp; drop or <span className="text-[#10b981] underline underline-offset-4">browse</span></>
                  )}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {activeVideo ? "Video loaded into project engine" : "MP4, MOV, MKV, or WebM up to 4GB"}
                </p>

                {/* Selected / Downloaded Video Chip */}
                {activeVideo && (
                  <div
                    role="status"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-4 flex w-full max-w-md items-center justify-between rounded-[10px] border border-[#232326] bg-[#111113] p-3 text-left transition-all duration-150"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#10b981]/10 text-[#10b981]">
                        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">
                          {activeVideo.name}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {activeVideo.kind === "downloaded"
                            ? `YouTube video (${activeVideo.projectId}) · Generating clips`
                            : `${(activeVideo.size / (1024 * 1024)).toFixed(1)} MB · Ready for generation`}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (isProcessingVideo) return;
                        setActiveVideo(null);
                        setDownloadStatus("");
                      }}
                      disabled={isProcessingVideo}
                      className="shrink-0 rounded-[8px] border border-[#232326] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-all duration-150 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Card 2: 2. Clip settings */}
            <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm space-y-6 transition-all duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-6 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
                    2
                  </span>
                  <h2 className="text-base font-semibold text-white">Clip settings</h2>
                </div>
                <span className="text-xs text-zinc-400 font-medium">Timing &amp; captions</span>
              </div>

              {/* Generation Mode Selector */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">
                  Generation mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isProcessingVideo}
                    onClick={() => setGenerationMode("random")}
                    className={`rounded-[10px] border py-2.5 text-xs font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                      generationMode === "random"
                        ? "border-zinc-500 bg-zinc-800 text-white font-semibold"
                        : "border-[#232326] bg-[#0a0a0a] text-zinc-400 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    Random
                  </button>

                  <div className="relative group cursor-not-allowed">
                    <button
                      type="button"
                      disabled
                      title="COMING SOON"
                      aria-label="AI mode coming soon"
                      className="w-full h-full rounded-[10px] border border-[#232326] bg-[#0a0a0a]/50 py-2.5 text-xs font-medium text-zinc-500 cursor-not-allowed flex items-center justify-center gap-2 group-hover:border-zinc-700 transition-all duration-150 pointer-events-none"
                    >
                      <span className="font-semibold text-zinc-400">AI</span>
                      <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400/90 border border-amber-400/20">
                        Soon
                      </span>
                    </button>
                    {/* Hover tooltip */}
                    <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-150 transform translate-y-1 group-hover:translate-y-0 flex items-center justify-center rounded-[6px] bg-zinc-950 border border-zinc-700 px-2.5 py-1 text-[10px] font-bold tracking-wider text-amber-300 shadow-xl whitespace-nowrap z-30">
                      COMING SOON
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-950" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Clip Length Selector */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">
                  Clip length
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {CLIP_DURATIONS.map((seconds) => {
                    const isSelected = clipDurationSeconds === seconds;
                    return (
                      <button
                        key={seconds}
                        type="button"
                        disabled={isProcessingVideo}
                        onClick={() => setClipDurationSeconds(seconds)}
                        className={`rounded-[10px] border py-2.5 text-xs font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                          isSelected
                            ? "border-zinc-500 bg-zinc-800 text-white font-semibold"
                            : "border-[#232326] bg-[#0a0a0a] text-zinc-400 hover:border-zinc-700 hover:text-white"
                        }`}
                      >
                        {seconds}s
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Video Framing / Layout Visual Selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-zinc-400">
                    Video layout & framing
                  </label>
                  <span className="text-[11px] text-zinc-500 font-normal">
                    Visual preview
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Video framing mode">
                  {/* Option 1: 16:9 Rounded */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={framingMode === "standard"}
                    disabled={isProcessingVideo}
                    onClick={() => handleFramingModeChange("standard")}
                    className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3.5 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                      framingMode === "standard"
                        ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                        : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                    }`}
                  >
                    {/* Visual Phone Mockup */}
                    <div className="relative mb-3 flex h-24 w-14 items-center justify-center rounded-lg border border-zinc-700 bg-black p-1 shadow-inner overflow-hidden">
                      {/* Subtle notch */}
                      <div className="absolute top-1 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full bg-zinc-700" />
                      
                      {/* 16:9 Rounded video rectangle in center */}
                      <div className="w-full h-8 rounded-[6px] bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-700 flex items-center justify-center border border-zinc-500/50 shadow-sm overflow-hidden">
                        <svg className="size-3 text-zinc-300" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>

                      {/* Bottom subtitle mock lines */}
                      <div className="absolute bottom-2 left-1.5 right-1.5 space-y-0.5">
                        <div className="h-0.5 w-3/4 mx-auto rounded bg-zinc-600/80" />
                        <div className="h-0.5 w-1/2 mx-auto rounded bg-amber-400/80" />
                      </div>
                    </div>

                    <div className="w-full text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`text-xs font-semibold ${framingMode === "standard" ? "text-white" : "text-zinc-300"}`}>
                          16:9 Rounded
                        </span>
                        {framingMode === "standard" && (
                          <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-zinc-400">
                        Classic 16:9 rounded
                      </p>
                    </div>
                  </button>

                  {/* Option 2: 1:1 Rounded Square (TikTok & Reels Style) */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={framingMode === "square_rounded"}
                    disabled={isProcessingVideo}
                    onClick={() => handleFramingModeChange("square_rounded")}
                    className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3.5 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                      framingMode === "square_rounded"
                        ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                        : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                    }`}
                  >
                    {/* Trending / Popular Pill Badge */}
                    <div className="absolute -top-2 right-2 z-10 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 px-1.5 py-0.5 text-[9px] font-bold text-zinc-950 shadow-md">
                      POPULAR
                    </div>

                    {/* Visual Phone Mockup */}
                    <div className="relative mb-3 flex h-24 w-14 items-center justify-center rounded-lg border border-zinc-700 bg-black p-1 shadow-inner overflow-hidden">
                      {/* Subtle notch */}
                      <div className="absolute top-1 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full bg-zinc-700" />
                      
                      {/* Top hook line preview */}
                      <div className="absolute top-2.5 left-1.5 right-1.5">
                        <div className="h-0.5 w-4/5 mx-auto rounded bg-emerald-400/90" />
                      </div>

                      {/* 1:1 Square with rounded corners in center */}
                      <div className="size-11 rounded-[6px] bg-gradient-to-br from-emerald-600/90 via-teal-700 to-zinc-800 flex items-center justify-center border border-emerald-400/40 shadow-sm relative overflow-hidden">
                        <svg className="size-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>

                      {/* Bottom subtitle mock lines */}
                      <div className="absolute bottom-2 left-1.5 right-1.5 space-y-0.5">
                        <div className="h-0.5 w-3/4 mx-auto rounded bg-amber-400/90" />
                        <div className="h-0.5 w-1/2 mx-auto rounded bg-zinc-500" />
                      </div>
                    </div>

                    <div className="w-full text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`text-xs font-semibold ${framingMode === "square_rounded" ? "text-white" : "text-zinc-300"}`}>
                          1:1 Rounded
                        </span>
                        {framingMode === "square_rounded" && (
                          <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-emerald-400 font-medium">
                        TikTok &amp; Reels square
                      </p>
                    </div>
                  </button>

                  {/* Option 3: True 9:16 (Powered by AI Active Speaker Tracking) */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={framingMode === "true_9_16"}
                    disabled={isProcessingVideo}
                    onClick={() => handleFramingModeChange("true_9_16")}
                    className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3.5 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                      framingMode === "true_9_16"
                        ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                        : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                    }`}
                  >
                    {/* AI Powered Badge */}
                    <div className="absolute -top-2 right-2 z-10 rounded-full bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-md flex items-center gap-1">
                      <svg className="size-2.5 text-amber-300" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                      </svg>
                      AI POWERED
                    </div>

                    {/* Visual Phone Mockup */}
                    <div className="relative mb-3 flex h-24 w-14 items-center justify-center rounded-lg border border-zinc-700 bg-black p-0 shadow-inner overflow-hidden">
                      {/* Full bleed 9:16 vertical video background */}
                      <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/70 via-zinc-900 to-black flex items-center justify-center">
                        {/* AI Face Detection tracking reticle */}
                        <div className="relative flex flex-col items-center -mt-2">
                          <div className="size-7 rounded-full border border-dashed border-emerald-400/90 bg-emerald-500/15 flex items-center justify-center shadow-xs">
                            <svg className="size-4 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                            </svg>
                          </div>
                          <span className="mt-0.5 text-[7px] font-mono font-bold text-emerald-400 uppercase tracking-tighter">SPEAKER</span>
                        </div>
                      </div>

                      {/* Subtle notch */}
                      <div className="absolute top-1 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full bg-zinc-700 z-10" />

                      {/* Bottom subtitle mock lines */}
                      <div className="absolute bottom-2 left-1.5 right-1.5 space-y-0.5 z-10">
                        <div className="h-0.5 w-3/4 mx-auto rounded bg-white/90 shadow-xs" />
                        <div className="h-0.5 w-1/2 mx-auto rounded bg-yellow-400/90 shadow-xs" />
                      </div>
                    </div>

                    <div className="w-full text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`text-xs font-semibold ${framingMode === "true_9_16" ? "text-white" : "text-zinc-300"}`}>
                          True 9:16
                        </span>
                        {framingMode === "true_9_16" && (
                          <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-purple-300 font-medium">
                        AI speaker tracking
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Captions Toggle Switch */}
              <div className="flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-4 transition-all duration-150">
                <div className="pr-4">
                  <p className="text-sm font-medium text-white">Burn captions into clips</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Word-by-word animated highlights in 9:16 vertical video
                  </p>
                </div>

                {/* Accessible Toggle Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={showCaptions}
                  disabled={isProcessingVideo}
                  onClick={() => setShowCaptions((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:ring-offset-2 focus:ring-offset-[#111113] disabled:cursor-not-allowed disabled:opacity-50 ${
                    showCaptions ? "bg-[#10b981]" : "bg-zinc-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md transition duration-150 ease-in-out ${
                      showCaptions ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Caption Style Visual Selector */}
              {showCaptions && (
                <div className="space-y-4 pt-1 transition-all duration-200">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-zinc-400">
                      Caption style
                    </label>
                    <span className="text-[11px] text-zinc-500 font-normal">
                      Visual preview
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" role="radiogroup" aria-label="Caption style">
                    {/* Style 1: Clean */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={captionStyle === "clean" || captionStyle === "clean_gold"}
                      disabled={isProcessingVideo}
                      onClick={() => handleCaptionStyleChange("clean")}
                      className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                        captionStyle === "clean" || captionStyle === "clean_gold"
                          ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                          : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                      }`}
                    >
                      <div className="relative mb-2.5 flex h-20 w-full items-center justify-center rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-2 shadow-inner overflow-hidden select-none">
                        <div className="relative z-10 flex items-baseline gap-1.5 font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
                          <span className="text-[11px] tracking-normal">Stay</span>
                          <span className="text-[12px] tracking-normal text-white">focused</span>
                          <span className="text-[11px] tracking-normal">daily</span>
                        </div>
                      </div>
                      <div className="w-full text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-xs font-semibold ${(captionStyle === "clean" || captionStyle === "clean_gold") ? "text-white" : "text-zinc-300"}`}>
                            Clean
                          </span>
                          {(captionStyle === "clean" || captionStyle === "clean_gold") && (
                            <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Minimalist typography
                        </p>
                      </div>
                    </button>

                    {/* Style 2: Punch */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={captionStyle === "punch"}
                      disabled={isProcessingVideo}
                      onClick={() => handleCaptionStyleChange("punch")}
                      className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                        captionStyle === "punch"
                          ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                          : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                      }`}
                    >
                      <div className="relative mb-2.5 flex h-20 w-full items-center justify-center rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-2 shadow-inner overflow-hidden select-none">
                        <div className="relative z-10 flex items-baseline gap-1.5 font-black uppercase tracking-tight">
                          <span className="text-[11px] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">HIGH</span>
                          <span className="text-[13px] text-[#F7C204] drop-shadow-[0_0_8px_rgba(247,194,4,0.6)] drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] scale-110 transform transition-transform">IMPACT</span>
                          <span className="text-[11px] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">REACH</span>
                        </div>
                      </div>
                      <div className="w-full text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-xs font-semibold ${captionStyle === "punch" ? "text-white" : "text-zinc-300"}`}>
                            Punch
                          </span>
                          {captionStyle === "punch" && (
                            <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-amber-400 font-medium">
                          Bold all-caps &amp; gold
                        </p>
                      </div>
                    </button>

                    {/* Style 3: Robin (Default) */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={captionStyle === "robin" || captionStyle === "classic" || captionStyle === "bold_emerald"}
                      disabled={isProcessingVideo}
                      onClick={() => handleCaptionStyleChange("robin")}
                      className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                        captionStyle === "robin" || captionStyle === "classic" || captionStyle === "bold_emerald"
                          ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                          : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                      }`}
                    >
                      <div className="absolute -top-2 right-2 z-10 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 px-1.5 py-0.5 text-[9px] font-bold text-zinc-950 shadow-md">
                        DEFAULT
                      </div>
                      <div className="relative mb-2.5 flex h-20 w-full items-center justify-center rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-2 shadow-inner overflow-hidden select-none">
                        <div className="absolute inset-0 bg-radial from-emerald-950/20 to-transparent pointer-events-none" />
                        <div className="relative z-10 flex items-baseline gap-1.5 font-black uppercase tracking-tight">
                          <span className="text-[11px] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">CLIP</span>
                          <span className="text-[13px] text-[#34D399] drop-shadow-[0_0_10px_rgba(52,211,153,0.7)] drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] scale-110 transform transition-transform">VIRAL</span>
                          <span className="text-[11px] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">MOMENTS</span>
                        </div>
                      </div>
                      <div className="w-full text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-xs font-semibold ${(captionStyle === "robin" || captionStyle === "classic" || captionStyle === "bold_emerald") ? "text-white" : "text-zinc-300"}`}>
                            Robin
                          </span>
                          {(captionStyle === "robin" || captionStyle === "classic" || captionStyle === "bold_emerald") && (
                            <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-emerald-400 font-medium">
                          Signature viral emerald
                        </p>
                      </div>
                    </button>

                    {/* Style 4: Pill */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={captionStyle === "pill"}
                      disabled={isProcessingVideo}
                      onClick={() => handleCaptionStyleChange("pill")}
                      className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                        captionStyle === "pill"
                          ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                          : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                      }`}
                    >
                      <div className="relative mb-2.5 flex h-20 w-full items-center justify-center rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-2 shadow-inner overflow-hidden select-none">
                        <div className="relative z-10 flex items-baseline gap-1.5 rounded-[7px] bg-black/75 px-2.5 py-1 border border-white/10 shadow-md backdrop-blur-xs">
                          <span className="text-[11px] font-bold text-white tracking-wide">Catch</span>
                          <span className="text-[12px] font-extrabold text-[#34D399] tracking-wide drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] scale-110 transform transition-transform">every</span>
                          <span className="text-[11px] font-bold text-white tracking-wide">moment</span>
                        </div>
                      </div>
                      <div className="w-full text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-xs font-semibold ${captionStyle === "pill" ? "text-white" : "text-zinc-300"}`}>
                            Pill
                          </span>
                          {captionStyle === "pill" && (
                            <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Translucent dark box
                        </p>
                      </div>
                    </button>

                    {/* Style 5: Karaoke */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={captionStyle === "karaoke"}
                      disabled={isProcessingVideo}
                      onClick={() => handleCaptionStyleChange("karaoke")}
                      className={`group relative flex flex-col items-center justify-between rounded-[12px] border p-3 transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                        captionStyle === "karaoke"
                          ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981]"
                          : "border-[#232326] bg-[#0a0a0a] hover:border-zinc-700"
                      }`}
                    >
                      <div className="relative mb-2.5 flex h-20 w-full items-center justify-center rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black p-2 shadow-inner overflow-hidden select-none">
                        <div className="relative z-10 flex items-baseline gap-1.5 font-bold tracking-normal drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                          <span className="text-[11px] text-[#34D399]">Sing</span>
                          <span className="text-[12px] text-[#34D399] font-extrabold">along</span>
                          <span className="text-[11px] text-white/90">smooth</span>
                        </div>
                      </div>
                      <div className="w-full text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-xs font-semibold ${captionStyle === "karaoke" ? "text-white" : "text-zinc-300"}`}>
                            Karaoke
                          </span>
                          {captionStyle === "karaoke" && (
                            <span className="size-3.5 rounded-full bg-[#10b981] text-[9px] font-bold text-zinc-950 flex items-center justify-center">
                              ✓
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Phrase sweep fill
                        </p>
                      </div>
                    </button>
                  </div>

                  {/* Animation Effect Selector Chips */}
                  <div className="rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-zinc-400">
                        Animation effect
                      </label>
                      <span className="text-[11px] text-zinc-500 font-normal">
                        Word highlight motion
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Caption animation effect">
                      {ANIMATION_CHIPS.map((anim) => {
                        const isSelected = captionAnimation === anim.id;
                        return (
                          <button
                            key={anim.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            disabled={isProcessingVideo}
                            onClick={() => handleCaptionAnimationChange(anim.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all duration-150 border focus:outline-none focus:ring-1 focus:ring-[#10b981] ${
                              isSelected
                                ? "border-[#10b981] bg-[#10b981]/15 text-emerald-400 font-semibold ring-1 ring-[#10b981]/40"
                                : "border-[#232326] bg-[#111113] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                            }`}
                          >
                            <span>{anim.name}</span>
                            {isSelected && (
                              <span className="size-1.5 rounded-full bg-emerald-400" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Watermark Toggle Switch */}
              <div className="flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-4 transition-all duration-150">
                <div className="pr-4">
                  <p className="text-sm font-medium text-white">Add a watermark: Made with Clip Robin</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Overlay Clip Robin watermark at top-center of vertical video
                  </p>
                </div>

                {/* Accessible Toggle Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={showWatermark}
                  disabled={isProcessingVideo}
                  onClick={() => setShowWatermark((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:ring-offset-2 focus:ring-offset-[#111113] disabled:cursor-not-allowed disabled:opacity-50 ${
                    showWatermark ? "bg-[#10b981]" : "bg-zinc-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md transition duration-150 ease-in-out ${
                      showWatermark ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Single Primary Button: Start generating */}
              <div>
                <button
                  type="button"
                  onClick={() => void handleStartGenerating()}
                  disabled={!activeVideo || isProcessingVideo}
                  className="w-full rounded-[10px] bg-[#10b981] py-3.5 px-6 text-sm font-semibold text-zinc-950 transition-all duration-150 hover:bg-[#059669] hover:shadow-lg hover:shadow-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#10b981] disabled:hover:shadow-none focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:ring-offset-2 focus:ring-offset-[#0a0a0a]"
                >
                  {activeVideoJob?.kind === "transcription" ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="size-4 animate-spin text-zinc-950" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity=".25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Transcribing audio...
                    </span>
                  ) : activeVideoJob?.kind === "generation" ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="size-4 animate-spin text-zinc-950" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity=".25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Rendering clips...
                    </span>
                  ) : (
                    "Start generating"
                  )}
                </button>

                {!activeVideo && (
                  <p className="mt-2 text-center text-xs text-zinc-500">
                    Select a video or download from YouTube to enable generation.
                  </p>
                )}
              </div>
            </section>

            {/* Active Processing Card (Progress) */}
            {transcriptionProgress && (
              <section
                aria-live="polite"
                className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm space-y-4 transition-all duration-150"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      {transcriptionProgress.step}
                    </h3>
                    {transcriptionProgress.projectId && (
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Project ID: <span className="font-mono text-zinc-300">{transcriptionProgress.projectId}</span>
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-mono font-medium text-emerald-400">
                    {transcriptionProgress.progress}%
                  </span>
                </div>

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

                {/* Step checklist */}
                <ol className="grid gap-2 sm:grid-cols-2 pt-2 border-t border-[#232326]">
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
                            : "text-zinc-600"
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
              </section>
            )}

            {/* Download feedback status */}
            {downloadStatus && (
              <div
                className={`rounded-[10px] border p-3.5 text-xs transition-all duration-150 ${
                  downloadStatus.includes("failed") || downloadStatus.includes("Could not")
                    ? "border-red-500/30 bg-red-950/20 text-red-300"
                    : "border-[#232326] bg-[#111113] text-zinc-300"
                }`}
              >
                <p>{downloadStatus}</p>
              </div>
            )}

            {/* Generated clips section or Empty state */}
            {generatedClips.length > 0 || (isProcessingVideo && transcriptionProgress?.kind === "generation") ? (
              <div className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm space-y-4 transition-all duration-150">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-[#10b981]/15 text-[10px] text-[#10b981]">
                      {isProcessingVideo && transcriptionProgress?.kind === "generation" ? (
                        <span className="size-2 rounded-full bg-[#10b981] animate-pulse" />
                      ) : (
                        "✓"
                      )}
                    </span>
                    <h3 className="text-sm font-semibold text-white">
                      {isProcessingVideo && transcriptionProgress?.kind === "generation"
                        ? `Generating Clips (${generatedClips.length} ready)`
                        : `Generated Clips (${generatedClips.length})`}
                    </h3>
                  </div>
                  {generatedProjectId && (
                    <Link
                      href={`/clips?project=${encodeURIComponent(generatedProjectId)}`}
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
                    >
                      View all in Clips studio &rarr;
                    </Link>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {generatedClips.slice(0, 4).map((clip) => (
                    <div
                      key={clip.id}
                      className="rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3 transition-all duration-150 hover:border-zinc-700"
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
                      <div className="mt-2.5 flex items-center justify-between border-t border-[#232326] pt-2 text-[11px]">
                        <span className="text-zinc-500 font-mono">
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
                  {isProcessingVideo && transcriptionProgress?.kind === "generation" && Array.from({
                    length: Math.max(1, Math.min(2, 4 - generatedClips.length))
                  }).map((_, i) => (
                    <div
                      key={`dash-skel-${i}`}
                      className="rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="h-3.5 w-24 rounded bg-zinc-800/80 skeleton-shimmer" />
                        <div className="h-3 w-10 rounded bg-zinc-800/50 skeleton-shimmer" />
                      </div>
                      <div className="h-3 w-4/5 rounded bg-zinc-800/60 skeleton-shimmer" />
                      <div className="h-3 w-1/2 rounded bg-zinc-800/40 skeleton-shimmer" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-[12px] border border-[#232326] bg-[#111113] p-8 text-center transition-all duration-150">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-[#0a0a0a] border border-[#232326] text-zinc-500">
                  <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-white">No clips yet</h3>
                <p className="mt-1 text-xs text-zinc-400">
                  No clips yet, your generated clips will show up here.
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Recent Projects */}
          <div className="space-y-4">
            <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm transition-all duration-150">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white">Recent projects</h2>
                <Link
                  href="/projects"
                  className="text-xs text-zinc-400 hover:text-emerald-400 transition-colors duration-150"
                >
                  View all &rarr;
                </Link>
              </div>

              {isLoadingProjects ? (
                <ul className="space-y-2.5">
                  <RecentProjectSkeletonItem />
                  <RecentProjectSkeletonItem />
                  <RecentProjectSkeletonItem />
                </ul>
              ) : recentProjects.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400 space-y-1.5">
                  <p className="font-medium text-zinc-300">No projects created yet.</p>
                  <p className="text-[11px] text-zinc-500">
                    Upload a video or download from YouTube to create your first project.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {recentProjects.slice(0, 5).map((project) => (
                    <li
                      key={project.project_id}
                      className="flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3 text-xs transition-all duration-150 hover:border-zinc-700"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white font-mono">
                            {project.project_id}
                          </span>
                          <span className={`inline-block size-1.5 rounded-full ${
                            project.status === "Ready" ? "bg-[#10b981]" : "bg-amber-400"
                          }`} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          {project.source_type} · {project.clips} {project.clips === 1 ? "clip" : "clips"}
                        </p>
                      </div>

                      <Link
                        href={`/clips?project=${encodeURIComponent(project.project_id)}`}
                        className="shrink-0 rounded-[8px] border border-[#232326] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-all duration-150 hover:border-[#10b981] hover:text-[#10b981]"
                      >
                        {project.clips > 0 ? "View clips" : "Generate"}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Local Processing Guarantee Card */}
            <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-5 shadow-sm transition-all duration-150">
              <div className="flex items-center gap-2 mb-2 text-zinc-300">
                <svg className="size-4 text-[#10b981]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Local-First Engine
                </h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Clip Robin executes transcription, audio ripping, and FFmpeg video slicing directly on your machine. Your media stays private.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

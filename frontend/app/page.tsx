"use client";

import React, {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  getProjects,
  Project,
  FramingMode,
  CaptionStyle,
} from "@/src/lib/api";
import { DashboardProjectSkeleton } from "@/src/components/skeletons";
import { CAPTION_STYLE_OPTIONS } from "@/src/components/caption-style-picker";
import { ClipSettings, ClipDuration } from "@/src/components/clip-settings";
import { LiveMovingCaptions } from "@/src/components/live-moving-captions";
import { Badge } from "@/src/components/ui/badge";
import { StatusPill } from "@/src/components/ui/status-pill";
import { IconButton } from "@/src/components/ui/icon-button";
import { OptionCard } from "@/src/components/ui/option-card";
import { useAIDeveloperStatus } from "@/src/hooks/use-ai-developer-status";
import { useVideoQueue, QueueSource } from "@/src/lib/queue-context";
import { VideoQueueView } from "@/src/components/video-queue-view";
import { sanitizeProjectName, validateProjectName } from "@/src/lib/project-name-utils";

type ActiveVideo =
  | { kind: "file"; file: File; name: string; size: number }
  | { kind: "youtube"; url: string; name: string };

const isValidYouTubeUrl = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}(\S*)?$/i.test(
    trimmed
  );
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileDuration = (file: File): Promise<number | null> => {
  return new Promise((resolve) => {
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      const u = URL.createObjectURL(file);
      v.src = u;
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(u);
        resolve(v.duration || null);
      };
      v.onerror = () => {
        URL.revokeObjectURL(u);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
};

export default function Home() {
  const { status: aiDeveloperStatus } = useAIDeveloperStatus();
  const aiModeEnabled = Boolean(aiDeveloperStatus?.ai_enabled);

  // Global Video Queue
  const {
    queue,
    queueCount,
    maxQueueSize,
    isAtLimit,
    addToQueue,
  } = useVideoQueue();

  // Wizard Progressive Flow State
  // Step 1 State: Source
  const [activeVideo, setActiveVideo] = useState<ActiveVideo | null>(null);
  const [importTab, setImportTab] = useState<"file" | "youtube">("file");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [inlineSourceError, setInlineSourceError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);

  // Step 2 State: Aspect Ratio
  const [hasSelectedRatio, setHasSelectedRatio] = useState(false);
  const [framingMode, setFramingMode] = useState<FramingMode>("standard");
  const [compatibilityNotice, setCompatibilityNotice] = useState<string | null>(null);

  // Step 3 State: Project Name & Remaining Options
  const [projectName, setProjectName] = useState("");
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const [generationMode, setGenerationMode] = useState<"random" | "ai">("random");
  const [clipDurationSeconds, setClipDurationSeconds] = useState<ClipDuration>(30);
  const [clipCount, setClipCount] = useState<number>(3);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("classic");
  const [showCaptions, setShowCaptions] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);

  // Recent Projects
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  // Video Preview URL
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate dynamic max clips
  const maxClips = useMemo(() => {
    if (!sourceDuration || sourceDuration <= 0) return 10;
    return Math.max(1, Math.floor(sourceDuration / clipDurationSeconds));
  }, [sourceDuration, clipDurationSeconds]);

  useEffect(() => {
    if (clipCount > maxClips) {
      setClipCount(maxClips);
    }
  }, [maxClips, clipCount]);

  // Handle preview blob URL
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

  // Load user preference defaults from localStorage
  useEffect(() => {
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
      const savedSubs = localStorage.getItem("cliprobin_show_captions");
      if (savedSubs !== null) {
        setShowCaptions(savedSubs === "true");
      }
      const savedWm = localStorage.getItem("cliprobin_show_watermark");
      if (savedWm !== null) {
        setShowWatermark(savedWm === "true");
      }
      const savedStyle = localStorage.getItem("cliprobin_caption_style");
      if (
        savedStyle &&
        ["classic", "robin", "clean", "punch", "pill", "karaoke", "bold_emerald", "clean_gold"].includes(
          savedStyle
        )
      ) {
        setCaptionStyle(savedStyle as CaptionStyle);
      }
    } catch {}
  }, []);

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

  // Reset the wizard to Step 1 (for "+ Add another video")
  const handleResetFlow = () => {
    setActiveVideo(null);
    setHasSelectedRatio(false);
    setYoutubeUrl("");
    setInlineSourceError(null);
    setSourceDuration(null);
    setProjectName("");
    setProjectNameError(null);
    setCompatibilityNotice(null);
  };

  // Step 1: File selection handlers
  const isVideoFile = (file: File) => {
    if (file.type.startsWith("video/")) return true;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return ["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(extension);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!isVideoFile(file)) {
      setInlineSourceError("Unsupported format. Please select an MP4, MOV, MKV, WebM, or AVI file.");
      return;
    }

    if (file.size > 4 * 1024 * 1024 * 1024) {
      setInlineSourceError("File is too large. Clip Robin supports video files up to 4 GB.");
      return;
    }

    setInlineSourceError(null);
    void getFileDuration(file).then((dur) => {
      if (dur) setSourceDuration(dur);
    });

    setActiveVideo({
      kind: "file",
      file,
      name: file.name,
      size: file.size,
    });

    const existingNames = [
      ...recentProjects.map((p) => p.title || p.project_id),
      ...queue.map((q) => q.projectName),
    ];
    setProjectName(sanitizeProjectName(file.name, existingNames));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;

    if (!isVideoFile(file)) {
      setInlineSourceError("Unsupported format. Please drop an MP4, MOV, MKV, WebM, or AVI file.");
      return;
    }

    if (file.size > 4 * 1024 * 1024 * 1024) {
      setInlineSourceError("File is too large. Clip Robin supports video files up to 4 GB.");
      return;
    }

    setInlineSourceError(null);
    void getFileDuration(file).then((dur) => {
      if (dur) setSourceDuration(dur);
    });

    setActiveVideo({
      kind: "file",
      file,
      name: file.name,
      size: file.size,
    });

    const existingNames = [
      ...recentProjects.map((p) => p.title || p.project_id),
      ...queue.map((q) => q.projectName),
    ];
    setProjectName(sanitizeProjectName(file.name, existingNames));
  };

  // Step 1: YouTube link submission
  const handleValidateYouTubeUrl = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = youtubeUrl.trim();
    if (!trimmed) {
      setInlineSourceError("Please enter a YouTube video or Shorts link.");
      return;
    }

    if (!isValidYouTubeUrl(trimmed)) {
      setInlineSourceError(
        "Invalid YouTube URL. Please enter a valid link (e.g. https://www.youtube.com/watch?v=... or https://youtu.be/...)."
      );
      return;
    }

    setInlineSourceError(null);
    setActiveVideo({
      kind: "youtube",
      url: trimmed,
      name: "YouTube Video",
    });

    const existingNames = [
      ...recentProjects.map((p) => p.title || p.project_id),
      ...queue.map((q) => q.projectName),
    ];
    setProjectName(sanitizeProjectName("YouTube Video", existingNames));
  };

  // Step 2: Aspect Ratio selection
  const handleSelectFramingMode = (mode: FramingMode) => {
    const prevMode = framingMode;
    setFramingMode(mode);
    setHasSelectedRatio(true);

    try {
      localStorage.setItem("cliprobin_framing_mode", mode);
    } catch {}

    // Compatibility check between ratio and other settings
    if (prevMode && prevMode !== mode) {
      if (mode === "square_rounded") {
        setCompatibilityNotice("Selected 1:1 Rounded square canvas. Subtitle safe-margins adjusted to centered square framing.");
      } else if (mode === "true_9_16") {
        setCompatibilityNotice("Selected Full 9:16 Crop. AI face & speaker tracking enabled.");
      } else {
        setCompatibilityNotice("Selected 16:9 Letterbox widescreen canvas.");
      }
    }
  };

  // Step 3: Project name validation & handlers
  const handleProjectNameChange = (val: string) => {
    setProjectName(val);
    const check = validateProjectName(val);
    if (!check.valid && check.error) {
      setProjectNameError(check.error);
    } else {
      setProjectNameError(null);
    }
  };

  const handleProjectNameBlur = () => {
    const existingNames = [
      ...recentProjects.map((p) => p.title || p.project_id),
      ...queue.map((q) => q.projectName),
    ];
    setProjectName(sanitizeProjectName(projectName, existingNames));
    setProjectNameError(null);
  };

  // Submit flow: Add to Queue / Generate
  const handleSubmitToQueue = () => {
    if (!activeVideo || !hasSelectedRatio) return;

    if (isAtLimit) {
      setInlineSourceError(`Queue is full (${maxQueueSize}/${maxQueueSize}). Please wait for active videos to complete.`);
      return;
    }

    const existingNames = [
      ...recentProjects.map((p) => p.title || p.project_id),
      ...queue.map((q) => q.projectName),
    ];
    const finalName = sanitizeProjectName(projectName || activeVideo.name, existingNames);

    const queueSource: QueueSource =
      activeVideo.kind === "youtube"
        ? { kind: "youtube", url: activeVideo.url, videoLabel: finalName }
        : { kind: "file", file: activeVideo.file, name: activeVideo.name, size: activeVideo.size };

    const result = addToQueue({
      projectName: finalName,
      source: queueSource,
      settings: {
        framingMode,
        clipDurationSeconds,
        clipCount,
        generationMode,
        captionStyle,
        showCaptions,
        showWatermark,
      },
    });

    if (result.success) {
      // Reset the local wizard so user can queue another video right away
      handleResetFlow();
      void refreshProjectsList();
    } else if (result.error) {
      setInlineSourceError(result.error);
    }
  };

  const activeStyleName =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === captionStyle)?.name || "Classic";

  return (
    <main className="min-h-full p-4 md:p-8 xl:p-10 max-w-7xl mx-auto">
      <div className="space-y-8">
        {/* Header Bar */}
        <header className="flex flex-col gap-3 pb-6 border-b border-zinc-800/80">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Create Clips</h1>
              <p className="text-xs text-zinc-400 mt-1">
                Turn long video content into vertical short-form clips powered by local AI
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="emerald" size="md">Local Engine Ready</Badge>
              {queueCount > 0 && (
                <Badge variant={isAtLimit ? "amber" : "emerald"} size="md">
                  Queue: {queueCount}/{maxQueueSize}
                </Badge>
              )}
            </div>
          </div>
        </header>

        {/* Video Processing Queue (Visible whenever items are queued or processing) */}
        {queue.length > 0 && (
          <VideoQueueView onAddAnotherVideo={handleResetFlow} />
        )}

        {/* 2-Column Responsive Layout: Left Steps + Right Sticky Preview */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] 2xl:grid-cols-[1fr_420px] gap-6 xl:gap-8 items-start">
          {/* Left Column: Progressive Step-by-Step Wizard */}
          <div className="space-y-6 min-w-0">
            {/* STEP 1: Source (Always visible on load) */}
            <section
              aria-label="Step 1: Video source"
              className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-200"
            >
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      activeVideo
                        ? "bg-[#10b981] text-zinc-950"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {activeVideo ? "✓" : "1"}
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-white">1. Add source video</h2>
                    <p className="text-xs text-zinc-400">
                      Upload a local video file or paste a YouTube video / Shorts link
                    </p>
                  </div>
                </div>

                {!activeVideo && (
                  <div className="flex items-center rounded-xl border border-zinc-800 bg-[#0d0d10] p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setImportTab("file");
                        setInlineSourceError(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        importTab === "file"
                          ? "bg-zinc-800 text-white font-semibold shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <span>Upload File</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImportTab("youtube");
                        setInlineSourceError(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        importTab === "youtube"
                          ? "bg-zinc-800 text-white font-semibold shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <svg className="size-3.5 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                      </svg>
                      <span>YouTube Link</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Once source is valid: Display active video banner */}
              {activeVideo ? (
                <div className="rounded-xl border border-zinc-700/80 bg-[#0c0c0e] p-4 transition-all duration-200 animate-fade-in">
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
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                          <span>
                            {activeVideo.kind === "file"
                              ? formatFileSize(activeVideo.size)
                              : "YouTube Video"}
                          </span>
                          {sourceDuration && (
                            <>
                              <span>•</span>
                              <span>{Math.round(sourceDuration)}s</span>
                            </>
                          )}
                          <span>•</span>
                          <span className="text-emerald-400 font-medium flex items-center gap-1">
                            <span className="size-1.5 rounded-full bg-[#10b981]" />
                            Source valid
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (activeVideo.kind === "file") {
                            fileInputRef.current?.click();
                          } else {
                            setActiveVideo(null);
                            setHasSelectedRatio(false);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-xs font-medium text-zinc-200 hover:text-white hover:bg-zinc-700 transition-colors focus-ring cursor-pointer"
                      >
                        Change
                      </button>
                      <IconButton
                        label="Remove source video"
                        tooltip="Remove video"
                        variant="ghost"
                        size="sm"
                        onClick={handleResetFlow}
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
              ) : importTab === "file" ? (
                /* Choice A: Drag & Drop File Zone */
                <div className="space-y-3">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
                      isDragging
                        ? "border-[#10b981] bg-[#10b981]/10 text-emerald-400 shadow-lg shadow-emerald-950/20"
                        : "border-zinc-800 bg-[#0c0c0e]/60 hover:border-zinc-700 hover:bg-[#0c0c0e]"
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*,.mkv,.avi,.webm"
                      onChange={handleFileChange}
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
                      MP4, MOV, MKV, or WebM up to 4 GB
                    </p>

                    <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
                      <span className="px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/50">Local privacy</span>
                      <span>•</span>
                      <span>Processed 100% on device</span>
                    </div>
                  </div>

                  {inlineSourceError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300 animate-fade-in flex items-center gap-2">
                      <span className="shrink-0">⚠️</span>
                      <span>{inlineSourceError}</span>
                    </div>
                  )}
                </div>
              ) : (
                /* Choice B: YouTube URL Input */
                <form onSubmit={handleValidateYouTubeUrl} className="space-y-3">
                  <div>
                    <label htmlFor="youtube-url-input" className="block text-xs font-medium text-zinc-400 mb-1.5">
                      YouTube Video or Shorts URL
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        id="youtube-url-input"
                        type="url"
                        value={youtubeUrl}
                        onChange={(e) => {
                          setYoutubeUrl(e.target.value);
                          if (inlineSourceError) setInlineSourceError(null);
                        }}
                        placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                        className="flex-1 min-w-0 rounded-xl border border-zinc-800 bg-[#0c0c0e] px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus-ring"
                      />
                      <button
                        type="submit"
                        disabled={!youtubeUrl.trim()}
                        className="shrink-0 px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/90 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-ring cursor-pointer"
                      >
                        Use YouTube Video
                      </button>
                    </div>
                  </div>

                  {inlineSourceError ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300 animate-fade-in flex items-center gap-2">
                      <span className="shrink-0">⚠️</span>
                      <span>{inlineSourceError}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400">
                      Paste any public YouTube video or Shorts link to configure your clips.
                    </p>
                  )}
                </form>
              )}
            </section>

            {/* STEP 2: Aspect Ratio (Revealed only after source is valid) */}
            {activeVideo && (
              <section
                aria-label="Step 2: Output aspect ratio"
                className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-300 animate-fade-in space-y-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                        hasSelectedRatio
                          ? "bg-[#10b981] text-zinc-950"
                          : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {hasSelectedRatio ? "✓" : "2"}
                    </span>
                    <div>
                      <h2 className="text-base font-semibold text-white">2. Output aspect ratio &amp; canvas</h2>
                      <p className="text-xs text-zinc-400">
                        Choose how your video is framed inside the 9:16 vertical canvas
                      </p>
                    </div>
                  </div>
                  <Badge variant="neutral" size="sm">9:16 Canvas</Badge>
                </div>

                {/* Aspect ratio selectable cards */}
                <div
                  className="grid grid-cols-1 @md:grid-cols-3 gap-3"
                  role="radiogroup"
                  aria-label="Output aspect ratio"
                >
                  {/* Option 1: 16:9 Letterbox */}
                  <OptionCard
                    title="16:9 Letterbox"
                    subtitle="Original widescreen"
                    selected={hasSelectedRatio && framingMode === "standard"}
                    onClick={() => handleSelectFramingMode("standard")}
                    previewGraphic={
                      <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0a0a0d] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                        <div className="h-4.5 w-full rounded-[3px] bg-zinc-700/80 border border-zinc-600/70 flex items-center justify-center">
                          <span className="text-[7px] font-semibold text-zinc-300">16:9</span>
                        </div>
                      </div>
                    }
                  />

                  {/* Option 2: 1:1 Rounded */}
                  <OptionCard
                    title="1:1 Rounded"
                    subtitle="Centered square"
                    badge={<Badge variant="emerald" size="sm">Popular</Badge>}
                    selected={hasSelectedRatio && framingMode === "square_rounded"}
                    onClick={() => handleSelectFramingMode("square_rounded")}
                    previewGraphic={
                      <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0a0a0d] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                        <div className="w-full aspect-square rounded-[3px] bg-zinc-700/80 border border-zinc-600/70 flex items-center justify-center">
                          <span className="text-[7px] font-semibold text-emerald-300">1:1</span>
                        </div>
                      </div>
                    }
                  />

                  {/* Option 3: Full 9:16 Crop */}
                  <OptionCard
                    title="Full 9:16 Crop"
                    subtitle="Speaker tracking"
                    badge={<Badge variant="purple" size="sm">AI</Badge>}
                    selected={hasSelectedRatio && framingMode === "true_9_16"}
                    onClick={() => handleSelectFramingMode("true_9_16")}
                    previewGraphic={
                      <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0a0a0d] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                        <div className="size-full rounded-[3px] bg-zinc-700/80 border border-purple-500/40 flex items-center justify-center">
                          <svg className="size-4 text-purple-300/90" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="12" cy="8" r="4" strokeWidth="2" />
                            <path d="M6 20v-2a6 6 0 0 1 12 0v2" strokeWidth="2" />
                          </svg>
                        </div>
                      </div>
                    }
                  />
                </div>

                {/* Compatibility notice if ratio changed */}
                {compatibilityNotice && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300 animate-fade-in flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-[#10b981]" />
                      <span>{compatibilityNotice}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCompatibilityNotice(null)}
                      className="text-emerald-400/80 hover:text-emerald-200 text-xs"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* STEP 3: Remaining Options & Project Name (Revealed only after ratio is selected) */}
            {activeVideo && hasSelectedRatio && (
              <section
                aria-label="Step 3: Clip options & project name"
                className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-300 animate-fade-in space-y-6"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                    3
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-white">3. Clip options &amp; project name</h2>
                    <p className="text-xs text-zinc-400">
                      Configure clip lengths, subtitle branding, and customize your project name
                    </p>
                  </div>
                </div>

                {/* Project Name Field */}
                <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="project-name-input" className="block text-xs font-semibold text-zinc-200">
                      Project Name
                    </label>
                    <span className="text-[11px] font-mono text-zinc-500">
                      {projectName.length}/60
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      id="project-name-input"
                      type="text"
                      value={projectName}
                      onChange={(e) => handleProjectNameChange(e.target.value)}
                      onBlur={handleProjectNameBlur}
                      maxLength={60}
                      placeholder="Enter project name..."
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  {projectNameError ? (
                    <p className="text-xs text-red-400">{projectNameError}</p>
                  ) : (
                    <p className="text-[11px] text-zinc-400">
                      Auto-derived from source file. Letters, numbers, spaces, and hyphens permitted.
                    </p>
                  )}
                </div>

                {/* Remaining Options (Duration, Count, Captions, Watermark) */}
                <ClipSettings
                  variant="full"
                  hideFraming={true}
                  aiModeEnabled={aiModeEnabled}
                  aiModeDisabledReason={aiDeveloperStatus?.reason}
                  generationMode={generationMode}
                  onGenerationModeChange={setGenerationMode}
                  clipDurationSeconds={clipDurationSeconds}
                  onClipDurationChange={setClipDurationSeconds}
                  clipCount={clipCount}
                  onClipCountChange={setClipCount}
                  maxClips={maxClips}
                  framingMode={framingMode}
                  onFramingModeChange={handleSelectFramingMode}
                  showCaptions={showCaptions}
                  onShowCaptionsChange={setShowCaptions}
                  captionStyle={captionStyle}
                  onCaptionStyleChange={setCaptionStyle}
                  showWatermark={showWatermark}
                  onShowWatermarkChange={setShowWatermark}
                />

                {/* Submit to Queue Button in Step 3 */}
                <div className="pt-2 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={handleSubmitToQueue}
                    disabled={isAtLimit}
                    className={`w-full min-h-[46px] rounded-xl px-5 py-3 text-[13px] font-bold transition-all duration-150 focus-ring flex items-center justify-center gap-2 ${
                      isAtLimit
                        ? "bg-zinc-800 text-zinc-500 border border-zinc-700/50 cursor-not-allowed opacity-60"
                        : "bg-[#10b981] text-zinc-950 hover:bg-[#059669] hover:shadow-lg hover:shadow-emerald-950/40 cursor-pointer"
                    }`}
                  >
                    <svg className="size-4 fill-current" viewBox="0 0 24 24">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>
                      {isAtLimit
                        ? "Queue Limit Reached (10/10)"
                        : queueCount > 0
                        ? `Add to Queue (${queueCount}/10)`
                        : `Start Generating ${clipCount} ${clipCount === 1 ? "Clip" : "Clips"}`}
                    </span>
                  </button>
                  {isAtLimit && (
                    <p className="mt-2 text-center text-xs text-amber-400/90">
                      Maximum 10 videos in queue. Please wait for current items to finish.
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* Right Column: Sticky Aside with Live 9:16 Preview, Summary Chips & Action */}
          <aside className="sticky top-6 space-y-6">
            <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white">Live 9:16 Output Preview</span>
                <Badge variant="emerald" size="sm">9:16 Vertical</Badge>
              </div>

              {/* 9:16 Phone Mockup Container */}
              <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] rounded-3xl border-2 border-zinc-700/80 bg-[#0a0a0c] overflow-hidden shadow-2xl flex flex-col items-center justify-center p-2 ring-1 ring-white/5">
                {/* Phone Speaker Notch */}
                <div className="absolute top-2.5 left-1/2 -translate-x-1/2 h-1 w-12 rounded-full bg-zinc-700/80 z-20" />

                {/* Video / Graphic Area */}
                <div className="relative size-full rounded-2xl overflow-hidden bg-black flex items-center justify-center">
                  {!activeVideo ? (
                    // Empty preview state before Step 1 is chosen
                    <div className="size-full bg-gradient-to-b from-zinc-900/60 to-black flex flex-col items-center justify-center p-4 text-center">
                      <div className="size-12 rounded-full border border-dashed border-zinc-700 bg-zinc-900/80 flex items-center justify-center text-zinc-500">
                        <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </div>
                      <p className="mt-3 text-xs font-semibold text-zinc-300">Step 1</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        Add a source video to unlock live preview
                      </p>
                    </div>
                  ) : framingMode === "true_9_16" ? (
                    // Full bleed True 9:16
                    videoPreviewUrl ? (
                      <video
                        src={videoPreviewUrl}
                        data-decorative-loop="true"
                        muted
                        autoPlay
                        loop
                        playsInline
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="size-full bg-gradient-to-b from-purple-950/40 via-zinc-950 to-black flex items-center justify-center relative p-4 text-center">
                        <div className="relative flex flex-col items-center">
                          <div className="size-14 rounded-full border border-dashed border-purple-400/80 bg-purple-500/10 flex items-center justify-center">
                            <svg className="size-7 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="8" r="4" strokeWidth="2" />
                              <path d="M6 20v-2a6 6 0 0 1 12 0v2" strokeWidth="2" />
                            </svg>
                          </div>
                          <span className="mt-2 text-[10px] font-semibold text-purple-300">Full 9:16 Crop</span>
                          <span className="text-[8px] text-zinc-400 mt-0.5">Speaker tracking focus</span>
                        </div>
                      </div>
                    )
                  ) : framingMode === "square_rounded" ? (
                    // 1:1 Rounded Square Card
                    <div className="size-full bg-black flex items-center justify-center p-3">
                      <div className="w-full aspect-square rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-md relative flex items-center justify-center">
                        {videoPreviewUrl ? (
                          <video
                            src={videoPreviewUrl}
                            data-decorative-loop="true"
                            muted
                            autoPlay
                            loop
                            playsInline
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center text-center p-2">
                            <span className="text-xs font-semibold text-emerald-300">1:1 Rounded</span>
                            <span className="text-[9px] text-zinc-400 mt-0.5">Centered Square Card</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // 16:9 Letterbox Card
                    <div className="size-full bg-black flex items-center justify-center p-3">
                      <div className="w-full aspect-video rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-md relative flex items-center justify-center">
                        {videoPreviewUrl ? (
                          <video
                            src={videoPreviewUrl}
                            data-decorative-loop="true"
                            muted
                            autoPlay
                            loop
                            playsInline
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center text-center p-2">
                            <span className="text-xs font-semibold text-zinc-200">16:9 Letterbox</span>
                            <span className="text-[9px] text-zinc-400 mt-0.5">Floating Widescreen Card</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Watermark Overlay Preview */}
                  {activeVideo && showWatermark && (
                    <div className="absolute top-3.5 right-3.5 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 border border-white/10 backdrop-blur-xs shadow-sm">
                      <span className="size-1.5 rounded-full bg-[#10b981]" />
                      <span className="text-[8px] font-semibold text-white tracking-tight">Clip Robin</span>
                    </div>
                  )}

                  {/* Live Moving Captions Overlay */}
                  {activeVideo && showCaptions && (
                    <div
                      className={`absolute inset-x-2 z-20 text-center pointer-events-none transition-all duration-200 ${
                        framingMode === "square_rounded" ? "bottom-[18%]" : "bottom-[26.5%]"
                      }`}
                    >
                      <LiveMovingCaptions captionStyle={captionStyle} />
                    </div>
                  )}
                </div>
              </div>

              {/* Summary Chips */}
              <div className="pt-2 border-t border-zinc-800 space-y-2">
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider block">
                  Configured options
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="neutral">
                    {framingMode === "true_9_16"
                      ? "Full 9:16 (AI)"
                      : framingMode === "square_rounded"
                      ? "1:1 Rounded"
                      : "16:9 Letterbox"}
                  </Badge>
                  <Badge variant="neutral">
                    {clipCount} {clipCount === 1 ? "clip" : "clips"} · {clipDurationSeconds}s
                  </Badge>
                  <Badge variant={showCaptions ? "emerald" : "neutral"}>
                    {showCaptions ? `${activeStyleName} subtitles` : "No subtitles"}
                  </Badge>
                  <Badge variant="neutral">
                    {showWatermark ? "Watermark on" : "No watermark"}
                  </Badge>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleSubmitToQueue}
                  disabled={!activeVideo || !hasSelectedRatio || isAtLimit}
                  className={`w-full min-h-[46px] rounded-xl px-5 py-3 text-[13px] font-bold transition-all duration-150 focus-ring flex items-center justify-center gap-2 ${
                    activeVideo && hasSelectedRatio && !isAtLimit
                      ? "bg-[#10b981] text-zinc-950 hover:bg-[#059669] hover:shadow-lg hover:shadow-emerald-950/40 cursor-pointer"
                      : "border border-zinc-800 bg-zinc-900/60 text-zinc-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  <svg className="size-4 fill-current" viewBox="0 0 24 24">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>
                    {!activeVideo
                      ? "Add Video (Step 1)"
                      : !hasSelectedRatio
                      ? "Select Aspect Ratio (Step 2)"
                      : isAtLimit
                      ? "Queue Full (10/10)"
                      : queueCount > 0
                      ? `Add to Queue (${queueCount}/10)`
                      : `Generate ${clipCount} ${clipCount === 1 ? "Clip" : "Clips"}`}
                  </span>
                </button>
              </div>
            </section>
          </aside>
        </div>

        {/* Lower Section: Recent Projects & Local Engine Guarantee */}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DashboardProjectSkeleton />
                <DashboardProjectSkeleton />
                <DashboardProjectSkeleton />
                <DashboardProjectSkeleton />
              </div>
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
                        <span className="font-semibold text-white font-mono text-xs truncate" title={project.title || project.project_id}>
                          {project.title || project.project_id}
                        </span>
                        <StatusPill status={project.status} />
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {project.source_type} • {project.clips} {project.clips === 1 ? "clip" : "clips"}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                      <span className="text-xs text-zinc-500">
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                      <Link
                        href={`/clips?project=${encodeURIComponent(project.project_id)}`}
                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                      >
                        {project.clips > 0 ? "Open in Studio →" : "Generate →"}
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

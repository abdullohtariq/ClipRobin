"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CaptionStyle,
  FramingMode,
  ActiveJob,
  ClipGenerationJob,
  cancelClipGeneration,
  deleteProject,
  generateClips,
  getActiveJobs,
  getProjects,
  Project,
} from "@/src/lib/api";
import { ProjectSkeletonCard } from "@/src/components/skeletons";
import {
  CaptionStylePicker,
  CAPTION_STYLE_OPTIONS,
  getPreviewUrls,
} from "@/src/components/caption-style-picker";

const CLIP_DURATIONS = [15, 30, 60, 90] as const;
type ClipDuration = (typeof CLIP_DURATIONS)[number];

export default function Projects() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const [generatingProject, setGeneratingProject] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<ClipGenerationJob | null>(null);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [subtitleOptions, setSubtitleOptions] = useState<Record<string, boolean>>({});
  const [watermarkOptions, setWatermarkOptions] = useState<Record<string, boolean>>({});
  const [framingOptions, setFramingOptions] = useState<Record<string, FramingMode>>({});
  const [captionStyleOptions, setCaptionStyleOptions] = useState<Record<string, CaptionStyle>>({});
  const [durationOptions, setDurationOptions] = useState<Record<string, ClipDuration>>({});
  const [generationModeOptions, setGenerationModeOptions] = useState<Record<string, "random" | "ai">>({});
  const [activeModalProjectId, setActiveModalProjectId] = useState<string | null>(null);
  const [defaultFraming, setDefaultFraming] = useState<FramingMode>("standard");
  const [defaultCaptionStyle, setDefaultCaptionStyle] = useState<CaptionStyle>("classic");
  const [defaultDuration, setDefaultDuration] = useState<ClipDuration>(30);
  const [defaultGenerationMode, setDefaultGenerationMode] = useState<"random" | "ai">("random");

  useEffect(() => {
    try {
      const savedFraming = localStorage.getItem("cliprobin_framing_mode");
      if (savedFraming && ["standard", "square_rounded", "true_9_16"].includes(savedFraming)) {
        setDefaultFraming(savedFraming as FramingMode);
      }
      const savedDuration = localStorage.getItem("cliprobin_clip_duration");
      if (savedDuration && [15, 30, 60, 90].includes(Number(savedDuration))) {
        setDefaultDuration(Number(savedDuration) as ClipDuration);
      }
      const savedMode = localStorage.getItem("cliprobin_generation_mode");
      if (savedMode && ["random", "ai"].includes(savedMode)) {
        setDefaultGenerationMode(savedMode as "random" | "ai");
      }
      const savedStyle = localStorage.getItem("cliprobin_caption_style");
      if (savedStyle && ["classic", "robin", "clean", "punch", "pill", "karaoke", "bold_emerald", "clean_gold"].includes(savedStyle)) {
        setDefaultCaptionStyle(savedStyle as CaptionStyle);
      } else {
        const stored = localStorage.getItem("cliprobin.settings");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.defaultCaptionStyle) setDefaultCaptionStyle(parsed.defaultCaptionStyle);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    getProjects()
      .then((result) => {
        setProjects(result.projects);
        setStatus(result.projects.length ? "" : "No projects yet.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load projects"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    let isCurrent = true;
    let timeoutId: number | undefined;
    let refreshCount = 0;

    const refreshActiveJobs = async () => {
      try {
        const jobs = await getActiveJobs();
        if (isCurrent) {
          setActiveJobs(jobs);
          refreshCount += 1;
          if (refreshCount % 3 === 0) {
            const result = await getProjects();
            if (isCurrent) {
              setProjects((current) => (
                JSON.stringify(current) === JSON.stringify(result.projects)
                  ? current
                  : result.projects
              ));
            }
          }
        }
      } catch (error) {
        console.error("Could not refresh project status", error);
      } finally {
        if (isCurrent) {
          timeoutId = window.setTimeout(() => void refreshActiveJobs(), 1000);
        }
      }
    };

    void refreshActiveJobs();
    return () => {
      isCurrent = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const handleDelete = async (projectId: string) => {
    if (!window.confirm(`Delete ${projectId} and all of its files? This cannot be undone.`)) {
      return;
    }

    setDeletingProject(projectId);
    setStatus(`Deleting ${projectId}...`);
    try {
      await deleteProject(projectId);
      setProjects((current) => current.filter((project) => project.project_id !== projectId));
      setStatus(`${projectId} deleted.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete project");
    } finally {
      setDeletingProject(null);
    }
  };

  const handleGenerate = async (projectId: string) => {
    setGeneratingProject(projectId);
    setProjects((current) => current.map((project) => project.project_id === projectId
      ? { ...project, clips: 0 }
      : project));
    setGenerationProgress({
      job_id: "",
      project_id: projectId,
      status: "queued",
      step: "Starting clip generation",
      progress: 0,
      completed_clips: 0,
      total_clips: 0,
      ready_clips: [],
    });
    setStatus(`Generating clips for ${projectId}...`);
    try {
      const result = await generateClips(
        projectId,
        subtitleOptions[projectId] ?? true,
        (job) => {
          setGenerationProgress(job);
          if (job.ready_clips && job.ready_clips.length > 0) {
            setProjects((current) => current.map((p) => p.project_id === projectId
              ? { ...p, clips: job.ready_clips!.length }
              : p));
          }
        },
        durationOptions[projectId] ?? defaultDuration,
        watermarkOptions[projectId] ?? true,
        framingOptions[projectId] ?? defaultFraming,
        captionStyleOptions[projectId] ?? defaultCaptionStyle,
      );
      setProjects((current) => current.map((project) => project.project_id === projectId
        ? { ...project, clips: result.clips.length }
        : project));
      if (result.cancelled) {
        setStatus(`Generation cancelled. Clips for ${projectId} were removed.`);
      } else {
        setStatus(`${result.clips.length} clips generated for ${projectId}.`);
        router.push(`/clips?project=${encodeURIComponent(projectId)}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Could not generate clips for ${projectId}`);
      setGenerationProgress((current) => current
        ? { ...current, status: "failed", step: "Clip generation failed" }
        : null);
    } finally {
      setGeneratingProject(null);
    }
  };

  const handleCancel = async (projectId: string) => {
    const activeJob = activeJobs.find((item) =>
      item.kind === "generation" && item.project_id === projectId);
    const job = generationProgress?.project_id === projectId
      ? generationProgress
      : activeJob
        ? {
            job_id: activeJob.id,
            project_id: activeJob.project_id,
            status: activeJob.status,
            step: activeJob.step,
            progress: activeJob.progress,
            completed_clips: activeJob.completed_clips ?? 0,
            total_clips: activeJob.total_clips ?? 0,
          }
        : null;
    if (job?.project_id !== projectId || !job.job_id || job.status === "cancelling") return;
    if (!window.confirm(`Cancel generation and remove all generated clips for ${projectId}? The source video and transcript will be kept.`)) {
      return;
    }
    try {
      const updatedJob = await cancelClipGeneration(projectId, job.job_id);
      setGenerationProgress(updatedJob);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not cancel clip generation");
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-6 lg:p-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Projects
          </h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Manage your imported videos and clip generation runs.
          </p>
          {status && <p className="mt-2 text-xs text-zinc-500">{status}</p>}
        </header>

        {isLoading ? (
          <div className="grid gap-6">
            <ProjectSkeletonCard />
            <ProjectSkeletonCard />
            <ProjectSkeletonCard />
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-[12px] border border-[#232326] bg-[#111113] p-10 text-center">
            <p className="text-sm font-medium text-zinc-300">No projects yet.</p>
            <p className="mt-1 text-xs text-zinc-500">Import a video from the dashboard to create your first project.</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-[10px] bg-[#10b981] px-4 py-2 text-xs font-semibold text-zinc-950 transition-all duration-150 hover:bg-[#059669]"
            >
              Go to Dashboard &rarr;
            </Link>
          </div>
        ) : (
          <div className="grid gap-6">
            {projects.map((project) => {
              const activeGeneration = activeJobs.find((job) =>
                job.kind === "generation" && job.project_id === project.project_id);
              const activeTranscription = activeJobs.find((job) =>
                job.kind === "transcription" && job.project_id === project.project_id);
              const projectProgress = generationProgress?.project_id === project.project_id
                ? generationProgress
                : activeGeneration
                  ? {
                      job_id: activeGeneration.id,
                      project_id: activeGeneration.project_id,
                      status: activeGeneration.status,
                      step: activeGeneration.step,
                      progress: activeGeneration.progress,
                      completed_clips: activeGeneration.completed_clips ?? 0,
                      total_clips: activeGeneration.total_clips ?? 0,
                      ready_clips: activeGeneration.ready_clips ?? [],
                    }
                  : null;
              const isGenerating = generatingProject === project.project_id || Boolean(activeGeneration);
              const isTranscribing = Boolean(activeTranscription);
              const readyClipsCount = projectProgress && projectProgress.total_clips > 0
                ? Math.max(project.clips, projectProgress.completed_clips, projectProgress.ready_clips?.length ?? 0)
                : project.clips;

              return (
                <article
                  key={project.project_id}
                  className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm transition-all duration-150"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-lg font-semibold font-mono text-white">{project.project_id}</h2>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                          project.status === "Ready" ? "bg-[#10b981]/15 text-[#10b981]" : "bg-amber-400/15 text-amber-300"
                        }`}>
                          {project.status}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-zinc-400">
                        Source: <span className="text-zinc-300">{project.source_type}</span> ·{" "}
                        {projectProgress && projectProgress.total_clips > 0 ? (
                          <span className="text-emerald-400 font-semibold font-mono">
                            {readyClipsCount} of {projectProgress.total_clips} clips ready
                            {projectProgress.status !== "completed" && " (rendering...)"}
                          </span>
                        ) : (
                          <span>{project.clips} {project.clips === 1 ? "clip" : "clips"} generated</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const currentFraming = framingOptions[project.project_id] ?? defaultFraming;
                    const currentCaptionStyle = captionStyleOptions[project.project_id] ?? defaultCaptionStyle;
                    const currentDuration = durationOptions[project.project_id] ?? defaultDuration;
                    const currentGenMode = generationModeOptions[project.project_id] ?? defaultGenerationMode;
                    const activeStyleOption =
                      CAPTION_STYLE_OPTIONS.find((s) => s.id === currentCaptionStyle) || CAPTION_STYLE_OPTIONS[0];
                    const previewUrls = getPreviewUrls(currentCaptionStyle);
                    const showSubs = subtitleOptions[project.project_id] ?? true;
                    const showWm = watermarkOptions[project.project_id] ?? true;

                    return (
                      <>
                        {/* Controls Grid: Aspect Ratio (16:9, 1:1, 9:16) + Captions Style */}
                        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Ratio Selector: 16:9, 1:1, 9:16 */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-zinc-400">
                              Aspect ratio &amp; framing
                            </label>
                            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Aspect ratio">
                              <button
                                type="button"
                                role="radio"
                                aria-checked={currentFraming === "standard"}
                                disabled={isGenerating || isTranscribing}
                                onClick={() => setFramingOptions((prev) => ({ ...prev, [project.project_id]: "standard" }))}
                                className={`flex flex-col items-center justify-center rounded-[10px] border p-2 text-center transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                                  currentFraming === "standard"
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
                                aria-checked={currentFraming === "square_rounded"}
                                disabled={isGenerating || isTranscribing}
                                onClick={() => setFramingOptions((prev) => ({ ...prev, [project.project_id]: "square_rounded" }))}
                                className={`flex flex-col items-center justify-center rounded-[10px] border p-2 text-center transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                                  currentFraming === "square_rounded"
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
                                aria-checked={currentFraming === "true_9_16"}
                                disabled={isGenerating || isTranscribing}
                                onClick={() => setFramingOptions((prev) => ({ ...prev, [project.project_id]: "true_9_16" }))}
                                className={`flex flex-col items-center justify-center rounded-[10px] border p-2 text-center transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                                  currentFraming === "true_9_16"
                                    ? "border-[#10b981] bg-[#10b981]/10 text-white ring-1 ring-[#10b981]"
                                    : "border-[#232326] bg-[#0a0a0a] text-zinc-400 hover:border-zinc-700 hover:text-white"
                                }`}
                              >
                                <span className="text-xs font-semibold">9:16</span>
                                <span className="text-[10px] text-purple-400 mt-0.5">AI Speaker</span>
                              </button>
                            </div>
                          </div>

                          {/* Captions Style Selector */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="block text-xs font-medium text-zinc-400">
                                Captions
                              </label>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={showSubs}
                                disabled={isGenerating || isTranscribing}
                                onClick={() => setSubtitleOptions((prev) => ({ ...prev, [project.project_id]: !showSubs }))}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-50 ${
                                  showSubs ? "bg-[#10b981]" : "bg-zinc-800"
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                                    showSubs ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </div>

                            {showSubs ? (
                              <div className="flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-2 transition-all duration-150 hover:border-zinc-700">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="relative aspect-[9/16] w-6 h-10 shrink-0 overflow-hidden rounded border border-[#232326] bg-black">
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
                                  disabled={isGenerating || isTranscribing}
                                  onClick={() => setActiveModalProjectId(project.project_id)}
                                  className="shrink-0 px-2.5 py-1 rounded-lg border border-[#232326] bg-[#111113] text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:bg-[#10b981]/10 hover:text-white transition-colors duration-150 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                                >
                                  Change
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center rounded-[10px] border border-dashed border-[#232326] bg-[#0a0a0a] p-2.5 text-xs text-zinc-500">
                                Captions disabled
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Row 2: Generation Mode (Random vs AI) + Clip Duration (15s, 30s, 60s, 90s) */}
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#232326]">
                          {/* Generation Mode Selector */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-zinc-400">
                              Generation mode
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={isGenerating || isTranscribing}
                                onClick={() => {
                                  setGenerationModeOptions((prev) => ({ ...prev, [project.project_id]: "random" }));
                                  try {
                                    localStorage.setItem("cliprobin_generation_mode", "random");
                                  } catch {}
                                }}
                                className={`rounded-[10px] border py-2 text-xs font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                                  currentGenMode === "random"
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
                                  className="w-full h-full rounded-[10px] border border-[#232326] bg-[#0a0a0a]/50 py-2 text-xs font-medium text-zinc-500 cursor-not-allowed flex items-center justify-center gap-1.5 group-hover:border-zinc-700 transition-all duration-150 pointer-events-none"
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

                          {/* Clip Duration Selector */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-zinc-400">
                              Clip duration
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                              {CLIP_DURATIONS.map((seconds) => {
                                const isSelected = currentDuration === seconds;
                                return (
                                  <button
                                    key={seconds}
                                    type="button"
                                    disabled={isGenerating || isTranscribing}
                                    onClick={() => {
                                      setDurationOptions((prev) => ({ ...prev, [project.project_id]: seconds }));
                                      try {
                                        localStorage.setItem("cliprobin_clip_duration", String(seconds));
                                      } catch {}
                                    }}
                                    className={`rounded-[10px] border py-2 text-xs font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
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
                        </div>

                        {/* Watermark Toggle Row */}
                        <div className="mt-3 flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3">
                          <span className="text-xs text-zinc-300">Add a watermark: Made with Clip Robin</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={showWm}
                            disabled={isGenerating || isTranscribing}
                            onClick={() => setWatermarkOptions((prev) => ({
                              ...prev,
                              [project.project_id]: !showWm,
                            }))}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-50 ${
                              showWm ? "bg-[#10b981]" : "bg-zinc-800"
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                                showWm ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </>
                    );
                  })()}

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleGenerate(project.project_id)}
                      disabled={generatingProject !== null || deletingProject !== null || activeGeneration !== undefined || isTranscribing || project.source_type === "Unknown"}
                      className="rounded-[10px] bg-[#10b981] px-4 py-2 text-xs font-semibold text-zinc-950 transition-all duration-150 hover:bg-[#059669] disabled:opacity-40 disabled:hover:bg-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                    >
                      {isGenerating
                        ? "Generating..."
                        : isTranscribing ? "Transcribing..."
                        : project.clips > 0 ? "Regenerate Clips" : "Generate Clips"}
                    </button>

                    <Link
                      href={`/clips?project=${encodeURIComponent(project.project_id)}`}
                      className="rounded-[10px] border border-[#232326] bg-transparent px-4 py-2 text-xs font-medium text-zinc-300 transition-all duration-150 hover:border-zinc-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                    >
                      {readyClipsCount > 0 ? `View Clips (${readyClipsCount})` : "View Clips"}
                    </Link>

                    <button
                      type="button"
                      onClick={() => void handleDelete(project.project_id)}
                      disabled={deletingProject !== null || generatingProject !== null || activeGeneration !== undefined || isTranscribing}
                      className="rounded-[10px] border border-red-500/20 px-3 py-2 text-xs font-medium text-red-400 transition-all duration-150 hover:bg-red-950/20 hover:border-red-500/40 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      {deletingProject === project.project_id ? "Deleting..." : "Delete Project"}
                    </button>
                  </div>

                  {activeTranscription && (
                    <section aria-live="polite" className="mt-5 rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-xs font-medium text-zinc-200">{activeTranscription.step}</p>
                        <p className="text-xs font-mono font-medium text-emerald-400">{activeTranscription.progress}%</p>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`Transcription progress for ${project.project_id}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={activeTranscription.progress}
                        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800"
                      >
                        <div
                          className="h-full rounded-full bg-[#10b981] transition-[width] duration-300"
                          style={{ width: `${activeTranscription.progress}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[11px] text-zinc-500">Clip generation will start automatically when transcription finishes.</p>
                    </section>
                  )}

                  {projectProgress && (
                    <section aria-live="polite" className="mt-5 rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-xs font-medium text-zinc-200">{projectProgress.step}</p>
                        <p className="text-xs font-mono font-medium text-emerald-400">{projectProgress.progress}%</p>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`Clip generation progress for ${project.project_id}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={projectProgress.progress}
                        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800"
                      >
                        <div
                          className="h-full rounded-full bg-[#10b981] transition-[width] duration-300"
                          style={{ width: `${projectProgress.progress}%` }}
                        />
                      </div>
                      <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-[11px] text-zinc-500">
                        <span>Preparing analysis</span>
                        <span>
                          Rendering clips
                          {projectProgress.total_clips > 0
                            ? ` (${projectProgress.completed_clips}/${projectProgress.total_clips})`
                            : ""}
                        </span>
                        <span>Saving clips</span>
                      </div>

                      {/* Live preview of ready clips and remaining skeletons */}
                      {(isGenerating || (projectProgress.ready_clips && projectProgress.ready_clips.length > 0)) && (
                        <div className="mt-4 pt-3 border-t border-[#232326]">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                              <span className="size-2 rounded-full bg-[#10b981] animate-pulse" />
                              {projectProgress.ready_clips && projectProgress.ready_clips.length > 0
                                ? `Ready clips (${projectProgress.ready_clips.length} of ${projectProgress.total_clips || "?"})`
                                : "Rendering & framing clips..."}
                            </p>
                            <Link
                              href={`/clips?project=${encodeURIComponent(project.project_id)}`}
                              className="text-[11px] text-zinc-400 hover:text-white underline underline-offset-2"
                            >
                              Open clips studio &rarr;
                            </Link>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {projectProgress.ready_clips?.slice(0, 4).map((clip) => (
                              <div key={clip.id} className="rounded-[8px] border border-[#232326] bg-[#111113] p-2.5 flex items-center justify-between text-xs">
                                <div className="min-w-0 pr-2">
                                  <p className="font-semibold text-white truncate">{clip.title}</p>
                                  <p className="text-[10px] text-zinc-400 font-mono">{clip.duration.toFixed(1)}s · {clip.status}</p>
                                </div>
                                <Link
                                  href={`/clips?project=${encodeURIComponent(project.project_id)}`}
                                  className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-[10px] text-emerald-400 hover:bg-zinc-700 font-medium"
                                >
                                  Watch
                                </Link>
                              </div>
                            ))}
                            {isGenerating && Array.from({
                              length: Math.min(
                                4,
                                Math.max(1, (projectProgress.total_clips || 4) - (projectProgress.ready_clips?.length ?? 0))
                              ),
                            }).map((_, i) => (
                              <div key={`proj-skel-${i}`} className="rounded-[8px] border border-[#232326] bg-[#111113] p-2.5 flex items-center justify-between">
                                <div className="space-y-1 flex-1">
                                  <div className="h-3 w-3/4 rounded bg-zinc-800/80 skeleton-shimmer" />
                                  <div className="h-2.5 w-1/3 rounded bg-zinc-800/50 skeleton-shimmer" />
                                </div>
                                <div className="size-4 animate-spin text-[#10b981] ml-2 shrink-0">
                                  <svg viewBox="0 0 24 24" fill="none">
                                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity=".2" />
                                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                                  </svg>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {["queued", "processing", "cancelling"].includes(projectProgress.status) && (
                        <button
                          type="button"
                          onClick={() => void handleCancel(project.project_id)}
                          disabled={!projectProgress.job_id || projectProgress.status === "cancelling"}
                          className="mt-3 rounded-[8px] border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
                        >
                          {projectProgress.status === "cancelling" ? "Cancelling..." : "Cancel generation"}
                        </button>
                      )}
                    </section>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <CaptionStylePicker
          isOpen={activeModalProjectId !== null}
          onClose={() => setActiveModalProjectId(null)}
          selectedStyle={
            activeModalProjectId
              ? (captionStyleOptions[activeModalProjectId] ?? defaultCaptionStyle)
              : defaultCaptionStyle
          }
          onSelect={(style) => {
            if (activeModalProjectId) {
              setCaptionStyleOptions((prev) => ({
                ...prev,
                [activeModalProjectId]: style,
              }));
              try {
                localStorage.setItem("cliprobin_caption_style", style);
              } catch {}
            }
          }}
        />
      </div>
    </main>
  );
}
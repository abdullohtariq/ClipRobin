"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CaptionAnimation,
  CaptionStyle,
  FramingMode,
  TrackingMode,
  ActiveJob,
  ClipGenerationJob,
  cancelClipGeneration,
  deleteProject,
  generateClips,
  getActiveJobs,
  getClips,
  getProjects,
  Project,
} from "@/src/lib/api";
import { ProjectSkeletonCard } from "@/src/components/skeletons";
import { ClipSettings, ClipDuration } from "@/src/components/clip-settings";
import { ModalDialog } from "@/src/components/ui/modal-dialog";
import { ConfirmDialog } from "@/src/components/ui/confirm-dialog";
import { StatusPill } from "@/src/components/ui/status-pill";
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

export default function Projects() {
  const { status: aiDeveloperStatus } = useAIDeveloperStatus();
  const { isPro, openUpgradeModal, isCaptionStyleAllowed, plan, session } = useSubscription();
  const hostedHookAccountId = !aiDeveloperStatus?.ai_enabled && plan?.hookCredits ? session?.user.id : undefined;
  const aiModeEnabled = Boolean(aiDeveloperStatus?.ai_enabled || hostedHookAccountId);
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
  const [trackingModeOptions, setTrackingModeOptions] = useState<Record<string, TrackingMode>>({});
  const [cropAnchorOptions, setCropAnchorOptions] = useState<Record<string, number>>({});
  const [captionStyleOptions, setCaptionStyleOptions] = useState<Record<string, CaptionStyle>>({});
  const [captionAnimationOptions, setCaptionAnimationOptions] = useState<Record<string, CaptionAnimation | null>>({});
  const [durationOptions, setDurationOptions] = useState<Record<string, ClipDuration>>({});
  const [generationModeOptions, setGenerationModeOptions] = useState<Record<string, "random" | "ai">>({});

  const [configureProjectId, setConfigureProjectId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const [defaultFraming, setDefaultFraming] = useState<FramingMode>("standard");
  const [defaultTrackingMode, setDefaultTrackingMode] = useState<TrackingMode>("locked");
  const [defaultCropAnchor, setDefaultCropAnchor] = useState<number>(0.5);
  const [defaultCaptionStyle, setDefaultCaptionStyle] = useState<CaptionStyle>("classic");
  const [defaultCaptionAnimation, setDefaultCaptionAnimation] = useState<CaptionAnimation | null>(null);
  const [defaultDuration, setDefaultDuration] = useState<ClipDuration>(30);
  const [defaultGenerationMode, setDefaultGenerationMode] = useState<"random" | "ai">("random");
  const [defaultSubtitles, setDefaultSubtitles] = useState<boolean>(true);
  const [defaultWatermark, setDefaultWatermark] = useState<boolean>(true);

  useEffect(() => {
    const syncDefaults = () => {
      try {
        const savedFraming = localStorage.getItem("cliprobin_framing_mode");
        if (savedFraming && ["standard", "square_rounded", "true_9_16"].includes(savedFraming)) {
          setDefaultFraming(savedFraming as FramingMode);
        }
        const savedTrackingMode = localStorage.getItem("cliprobin_tracking_mode");
        if (savedTrackingMode && ["locked", "cuts", "follow"].includes(savedTrackingMode)) {
          setDefaultTrackingMode(savedTrackingMode as TrackingMode);
        }
        const savedAnchor = localStorage.getItem("cliprobin_crop_anchor_x");
        if (savedAnchor !== null) {
          const parsedAnchor = Number(savedAnchor);
          if (!Number.isNaN(parsedAnchor) && parsedAnchor >= 0 && parsedAnchor <= 1) {
            setDefaultCropAnchor(parsedAnchor);
          }
        }
        const savedDuration = localStorage.getItem("cliprobin_clip_duration");
        if (savedDuration && [12, 15, 30, 60, 90].includes(Number(savedDuration))) {
          setDefaultDuration(Number(savedDuration) as ClipDuration);
        }
        const savedMode = localStorage.getItem("cliprobin_generation_mode");
        if (savedMode && ["random", "ai"].includes(savedMode)) {
          setDefaultGenerationMode(isPro && savedMode === "ai" ? "ai" : "random");
        }
        const savedSubs = localStorage.getItem("cliprobin_show_captions");
        if (savedSubs !== null) {
          setDefaultSubtitles(savedSubs === "true");
        }
        const savedWm = localStorage.getItem("cliprobin_show_watermark");
        if (!isPro) {
          setDefaultWatermark(true);
        } else if (savedWm !== null) {
          setDefaultWatermark(savedWm === "true");
        }
        const savedStyle = localStorage.getItem("cliprobin_caption_style");
        if (savedStyle) {
          const normalized = normalizeCaptionStyle(savedStyle);
          setDefaultCaptionStyle(isCaptionStyleAllowed(normalized) ? normalized : "classic");
        } else {
          const stored = localStorage.getItem("cliprobin.settings");
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.defaultCaptionStyle) {
              const normalized = normalizeCaptionStyle(parsed.defaultCaptionStyle);
              setDefaultCaptionStyle(isCaptionStyleAllowed(normalized) ? normalized : "classic");
            }
          }
        }
        const savedAnim = localStorage.getItem("cliprobin_caption_animation");
        if (savedAnim && ["pop", "grow", "sweep", "fade", "glide"].includes(savedAnim)) {
          setDefaultCaptionAnimation(savedAnim as CaptionAnimation);
        }
      } catch {}

      if (!isPro) {
        setWatermarkOptions((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) next[k] = true;
          return next;
        });
        setGenerationModeOptions((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) next[k] = "random";
          return next;
        });
        setCaptionStyleOptions((prev) => {
          const next = { ...prev };
          for (const [k, st] of Object.entries(next)) {
            if (!isCaptionStyleAllowed(st)) next[k] = "classic";
          }
          return next;
        });
      }
    };

    syncDefaults();
    window.addEventListener("cliprobin:subscription-changed", syncDefaults);
    return () => window.removeEventListener("cliprobin:subscription-changed", syncDefaults);
  }, [isPro, isCaptionStyleAllowed]);

  useEffect(() => {
    if (!aiDeveloperStatus || !plan || aiModeEnabled) return;
    setDefaultGenerationMode("random");
    setGenerationModeOptions((current) => {
      const next = { ...current };
      for (const [projectId, mode] of Object.entries(next)) {
        if (mode === "ai") next[projectId] = "random";
      }
      return next;
    });
    try { localStorage.setItem("cliprobin_generation_mode", "random"); } catch {}
  }, [aiDeveloperStatus, aiModeEnabled, plan]);

  useEffect(() => {
    const loadInitial = () => {
      getProjects()
        .then((result) => {
          setProjects(result.projects);
          setStatus(result.projects.length ? "" : "No projects yet.");
        })
        .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load projects"))
        .finally(() => setIsLoading(false));
    };
    loadInitial();
    window.addEventListener("cliprobin:queue-item-completed", loadInitial);
    return () => window.removeEventListener("cliprobin:queue-item-completed", loadInitial);
  }, []);

  useEffect(() => {
    let isCurrent = true;
    let timeoutId: number | undefined;
    let refreshCount = 0;
    let hadActiveJobs = false;

    const scheduleNext = (delayMs: number) => {
      if (!isCurrent) return;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (typeof document !== "undefined" && document.hidden) return;
      timeoutId = window.setTimeout(() => void refreshActiveJobs(), delayMs);
    };

    const refreshActiveJobs = async () => {
      if (!isCurrent) return;
      if (typeof document !== "undefined" && document.hidden) return;
      let nextDelay = 4000;
      try {
        const jobs = await getActiveJobs();
        if (isCurrent) {
          setActiveJobs((prev) => (prev.length === 0 && jobs.length === 0 ? prev : jobs));
          const hasActive = jobs.length > 0;
          nextDelay = hasActive ? 1000 : 4000;
          refreshCount += 1;
          if ((hasActive && refreshCount % 3 === 0) || (hadActiveJobs && !hasActive)) {
            const result = await getProjects();
            if (isCurrent) {
              setProjects((current) => (
                JSON.stringify(current) === JSON.stringify(result.projects)
                  ? current
                  : result.projects
              ));
            }
          }
          hadActiveJobs = hasActive;
        }
      } catch (error) {
        const isNetworkErr =
          error instanceof TypeError &&
          (error.message.includes("fetch") || error.message.includes("NetworkError") || error.message.includes("Failed"));
        if (!isNetworkErr) {
          console.error("Could not refresh project status", error);
        }
      } finally {
        scheduleNext(nextDelay);
      }
    };

    const handleVisibilityOrWake = () => {
      if (typeof document !== "undefined" && document.hidden) {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        return;
      }
      void refreshActiveJobs();
    };

    void refreshActiveJobs();
    document.addEventListener("visibilitychange", handleVisibilityOrWake);
    window.addEventListener("cliprobin:job-started", handleVisibilityOrWake);
    return () => {
      isCurrent = false;
      document.removeEventListener("visibilitychange", handleVisibilityOrWake);
      window.removeEventListener("cliprobin:job-started", handleVisibilityOrWake);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const executeDelete = async (projectId: string) => {
    setConfirmDeleteId(null);
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

  const handleRequestDelete = (projectId: string) => {
    let shouldConfirm = true;
    try {
      const stored = localStorage.getItem("cliprobin.settings");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.confirmDelete === false) shouldConfirm = false;
      }
    } catch {}

    if (shouldConfirm) {
      setConfirmDeleteId(projectId);
    } else {
      void executeDelete(projectId);
    }
  };

  const handleGenerate = async (projectId: string) => {
    setConfigureProjectId(null);
    const projectLabel = projects.find((p) => p.project_id === projectId)?.title || projectId;
    const chosenFraming = framingOptions[projectId] ?? defaultFraming;
    const rawStyle = normalizeCaptionStyle(captionStyleOptions[projectId] ?? defaultCaptionStyle);
    const effectiveStyle: CaptionStyle = isCaptionStyleAllowed(rawStyle) ? rawStyle : "classic";
    const rawGenMode = generationModeOptions[projectId] ?? defaultGenerationMode;
    const effectiveGenMode: "random" | "ai" =
      isPro && aiModeEnabled && rawGenMode === "ai" ? "ai" : "random";
    const effectiveTrackingMode: TrackingMode =
      chosenFraming === "true_9_16"
        ? (trackingModeOptions[projectId] ?? defaultTrackingMode)
        : "locked";
    const effectiveFaceTracking = effectiveTrackingMode === "follow";
    const effectiveAnchor = cropAnchorOptions[projectId] ?? defaultCropAnchor;

    setGeneratingProject(projectId);
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
    setStatus(`Generating clips for ${projectLabel}...`);
    try {
      const result = await generateClips(
        projectId,
        subtitleOptions[projectId] ?? defaultSubtitles,
        (job) => {
          setGenerationProgress(job);
        },
        durationOptions[projectId] ?? defaultDuration,
        isPro ? (watermarkOptions[projectId] ?? defaultWatermark) : true,
        chosenFraming,
        effectiveStyle,
        effectiveStyle === "classic"
          ? undefined
          : ((captionAnimationOptions[projectId] ?? defaultCaptionAnimation) || undefined),
        undefined,
        effectiveGenMode,
        effectiveFaceTracking,
        {
          trackingMode: effectiveTrackingMode,
          cropAnchorX: effectiveAnchor,
          hostedHookAccountId,
        },
      );
      if (result.cancelled) {
        const saved = await getClips(projectId).catch(() => null);
        if (saved) {
          setProjects((current) => current.map((project) => project.project_id === projectId
            ? { ...project, clips: saved.clips.length }
            : project));
        }
        setStatus(`Generation cancelled. Saved clips for ${projectLabel} were kept intact.`);
      } else {
        setProjects((current) => current.map((project) => project.project_id === projectId
          ? { ...project, clips: result.clips.length }
          : project));
        setStatus(`${result.clips.length} clips generated for ${projectLabel}.`);
        router.push(`/clips?project=${encodeURIComponent(projectId)}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Could not generate clips for ${projectLabel}`);
      setGenerationProgress((current) => current
        ? { ...current, status: "failed", step: "Clip generation failed" }
        : null);
    } finally {
      setGeneratingProject(null);
    }
  };

  const executeCancel = async (projectId: string) => {
    setConfirmCancelId(null);
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
    try {
      const updatedJob = await cancelClipGeneration(projectId, job.job_id);
      setGenerationProgress(updatedJob);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not cancel clip generation");
    }
  };

  const configureProject = configureProjectId
    ? projects.find((p) => p.project_id === configureProjectId) ?? null
    : null;

  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] p-4 md:p-8 xl:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-800/80">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#f4f4f5]">
              Projects
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Manage your imported videos and open any run in Clips Studio.
            </p>
          </div>
          <Link
            href="/"
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-[#10b981] px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-[#059669] active:scale-[0.985] transition-all focus-ring"
          >
            <span>+ New project</span>
          </Link>
        </header>

        {status && (
          <div className="rounded-xl border border-zinc-800 bg-[#121215] px-4 py-2.5 text-xs text-zinc-300 flex items-center justify-between gap-3">
            <span>{status}</span>
            <button
              type="button"
              onClick={() => setStatus("")}
              aria-label="Dismiss status"
              className="text-zinc-400 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ProjectSkeletonCard />
            <ProjectSkeletonCard />
            <ProjectSkeletonCard />
            <ProjectSkeletonCard />
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#121215] p-12 text-center space-y-3">
            <p className="text-sm font-semibold text-zinc-200">No projects yet</p>
            <p className="text-xs text-zinc-400">
              Import a video on the Dashboard to create your first clip project.
            </p>
            <Link
              href="/"
              className="mt-2 inline-flex items-center rounded-xl bg-[#10b981] px-4 py-2 text-xs font-bold text-zinc-950 transition-all hover:bg-[#059669] focus-ring"
            >
              Go to Dashboard &rarr;
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              const isBusy = isGenerating || isTranscribing || generatingProject !== null || deletingProject !== null;

              return (
                <article
                  key={project.project_id}
                  className="flex flex-col justify-between rounded-2xl border border-zinc-800 bg-[#121215] p-5 shadow-sm transition-all duration-150 hover:border-zinc-700 space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-[#f4f4f5] truncate" title={project.title || project.project_id}>
                          {project.title || project.project_id}
                        </h2>
                        {project.title && project.title !== project.project_id && (
                          <span className="text-xs font-mono text-zinc-500">
                            {project.project_id}
                          </span>
                        )}
                      </div>
                      <StatusPill
                        status={isTranscribing ? "transcribing" : isGenerating ? "rendering" : project.status}
                        progress={isTranscribing ? activeTranscription?.progress : isGenerating ? projectProgress?.progress : undefined}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span>{project.source_type}</span>
                      <span>·</span>
                      {projectProgress && projectProgress.total_clips > 0 ? (
                        <span className="text-emerald-400 font-medium font-mono">
                          {readyClipsCount} of {projectProgress.total_clips} clips ready
                        </span>
                      ) : (
                        <span>
                          {project.clips} {project.clips === 1 ? "clip" : "clips"}
                        </span>
                      )}
                      <span>·</span>
                      <span className="text-zinc-500">
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {activeTranscription && (
                    <section aria-live="polite" className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <p className="font-medium text-zinc-200 truncate">{activeTranscription.step}</p>
                        <p className="font-mono font-medium text-emerald-400 shrink-0">{activeTranscription.progress}%</p>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`Transcription progress for ${project.project_id}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={activeTranscription.progress}
                        className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
                      >
                        <div
                          className="h-full rounded-full bg-[#10b981] transition-[width] duration-300"
                          style={{ width: `${activeTranscription.progress}%` }}
                        />
                      </div>
                    </section>
                  )}

                  {projectProgress && (
                    <section aria-live="polite" className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <p className="font-medium text-zinc-200 truncate">{projectProgress.step}</p>
                        <p className="font-mono font-medium text-emerald-400 shrink-0">{projectProgress.progress}%</p>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`Clip generation progress for ${project.project_id}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={projectProgress.progress}
                        className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
                      >
                        <div
                          className="h-full rounded-full bg-[#10b981] transition-[width] duration-300"
                          style={{ width: `${projectProgress.progress}%` }}
                        />
                      </div>

                      {["queued", "processing", "cancelling"].includes(projectProgress.status) && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-xs text-zinc-400">
                            {projectProgress.total_clips > 0
                              ? `${projectProgress.completed_clips}/${projectProgress.total_clips} clips rendered`
                              : "Preparing video…"}
                          </span>
                          <button
                            type="button"
                            onClick={() => setConfirmCancelId(project.project_id)}
                            disabled={!projectProgress.job_id || projectProgress.status === "cancelling"}
                            className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-950/30 disabled:opacity-50 cursor-pointer focus-ring"
                          >
                            {projectProgress.status === "cancelling" ? "Cancelling…" : "Cancel"}
                          </button>
                        </div>
                      )}
                    </section>
                  )}

                  <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/clips?project=${encodeURIComponent(project.project_id)}`}
                      className="min-h-[38px] inline-flex items-center justify-center rounded-xl bg-[#10b981] px-4 py-2 text-xs font-bold text-zinc-950 transition-all hover:bg-[#059669] active:scale-[0.985] focus-ring"
                    >
                      {readyClipsCount > 0 ? `Open Studio (${readyClipsCount})` : "Open Studio"}
                    </Link>

                    <button
                      type="button"
                      onClick={() => setConfigureProjectId(project.project_id)}
                      disabled={isBusy || project.source_type === "Unknown"}
                      className="min-h-[38px] rounded-xl border border-zinc-700 bg-[#18181c] px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-[#202026] hover:text-white disabled:opacity-40 focus-ring cursor-pointer"
                    >
                      {isGenerating
                        ? "Generating…"
                        : isTranscribing
                        ? "Transcribing…"
                        : project.clips > 0
                        ? "Regenerate…"
                        : "Generate…"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRequestDelete(project.project_id)}
                      disabled={isBusy}
                      className="min-h-[38px] ml-auto rounded-xl border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-red-500/40 hover:bg-red-950/20 hover:text-red-300 disabled:opacity-40 focus-ring cursor-pointer"
                    >
                      {deletingProject === project.project_id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Shared Project Generation Settings Modal */}
        <ModalDialog
          open={Boolean(configureProject)}
          onClose={() => setConfigureProjectId(null)}
          ariaLabelledBy="project-settings-modal-title"
          className="max-w-3xl"
        >
          {configureProject && (
            <div className="w-full rounded-2xl border border-zinc-800 bg-[#121215] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-6 py-4">
                <div className="min-w-0">
                  <h2 id="project-settings-modal-title" className="text-base font-semibold text-[#f4f4f5] truncate">
                    {configureProject.clips > 0 ? "Regenerate clips" : "Generate clips"} · {configureProject.title || configureProject.project_id}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Configure framing, duration, captions, and watermark for this project.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfigureProjectId(null)}
                  aria-label="Close project settings"
                  className="size-8 rounded-lg border border-zinc-800 bg-[#18181c] text-zinc-400 hover:text-white flex items-center justify-center focus-ring cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 overflow-y-auto">
                <ClipSettings
                  variant="compact"
                  aiModeEnabled={aiModeEnabled}
                  includedHookCredits={hostedHookAccountId ? plan?.hookCredits?.availableNow ?? plan?.hookCredits?.remaining : undefined}
                  aiModeDisabledReason={aiDeveloperStatus?.reason}
                  generationMode={generationModeOptions[configureProject.project_id] ?? defaultGenerationMode}
                  onGenerationModeChange={(mode) => {
                    if (mode === "ai" && !isPro) {
                      openUpgradeModal("Gemini AI Hook Finder");
                      return;
                    }
                    setGenerationModeOptions((prev) => ({ ...prev, [configureProject.project_id]: mode }));
                    try { localStorage.setItem("cliprobin_generation_mode", mode); } catch {}
                  }}
                  clipDurationSeconds={durationOptions[configureProject.project_id] ?? defaultDuration}
                  onClipDurationChange={(dur) => {
                    setDurationOptions((prev) => ({ ...prev, [configureProject.project_id]: dur }));
                    try { localStorage.setItem("cliprobin_clip_duration", String(dur)); } catch {}
                  }}
                  framingMode={framingOptions[configureProject.project_id] ?? defaultFraming}
                  onFramingModeChange={(fm) => {
                    setFramingOptions((prev) => ({ ...prev, [configureProject.project_id]: fm }));
                    try { localStorage.setItem("cliprobin_framing_mode", fm); } catch {}
                  }}
                  trackingMode={trackingModeOptions[configureProject.project_id] ?? defaultTrackingMode}
                  onTrackingModeChange={(tm) => {
                    setTrackingModeOptions((prev) => ({ ...prev, [configureProject.project_id]: tm }));
                    try {
                      localStorage.setItem("cliprobin_tracking_mode", tm);
                      localStorage.setItem("cliprobin_face_tracking", String(tm === "follow"));
                    } catch {}
                  }}
                  cropAnchorX={cropAnchorOptions[configureProject.project_id] ?? defaultCropAnchor}
                  onCropAnchorXChange={(anchor) => {
                    setCropAnchorOptions((prev) => ({ ...prev, [configureProject.project_id]: anchor }));
                    try { localStorage.setItem("cliprobin_crop_anchor_x", String(anchor)); } catch {}
                  }}
                  showCaptions={subtitleOptions[configureProject.project_id] ?? defaultSubtitles}
                  onShowCaptionsChange={(subs) => {
                    setSubtitleOptions((prev) => ({ ...prev, [configureProject.project_id]: subs }));
                    try { localStorage.setItem("cliprobin_show_captions", String(subs)); } catch {}
                  }}
                  captionStyle={normalizeCaptionStyle(captionStyleOptions[configureProject.project_id] ?? defaultCaptionStyle)}
                  onCaptionStyleChange={(st) => {
                    if (!isCaptionStyleAllowed(st)) {
                      openUpgradeModal("Pro Subtitle Styles");
                      return;
                    }
                    setCaptionStyleOptions((prev) => ({ ...prev, [configureProject.project_id]: st }));
                    try { localStorage.setItem("cliprobin_caption_style", st); } catch {}
                  }}
                  captionAnimation={captionAnimationOptions[configureProject.project_id] ?? defaultCaptionAnimation}
                  onCaptionAnimationChange={(anim) => {
                    setCaptionAnimationOptions((prev) => ({ ...prev, [configureProject.project_id]: anim }));
                    try {
                      if (anim) localStorage.setItem("cliprobin_caption_animation", anim);
                      else localStorage.removeItem("cliprobin_caption_animation");
                    } catch {}
                  }}
                  showWatermark={isPro ? (watermarkOptions[configureProject.project_id] ?? defaultWatermark) : true}
                  onShowWatermarkChange={(wm) => {
                    if (!wm && !isPro) {
                      openUpgradeModal("Watermark Removal");
                      return;
                    }
                    setWatermarkOptions((prev) => ({ ...prev, [configureProject.project_id]: wm }));
                    try { localStorage.setItem("cliprobin_show_watermark", String(wm)); } catch {}
                  }}
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-zinc-800 px-6 py-4 bg-[#0c0c0e]">
                <button
                  type="button"
                  onClick={() => setConfigureProjectId(null)}
                  className="min-h-[40px] rounded-xl border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors focus-ring cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerate(configureProject.project_id)}
                  className="min-h-[40px] rounded-xl bg-[#10b981] px-5 py-2 text-xs font-bold text-zinc-950 hover:bg-[#059669] active:scale-[0.985] transition-all focus-ring cursor-pointer"
                >
                  {configureProject.clips > 0 ? "Regenerate Clips" : "Generate Clips"}
                </button>
              </div>
            </div>
          )}
        </ModalDialog>

        <ConfirmDialog
          open={Boolean(confirmDeleteId)}
          title="Delete project?"
          description={`Delete ${confirmDeleteId ?? ""} and all of its local video and clip files? This cannot be undone.`}
          confirmLabel="Delete project"
          variant="danger"
          onConfirm={() => {
            if (confirmDeleteId) void executeDelete(confirmDeleteId);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />

        <ConfirmDialog
          open={Boolean(confirmCancelId)}
          title="Cancel clip generation?"
          description={`Stop generating clips for ${confirmCancelId ?? ""}? Previously saved clips and the source video will be kept.`}
          confirmLabel="Cancel generation"
          variant="danger"
          onConfirm={() => {
            if (confirmCancelId) void executeCancel(confirmCancelId);
          }}
          onCancel={() => setConfirmCancelId(null)}
        />
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActiveJob,
  ClipGenerationJob,
  cancelClipGeneration,
  deleteProject,
  generateClips,
  getActiveJobs,
  getProjects,
  Project,
} from "@/src/lib/api";

export default function Projects() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState("Loading projects...");
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const [generatingProject, setGeneratingProject] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<ClipGenerationJob | null>(null);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [subtitleOptions, setSubtitleOptions] = useState<Record<string, boolean>>({});
  const [watermarkOptions, setWatermarkOptions] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getProjects()
      .then((result) => {
        setProjects(result.projects);
        setStatus(result.projects.length ? "" : "No projects yet.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load projects"));
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
    });
    setStatus(`Generating clips for ${projectId}...`);
    try {
      const result = await generateClips(
        projectId,
        subtitleOptions[projectId] ?? true,
        setGenerationProgress,
        60,
        watermarkOptions[projectId] ?? true,
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
                  }
                : null;
            const isGenerating = generatingProject === project.project_id || Boolean(activeGeneration);
            const isTranscribing = Boolean(activeTranscription);

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
                      Source: <span className="text-zinc-300">{project.source_type}</span> · {project.clips} {project.clips === 1 ? "clip" : "clips"} generated
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3.5">
                  <span className="text-xs text-zinc-300">Burn animated captions into generated clips</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={subtitleOptions[project.project_id] ?? true}
                    disabled={generatingProject !== null || activeGeneration !== undefined || isTranscribing}
                    onClick={() => setSubtitleOptions((current) => ({
                      ...current,
                      [project.project_id]: !(subtitleOptions[project.project_id] ?? true),
                    }))}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-50 ${
                      (subtitleOptions[project.project_id] ?? true) ? "bg-[#10b981]" : "bg-zinc-800"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                        (subtitleOptions[project.project_id] ?? true) ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3.5">
                  <span className="text-xs text-zinc-300">Add a watermark: Made with Clip Robin</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={watermarkOptions[project.project_id] ?? true}
                    disabled={generatingProject !== null || activeGeneration !== undefined || isTranscribing}
                    onClick={() => setWatermarkOptions((current) => ({
                      ...current,
                      [project.project_id]: !(watermarkOptions[project.project_id] ?? true),
                    }))}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] disabled:opacity-50 ${
                      (watermarkOptions[project.project_id] ?? true) ? "bg-[#10b981]" : "bg-zinc-800"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                        (watermarkOptions[project.project_id] ?? true) ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

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
                    View Clips
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
      </div>
    </main>
  );
}
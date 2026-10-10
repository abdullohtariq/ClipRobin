"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipGenerationJob,
  cancelClipGeneration,
  deleteProject,
  generateClips,
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
  const [subtitleOptions, setSubtitleOptions] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getProjects()
      .then((result) => {
        setProjects(result.projects);
        setStatus(result.projects.length ? "" : "No projects yet.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load projects"));
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
    const job = generationProgress;
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
    <main className="min-h-screen bg-zinc-950 text-white p-10">
      <h1 className="text-3xl font-semibold">
        Projects
      </h1>

      <p className="mt-2 text-zinc-400">{status}</p>
      <div className="mt-8 grid max-w-3xl gap-4">
        {projects.map((project) => (
          <article key={project.project_id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-xl font-medium">{project.project_id}</h2>
            <p className="mt-2 text-sm text-zinc-400">Source: {project.source_type}</p>
            <p className="text-sm text-zinc-400">Clips: {project.clips}</p>
            <p className="text-sm text-zinc-400">Status: {project.status}</p>
            <label className="mt-4 flex w-fit cursor-pointer items-center gap-3 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={subtitleOptions[project.project_id] ?? true}
                onChange={(event) => setSubtitleOptions((current) => ({
                  ...current,
                  [project.project_id]: event.target.checked,
                }))}
                disabled={generatingProject !== null}
                className="size-4 accent-white"
              />
              Burn animated captions into generated clips
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              <button
                type="button"
                onClick={() => void handleGenerate(project.project_id)}
                disabled={generatingProject !== null || deletingProject !== null || project.source_type === "Unknown"}
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                {generatingProject === project.project_id
                  ? "Generating..."
                  : project.clips > 0 ? "Regenerate Clips" : "Generate Clips"}
              </button>
              <Link href={`/clips?project=${encodeURIComponent(project.project_id)}`} className="text-sm text-white underline">View Clips</Link>
              <button
                type="button"
                onClick={() => void handleDelete(project.project_id)}
                disabled={deletingProject !== null || generatingProject !== null}
                className="text-sm text-red-400 underline hover:text-red-300 disabled:opacity-50"
              >
                {deletingProject === project.project_id ? "Deleting..." : "Delete Project"}
              </button>
            </div>
            {generationProgress?.project_id === project.project_id && (
              <section aria-live="polite" className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-zinc-200">{generationProgress.step}</p>
                  <p className="text-sm tabular-nums text-zinc-400">{generationProgress.progress}%</p>
                </div>
                <div
                  role="progressbar"
                  aria-label={`Clip generation progress for ${project.project_id}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={generationProgress.progress}
                  className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-700"
                >
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
                    style={{ width: `${generationProgress.progress}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
                  <span>Preparing analysis</span>
                  <span>
                    Rendering clips
                    {generationProgress.total_clips > 0
                      ? ` (${generationProgress.completed_clips}/${generationProgress.total_clips})`
                      : ""}
                  </span>
                  <span>Saving clips</span>
                </div>
                {["queued", "processing", "cancelling"].includes(generationProgress.status) && (
                  <button
                    type="button"
                    onClick={() => void handleCancel(project.project_id)}
                    disabled={!generationProgress.job_id || generationProgress.status === "cancelling"}
                    className="mt-4 rounded-md border border-red-500/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/50 disabled:opacity-50"
                  >
                    {generationProgress.status === "cancelling" ? "Cancelling..." : "Cancel generation"}
                  </button>
                )}
              </section>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
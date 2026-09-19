"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProjects, Project } from "@/src/lib/api";

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState("Loading projects...");

  useEffect(() => {
    getProjects()
      .then((result) => {
        setProjects(result.projects);
        setStatus(result.projects.length ? "" : "No projects yet.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load projects"));
  }, []);

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
            <Link href={`/clips?project=${project.project_id}`} className="mt-4 inline-block text-sm text-white underline">Open Project</Link>
          </article>
        ))}
      </div>
    </main>
  );
}
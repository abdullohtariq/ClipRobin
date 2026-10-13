"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActiveJob, getActiveJobs } from "@/src/lib/api";

export default function JobProgress() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    let timeoutId: number | undefined;
    let emptySince: number | undefined;

    const refreshJobs = async () => {
      try {
        const activeJobs = await getActiveJobs();
        if (isMounted) {
          if (activeJobs.length > 0) {
            emptySince = undefined;
            setJobs(activeJobs);
          } else if (emptySince === undefined) {
            emptySince = Date.now();
          } else if (Date.now() - emptySince >= 5000) {
            setJobs([]);
          }
          setError("");
        }
      } catch (requestError) {
        if (isMounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not check active job progress",
          );
        }
      } finally {
        if (isMounted) {
          timeoutId = window.setTimeout(() => void refreshJobs(), 1000);
        }
      }
    };

    void refreshJobs();
    return () => {
      isMounted = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  if (jobs.length === 0 && !error) {
    return null;
  }

  return (
    <div className="group fixed bottom-5 right-5 z-50">
      <section
        aria-label="Active job progress"
        className="absolute bottom-[44px] right-0 hidden w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl group-hover:block group-focus-within:block"
      >
        <h2 className="mb-3 text-sm font-semibold text-white">
          {jobs.length > 0 ? "In progress" : "Progress unavailable"}
        </h2>
        {error && (
          <p role="status" className="mb-3 text-xs text-amber-300">
            {error}
          </p>
        )}
        <ul className="space-y-4">
          {jobs.map((job) => (
            <li key={`${job.kind}-${job.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {job.kind === "transcription" ? "Transcribing video" : "Generating clips"}
                  </p>
                  <p className="mt-1 truncate text-xs text-zinc-400">
                    {job.project_id} · {job.step}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-zinc-300">
                  {job.progress}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${job.kind === "transcription" ? "Transcription" : "Clip generation"} progress for ${job.project_id}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.progress}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-700"
              >
                <div
                  className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              {job.kind === "generation" && (job.total_clips ?? 0) > 0 && (
                <p className="mt-1 text-right text-xs text-zinc-500">
                  {job.completed_clips ?? 0} of {job.total_clips} clips
                </p>
              )}
              {job.kind === "generation" && (
                <Link
                  href="/projects"
                  className="mt-2 inline-block text-xs text-emerald-300 underline hover:text-emerald-200"
                >
                  Go to Projects
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        aria-label={`${jobs.length} active ${jobs.length === 1 ? "job" : "jobs"}. Focus or hover to view progress.`}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-emerald-300 shadow-lg transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          className={`h-5 w-5 ${jobs.length > 0 ? "animate-spin" : ""}`}
        >
          {jobs.length > 0 ? (
            <>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8v5m0 3h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </>
          )}
        </svg>
        {jobs.length > 1 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold text-zinc-950">
            {jobs.length}
          </span>
        )}
      </button>
    </div>
  );
}

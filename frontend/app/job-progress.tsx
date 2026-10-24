"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActiveJob, getActiveJobs } from "@/src/lib/api";

export default function JobProgress() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(false);

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
          timeoutId = window.setTimeout(() => void refreshJobs(), 700);
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

  const hasDownloadJob = jobs.some((job) => job.kind === "download");
  const downloadJob = jobs.find((job) => job.kind === "download");

  return (
    <div className="group fixed bottom-5 right-5 z-50">
      <section
        aria-label="Active job progress"
        className={`absolute bottom-[52px] right-0 w-84 max-w-[calc(100vw-2.5rem)] rounded-[12px] border border-[#232326] bg-[#111113] p-4 shadow-2xl transition-all duration-150 ${
          isOpen ? "block" : "hidden group-hover:block group-focus-within:block"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            {jobs.length > 0 ? "Active Jobs" : "Status unavailable"}
          </h2>
          {hasDownloadJob && (
            <span className="inline-flex items-center gap-1 rounded bg-[#10b981]/15 px-1.5 py-0.5 text-xs font-semibold text-[#10b981]">
              <span className="size-1.5 rounded-full bg-[#10b981] animate-ping" />
              Downloading
            </span>
          )}
        </div>

        {error && (
          <p role="status" className="mb-3 text-xs text-amber-300">
            {error}
          </p>
        )}

        <ul className="space-y-3.5">
          {jobs.map((job) => (
            <li key={`${job.kind}-${job.id}`} className="rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">
                    {job.kind === "download"
                      ? "Downloading video"
                      : job.kind === "transcription"
                      ? "Transcribing audio"
                      : "Generating clips"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-400" title={job.title || job.step}>
                    <span className="font-mono text-zinc-300">
                      {job.title ? `${job.title.slice(0, 24)}...` : job.project_id}
                    </span>{" "}
                    · {job.step}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-mono font-medium text-emerald-400">
                  {Math.round(job.progress)}%
                </span>
              </div>

              <div
                role="progressbar"
                aria-label={`${
                  job.kind === "download"
                    ? "Download"
                    : job.kind === "transcription"
                    ? "Transcription"
                    : "Clip generation"
                } progress for ${job.project_id}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(job.progress)}
                className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800"
              >
                <div
                  className="h-full rounded-full bg-[#10b981] transition-[width] duration-200"
                  style={{ width: `${Math.max(4, Math.round(job.progress))}%` }}
                />
              </div>

              {job.kind === "generation" && (job.total_clips ?? 0) > 0 && (
                <p className="mt-1.5 text-right text-xs text-zinc-500">
                  {job.completed_clips ?? 0} of {job.total_clips} clips rendered
                </p>
              )}

              {job.kind === "generation" && (
                <Link
                  href="/projects"
                  className="mt-1.5 inline-block text-xs text-emerald-400 underline hover:text-emerald-300"
                >
                  Go to Projects &rarr;
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Circle button on bottom right */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`${jobs.length} active ${jobs.length === 1 ? "job" : "jobs"}. ${
          hasDownloadJob ? `Video downloading (${Math.round(downloadJob?.progress || 0)}%).` : ""
        } Click or hover to view progress.`}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full border bg-[#111113] text-emerald-400 shadow-xl transition-all duration-150 hover:border-zinc-700 hover:bg-[#18181b] focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
          hasDownloadJob
            ? "border-[#10b981] ring-2 ring-[#10b981]/50 ring-offset-2 ring-offset-[#0a0a0a]"
            : "border-[#232326]"
        }`}
      >
        {hasDownloadJob ? (
          <div className="relative flex items-center justify-center">
            {/* Spinning ring */}
            <svg
              className="size-5.5 animate-spin text-emerald-400"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
            </svg>
            {/* Center download arrow */}
            <svg
              className="absolute size-2.5 text-emerald-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v11m0 0 3.5-3.5M12 14 8.5 10.5M5 19h14" />
            </svg>
          </div>
        ) : jobs.length > 0 ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            className="size-5 animate-spin"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            className="size-5"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 8v5m0 3h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        )}

        {jobs.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#10b981] px-1 text-xs font-bold text-zinc-950 ring-2 ring-[#0a0a0a]">
            {jobs.length}
          </span>
        )}
      </button>
    </div>
  );
}

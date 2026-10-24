"use client";

import React from "react";

export function ClipSkeletonCard({
  index,
  total,
  message,
}: {
  index?: number;
  total?: number;
  message?: string;
}) {
  return (
    <article
      aria-label="Loading clip placeholder"
      className="relative flex flex-col justify-between rounded-xl border border-zinc-800 bg-[#111114] p-5 shadow-sm overflow-hidden"
    >
      {/* 9:16 Video preview skeleton */}
      <div className="relative aspect-[9/16] w-full max-w-xs rounded-lg border border-zinc-800/60 bg-zinc-900/60 overflow-hidden flex flex-col items-center justify-center p-4">
        {/* Shimmer background */}
        <div className="absolute inset-0 skeleton-shimmer opacity-30 pointer-events-none" />

        {/* Pulsing center indicator */}
        <div className="relative z-10 flex flex-col items-center gap-2.5 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-zinc-800/90 border border-zinc-700/50 shadow-inner">
            <svg
              className="size-5 animate-spin text-[#10b981]"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeOpacity=".2"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-zinc-200">
              {message
                ? message
                : index !== undefined && total !== undefined
                ? `Clip ${index} of ${total}`
                : index !== undefined
                ? `Clip ${index}`
                : "Rendering clip..."}
            </p>
            <p className="text-xs text-zinc-500 font-mono">
              Generating vertical 9:16
            </p>
          </div>
        </div>
      </div>

      {/* Media control & download skeletons */}
      <div className="mt-3 flex max-w-xs items-center gap-2">
        <div className="h-7 w-24 rounded-lg bg-zinc-800/70 skeleton-shimmer shrink-0" />
        <div className="h-4 flex-1 rounded bg-zinc-800/40 skeleton-shimmer" />
      </div>

      <div className="mt-3">
        <div className="h-7 w-28 rounded-lg bg-zinc-800/70 skeleton-shimmer" />
      </div>

      {/* Title & metadata lines */}
      <div className="mt-3.5 space-y-2">
        <div className="h-4 w-4/5 rounded bg-zinc-800/80 skeleton-shimmer" />
        <div className="h-3 w-1/2 rounded bg-zinc-800/50 skeleton-shimmer" />
        <div className="h-3 w-20 rounded bg-emerald-950/40 skeleton-shimmer" />
      </div>
    </article>
  );
}

export function ProjectSkeletonCard() {
  return (
    <article
      aria-label="Loading project placeholder"
      className="rounded-xl border border-zinc-800 bg-[#121215] p-5 shadow-sm space-y-4 overflow-hidden"
    >
      {/* Header with Title and Status */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="h-5 w-44 rounded bg-zinc-800/90 skeleton-shimmer" />
            <div className="h-4 w-14 rounded bg-zinc-800/60 skeleton-shimmer" />
          </div>
          <div className="h-3.5 w-56 rounded bg-zinc-800/50 skeleton-shimmer" />
        </div>
      </div>

      {/* Settings Row Placeholder */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-[#0a0a0c] p-3">
        <div className="h-4 w-48 rounded bg-zinc-800/60 skeleton-shimmer" />
        <div className="h-5 w-9 rounded-full bg-zinc-800 skeleton-shimmer" />
      </div>

      {/* Action Buttons Row */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <div className="h-8 w-24 rounded-lg bg-zinc-800/80 skeleton-shimmer" />
        <div className="h-8 w-20 rounded-lg bg-zinc-800/50 skeleton-shimmer" />
        <div className="h-8 w-20 rounded-lg bg-zinc-800/40 skeleton-shimmer" />
      </div>
    </article>
  );
}

export function RecentProjectSkeletonItem() {
  return (
    <li
      aria-label="Loading project item"
      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5"
    >
      <div className="min-w-0 pr-3 space-y-1.5 flex-1">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-32 rounded bg-zinc-800/90 skeleton-shimmer" />
          <div className="size-1.5 rounded-full bg-zinc-800 skeleton-shimmer" />
        </div>
        <div className="h-2.5 w-24 rounded bg-zinc-800/50 skeleton-shimmer" />
      </div>
      <div className="h-6 w-16 rounded-md bg-zinc-800/70 skeleton-shimmer shrink-0" />
    </li>
  );
}

export function DashboardProjectSkeleton() {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-[#0c0c0e] p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="h-4 w-28 rounded bg-zinc-800/90 skeleton-shimmer" />
          <div className="h-5 w-16 rounded-full bg-zinc-800/60 skeleton-shimmer" />
        </div>
        <div className="h-3 w-36 rounded bg-zinc-800/50 skeleton-shimmer" />
      </div>
      <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
        <div className="h-3 w-16 rounded bg-zinc-800/40 skeleton-shimmer" />
        <div className="h-4 w-20 rounded bg-zinc-800/60 skeleton-shimmer" />
      </div>
    </div>
  );
}

"use client";

import React from "react";

export type StatusPillKind =
  | "ready"
  | "completed"
  | "rendering"
  | "transcribing"
  | "queued"
  | "failed"
  | "cancelled"
  | "neutral";

export interface StatusPillProps {
  status: StatusPillKind | string;
  label?: string;
  progress?: number;
  className?: string;
}

export function StatusPill({
  status,
  label,
  progress,
  className = "",
}: StatusPillProps) {
  const normalized = (status || "").toLowerCase();

  let dotColor = "bg-zinc-400";
  let textColor = "text-zinc-300";
  let bgColor = "bg-zinc-800/80 border-zinc-700/60";
  let defaultLabel = "Ready";
  let isAnimated = false;

  if (normalized === "ready" || normalized === "completed") {
    dotColor = "bg-emerald-400";
    textColor = "text-emerald-300";
    bgColor = "bg-emerald-500/10 border-emerald-500/25";
    defaultLabel = "Ready";
  } else if (normalized === "rendering" || normalized === "processing") {
    dotColor = "bg-amber-400";
    textColor = "text-amber-300";
    bgColor = "bg-amber-400/10 border-amber-400/25";
    defaultLabel = progress !== undefined ? `Rendering ${progress}%` : "Rendering";
    isAnimated = true;
  } else if (normalized === "transcribing") {
    dotColor = "bg-amber-400";
    textColor = "text-amber-300";
    bgColor = "bg-amber-400/10 border-amber-400/25";
    defaultLabel = progress !== undefined ? `Transcribing ${progress}%` : "Transcribing";
    isAnimated = true;
  } else if (normalized === "queued") {
    dotColor = "bg-blue-400";
    textColor = "text-blue-300";
    bgColor = "bg-blue-400/10 border-blue-400/25";
    defaultLabel = "Queued";
  } else if (normalized === "failed" || normalized === "error") {
    dotColor = "bg-red-400";
    textColor = "text-red-300";
    bgColor = "bg-red-500/10 border-red-500/25";
    defaultLabel = "Failed";
  } else if (normalized === "cancelled") {
    dotColor = "bg-zinc-500";
    textColor = "text-zinc-400";
    bgColor = "bg-zinc-800/60 border-zinc-700/40";
    defaultLabel = "Cancelled";
  }

  const displayText = label || defaultLabel;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap transition-colors duration-150 ${bgColor} ${textColor} ${className}`}
    >
      <span
        className={`size-1.5 rounded-full shrink-0 ${dotColor} ${
          isAnimated ? "animate-pulse" : ""
        }`}
      />
      <span className="tabular-nums">{displayText}</span>
    </span>
  );
}

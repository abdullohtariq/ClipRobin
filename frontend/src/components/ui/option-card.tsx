"use client";

import React from "react";

export interface OptionCardProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  previewGraphic: React.ReactNode;
  className?: string;
}

export function OptionCard({
  title,
  subtitle,
  badge,
  selected,
  disabled = false,
  onClick,
  previewGraphic,
  className = "",
}: OptionCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`group relative flex flex-col items-center justify-between rounded-xl border p-3.5 text-center transition-all duration-150 focus-ring ${
        selected
          ? "border-[#10b981] bg-[#10b981]/5 shadow-[0_0_0_1px_rgba(16,185,129,0.3)] ring-1 ring-[#10b981]"
          : "border-zinc-800 bg-[#121215] hover:border-zinc-700 hover:bg-[#16161a]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${className}`}
    >
      {/* Top right checkmark or status indicator */}
      {selected && (
        <span className="absolute top-2.5 right-2.5 flex size-4 items-center justify-center rounded-full bg-[#10b981] text-zinc-950">
          <svg className="size-2.5 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}

      {/* Top Badge positioned neatly inside the card */}
      {badge && (
        <div className="absolute top-2.5 left-2.5 z-10">
          {badge}
        </div>
      )}

      {/* Graphic Preview Box */}
      <div className="my-2 flex w-full items-center justify-center overflow-hidden py-1">
        {previewGraphic}
      </div>

      {/* Title & Subtitle */}
      <div className="w-full min-w-0 pt-2 border-t border-zinc-800/80">
        <p className="text-[13px] font-semibold text-white tracking-tight leading-snug">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-xs text-zinc-400 font-normal truncate">
            {subtitle}
          </p>
        )}
      </div>
    </button>
  );
}

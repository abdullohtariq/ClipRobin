"use client";

import React, { useState } from "react";
import { CaptionStyle, FramingMode } from "@/src/lib/api";
import {
  CaptionStylePicker,
  CAPTION_STYLE_OPTIONS,
  CaptionVisualSample,
} from "./caption-style-picker";
import { SegmentedControl } from "./ui/segmented-control";
import { ToggleRow } from "./ui/toggle-row";
import { OptionCard } from "./ui/option-card";
import { Badge } from "./ui/badge";

export const CLIP_DURATIONS = [12, 30, 60, 90] as const;
export type ClipDuration = (typeof CLIP_DURATIONS)[number];

export interface ClipSettingsProps {
  variant?: "full" | "compact";
  generationMode: "random" | "ai";
  onGenerationModeChange: (mode: "random" | "ai") => void;
  clipDurationSeconds: ClipDuration;
  onClipDurationChange: (duration: ClipDuration) => void;
  clipCount?: number;
  onClipCountChange?: (count: number) => void;
  maxClips?: number;
  framingMode: FramingMode;
  onFramingModeChange: (mode: FramingMode) => void;
  showCaptions: boolean;
  onShowCaptionsChange: (show: boolean) => void;
  captionStyle: CaptionStyle;
  onCaptionStyleChange: (style: CaptionStyle) => void;
  showWatermark: boolean;
  onShowWatermarkChange: (show: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ClipSettings({
  variant = "full",
  generationMode,
  onGenerationModeChange,
  clipDurationSeconds,
  onClipDurationChange,
  clipCount = 3,
  onClipCountChange,
  maxClips = 10,
  framingMode,
  onFramingModeChange,
  showCaptions,
  onShowCaptionsChange,
  captionStyle,
  onCaptionStyleChange,
  showWatermark,
  onShowWatermarkChange,
  disabled = false,
  className = "",
}: ClipSettingsProps) {
  const [isCaptionPickerOpen, setIsCaptionPickerOpen] = useState(false);

  const activeStyleOption =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === captionStyle) || CAPTION_STYLE_OPTIONS[0];

  const durationOptions = CLIP_DURATIONS.map((sec) => ({
    value: sec,
    label: `${sec}s`,
  }));

  const modeOptions = [
    {
      value: "random" as const,
      label: "Random",
    },
    {
      value: "ai" as const,
      label: "AI",
      badge: <Badge variant="purple" size="sm">Soon</Badge>,
      disabled: true,
      tooltip: "AI mode is in development and coming soon",
    },
  ];

  return (
    <div className={`space-y-5 ${className}`}>
      {/* 1. Generation Mode, Clip Length & Clip Count Row */}
      <div className={onClipCountChange ? "grid grid-cols-1 sm:grid-cols-3 gap-3.5" : (variant === "full" ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-3")}>
        {/* Generation Mode */}
        <div>
          <label className="block text-[13px] font-medium text-zinc-300 mb-2">
            Generation mode
          </label>
          <SegmentedControl
            options={modeOptions}
            value={generationMode}
            onChange={onGenerationModeChange}
            disabled={disabled}
            ariaLabel="Generation mode selection"
          />
        </div>

        {/* Clip Length */}
        <div>
          <label className="block text-[13px] font-medium text-zinc-300 mb-2">
            Clip length
          </label>
          <SegmentedControl
            options={durationOptions}
            value={clipDurationSeconds}
            onChange={onClipDurationChange}
            disabled={disabled}
            ariaLabel="Clip length duration selection"
          />
        </div>

        {/* Clip Count Selector */}
        {onClipCountChange && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[13px] font-medium text-zinc-300">
                Number of clips
              </label>
              <span className="text-[11px] text-zinc-400 font-medium">
                Max: {maxClips}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#0c0c0e] p-1 h-9">
              <button
                type="button"
                onClick={() => onClipCountChange(Math.max(1, clipCount - 1))}
                disabled={disabled || clipCount <= 1}
                aria-label="Decrease clip count"
                className="flex h-7 w-8 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                −
              </button>
              <span className="text-xs font-bold text-zinc-100 tabular-nums px-2 select-none">
                {clipCount} {clipCount === 1 ? "clip" : "clips"}
              </span>
              <button
                type="button"
                onClick={() => onClipCountChange(Math.min(maxClips, clipCount + 1))}
                disabled={disabled || clipCount >= maxClips}
                aria-label="Increase clip count"
                className="flex h-7 w-8 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Video Layout & Framing Selection */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[13px] font-medium text-zinc-300">
            Video layout & framing
          </label>
          <span className="text-xs text-zinc-500 font-normal">
            9:16 Canvas
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Video framing layout">
          {/* Option 1: 16:9 Rounded */}
          <OptionCard
            title="16:9 Rounded"
            subtitle="Classic 16:9 card"
            selected={framingMode === "standard"}
            disabled={disabled}
            onClick={() => onFramingModeChange("standard")}
            previewGraphic={
              <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0c0c0e] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                <div className="h-4.5 w-full rounded-[3px] bg-zinc-700/80 border border-zinc-600/70 flex items-center justify-center">
                  <span className="text-[7px] font-semibold text-zinc-300">16:9</span>
                </div>
              </div>
            }
          />

          {/* Option 2: 1:1 Rounded */}
          <OptionCard
            title="1:1 Rounded"
            subtitle="TikTok & Reels"
            badge={<Badge variant="emerald" size="sm">Popular</Badge>}
            selected={framingMode === "square_rounded"}
            disabled={disabled}
            onClick={() => onFramingModeChange("square_rounded")}
            previewGraphic={
              <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0c0c0e] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                <div className="w-full aspect-square rounded-[3px] bg-zinc-700/80 border border-zinc-600/70 flex items-center justify-center">
                  <span className="text-[7px] font-semibold text-emerald-300">1:1</span>
                </div>
              </div>
            }
          />

          {/* Option 3: True 9:16 */}
          <OptionCard
            title="True 9:16"
            subtitle="AI speaker tracking"
            badge={<Badge variant="purple" size="sm">AI</Badge>}
            selected={framingMode === "true_9_16"}
            disabled={disabled}
            onClick={() => onFramingModeChange("true_9_16")}
            previewGraphic={
              <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0c0c0e] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                <div className="size-full rounded-[3px] bg-zinc-700/80 border border-purple-500/40 flex items-center justify-center">
                  <svg className="size-4 text-purple-300/90" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="8" r="4" strokeWidth="2" />
                    <path d="M6 20v-2a6 6 0 0 1 12 0v2" strokeWidth="2" />
                  </svg>
                </div>
              </div>
            }
          />
        </div>
      </div>

      {/* 3. Captions Setting & Style Selection */}
      <div className="space-y-2 rounded-xl border border-zinc-800 bg-[#121215] p-3.5 transition-all duration-150">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[13px] font-medium text-zinc-200">Burn captions into clips</span>
            <p className="text-xs text-zinc-400 mt-0.5">Word-by-word animated highlights in 9:16 vertical video</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showCaptions}
            disabled={disabled}
            onClick={() => onShowCaptionsChange(!showCaptions)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus-ring ${
              showCaptions ? "bg-[#10b981]" : "bg-zinc-800"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span
              className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                showCaptions ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Active Style Visualization & Change Button */}
        {showCaptions && (
          <div className="mt-3 pt-3 border-t border-zinc-800/80 space-y-3 animate-in fade-in-0 duration-150">
            {/* Typography Visual Canvas (matching the modal look) */}
            <div className="relative w-full h-20 rounded-xl overflow-hidden flex items-center justify-center border border-zinc-800 bg-[#141418] bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:12px_12px] shadow-inner">
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 pointer-events-none" />
              <CaptionVisualSample styleId={captionStyle} />
              <div className="absolute top-2 left-2.5 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 border border-white/10 backdrop-blur-xs">
                <span className="text-[10px] font-mono text-zinc-400">Preview</span>
              </div>
            </div>

            {/* Style Details & Change Button */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-white tracking-tight">
                    {activeStyleOption.name}
                  </span>
                  <Badge variant="emerald" size="sm">Active style</Badge>
                  <Badge variant="neutral" size="sm">{activeStyleOption.animationName}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">
                  {activeStyleOption.description}
                </p>
              </div>

              <button
                type="button"
                disabled={disabled}
                onClick={() => setIsCaptionPickerOpen(true)}
                className="shrink-0 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800/90 text-xs font-semibold text-zinc-200 hover:border-emerald-500/50 hover:bg-[#10b981]/10 hover:text-white transition-all duration-150 disabled:opacity-50 focus-ring shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <span>Change style</span>
                <svg className="size-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Watermark Toggle */}
      <ToggleRow
        label="Add a watermark: Made with Clip Robin"
        description="Overlays Clip Robin watermark at top-right corner with platform safe-space margins"
        checked={showWatermark}
        onChange={onShowWatermarkChange}
        disabled={disabled}
      />

      {/* Caption Style Picker Modal */}
      <CaptionStylePicker
        isOpen={isCaptionPickerOpen}
        onClose={() => setIsCaptionPickerOpen(false)}
        selectedStyle={captionStyle}
        onSelect={onCaptionStyleChange}
      />
    </div>
  );
}


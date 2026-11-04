"use client";

import React, { useState, useEffect } from "react";
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
import { useSubscription } from "@/src/lib/subscription-context";
import { CustomWatermarkSettings } from "./custom-watermark-settings";

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
  aiModeEnabled: boolean;
  aiModeDisabledReason?: string | null;
  faceTracking?: boolean;
  onFaceTrackingChange?: (enabled: boolean) => void;
  hideFraming?: boolean;
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
  aiModeEnabled,
  aiModeDisabledReason,
  faceTracking = true,
  onFaceTrackingChange,
  hideFraming = false,
  disabled = false,
  className = "",
}: ClipSettingsProps) {
  const {
    isPro,
    openUpgradeModal,
    isCaptionStyleAllowed,
  } = useSubscription();

  const [isCaptionPickerOpen, setIsCaptionPickerOpen] = useState(false);
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(true);
  const [showCustomWatermarkPanel, setShowCustomWatermarkPanel] = useState(false);

  // Pro subtitle customization options
  const [captionScale, setCaptionScale] = useState<"normal" | "large" | "xl">("normal");
  const [customAccentColor, setCustomAccentColor] = useState<string>("#34D399");
  const [isUpperCase, setIsUpperCase] = useState(true);

  useEffect(() => {
    try {
      const savedScale = localStorage.getItem("cliprobin_caption_scale") as "normal" | "large" | "xl";
      if (savedScale) setCaptionScale(savedScale);
      const savedColor = localStorage.getItem("cliprobin_caption_accent");
      if (savedColor) setCustomAccentColor(savedColor);
    } catch {}
  }, []);

  const handleScaleChange = (scale: "normal" | "large" | "xl") => {
    setCaptionScale(scale);
    try {
      localStorage.setItem("cliprobin_caption_scale", scale);
    } catch {}
  };

  const handleColorChange = (color: string) => {
    setCustomAccentColor(color);
    try {
      localStorage.setItem("cliprobin_caption_accent", color);
    } catch {}
  };

  const activeStyleOption =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === captionStyle) || CAPTION_STYLE_OPTIONS[0];

  const durationOptions = CLIP_DURATIONS.map((sec) => ({
    value: sec,
    label: `${sec}s`,
  }));

  const modeOptions = [
    {
      value: "random" as const,
      label: "Fast Interval",
      sublabel: "Evenly spaced cuts",
    },
    {
      value: "ai" as const,
      label: "AI Hook Finder",
      sublabel: "Gemini moments",
      badge: isPro ? (
        <Badge variant="purple" size="sm">{aiModeEnabled ? "Dev" : "Off"}</Badge>
      ) : (
        <Badge variant="amber" size="sm">PRO ✦</Badge>
      ),
      disabled: isPro ? !aiModeEnabled : false,
      tooltip: !isPro
        ? "Gemini AI Hook Finder is a Pro feature. Click to unlock."
        : aiModeEnabled
        ? "AI Developer Mode uses Gemini to find high-engagement moments"
        : aiModeDisabledReason || "Add Gemini API Key in Settings to unlock AI Hook Finder",
    },
  ];

  const handleModeChange = (mode: "random" | "ai") => {
    if (mode === "ai" && !isPro) {
      openUpgradeModal("Gemini AI Hook Finder");
      return;
    }
    onGenerationModeChange(mode);
  };

  const handleWatermarkToggle = (checked: boolean) => {
    if (!checked && !isPro) {
      openUpgradeModal("Watermark Removal");
      return;
    }
    onShowWatermarkChange(checked);
  };

  return (
    <div className={`@container space-y-6 ${className}`}>
      {/* 1. Primary Settings Grid: Generation Mode, Clip Length & Clip Count */}
      <div className="space-y-4">
        <div className={onClipCountChange ? "grid grid-cols-1 @lg:grid-cols-3 gap-3.5" : (variant === "full" ? "grid grid-cols-1 @md:grid-cols-2 gap-4" : "grid grid-cols-1 @md:grid-cols-2 gap-3")}>
          {/* Generation Mode */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[13px] font-semibold text-zinc-200">
                Moments selection
              </label>
              {!isPro ? (
                <button
                  type="button"
                  onClick={() => openUpgradeModal("Gemini AI Hook Finder")}
                  className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                >
                  ⚡ Unlock AI Hooks
                </button>
              ) : !aiModeEnabled ? (
                <span className="text-[11px] text-zinc-500">Local offline</span>
              ) : null}
            </div>
            <SegmentedControl
              options={modeOptions}
              value={generationMode}
              onChange={handleModeChange}
              disabled={disabled}
              ariaLabel="Moments selection mode"
            />
          </div>

          {/* Clip Length */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[13px] font-semibold text-zinc-200">
                Target duration
              </label>
              <span className="text-[11px] text-zinc-500">Seconds per clip</span>
            </div>
            <SegmentedControl
              options={durationOptions}
              value={clipDurationSeconds}
              onChange={onClipDurationChange}
              disabled={disabled}
              ariaLabel="Target duration in seconds"
            />
          </div>

          {/* Clip Count Selector */}
          {onClipCountChange && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[13px] font-semibold text-zinc-200">
                  Number of clips
                </label>
                <span className="text-[11px] text-zinc-500">
                  Max: {maxClips}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-[#0d0d10] p-1 min-h-[46px]">
                <button
                  type="button"
                  onClick={() => onClipCountChange(Math.max(1, clipCount - 1))}
                  disabled={disabled || clipCount <= 1}
                  aria-label="Decrease clip count"
                  className="flex size-8 items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <span className="text-[13px] font-semibold text-zinc-100 tabular-nums px-2 select-none">
                  {clipCount} {clipCount === 1 ? "clip" : "clips"}
                </span>
                <button
                  type="button"
                  onClick={() => onClipCountChange(Math.min(maxClips, clipCount + 1))}
                  disabled={disabled || clipCount >= maxClips}
                  aria-label="Increase clip count"
                  className="flex size-8 items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Video Layout & Framing in 9:16 Canvas */}
      {!hideFraming && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-[13px] font-semibold text-zinc-200">
                Framing in 9:16 canvas
              </label>
              <p className="text-xs text-zinc-400">
                Output is always vertical 9:16 (1080×1920) for Shorts, Reels &amp; TikTok
              </p>
            </div>
            <Badge variant="neutral" size="sm">9:16 Canvas</Badge>
          </div>

          <div className="grid grid-cols-1 @md:grid-cols-3 gap-3" role="radiogroup" aria-label="Framing in 9:16 canvas">
            {/* Option 1: 16:9 Letterbox */}
            <OptionCard
              title="16:9 Letterbox"
              subtitle="Original widescreen"
              selected={framingMode === "standard"}
              disabled={disabled}
              onClick={() => onFramingModeChange("standard")}
              previewGraphic={
                <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0a0a0d] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                  <div className="h-4.5 w-full rounded-[3px] bg-zinc-700/80 border border-zinc-600/70 flex items-center justify-center">
                    <span className="text-[7px] font-semibold text-zinc-300">16:9</span>
                  </div>
                </div>
              }
            />

            {/* Option 2: 1:1 Rounded */}
            <OptionCard
              title="1:1 Rounded"
              subtitle="Centered square"
              badge={<Badge variant="emerald" size="sm">Popular</Badge>}
              selected={framingMode === "square_rounded"}
              disabled={disabled}
              onClick={() => onFramingModeChange("square_rounded")}
              previewGraphic={
                <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0a0a0d] flex items-center justify-center overflow-hidden p-1 shadow-inner">
                  <div className="w-full aspect-square rounded-[3px] bg-zinc-700/80 border border-zinc-600/70 flex items-center justify-center">
                    <span className="text-[7px] font-semibold text-emerald-300">1:1</span>
                  </div>
                </div>
              }
            />

            {/* Option 3: Full 9:16 Crop */}
            <OptionCard
              title="Full 9:16 Crop"
              subtitle="Speaker tracking"
              badge={<Badge variant="purple" size="sm">AI</Badge>}
              selected={framingMode === "true_9_16"}
              disabled={disabled}
              onClick={() => onFramingModeChange("true_9_16")}
              previewGraphic={
                <div className="relative aspect-[9/16] w-12 rounded-[5px] border border-zinc-700/60 bg-[#0a0a0d] flex items-center justify-center overflow-hidden p-1 shadow-inner">
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

          {/* Face Tracking Option - Exclusively in 9:16 */}
          {framingMode === "true_9_16" ? (
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-3.5 flex items-center justify-between gap-3 animate-fade-in transition-all">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300 mt-0.5 shrink-0">
                  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
                    <path d="M2 12h2M20 12h2M12 2v2M12 20v2" strokeLinecap="round" strokeDasharray="1 3" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-zinc-100">Smooth Face Tracking</span>
                    <Badge variant="purple" size="sm">9:16 AI Follow</Badge>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Smoothly moves the camera to keep the active speaker centered in 9:16 as they shift or move.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Toggle smooth face tracking in 9:16"
                aria-checked={faceTracking}
                disabled={disabled}
                onClick={() => onFaceTrackingChange?.(!faceTracking)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus-ring ${
                  faceTracking ? "bg-purple-600" : "bg-zinc-700"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span
                  className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                    faceTracking ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-2.5 px-3 flex items-center justify-between text-xs text-zinc-500">
              <div className="flex items-center gap-2">
                <span className="inline-block size-1.5 rounded-full bg-zinc-600" />
                <span>Smooth Face Tracking is only available for <strong>Full 9:16 Crop</strong>.</span>
              </div>
              <Badge variant="neutral" size="sm">9:16 Only</Badge>
            </div>
          )}
        </div>
      )}

      {/* 3. Secondary Section: Captions & Branding (Collapsible) */}
      <div className="rounded-xl border border-zinc-800 bg-[#121215] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-800/30 transition-colors focus-ring"
          aria-expanded={isAdvancedExpanded}
        >
          <div className="space-y-0.5">
            <span className="text-[13px] font-semibold text-white">
              Captions &amp; branding
            </span>
            <p className="text-xs text-zinc-400">
              {showCaptions ? `${activeStyleOption.name} subtitles` : "Subtitles off"} •{" "}
              {showWatermark ? "Watermark on" : "Watermark off"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              {isAdvancedExpanded ? "Hide" : "Show"}
            </span>
            <svg
              className={`size-4 text-zinc-400 transition-transform duration-200 ${
                isAdvancedExpanded ? "rotate-180" : ""
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </button>

        {isAdvancedExpanded && (
          <div className="p-4 pt-1 border-t border-zinc-800/80 space-y-4 animate-fade-in">
            {/* Captions switch */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] font-medium text-zinc-200">Burn subtitles into video</span>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Synchronized word-by-word animated highlights generated locally
                </p>
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

            {/* Subtitle Visual Preview Canvas & Selector */}
            {showCaptions && (
              <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                <div className="relative w-full h-20 rounded-xl overflow-hidden flex items-center justify-center border border-zinc-800 bg-[#141418] bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:12px_12px] shadow-inner">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 pointer-events-none" />
                  <CaptionVisualSample styleId={captionStyle} />
                  <div className="absolute top-2 left-2.5 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 border border-white/10 backdrop-blur-xs">
                    <span className="text-xs font-mono text-zinc-400">Sample style</span>
                  </div>
                  {!isCaptionStyleAllowed(captionStyle) && (
                    <div className="absolute top-2 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-[10px] font-bold text-amber-300">
                      <span>🔒</span>
                      <span>PRO</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-white tracking-tight">
                        {activeStyleOption.name}
                      </span>
                      <Badge variant="emerald" size="sm">Selected</Badge>
                      <Badge variant="neutral" size="sm">{activeStyleOption.animationName}</Badge>
                      {!isCaptionStyleAllowed(captionStyle) && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                          PRO
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">
                      {activeStyleOption.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsCaptionPickerOpen(true)}
                    className="w-full sm:w-auto shrink-0 justify-center px-3.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/90 text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:bg-[#10b981]/10 hover:text-white transition-all duration-150 disabled:opacity-50 focus-ring shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Change style ({CAPTION_STYLE_OPTIONS.length} available)</span>
                    <svg className="size-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>

                {/* Subtitle Customizer: Pro Feature */}
                {isPro ? (
                  <div className="mt-3 p-3 rounded-xl border border-zinc-800 bg-[#0c0c0e] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">Pro Subtitle Customizer</span>
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold">
                          UNLOCKED
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-400">Live styling</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                          Font Scale
                        </label>
                        <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
                          {[
                            { id: "normal", label: "Normal (100%)" },
                            { id: "large", label: "Large (120%)" },
                            { id: "xl", label: "XL (140%)" },
                          ].map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => handleScaleChange(s.id as "normal" | "large" | "xl")}
                              className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                                captionScale === s.id
                                  ? "bg-zinc-800 text-white font-semibold shadow-xs"
                                  : "text-zinc-400 hover:text-white"
                              }`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-[11px] font-medium text-zinc-400">
                            Accent Pop Color
                          </label>
                          <button
                            type="button"
                            onClick={() => setIsUpperCase(!isUpperCase)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                              isUpperCase
                                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-semibold"
                                : "bg-zinc-800 border-zinc-700 text-zinc-400"
                            }`}
                          >
                            {isUpperCase ? "ALL CAPS" : "Normal case"}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          {[
                            { color: "#34D399", name: "Emerald" },
                            { color: "#FFFF00", name: "Yellow" },
                            { color: "#00F0FF", name: "Cyan" },
                            { color: "#FF007F", name: "Magenta" },
                            { color: "#FF5722", name: "Flame" },
                          ].map((c) => (
                            <button
                              key={c.color}
                              type="button"
                              onClick={() => handleColorChange(c.color)}
                              className={`size-6 rounded-full border-2 transition-transform ${
                                customAccentColor === c.color
                                  ? "scale-110 border-white shadow-md"
                                  : "border-transparent opacity-70 hover:opacity-100"
                              }`}
                              style={{ backgroundColor: c.color }}
                              title={c.name}
                              aria-label={`Select accent color ${c.name}`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 p-2.5 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span>✦</span>
                      <span>Pro Subtitle Customizer (Custom colors, font sizing &amp; animations)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openUpgradeModal("Pro Subtitle Customizer")}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-bold border border-amber-500/30 transition-colors shrink-0"
                    >
                      Unlock Pro
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Watermark Section */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-3">
              {isPro ? (
                <>
                  <ToggleRow
                    label="Show Brand Watermark"
                    description="Burn your logo or Clip Robin branding into the video safe zone"
                    checked={showWatermark}
                    onChange={handleWatermarkToggle}
                    disabled={disabled}
                  />

                  {showWatermark && (
                    <div className="pt-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-zinc-300">
                          Watermark Options
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowCustomWatermarkPanel(!showCustomWatermarkPanel)}
                          className="text-xs text-emerald-400 hover:text-emerald-300 underline font-medium"
                        >
                          {showCustomWatermarkPanel ? "Hide custom logo settings" : "Custom logo settings"}
                        </button>
                      </div>

                      {showCustomWatermarkPanel && (
                        <CustomWatermarkSettings />
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-[#0d0d10] space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-zinc-200">
                          Watermark: Made with Clip Robin
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                          LOCKED ON FREE
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Free tier includes default branding mark. Upgrade to Pro to remove branding or upload your own custom logo.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => openUpgradeModal("Custom Watermark & Removal")}
                      className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-zinc-950 font-bold text-xs shadow transition-all duration-150 shrink-0"
                    >
                      Unlock Pro
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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

"use client";

import React, { useState, useEffect } from "react";
import { CaptionAnimation, CaptionStyle, FramingMode } from "@/src/lib/api";
import {
  CaptionStylePicker,
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  CaptionVisualSample,
} from "./caption-style-picker";
import {
  LiveMovingCaptions,
  getDefaultAnimationForStyle,
  getEffectiveAnimation,
} from "./live-moving-captions";
import { SegmentedControl } from "./ui/segmented-control";
import { ToggleRow } from "./ui/toggle-row";
import { OptionCard } from "./ui/option-card";
import { Badge } from "./ui/badge";
import { useSubscription } from "@/src/lib/subscription-context";
import { CustomWatermarkSettings } from "./custom-watermark-settings";

export const CLIP_DURATIONS = [12, 15, 30, 60, 90] as const;
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
  captionAnimation?: CaptionAnimation | null;
  onCaptionAnimationChange?: (animation: CaptionAnimation | null) => void;
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
  captionAnimation,
  onCaptionAnimationChange,
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
  const [internalAnimation, setInternalAnimation] = useState<CaptionAnimation | null>(null);

  useEffect(() => {
    try {
      const savedAnim = localStorage.getItem("cliprobin_caption_animation") as CaptionAnimation | null;
      if (savedAnim && ["pop", "grow", "sweep", "fade", "glide"].includes(savedAnim)) {
        setInternalAnimation(savedAnim);
      }
    } catch {}
  }, []);

  const currentAnimation = captionAnimation !== undefined ? captionAnimation : internalAnimation;

  const handleAnimationChange = (anim: CaptionAnimation | null) => {
    setInternalAnimation(anim);
    try {
      if (anim) {
        localStorage.setItem("cliprobin_caption_animation", anim);
      } else {
        localStorage.removeItem("cliprobin_caption_animation");
      }
    } catch {}
    onCaptionAnimationChange?.(anim);
  };

  const handleStyleSelect = (styleId: CaptionStyle) => {
    if (!isCaptionStyleAllowed(styleId)) {
      const styleDef = CAPTION_STYLE_OPTIONS.find((s) => s.id === styleId);
      openUpgradeModal(`The "${styleDef?.name || styleId}" Subtitle Style`);
      return;
    }
    onCaptionStyleChange(styleId);
  };

  const activeStyleOption =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === captionStyle) || CAPTION_STYLE_OPTIONS[0];
  const effectiveAnimation = getEffectiveAnimation(captionStyle, currentAnimation);
  const activeAnimationOption =
    CAPTION_ANIMATION_OPTIONS.find((a) => a.id === effectiveAnimation) ||
    CAPTION_ANIMATION_OPTIONS[0];

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

      {/* 3. Captions & Branding Studio */}
      <div className="rounded-xl border border-zinc-800 bg-[#121215] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-800/30 transition-colors focus-ring"
          aria-expanded={isAdvancedExpanded}
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-white">
                Captions &amp; branding
              </span>
              {showCaptions && (
                <Badge variant="emerald" size="sm">
                  {activeStyleOption.name} • {activeAnimationOption.name}
                </Badge>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              {showCaptions
                ? `${activeStyleOption.name} subtitles (${activeAnimationOption.name} motion)`
                : "Subtitles off"}{" "}
              • {showWatermark ? "Watermark on" : "Watermark off"}
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
            <div className="flex items-center justify-between pt-2">
              <div>
                <span className="text-[13px] font-medium text-zinc-200">Burn animated subtitles into video</span>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Synchronized word-by-word animated highlights rendered into the safe zone
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Burn animated subtitles into video"
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

            {/* Interactive Subtitle Studio */}
            {showCaptions && (
              <div className="pt-3 border-t border-zinc-800/80 space-y-4">
                {/* 1. Live Animated Preview Stage */}
                <div className="relative w-full h-24 rounded-xl overflow-hidden flex items-center justify-center border border-zinc-800 bg-[#0d0d11] bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:12px_12px] shadow-inner px-4">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/35 pointer-events-none" />

                  {/* Live word-by-word animated preview */}
                  <div className="relative z-10 pt-3">
                    <LiveMovingCaptions
                      captionStyle={captionStyle}
                      captionAnimation={effectiveAnimation}
                    />
                  </div>

                  {/* Top-left live status badge */}
                  <div className="absolute top-2 left-2.5 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/70 border border-white/10 backdrop-blur-xs">
                    <span className="size-1.5 rounded-full bg-[#10b981] animate-pulse" />
                    <span className="text-[11px] font-medium text-zinc-200">
                      {activeStyleOption.name}
                    </span>
                    <span className="text-[10px] text-zinc-500">•</span>
                    <span className="text-[10px] font-mono text-emerald-400">
                      {activeAnimationOption.name} motion
                    </span>
                  </div>

                  {/* Top-right 9:16 Video & Safe Zones Modal Trigger */}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsCaptionPickerOpen(true)}
                    className="absolute top-2 right-2.5 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 hover:border-emerald-500/50 text-[11px] font-medium text-zinc-200 hover:text-white transition-all focus-ring cursor-pointer shadow-sm"
                  >
                    <svg className="size-3 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span>9:16 Video &amp; Safe Zones</span>
                  </button>
                </div>

                {/* 2. Direct 1-Click Caption Style Grid */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-200">
                      Subtitle style
                    </label>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {activeStyleOption.fontFamily}
                    </span>
                  </div>

                  <div
                    role="radiogroup"
                    aria-label="Subtitle typography style"
                    className="grid grid-cols-2 @md:grid-cols-3 gap-2"
                  >
                    {CAPTION_STYLE_OPTIONS.map((styleOpt) => {
                      const isSelected = captionStyle === styleOpt.id;
                      const isLocked = !isCaptionStyleAllowed(styleOpt.id);
                      return (
                        <button
                          key={styleOpt.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          disabled={disabled}
                          onClick={() => handleStyleSelect(styleOpt.id)}
                          className={`group relative flex flex-col rounded-xl border p-2 transition-all duration-150 text-left focus-ring ${
                            isSelected
                              ? "border-[#10b981] bg-[#10b981]/10 ring-1 ring-[#10b981]/60 shadow-sm"
                              : "border-zinc-800 bg-[#0d0d10] hover:border-zinc-700 hover:bg-[#15151a]"
                          } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          {/* Mini visual sample */}
                          <div className="relative w-full h-11 rounded-lg overflow-hidden flex items-center justify-center border border-zinc-800/80 bg-[#141418] px-1">
                            <div className="scale-75 origin-center pointer-events-none">
                              <CaptionVisualSample styleId={styleOpt.id} />
                            </div>
                            {isLocked && (
                              <span className="absolute top-1 left-1 px-1 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-[9px] font-bold text-amber-300">
                                PRO
                              </span>
                            )}
                            {isSelected && (
                              <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-[#10b981] text-zinc-950">
                                <svg className="size-2.5 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </span>
                            )}
                          </div>

                          <div className="mt-1.5 flex items-center justify-between gap-1 w-full">
                            <span className="text-xs font-semibold text-white truncate">
                              {styleOpt.name}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-medium shrink-0">
                              {styleOpt.animationName}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Word Animation Motion Selector */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <label className="text-xs font-semibold text-zinc-200">
                        Word animation motion
                      </label>
                      <p className="text-[11px] text-zinc-400">
                        {captionStyle === "classic"
                          ? "Classic uses its built-in Pop word highlight."
                          : `Customize how active words animate (default for ${activeStyleOption.name}: ${activeStyleOption.animationName}).`}
                      </p>
                    </div>
                    {currentAnimation && captionStyle !== "classic" && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleAnimationChange(null)}
                        className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer shrink-0"
                      >
                        Reset to style default
                      </button>
                    )}
                  </div>

                  <div
                    role="radiogroup"
                    aria-label="Word animation motion"
                    className="grid grid-cols-2 @sm:grid-cols-5 gap-1.5"
                  >
                    {CAPTION_ANIMATION_OPTIONS.map((anim) => {
                      const isSelected = effectiveAnimation === anim.id;
                      const isStyleDefault =
                        getDefaultAnimationForStyle(captionStyle) === anim.id;
                      const isDisabledForClassic =
                        captionStyle === "classic" && anim.id !== "pop";

                      return (
                        <button
                          key={anim.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          disabled={disabled || isDisabledForClassic}
                          onClick={() => {
                            if (isDisabledForClassic) return;
                            handleAnimationChange(isStyleDefault ? null : anim.id);
                          }}
                          className={`flex flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-all focus-ring ${
                            isSelected
                              ? "border-[#10b981] bg-[#10b981]/10 text-white shadow-xs"
                              : "border-zinc-800 bg-[#0d0d10] text-zinc-300 hover:border-zinc-700 hover:text-white"
                          } ${
                            disabled || isDisabledForClassic
                              ? "opacity-40 cursor-not-allowed"
                              : "cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full gap-1">
                            <span className="text-xs font-semibold">{anim.name}</span>
                            {isStyleDefault && (
                              <span className="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-zinc-800 text-zinc-400">
                                Default
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5">
                            {anim.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
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
        onSelect={handleStyleSelect}
        selectedAnimation={currentAnimation}
        onSelectAnimation={handleAnimationChange}
      />
    </div>
  );
}

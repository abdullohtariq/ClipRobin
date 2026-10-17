"use client";

import React, { useEffect, useRef, useState } from "react";
import { CaptionStyle } from "@/src/lib/api";

export interface StyleOption {
  id: CaptionStyle;
  name: string;
  description: string;
}

export const CAPTION_STYLE_OPTIONS: StyleOption[] = [
  {
    id: "classic",
    name: "Classic",
    description: "The original Clip Robin word-by-word look with dark box.",
  },
  {
    id: "robin",
    name: "Robin",
    description: "Signature viral all-caps style with emerald highlight.",
  },
  {
    id: "clean",
    name: "Clean",
    description: "Clean minimal typography with soft shadow.",
  },
  {
    id: "punch",
    name: "Punch",
    description: "High-impact bold all-caps with golden accent highlight.",
  },
  {
    id: "pill",
    name: "Pill",
    description: "Translucent dark box with active emerald word highlight.",
  },
  {
    id: "karaoke",
    name: "Karaoke",
    description: "Smooth karaoke sweep highlight across words.",
  },
];

export function getPreviewUrls(styleId: CaptionStyle) {
  return {
    videoUrl: `/caption-previews/${styleId}.mp4`,
    posterUrl: `/caption-previews/${styleId}.jpg`,
  };
}

interface VideoPreviewCardProps {
  styleOption: StyleOption;
  isSelected: boolean;
  showSafeZones: boolean;
  prefersReducedMotion: boolean;
  onSelect: () => void;
}

function VideoPreviewCard({
  styleOption,
  isSelected,
  showSafeZones,
  prefersReducedMotion,
  onSelect,
}: VideoPreviewCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(!prefersReducedMotion);
  const [hasError, setHasError] = useState(false);

  const { videoUrl, posterUrl } = getPreviewUrls(styleOption.id);

  // IntersectionObserver: Pause video when scrolled out of view to preserve resources
  useEffect(() => {
    if (!containerRef.current || prefersReducedMotion) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (videoRef.current) {
            if (entry.isIntersecting) {
              videoRef.current.play().catch(() => {});
              setIsPlaying(true);
            } else {
              videoRef.current.pause();
              setIsPlaying(false);
            }
          }
        });
      },
      { threshold: 0.25 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [prefersReducedMotion]);

  // When video source changes, reload
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      if (!prefersReducedMotion) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }, [videoUrl, prefersReducedMotion]);

  const togglePlayback = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  return (
    <div
      role="radio"
      aria-checked={isSelected}
      tabIndex={isSelected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex flex-col items-center rounded-2xl border p-4 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#34D399] ${
        isSelected
          ? "border-[#34D399] bg-[#34D399]/5 ring-1 ring-[#34D399] shadow-lg shadow-emerald-950/20"
          : "border-[#232326] bg-[#0c0c0e] hover:border-zinc-700 hover:bg-[#111113]"
      }`}
    >
      {/* 9:16 Video Container */}
      <div
        ref={containerRef}
        className="relative w-full aspect-[9/16] rounded-xl overflow-hidden bg-black border border-[#232326] shadow-inner select-none"
      >
        {!hasError ? (
          <video
            ref={videoRef}
            src={videoUrl}
            poster={posterUrl}
            loop
            muted
            playsInline
            autoPlay={!prefersReducedMotion}
            onError={() => setHasError(true)}
            className="size-full object-cover"
          />
        ) : (
          <img
            src={posterUrl}
            alt={`${styleOption.name} preview`}
            className="size-full object-cover"
          />
        )}

        {/* Play/Pause manual toggle button for prefers-reduced-motion or user control */}
        {prefersReducedMotion && (
          <button
            type="button"
            onClick={togglePlayback}
            className="absolute bottom-2.5 right-2.5 z-30 flex size-7 items-center justify-center rounded-full bg-black/75 text-white hover:bg-black transition-all border border-white/20"
            aria-label={isPlaying ? "Pause preview" : "Play preview"}
          >
            {isPlaying ? (
              <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="size-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        )}

        {/* Safe Zones Overlay (7-24% top reserved, bottom 20% platform UI) */}
        {showSafeZones && (
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-20 overflow-hidden">
            {/* Top Reserved Zone (Watermark & Top-line Headline: 7% to 24% of height) */}
            <div
              style={{ top: "7%", height: "17%" }}
              className="absolute inset-x-2 border border-dashed border-amber-400/50 bg-amber-400/10 rounded flex items-center justify-center px-1"
            >
              <span className="text-[9px] font-semibold text-amber-300 tracking-wide uppercase text-center drop-shadow-sm line-clamp-1">
                Top line / Watermark
              </span>
            </div>

            {/* Bottom Platform UI Safe Zone (Bottom 20%) */}
            <div
              style={{ bottom: "0", height: "20%" }}
              className="absolute inset-x-2 border-t border-dashed border-red-400/50 bg-red-500/10 rounded-t flex items-center justify-center px-1"
            >
              <span className="text-[9px] font-semibold text-red-300 tracking-wide uppercase text-center drop-shadow-sm line-clamp-1">
                Platform UI Zone
              </span>
            </div>
          </div>
        )}

        {/* Selected corner checkmark badge */}
        {isSelected && (
          <div className="absolute top-2.5 right-2.5 z-30 flex size-6 items-center justify-center rounded-full bg-[#34D399] text-zinc-950 font-extrabold text-xs shadow-md">
            ✓
          </div>
        )}
      </div>

      {/* Style Details */}
      <div className="w-full mt-3.5 text-center">
        <div className="flex items-center justify-center gap-2">
          <h3 className="text-base font-semibold text-white tracking-tight">
            {styleOption.name}
          </h3>
          {isSelected && (
            <span className="text-[12px] font-medium text-[#34D399]">
              Selected
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-400 line-clamp-1 leading-snug">
          {styleOption.description}
        </p>
      </div>
    </div>
  );
}

export interface CaptionStylePickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedStyle: CaptionStyle;
  onSelect: (style: CaptionStyle) => void;
}

export function CaptionStylePicker({
  isOpen,
  onClose,
  selectedStyle,
  onSelect,
}: CaptionStylePickerProps) {
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [tempStyle, setTempStyle] = useState<CaptionStyle>(selectedStyle);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      setTempStyle(selectedStyle);
    }
  }, [isOpen, selectedStyle]);

  // Check prefers-reduced-motion
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  // Keyboard navigation & Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const currentIndex = CAPTION_STYLE_OPTIONS.findIndex((s) => s.id === tempStyle);
        const nextIndex = (currentIndex + 1) % CAPTION_STYLE_OPTIONS.length;
        setTempStyle(CAPTION_STYLE_OPTIONS[nextIndex].id);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const currentIndex = CAPTION_STYLE_OPTIONS.findIndex((s) => s.id === tempStyle);
        const prevIndex =
          (currentIndex - 1 + CAPTION_STYLE_OPTIONS.length) % CAPTION_STYLE_OPTIONS.length;
        setTempStyle(CAPTION_STYLE_OPTIONS[prevIndex].id);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSelect(tempStyle);
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, tempStyle, onSelect, onClose]);

  if (!isOpen) return null;

  const activeStyleDef =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === tempStyle) || CAPTION_STYLE_OPTIONS[0];

  const handleApply = () => {
    onSelect(tempStyle);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="caption-style-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        className="relative flex flex-col w-full max-w-5xl max-h-[90vh] rounded-2xl border border-[#232326] bg-[#0c0c0e] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#232326] px-6 py-4.5 bg-[#111113]">
          <div>
            <h2
              id="caption-style-picker-title"
              className="text-lg font-bold text-white tracking-tight sm:text-xl"
            >
              Caption style
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Select a typographic look for your vertical clips
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Safe zones toggle */}
            <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={showSafeZones}
                onChange={(e) => setShowSafeZones(e.target.checked)}
                className="size-4 rounded border-zinc-700 bg-zinc-900 text-[#34D399] focus:ring-[#34D399]"
              />
              <span>Show safe zones</span>
            </label>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#34D399]"
              aria-label="Close dialog"
            >
              <svg className="size-5" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content Body: Scrollable Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Responsive Grid: 3 cols at >=1100px, 2 below, gap at least 24px (gap-6) */}
          <div
            role="radiogroup"
            aria-label="Available caption styles"
            className="grid grid-cols-2 min-[1100px]:grid-cols-3 gap-6"
          >
            {CAPTION_STYLE_OPTIONS.map((styleOpt) => {
              const isSelected = tempStyle === styleOpt.id;
              return (
                <VideoPreviewCard
                  key={styleOpt.id}
                  styleOption={styleOpt}
                  isSelected={isSelected}
                  showSafeZones={showSafeZones}
                  prefersReducedMotion={prefersReducedMotion}
                  onSelect={() => setTempStyle(styleOpt.id)}
                />
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#232326] px-6 py-4 bg-[#111113]">
          <div className="text-xs text-zinc-400">
            Current: <span className="text-white font-medium">{activeStyleDef.name}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl bg-[#34D399] text-xs font-bold text-zinc-950 hover:bg-emerald-400 transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-[#34D399]"
            >
              Apply style
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

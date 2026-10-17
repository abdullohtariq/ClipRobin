"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CaptionStyle } from "@/src/lib/api";
import { Badge } from "@/src/components/ui/badge";
import { Checkbox } from "@/src/components/ui/checkbox";
import { IconButton } from "@/src/components/ui/icon-button";

export interface StyleOption {
  id: CaptionStyle;
  name: string;
  description: string;
  category: "bold" | "minimal" | "boxed";
  categories: Array<"all" | "bold" | "minimal" | "boxed">;
  animationName: string;
  fontFamily: string;
}

export const CAPTION_STYLE_OPTIONS: StyleOption[] = [
  {
    id: "classic",
    name: "Classic",
    description: "The original Clip Robin word-by-word look with dark box.",
    category: "boxed",
    categories: ["all", "boxed", "bold"],
    animationName: "Pop",
    fontFamily: "Montserrat Bold",
  },
  {
    id: "robin",
    name: "Robin",
    description: "Signature viral all-caps style with emerald highlight.",
    category: "bold",
    categories: ["all", "bold"],
    animationName: "Grow",
    fontFamily: "Montserrat Black",
  },
  {
    id: "clean",
    name: "Clean",
    description: "Clean minimal typography with soft shadow.",
    category: "minimal",
    categories: ["all", "minimal"],
    animationName: "Fade",
    fontFamily: "Montserrat Bold",
  },
  {
    id: "punch",
    name: "Punch",
    description: "High-impact bold all-caps with golden accent pop.",
    category: "bold",
    categories: ["all", "bold"],
    animationName: "Pop",
    fontFamily: "Anton Heavy",
  },
  {
    id: "pill",
    name: "Pill",
    description: "Translucent dark box with active emerald word highlight.",
    category: "boxed",
    categories: ["all", "boxed"],
    animationName: "Pop",
    fontFamily: "Poppins Bold",
  },
  {
    id: "karaoke",
    name: "Karaoke",
    description: "Smooth karaoke sweep highlight across words.",
    category: "minimal",
    categories: ["all", "minimal"],
    animationName: "Sweep",
    fontFamily: "Montserrat Bold",
  },
];

export function getPreviewUrls(styleId: CaptionStyle) {
  return {
    videoUrl: `/caption-previews/${styleId}.mp4`,
    posterUrl: `/caption-previews/${styleId}.jpg`,
  };
}

// 16-18px typography sample centered on subtle checkered dark canvas
export function CaptionVisualSample({ styleId }: { styleId: CaptionStyle }) {
  switch (styleId) {
    case "classic":
      return (
        <div className="flex items-center justify-center p-3">
          <span className="inline-block bg-black/80 px-3.5 py-1.5 rounded border border-white/10 text-[17px] font-bold text-white tracking-normal drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            These are <span className="text-[#FFFF00]">captions</span>
          </span>
        </div>
      );
    case "robin":
      return (
        <div className="flex items-center justify-center p-3">
          <span className="text-[18px] font-black uppercase text-white tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] [text-shadow:_0_2px_4px_rgba(0,0,0,0.9),_0_0_2px_#000]">
            THESE ARE <span className="text-[#34D399]">CAPTIONS</span>
          </span>
        </div>
      );
    case "punch":
      return (
        <div className="flex items-center justify-center p-3">
          <span className="text-[19px] font-extrabold uppercase text-white tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] [text-shadow:_0_2px_4px_rgba(0,0,0,0.9),_0_0_2px_#000]">
            THESE ARE <span className="text-[#F7C204]">CAPTIONS</span>
          </span>
        </div>
      );
    case "clean":
      return (
        <div className="flex items-center justify-center p-3">
          <span className="text-[17px] font-bold text-white tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
            These are captions
          </span>
        </div>
      );
    case "pill":
      return (
        <div className="flex items-center justify-center p-3">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-black/85 border border-white/15 text-[16px] font-semibold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            These are <span className="text-[#34D399] font-bold">captions</span>
          </span>
        </div>
      );
    case "karaoke":
      return (
        <div className="flex items-center justify-center p-3">
          <span className="text-[17px] font-bold text-white tracking-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
            These are <span className="text-[#34D399] underline decoration-[#34D399]/60 underline-offset-4">captions</span>
          </span>
        </div>
      );
    default:
      return (
        <div className="flex items-center justify-center p-3">
          <span className="text-[17px] font-bold text-white">These are captions</span>
        </div>
      );
  }
}

interface CaptionCardProps {
  styleOption: StyleOption;
  isSelected: boolean;
  onSelect: () => void;
}

function CaptionCard({ styleOption, isSelected, onSelect }: CaptionCardProps) {
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
      className={`group relative flex flex-col rounded-xl border p-3.5 transition-all duration-150 cursor-pointer text-left focus:outline-none focus-ring ${
        isSelected
          ? "border-[#10b981] bg-[#10b981]/5 ring-1 ring-[#10b981] shadow-lg shadow-emerald-950/20"
          : "border-zinc-800 bg-[#121215] hover:border-zinc-700 hover:bg-[#16161b]"
      }`}
    >
      {/* Visual Sample Box (16-18px typography sample with subtle checkered dark background) */}
      <div className="relative w-full h-24 rounded-lg overflow-hidden flex items-center justify-center border border-zinc-800/80 bg-[#141418] bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:12px_12px]">
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20 pointer-events-none" />
        <CaptionVisualSample styleId={styleOption.id} />

        {isSelected && (
          <div className="absolute top-2 right-2 z-10 flex size-5 items-center justify-center rounded-full bg-[#10b981] text-zinc-950 font-bold text-xs shadow">
            <svg className="size-3 stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
      </div>

      {/* Style Details */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white tracking-tight">{styleOption.name}</span>
          <Badge variant="neutral" className="text-[10px] px-1.5 py-0 font-medium">
            {styleOption.animationName}
          </Badge>
        </div>
        {isSelected && (
          <span className="text-[11px] font-semibold text-[#10b981]">Selected</span>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-400 line-clamp-1 leading-snug">
        {styleOption.description}
      </p>
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
  const [tempStyle, setTempStyle] = useState<CaptionStyle>(selectedStyle);
  const [selectedCategory, setSelectedCategory] = useState<"all" | "bold" | "minimal" | "boxed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSafeZones, setShowSafeZones] = useState<boolean>(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [videoError, setVideoError] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync state on open
  useEffect(() => {
    if (isOpen) {
      setTempStyle(selectedStyle);
      setSearchQuery("");
      setSelectedCategory("all");

      try {
        const savedSafeZones = localStorage.getItem("cliprobin_show_safe_zones");
        if (savedSafeZones !== null) {
          setShowSafeZones(savedSafeZones === "true");
        }
      } catch {}
    }
  }, [isOpen, selectedStyle]);

  // Reduced motion detection
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    setIsPlaying(!mq.matches);

    const listener = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
      setIsPlaying(!e.matches);
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const handleToggleSafeZones = (val: boolean) => {
    setShowSafeZones(val);
    try {
      localStorage.setItem("cliprobin_show_safe_zones", String(val));
    } catch {}
  };

  // Filtered styles
  const filteredStyles = useMemo(() => {
    return CAPTION_STYLE_OPTIONS.filter((s) => {
      const matchesCategory =
        selectedCategory === "all" || s.categories.includes(selectedCategory);
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.animationName.toLowerCase().includes(q) ||
        s.fontFamily.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // If user is focused on the search input, don't hijack left/right arrow typing
      if (document.activeElement === searchInputRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          onSelect(tempStyle);
          onClose();
        }
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredStyles.length === 0) return;
        const currentIndex = filteredStyles.findIndex((s) => s.id === tempStyle);
        const nextIndex = (currentIndex + 1) % filteredStyles.length;
        setTempStyle(filteredStyles[nextIndex].id);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredStyles.length === 0) return;
        const currentIndex = filteredStyles.findIndex((s) => s.id === tempStyle);
        const prevIndex =
          (currentIndex - 1 + filteredStyles.length) % filteredStyles.length;
        setTempStyle(filteredStyles[prevIndex].id);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSelect(tempStyle);
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, tempStyle, filteredStyles, onSelect, onClose]);

  // Update video element when style changes
  const { videoUrl, posterUrl } = getPreviewUrls(tempStyle);

  useEffect(() => {
    setVideoError(false);
    if (videoRef.current) {
      videoRef.current.load();
      if (!prefersReducedMotion) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }, [tempStyle, prefersReducedMotion]);

  const togglePlayback = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  if (!isOpen) return null;

  const activeStyleDef =
    CAPTION_STYLE_OPTIONS.find((s) => s.id === tempStyle) || CAPTION_STYLE_OPTIONS[0];

  const handleApply = () => {
    onSelect(tempStyle);
    onClose();
  };

  const categories: Array<{ id: "all" | "bold" | "minimal" | "boxed"; label: string }> = [
    { id: "all", label: "All" },
    { id: "bold", label: "Bold" },
    { id: "minimal", label: "Minimal" },
    { id: "boxed", label: "Boxed" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="caption-style-picker-title"
      aria-describedby="caption-style-picker-desc"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="relative flex flex-col w-[min(1100px,94vw)] max-h-[min(88vh,900px)] h-[88vh] rounded-2xl border border-zinc-800 bg-[#0e0e11] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 bg-[#121215] flex-shrink-0">
          <div>
            <h2
              id="caption-style-picker-title"
              className="text-lg font-bold text-white tracking-tight"
            >
              Caption style
            </h2>
            <p id="caption-style-picker-desc" className="mt-0.5 text-xs text-zinc-400">
              Select a typographic look for your vertical clips
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Checkbox
              checked={showSafeZones}
              onChange={handleToggleSafeZones}
              label={<span className="text-xs text-zinc-300">Show platform safe zones</span>}
            />
            <IconButton
              label="Close dialog"
              onClick={onClose}
              icon={
                <svg className="size-4" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              }
            />
          </div>
        </div>

        {/* 2-Pane Content Area */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-zinc-800">
          {/* Left Pane: Search, Category Chips, and Style Cards */}
          <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-5 lg:p-6 overflow-hidden">
            {/* Search and Category Filters */}
            <div className="space-y-3.5 mb-5 flex-shrink-0">
              {/* Search Bar */}
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search styles (e.g. Robin, Bold, Anton)..."
                  className="w-full pl-9 pr-9 py-2 rounded-xl border border-zinc-800 bg-[#141418] text-xs text-zinc-200 placeholder-zinc-500 focus-ring"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs"
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Category Chips */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist">
                {categories.map((cat) => {
                  const isActive = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus-ring whitespace-nowrap ${
                        isActive
                          ? "bg-zinc-800 text-white font-semibold border border-zinc-700 shadow-sm"
                          : "bg-transparent text-zinc-400 hover:text-white hover:bg-zinc-800/40 border border-transparent"
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Grid of Styles */}
            <div className="flex-1 overflow-y-auto pr-1 min-h-0">
              {filteredStyles.length > 0 ? (
                <div
                  role="radiogroup"
                  aria-label="Available caption styles"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3.5"
                >
                  {filteredStyles.map((styleOpt) => (
                    <CaptionCard
                      key={styleOpt.id}
                      styleOption={styleOpt}
                      isSelected={tempStyle === styleOpt.id}
                      onSelect={() => setTempStyle(styleOpt.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-800 rounded-xl">
                  <p className="text-xs font-medium text-zinc-400">No caption styles match your criteria</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedCategory("all");
                    }}
                    className="mt-2 text-xs font-semibold text-[#10b981] hover:underline"
                  >
                    Reset filters
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Pane: Sticky 9:16 Video Preview with Safe Zones & Style Meta */}
          <div className="w-full md:w-[280px] lg:w-[320px] bg-[#0b0b0e] p-4 sm:p-5 flex flex-col justify-between overflow-y-auto flex-shrink-0">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300">Live 9:16 Preview</span>
                <Badge variant="emerald" className="text-[10px]">
                  {activeStyleDef.animationName}
                </Badge>
              </div>

              {/* 9:16 Looping Preview Video Container */}
              <div className="relative aspect-[9/16] w-full max-w-[190px] sm:max-w-[220px] mx-auto rounded-xl overflow-hidden bg-black border border-zinc-800 shadow-xl select-none">
                {!videoError ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    poster={posterUrl}
                    loop
                    muted
                    playsInline
                    autoPlay={!prefersReducedMotion}
                    onError={() => setVideoError(true)}
                    className="size-full object-cover"
                  />
                ) : (
                  <img
                    src={posterUrl}
                    alt={`${activeStyleDef.name} preview`}
                    className="size-full object-cover"
                  />
                )}

                {/* Subtle Dashed Safe Zones (Platform Safe Area) - never occluding text */}
                {showSafeZones && (
                  <div className="absolute inset-0 pointer-events-none z-20">
                    {/* Top 10% Platform Safe Area */}
                    <div className="absolute top-0 inset-x-0 h-[10%] border-b border-dashed border-amber-400/40 bg-amber-400/[0.04] flex items-center justify-center px-1">
                      <span className="text-[9px] font-medium text-amber-300/80 uppercase tracking-wider text-center">
                        Top Safe Zone
                      </span>
                    </div>

                    {/* Bottom 20% Platform UI Safe Area */}
                    <div className="absolute bottom-0 inset-x-0 h-[20%] border-t border-dashed border-red-400/40 bg-red-400/[0.04] flex items-center justify-center px-1">
                      <span className="text-[9px] font-medium text-red-300/80 uppercase tracking-wider text-center">
                        Platform UI Safe Area
                      </span>
                    </div>

                    {/* 6% Margin Side Guides */}
                    <div className="absolute top-[10%] bottom-[20%] left-0 w-[6%] border-r border-dashed border-zinc-600/30" />
                    <div className="absolute top-[10%] bottom-[20%] right-0 w-[6%] border-l border-dashed border-zinc-600/30" />
                  </div>
                )}

                {/* Manual Play / Pause toggle for reduced motion or user preference */}
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="absolute bottom-2.5 right-2.5 z-30 flex size-7 items-center justify-center rounded-full bg-black/80 text-white hover:bg-black transition-all border border-white/20 shadow-md"
                  aria-label={isPlaying ? "Pause preview" : "Play preview"}
                >
                  {isPlaying ? (
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                  ) : (
                    <svg className="size-3.5 fill-current ml-0.5" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Active Style Metadata Card */}
              <div className="rounded-xl border border-zinc-800 bg-[#121215] p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white tracking-tight">{activeStyleDef.name}</h4>
                  <span className="text-[11px] font-mono text-zinc-400">{activeStyleDef.fontFamily}</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {activeStyleDef.description}
                </p>
                <div className="pt-1 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-500 font-medium">
                  <span>ASS Subtitle Pipeline</span>
                  <span className="capitalize">{activeStyleDef.category} Category</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4 bg-[#121215] flex-shrink-0">
          <div className="text-xs text-zinc-400">
            Selected style: <span className="text-white font-semibold">{activeStyleDef.name}</span>
            <span className="text-zinc-500 ml-2">({activeStyleDef.animationName})</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all focus-ring"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl bg-[#10b981] text-xs font-bold text-zinc-950 hover:bg-[#059669] transition-all shadow-md focus-ring"
            >
              Apply style
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

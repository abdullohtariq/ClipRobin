"use client";

import React, { useEffect, useState } from "react";
import { CaptionAnimation, CaptionStyle } from "@/src/lib/api";

export interface LiveMovingCaptionsProps {
  captionStyle: CaptionStyle;
  captionAnimation?: CaptionAnimation | null;
}

const CHUNKS = [
  { words: ["This", "is"], baseIndex: 0 },
  { words: ["how", "your"], baseIndex: 2 },
  { words: ["captions", "move"], baseIndex: 4 },
];

const TOTAL_WORDS = 6;
const STEP_MS = 380;
const PAUSE_MS = 500;

export function getDefaultAnimationForStyle(style: CaptionStyle): CaptionAnimation {
  switch (style) {
    case "robin":
      return "grow";
    case "clean":
      return "fade";
    case "karaoke":
      return "sweep";
    case "punch":
    case "pill":
    case "classic":
    default:
      return "pop";
  }
}

export function getEffectiveAnimation(
  style: CaptionStyle,
  animation?: CaptionAnimation | null
): CaptionAnimation {
  if (style === "classic") {
    return "pop";
  }
  return animation || getDefaultAnimationForStyle(style);
}

function getMotionClass(anim: CaptionAnimation, isActive: boolean): string {
  switch (anim) {
    case "pop":
      return isActive
        ? "scale-115 -translate-y-0.5 transition-all duration-75 ease-out"
        : "scale-100 translate-y-0 transition-all duration-150";
    case "grow":
      return isActive
        ? "scale-118 transition-all duration-200 ease-out"
        : "scale-100 transition-all duration-200 ease-in";
    case "fade":
      return isActive
        ? "opacity-100 scale-105 transition-all duration-250 ease-in-out"
        : "opacity-65 scale-100 transition-all duration-250 ease-in-out";
    case "glide":
      return isActive
        ? "scale-108 -translate-y-0.5 translate-x-0.5 transition-all duration-200 ease-out"
        : "scale-98 translate-y-0 translate-x-0 opacity-85 transition-all duration-200 ease-out";
    case "sweep":
    default:
      return isActive
        ? "scale-105 transition-all duration-200"
        : "scale-100 transition-all duration-200";
  }
}

export function LiveMovingCaptions({
  captionStyle,
  captionAnimation,
}: LiveMovingCaptionsProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    setIsPageHidden(document.hidden);

    const onMotionChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
      if (e.matches) setCurrentStep(0);
    };
    const onVisibilityChange = () => {
      setIsPageHidden(document.hidden);
    };

    mq.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mq.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || isPageHidden) return;

    const tick = () => {
      setCurrentStep((prev) => (prev + 1) % (TOTAL_WORDS + 1));
    };

    const delay = currentStep >= TOTAL_WORDS ? PAUSE_MS : STEP_MS;
    const timeoutId = setTimeout(tick, delay);

    return () => clearTimeout(timeoutId);
  }, [currentStep, prefersReducedMotion, isPageHidden]);

  const activeChunkIndex = currentStep < 2 ? 0 : currentStep < 4 ? 1 : 2;
  const chunk = CHUNKS[activeChunkIndex];
  const effectiveAnim = getEffectiveAnimation(captionStyle, captionAnimation);
  const isSweep = effectiveAnim === "sweep";

  return (
    <div className="flex items-center justify-center select-none pointer-events-none transition-all duration-150">
      {captionStyle === "classic" && (
        <div className="inline-block px-3 py-1.5 rounded bg-black/85 border border-black text-[14px] font-bold text-white shadow-lg">
          {chunk.words.map((word, i) => {
            const isWordActive = chunk.baseIndex + i === currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-0.5 transition-all duration-100 ${
                  isWordActive
                    ? "text-[#FFFF00] scale-110 underline underline-offset-2"
                    : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "robin" && (
        <div className="inline-flex items-center justify-center px-1 text-[15px] font-black uppercase tracking-wide">
          {chunk.words.map((word, i) => {
            const wordGlobalIndex = chunk.baseIndex + i;
            const isWordActive = wordGlobalIndex === currentStep;
            const isWordSung = isSweep && wordGlobalIndex <= currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-1 transform drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] [text-shadow:_0_2px_4px_rgba(0,0,0,0.95),_0_0_2px_#000] ${getMotionClass(
                  effectiveAnim,
                  isWordActive
                )} ${
                  isSweep
                    ? isWordActive
                      ? "text-[#34D399] underline decoration-[#34D399] underline-offset-4"
                      : isWordSung
                      ? "text-[#34D399]"
                      : "text-white"
                    : isWordActive
                    ? "text-[#34D399] font-black"
                    : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "punch" && (
        <div className="inline-flex items-center justify-center px-1 text-[16px] font-extrabold uppercase tracking-tight">
          {chunk.words.map((word, i) => {
            const wordGlobalIndex = chunk.baseIndex + i;
            const isWordActive = wordGlobalIndex === currentStep;
            const isWordSung = isSweep && wordGlobalIndex <= currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-1 transform drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] [text-shadow:_0_2px_4px_rgba(0,0,0,0.95),_0_0_2px_#000] ${getMotionClass(
                  effectiveAnim,
                  isWordActive
                )} ${
                  isSweep
                    ? isWordActive
                      ? "text-[#F7C204] underline decoration-[#F7C204] underline-offset-4"
                      : isWordSung
                      ? "text-[#F7C204]"
                      : "text-white"
                    : isWordActive
                    ? "text-[#F7C204]"
                    : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "pill" && (
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/85 border border-white/15 text-[14px] font-semibold text-white shadow-lg">
          {chunk.words.map((word, i) => {
            const wordGlobalIndex = chunk.baseIndex + i;
            const isWordActive = wordGlobalIndex === currentStep;
            const isWordSung = isSweep && wordGlobalIndex <= currentStep;
            return (
              <span
                key={i}
                className={`inline-block ${getMotionClass(
                  effectiveAnim,
                  isWordActive
                )} ${
                  isSweep
                    ? isWordActive
                      ? "text-[#34D399] font-bold underline decoration-[#34D399] underline-offset-4"
                      : isWordSung
                      ? "text-[#34D399] font-bold"
                      : "text-white"
                    : isWordActive
                    ? "text-[#34D399] font-bold"
                    : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "clean" && (
        <div className="inline-flex items-center justify-center px-1 text-[15px] font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
          {chunk.words.map((word, i) => {
            const wordGlobalIndex = chunk.baseIndex + i;
            const isWordActive = wordGlobalIndex === currentStep;
            const isWordSung = isSweep && wordGlobalIndex <= currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-1 ${getMotionClass(
                  effectiveAnim,
                  isWordActive
                )} ${
                  isSweep
                    ? isWordActive
                      ? "text-white underline decoration-white/80 underline-offset-4"
                      : isWordSung
                      ? "text-white"
                      : "text-zinc-400"
                    : isWordActive
                    ? "text-white"
                    : "text-zinc-400"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "karaoke" && (
        <div className="inline-flex items-center justify-center px-1 text-[15px] font-bold drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
          {chunk.words.map((word, i) => {
            const wordGlobalIndex = chunk.baseIndex + i;
            const isWordActive = wordGlobalIndex === currentStep;
            const isWordSung = isSweep && wordGlobalIndex <= currentStep;

            return (
              <span
                key={i}
                className={`inline-block mx-1 ${getMotionClass(
                  effectiveAnim,
                  isWordActive
                )} ${
                  isSweep
                    ? isWordActive
                      ? "text-[#34D399] underline decoration-[#34D399] underline-offset-4 font-extrabold"
                      : isWordSung
                      ? "text-[#34D399] font-bold"
                      : "text-white/90"
                    : isWordActive
                    ? "text-[#34D399] font-extrabold"
                    : "text-white/90"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

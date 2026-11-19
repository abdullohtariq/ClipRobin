"use client";

import React, { useEffect, useState } from "react";
import { CaptionAnimation, CaptionStyle } from "@/src/lib/api";
import {
  CAPTION_STYLE_VISUALS,
  getCaptionStyleOption,
  normalizeCaptionStyle,
} from "@/src/lib/caption-styles";

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
  return getCaptionStyleOption(style).defaultAnimation;
}

export function getEffectiveAnimation(
  style: CaptionStyle,
  animation?: CaptionAnimation | null
): CaptionAnimation {
  if (normalizeCaptionStyle(style) === "classic") {
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

  const canonicalStyle = normalizeCaptionStyle(captionStyle);
  const tokens = CAPTION_STYLE_VISUALS[canonicalStyle] ?? CAPTION_STYLE_VISUALS.classic;
  const activeChunkIndex = currentStep < 2 ? 0 : currentStep < 4 ? 1 : 2;
  const chunk = CHUNKS[activeChunkIndex];
  const effectiveAnim = getEffectiveAnimation(canonicalStyle, captionAnimation);
  const isSweep = effectiveAnim === "sweep";
  const isClassic = canonicalStyle === "classic";

  return (
    <div className="flex items-center justify-center select-none pointer-events-none transition-all duration-150">
      <div className={tokens.liveContainerClass}>
        {chunk.words.map((rawWord, i) => {
          const word = tokens.uppercase ? rawWord.toUpperCase() : rawWord;
          const wordGlobalIndex = chunk.baseIndex + i;
          const isWordActive = wordGlobalIndex === currentStep;
          const isWordSung = isSweep && wordGlobalIndex <= currentStep;
          const motionClass = isClassic
            ? `mx-0.5 transition-all duration-100 ${isWordActive ? "scale-110" : ""}`
            : `mx-1 transform ${tokens.liveTextClass} ${getMotionClass(effectiveAnim, isWordActive)}`;
          const colorClass = isSweep
            ? isWordActive
              ? tokens.activeSweepClass
              : isWordSung
              ? tokens.sungClass
              : tokens.inactiveClass
            : isWordActive
            ? tokens.activeClass
            : tokens.inactiveClass;

          return (
            <span key={i} className={`inline-block ${motionClass} ${colorClass}`}>
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

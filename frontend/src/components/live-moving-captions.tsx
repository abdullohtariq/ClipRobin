"use client";

import React, { useEffect, useState } from "react";
import { CaptionStyle } from "@/src/lib/api";

interface LiveMovingCaptionsProps {
  captionStyle: CaptionStyle;
}

const CHUNKS = [
  { words: ["This", "is"], baseIndex: 0 },
  { words: ["how", "your"], baseIndex: 2 },
  { words: ["captions", "move"], baseIndex: 4 },
];

const TOTAL_WORDS = 6;
const STEP_MS = 380;
const PAUSE_MS = 500;

export function LiveMovingCaptions({ captionStyle }: LiveMovingCaptionsProps) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const tick = () => {
      setCurrentStep((prev) => {
        const next = (prev + 1) % (TOTAL_WORDS + 1); // +1 step is pause before restart
        return next;
      });
    };

    const delay = currentStep >= TOTAL_WORDS ? PAUSE_MS : STEP_MS;
    timeoutId = setTimeout(tick, delay);

    return () => clearTimeout(timeoutId);
  }, [currentStep]);

  // Determine which chunk is active
  const activeChunkIndex = currentStep < 2 ? 0 : currentStep < 4 ? 1 : 2;
  const chunk = CHUNKS[activeChunkIndex];

  return (
    <div className="flex items-center justify-center select-none pointer-events-none transition-all duration-150">
      {captionStyle === "classic" && (
        <div className="inline-block px-2.5 py-1 rounded bg-black/85 border border-black text-[11px] font-bold text-white shadow-lg">
          {chunk.words.map((word, i) => {
            const isWordActive = chunk.baseIndex + i === currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-0.5 transition-colors duration-150 ${
                  isWordActive ? "text-[#FFFF00] underline underline-offset-2" : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "robin" && (
        <div className="inline-flex items-center justify-center px-1 text-[11px] font-black uppercase tracking-wide">
          {chunk.words.map((word, i) => {
            const isWordActive = chunk.baseIndex + i === currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-1 transform transition-all duration-150 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] [text-shadow:_0_2px_4px_rgba(0,0,0,0.95),_0_0_2px_#000] ${
                  isWordActive ? "text-[#34D399] scale-115 font-black" : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "punch" && (
        <div className="inline-flex items-center justify-center px-1 text-[12px] font-extrabold uppercase tracking-tight">
          {chunk.words.map((word, i) => {
            const isWordActive = chunk.baseIndex + i === currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-1 transform transition-all duration-150 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] [text-shadow:_0_2px_4px_rgba(0,0,0,0.95),_0_0_2px_#000] ${
                  isWordActive ? "text-[#F7C204] scale-115" : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "pill" && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/85 border border-white/15 text-[10.5px] font-semibold text-white shadow-lg">
          {chunk.words.map((word, i) => {
            const isWordActive = chunk.baseIndex + i === currentStep;
            return (
              <span
                key={i}
                className={`inline-block transition-all duration-150 ${
                  isWordActive ? "text-[#34D399] font-bold scale-110" : "text-white"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "clean" && (
        <div className="inline-flex items-center justify-center px-1 text-[11px] font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
          {chunk.words.map((word, i) => {
            const isWordActive = chunk.baseIndex + i === currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-1 transition-all duration-150 ${
                  isWordActive ? "text-white scale-105" : "text-zinc-300"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}

      {captionStyle === "karaoke" && (
        <div className="inline-flex items-center justify-center px-1 text-[11px] font-bold drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
          {chunk.words.map((word, i) => {
            const isWordActive = chunk.baseIndex + i === currentStep;
            return (
              <span
                key={i}
                className={`inline-block mx-1 transition-all duration-150 ${
                  isWordActive
                    ? "text-[#34D399] underline decoration-[#34D399]/70 underline-offset-4"
                    : "text-white"
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


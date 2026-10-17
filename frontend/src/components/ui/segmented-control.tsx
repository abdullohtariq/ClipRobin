"use client";

import React from "react";

export interface SegmentedControlOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  sublabel?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
  tooltip?: string;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
  size = "md",
  className = "",
  ariaLabel,
}: SegmentedControlProps<T>) {
  const heightClass = size === "sm" ? "min-h-[34px] py-1 px-2.5 text-xs" : "min-h-[38px] py-1.5 px-3 text-[13px]";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`grid w-full rounded-xl border border-zinc-800 bg-[#0d0d10] p-1 gap-1.5 ${className}`}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        const isDisabled = disabled || option.disabled;

        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={isDisabled}
            title={option.tooltip}
            onClick={() => {
              if (!isDisabled) onChange(option.value);
            }}
            className={`relative flex flex-col items-center justify-center rounded-lg font-medium transition-all duration-150 tabular-nums focus-ring ${heightClass} ${
              isSelected
                ? "border border-zinc-700 bg-zinc-800 text-white font-semibold shadow-sm"
                : "border border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            } ${isDisabled ? "cursor-not-allowed opacity-45 pointer-events-none" : "cursor-pointer"}`}
          >
            <span className="flex items-center gap-1.5 leading-none">
              <span>{option.label}</span>
              {option.badge}
            </span>
            {option.sublabel && (
              <span className="mt-0.5 text-[11px] text-zinc-500 font-normal leading-none">
                {option.sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

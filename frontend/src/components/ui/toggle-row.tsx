"use client";

import React from "react";

export interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className = "",
}: ToggleRowProps) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-[#121215] p-3.5 transition-all duration-150 ${className}`}
    >
      <div className="min-w-0 pr-2">
        <label
          onClick={() => {
            if (!disabled) onChange(!checked);
          }}
          className={`text-[13px] font-medium leading-tight block select-none ${
            disabled ? "text-zinc-500 cursor-not-allowed" : "text-zinc-200 cursor-pointer"
          }`}
        >
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-xs text-zinc-400 leading-normal">
            {description}
          </p>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus-ring ${
          checked ? "bg-[#10b981]" : "bg-zinc-800"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span
          className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

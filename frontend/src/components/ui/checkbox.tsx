"use client";

import React from "react";

export interface CheckboxProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({
  id,
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
}: CheckboxProps) {
  const fallbackId = React.useId();
  const generatedId = id || fallbackId;

  return (
    <label
      htmlFor={generatedId}
      className={`inline-flex items-center gap-2.5 select-none transition-colors duration-150 ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${className}`}
    >
      <div className="relative flex items-center justify-center">
        <input
          id={generatedId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div
          className={`size-4 rounded border transition-all duration-150 focus-ring flex items-center justify-center ${
            checked
              ? "bg-[#10b981] border-[#10b981] text-zinc-950 shadow-sm"
              : "bg-[#0d0d10] border-zinc-700 hover:border-zinc-500"
          } peer-focus-visible:ring-2 peer-focus-visible:ring-[#10b981] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#09090b]`}
        >
          {checked && (
            <svg
              className="size-3 stroke-[3] text-zinc-950"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      </div>
      {label && (
        <span className="text-[13px] font-medium text-zinc-300 peer-disabled:text-zinc-500">
          {label}
        </span>
      )}
    </label>
  );
}

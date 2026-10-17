"use client";

import React from "react";
import { Tooltip } from "./tooltip";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
  variant?: "ghost" | "secondary" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
}

export function IconButton({
  icon,
  label,
  tooltip,
  variant = "ghost",
  size = "md",
  className = "",
  disabled,
  ...props
}: IconButtonProps) {
  const sizeStyles = {
    sm: "size-8 p-1.5",
    md: "size-9 p-2",
    lg: "size-10 p-2.5",
  };

  const variantStyles = {
    ghost: "bg-transparent text-zinc-400 hover:text-white hover:bg-zinc-800/60 border border-transparent hover:border-zinc-700/60",
    secondary: "bg-[#18181c] text-zinc-300 hover:text-white hover:bg-[#202026] border border-zinc-800 hover:border-zinc-700",
    danger: "bg-red-500/10 text-red-400 hover:text-red-300 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40",
    accent: "bg-[#10b981] text-zinc-950 hover:bg-[#059669] font-semibold shadow-sm",
  };

  const button = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg transition-all duration-150 focus-ring ${sizeStyles[size]} ${variantStyles[variant]} ${
        disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "cursor-pointer"
      } ${className}`}
      {...props}
    >
      {icon}
    </button>
  );

  if (tooltip) {
    return <Tooltip content={tooltip}>{button}</Tooltip>;
  }

  return button;
}

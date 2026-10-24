"use client";

import React from "react";

export type BadgeVariant = "default" | "emerald" | "amber" | "purple" | "danger" | "neutral";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "sm" | "md";
  children: React.ReactNode;
}

export function Badge({
  variant = "default",
  size = "sm",
  children,
  className = "",
  ...props
}: BadgeProps) {
  const variantStyles: Record<BadgeVariant, string> = {
    default: "bg-zinc-800/80 text-zinc-300 border-zinc-700/60",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    amber: "bg-amber-400/10 text-amber-300 border-amber-400/25",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/25",
    danger: "bg-red-500/10 text-red-300 border-red-500/25",
    neutral: "bg-zinc-900 text-zinc-400 border-zinc-800",
  };

  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs font-semibold tracking-wide",
    md: "px-2.5 py-1 text-xs font-semibold",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border leading-none font-medium whitespace-nowrap transition-colors duration-150 ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

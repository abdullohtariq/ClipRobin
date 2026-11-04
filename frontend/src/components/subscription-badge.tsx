"use client";

import React from "react";
import { useSubscription } from "@/src/lib/subscription-context";

export function SubscriptionBadge() {
  const { isPro, openUpgradeModal } = useSubscription();

  if (isPro) {
    return (
      <button
        type="button"
        onClick={() => openUpgradeModal()}
        className="w-full flex items-center justify-between p-2.5 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 to-zinc-900/40 hover:border-emerald-500/50 transition-all text-left group cursor-pointer"
        title="Clip Robin Pro active"
      >
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold border border-emerald-500/30 shadow-xs">
            ★
          </div>
          <div className="hidden xl:block">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Pro Plan</span>
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-[10px] text-emerald-400/80">AI Hooks Unlocked</p>
          </div>
        </div>
        <span className="hidden xl:inline text-[11px] font-medium text-zinc-400 group-hover:text-emerald-300">
          Manage
        </span>
      </button>
    );
  }

  return (
    <div className="p-2.5 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-zinc-900/60 to-zinc-900/80 text-left">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">🔒</span>
          <span className="text-xs font-bold text-amber-200">Free Plan</span>
        </div>
        <span className="text-[10px] uppercase font-semibold text-zinc-400 bg-zinc-800/80 px-1.5 py-0.5 rounded">
          Basic
        </span>
      </div>
      <p className="hidden xl:block mt-1 text-[11px] text-zinc-400 line-clamp-2">
        Gemini AI hooks &amp; custom watermark are locked.
      </p>
      <button
        type="button"
        onClick={() => openUpgradeModal("Gemini AI Hooks & Custom Watermarks")}
        className="mt-2 w-full py-1.5 px-2 rounded-lg bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-zinc-950 font-bold text-xs shadow-md transition-all duration-150 text-center cursor-pointer"
      >
        <span className="xl:inline hidden">⚡ Upgrade to Pro</span>
        <span className="xl:hidden inline">Upgrade</span>
      </button>
    </div>
  );
}

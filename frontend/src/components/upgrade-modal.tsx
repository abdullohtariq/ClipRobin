"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CAPTION_STYLE_OPTIONS } from "@/src/lib/caption-styles";
import { useSubscription } from "@/src/lib/subscription-context";

export function UpgradeModal() {
  const { isPro, upgradeModalOpen, upgradeReason, closeUpgradeModal } = useSubscription();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (upgradeModalOpen && !element?.open) element?.showModal();
    if (!upgradeModalOpen && element?.open) element.close();
  }, [upgradeModalOpen]);

  return (
    <dialog
      ref={dialog}
      onClose={closeUpgradeModal}
      aria-labelledby="upgrade-modal-title"
      className="cliprobin-dialog w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-zinc-800 bg-[#121215] p-6 text-[#f4f4f5] shadow-2xl space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
            Clip Robin Pro · $12/month
          </span>
          <h2 id="upgrade-modal-title" className="text-lg font-semibold text-[#f4f4f5]">
            {isPro ? "Manage Clip Robin Pro" : "Unlock Pro features"}
          </h2>
        </div>
        <button
          type="button"
          onClick={closeUpgradeModal}
          aria-label="Close dialog"
          className="size-8 shrink-0 rounded-lg border border-zinc-800 bg-[#18181c] text-zinc-400 hover:text-white flex items-center justify-center focus-ring cursor-pointer"
        >
          ✕
        </button>
      </div>

      {upgradeReason && !isPro && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3.5 py-2 text-xs font-medium text-amber-200">
          Pro feature selected: <span className="font-semibold text-white">{upgradeReason}</span>
        </p>
      )}

      <div className="space-y-2.5 text-xs">
        <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5 space-y-1">
          <div className="font-semibold text-emerald-400">Included free</div>
          <p className="text-zinc-400 leading-relaxed">
            Local transcription, Fast Interval cuts, 16:9 / 1:1 / 9:16 framing, Classic &amp; Clean captions, and 720×1280 MP4 &amp; ZIP export.
          </p>
        </div>
        <div className="rounded-xl border border-amber-400/25 bg-[#0c0c0e] p-3.5 space-y-1">
          <div className="font-semibold text-amber-300">Added with Pro</div>
          <p className="text-zinc-300 leading-relaxed">
            Gemini AI Hook Finder (20 credits/cycle or own key), all {CAPTION_STYLE_OPTIONS.length} caption styles, watermark removal, and custom brand logos.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
        <button
          type="button"
          onClick={closeUpgradeModal}
          className="min-h-[38px] rounded-xl border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors focus-ring cursor-pointer"
        >
          Close
        </button>
        <Link
          href="/subscription"
          onClick={closeUpgradeModal}
          className="min-h-[38px] inline-flex items-center rounded-xl bg-[#10b981] hover:bg-[#059669] px-4 py-2 text-xs font-bold text-zinc-950 transition-colors focus-ring"
        >
          View plans
        </Link>
      </div>
    </dialog>
  );
}

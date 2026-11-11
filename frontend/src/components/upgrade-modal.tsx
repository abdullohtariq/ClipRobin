"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
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
    <dialog ref={dialog} onClose={closeUpgradeModal} aria-labelledby="upgrade-modal-title" className="m-auto w-[min(90vw,28rem)] space-y-4 rounded-2xl border border-zinc-700 bg-[#121215] p-6 text-white backdrop:bg-black/75">
      <h2 id="upgrade-modal-title" className="text-lg font-semibold">{isPro ? "Manage Clip Robin Pro" : "Explore Clip Robin Pro"}</h2>
      {upgradeReason && !isPro && <p className="text-sm font-medium text-emerald-300">{upgradeReason}</p>}
      <p className="text-sm text-zinc-300">Open Account &amp; Plans to view your plan and billing options.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/subscription" onClick={closeUpgradeModal} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950">Account &amp; Plans</Link>
        <button type="button" onClick={closeUpgradeModal} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm">Close</button>
      </div>
    </dialog>
  );
}

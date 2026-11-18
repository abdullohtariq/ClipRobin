"use client";

import Link from "next/link";
import { useSubscription } from "@/src/lib/subscription-context";

export function SubscriptionBadge() {
  const { isPro } = useSubscription();

  return (
    <Link
      href="/subscription"
      title={isPro ? "Clip Robin Pro active" : "Free plan — view account and plans"}
      className="w-full flex items-center justify-center xl:justify-between gap-2.5 rounded-xl border border-zinc-800 bg-[#121215] px-2.5 py-2 text-left transition-all duration-150 hover:border-zinc-700 hover:bg-[#18181c] focus-ring group cursor-pointer"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${
            isPro
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-zinc-700 bg-zinc-900 text-zinc-300"
          }`}
        >
          {isPro ? "★" : "F"}
        </span>
        <div className="hidden xl:block min-w-0">
          <div className="text-xs font-semibold text-[#f4f4f5] truncate">
            {isPro ? "Pro Plan" : "Free Plan"}
          </div>
          <p className="text-xs text-zinc-400 truncate">
            {isPro ? "Account & billing" : "Local mode"}
          </p>
        </div>
      </div>
      <span className="hidden xl:inline text-xs font-medium text-zinc-400 group-hover:text-emerald-400 shrink-0">
        {isPro ? "Manage" : "Upgrade"}
      </span>
    </Link>
  );
}

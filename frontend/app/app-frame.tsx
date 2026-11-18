"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import UpdateNotice from "./update-notice";
import JobProgress from "./job-progress";
import SidebarNav from "./sidebar-nav";
import WindowInit from "./window-init";
import { QueueProvider } from "@/src/lib/queue-context";
import { UpgradeModal } from "@/src/components/upgrade-modal";
import { SubscriptionBadge } from "@/src/components/subscription-badge";
import { EngineStatus } from "@/src/components/engine-status";

const accountBasePath = (process.env.NEXT_PUBLIC_CLIPROBIN_ACCOUNT_BASE_PATH || "").trim().replace(/\/+$/, "");

export default function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (process.env.NEXT_PUBLIC_CLIPROBIN_ACCOUNT_SITE === "1" && pathname?.replace(/\/$/, "") === "/subscription") {
    return (
      <>
        <header className="border-b border-zinc-800">
          <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 sm:px-8">
            <Image src={`${accountBasePath}/logo-mark.svg`} alt="" width={36} height={36} />
            <span className="text-lg font-bold">Clip Robin</span>
          </div>
        </header>
        {children}
      </>
    );
  }

  return (
    <>
      <div className="h-screen flex flex-col md:flex-row overflow-hidden bg-[#09090b]">
        <aside className="w-full md:w-16 xl:w-64 md:h-screen border-b md:border-b-0 md:border-r border-zinc-800/90 bg-[#09090b] px-4 py-2.5 md:p-3 xl:p-6 shrink-0 flex flex-row md:flex-col items-center md:items-stretch justify-between z-20 overflow-x-auto md:overflow-y-auto">
          <div className="flex items-center md:block justify-between w-full gap-4">
            <div className="md:mb-8 flex items-center md:justify-center xl:justify-start gap-3 shrink-0">
              <Image
                src="/logo-mark.svg"
                alt="Clip Robin logo"
                width={34}
                height={34}
                className="shrink-0 object-contain"
                priority
              />
              <div className="hidden xl:block">
                <span className="block text-lg font-bold tracking-tight text-[#f4f4f5] leading-none">Clip Robin</span>
                <p className="mt-1 text-xs font-medium text-zinc-500">Local Video Studio</p>
              </div>
            </div>
            <SidebarNav />
          </div>
          <div className="hidden md:flex flex-col gap-3 pt-4 border-t border-zinc-800/90">
            <SubscriptionBadge />
            <EngineStatus variant="sidebar" />
          </div>
        </aside>
        <div className="flex-1 h-full md:h-screen overflow-y-auto bg-[#09090b] min-w-0">
          <WindowInit />
          <UpdateNotice />
          <QueueProvider>{children}</QueueProvider>
        </div>
      </div>
      <UpgradeModal />
      <JobProgress />
    </>
  );
}

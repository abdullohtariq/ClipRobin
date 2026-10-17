import type { Metadata } from "next";
import Image from "next/image";
import { Inter } from "next/font/google";
import UpdateNotice from "./update-notice";
import JobProgress from "./job-progress";
import SidebarNav from "./sidebar-nav";
import WindowInit from "./window-init";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Clip Robin",
  description: "Turn long videos into short clips with AI",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#0a0a0a] text-white antialiased selection:bg-[#10b981]/20 selection:text-emerald-300`}>
        <div className="h-screen flex overflow-hidden bg-[#0a0a0a]">
          {/* Sidebar - permanently pinned to the left */}
          <aside className="w-64 h-screen border-r border-[#232326] bg-[#0a0a0a] p-6 shrink-0 flex flex-col justify-between z-20 overflow-y-auto">
            <div>
              <div className="mb-8 flex items-center gap-3">
                <Image
                  src="/logo-mark.svg"
                  alt="Clip Robin logo"
                  width={36}
                  height={36}
                  className="shrink-0 object-contain"
                  priority
                />
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-white leading-none">Clip Robin</h1>
                  <p className="mt-1 text-[11px] font-medium text-zinc-500">Local Video AI</p>
                </div>
              </div>

              <SidebarNav />
            </div>

            <div className="pt-6 border-t border-[#232326]">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="size-2 rounded-full bg-[#10b981] animate-pulse" />
                <span>Local Engine Ready</span>
              </div>
            </div>
          </aside>

          {/* Main content - independently scrollable right pane */}
          <div className="flex-1 h-screen overflow-y-auto bg-[#0a0a0a] min-w-0">
            <WindowInit />
            <UpdateNotice />
            {children}
          </div>
        </div>
        <JobProgress />
      </body>
    </html>
  );
}

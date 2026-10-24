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
        <div className="h-screen flex flex-col md:flex-row overflow-hidden bg-[#0a0a0a]">
          {/* Responsive navigation: top bar on mobile, icon rail on tablet/laptop, full sidebar on desktop */}
          <aside className="w-full md:w-16 xl:w-64 md:h-screen border-b md:border-b-0 md:border-r border-[#232326] bg-[#0a0a0a] px-4 py-2.5 md:p-3 xl:p-6 shrink-0 flex flex-row md:flex-col items-center md:items-stretch justify-between z-20 overflow-x-auto md:overflow-y-auto">
            <div className="flex items-center md:block justify-between w-full gap-4">
              <div className="md:mb-8 flex items-center md:justify-center xl:justify-start gap-3 shrink-0">
                <Image
                  src="/logo-mark.svg"
                  alt="Clip Robin logo"
                  width={36}
                  height={36}
                  className="shrink-0 object-contain"
                  priority
                />
                <div className="hidden xl:block">
                  <h1 className="text-xl font-bold tracking-tight text-white leading-none">Clip Robin</h1>
                  <p className="mt-1 text-xs font-medium text-zinc-500">Local Video AI</p>
                </div>
              </div>

              <SidebarNav />
            </div>

            <div className="hidden md:block pt-6 border-t border-[#232326]">
              <div className="flex items-center justify-center xl:justify-start gap-2 text-xs text-zinc-500" title="Local Engine Ready">
                <span className="size-2 rounded-full bg-[#10b981] animate-pulse shrink-0" />
                <span className="hidden xl:inline">Local Engine Ready</span>
              </div>
            </div>
          </aside>

          {/* Main content - independently scrollable right pane */}
          <div className="flex-1 h-full md:h-screen overflow-y-auto bg-[#0a0a0a] min-w-0">
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

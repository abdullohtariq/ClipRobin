import type { Metadata } from "next";
import Image from "next/image";
import { Inter } from "next/font/google";
import UpdateNotice from "./update-notice";
import JobProgress from "./job-progress";
import SidebarNav from "./sidebar-nav";
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
        <div className="min-h-screen flex">
          {/* Sidebar */}
          <aside className="w-64 border-r border-[#232326] bg-[#0a0a0a] p-6 shrink-0 flex flex-col justify-between">
            <div>
              <div className="mb-8 flex items-center gap-3">
                <Image
                  src="/logo.svg"
                  alt="Clip Robin logo"
                  width={36}
                  height={36}
                  className="rounded-xl shadow"
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

          {/* Main content */}
          <div className="flex-1 bg-[#0a0a0a] min-h-screen">
            <UpdateNotice />
            {children}
          </div>
        </div>
        <JobProgress />
      </body>
    </html>
  );
}

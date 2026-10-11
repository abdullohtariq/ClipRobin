import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

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
    <html lang="en">
      <body className="bg-zinc-950 text-white">
        <div className="min-h-screen flex">
          {/* Sidebar */}
          <aside className="w-64 border-r border-zinc-800 p-6">
            <div className="mb-10 flex items-center gap-3">
              <Image
                src="/clip-robin-icon.png"
                alt="Clip Robin logo"
                width={40}
                height={40}
                className="rounded-xl"
                priority
              />
              <h1 className="text-2xl font-bold">Clip Robin</h1>
            </div>

            <nav className="space-y-3">
              <Link
                href="/"
                className="block rounded-lg px-4 py-3 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                Dashboard
              </Link>

              <Link
                href="/projects"
                className="block rounded-lg px-4 py-3 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                Projects
              </Link>

              <Link
                href="/clips"
                className="block rounded-lg px-4 py-3 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                Clips
              </Link>

              <Link
                href="/settings"
                className="block rounded-lg px-4 py-3 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                Settings
              </Link>
            </nav>
          </aside>

          {/* Page */}
          <div className="flex-1">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}

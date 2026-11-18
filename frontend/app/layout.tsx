import type { Metadata } from "next";
import { Inter } from "next/font/google";
import AppFrame from "./app-frame";
import "./globals.css";
import { SubscriptionProvider } from "@/src/lib/subscription-context";

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
        <SubscriptionProvider>
          <AppFrame>{children}</AppFrame>
        </SubscriptionProvider>
      </body>
    </html>
  );
}

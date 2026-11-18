import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: process.env.NEXT_PUBLIC_CLIPROBIN_ACCOUNT_SITE === "1",
  images: {
    unoptimized: true,
  },
  devIndicators: false,
};

export default nextConfig;

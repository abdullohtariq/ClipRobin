import type { NextConfig } from "next";

const isAccountSite = process.env.NEXT_PUBLIC_CLIPROBIN_ACCOUNT_SITE === "1";
const rawBasePath = process.env.NEXT_PUBLIC_CLIPROBIN_ACCOUNT_BASE_PATH?.trim() || "";
const normalizedBasePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: isAccountSite,
  ...(isAccountSite && normalizedBasePath ? { basePath: normalizedBasePath } : {}),
  images: {
    unoptimized: true,
  },
  devIndicators: false,
};

export default nextConfig;

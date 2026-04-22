import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  basePath: "/jtl-app",
};

export default nextConfig;
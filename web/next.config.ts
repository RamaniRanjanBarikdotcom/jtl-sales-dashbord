import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: false,
  async rewrites() {
    // Proxy /api/* to the NestJS backend when NEXT_PUBLIC_API_URL is set.
    // In production Nginx handles this; rewrites are used in local dev.
    const backendUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!backendUrl) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;

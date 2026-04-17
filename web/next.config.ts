import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    // In local dev, proxy /api/* to the NestJS backend.
    // In production, nginx handles this so no rewrites are needed.
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001/api';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;

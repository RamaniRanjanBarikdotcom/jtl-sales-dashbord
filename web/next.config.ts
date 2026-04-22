import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  basePath: '/app1',
  async rewrites() {
    // In local dev, proxy /api/* to the NestJS backend.
    // In production, an external reverse proxy (e.g., Apache) handles routing.
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

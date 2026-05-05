import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://nestjs-api:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  basePath: "/jtl-app",
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/jtl-app/dashboard",
        permanent: false,
        basePath: false,
      },
      {
        source: "/dashboard/:path*",
        destination: "/jtl-app/dashboard/:path*",
        permanent: false,
        basePath: false,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${backendUrl}/api/:path*`,
          basePath: false,
        },
      ],
    };
  },
};

export default nextConfig;

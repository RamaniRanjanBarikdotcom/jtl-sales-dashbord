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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
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

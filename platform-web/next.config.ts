import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/push-service-worker.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache"
          },
          {
            key: "Service-Worker-Allowed",
            value: "/app/"
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          }
        ]
      },
      {
        source: "/app/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive"
          },
          {
            key: "Cache-Control",
            value: "private, no-store"
          }
        ]
      }
    ];
  },
  experimental: {
    useTypeScriptCli: true
  }
};

export default nextConfig;

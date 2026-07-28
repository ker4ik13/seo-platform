import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
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

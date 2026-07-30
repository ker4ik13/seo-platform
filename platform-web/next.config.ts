import type { NextConfig } from "next";
import { createWebHttpHeaderRules } from "./lib/http-security-policy";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return createWebHttpHeaderRules(process.env.NODE_ENV);
  },
  experimental: {
    useTypeScriptCli: true
  }
};

export default nextConfig;

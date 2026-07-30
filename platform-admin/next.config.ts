import type { NextConfig } from "next";
import { createAdminHttpHeaderRules } from "./lib/http-security-policy";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return createAdminHttpHeaderRules(process.env.NODE_ENV);
  },
  experimental: {
    useTypeScriptCli: true
  }
};

export default nextConfig;

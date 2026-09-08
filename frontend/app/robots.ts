import type { MetadataRoute } from "next";
import { webPublicOrigin } from "../lib/server-runtime-origin";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = webPublicOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/admin", "/preview", "/tools/results"]
      }
    ],
    sitemap: `${siteUrl}/sitemap.xml`
  };
}

import type { MetadataRoute } from "next";
import { locales } from "../lib/locales";
import { webPublicOrigin } from "../lib/server-runtime-origin";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = webPublicOrigin();
  const lastModified = new Date();

  return [
    ...locales.map((locale) => ({
      url: `${siteUrl}/${locale}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 1
    })),
    {
      url: `${siteUrl}/tools`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9
    },
    {
      url: `${siteUrl}/docs/api`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8
    }
  ];
}

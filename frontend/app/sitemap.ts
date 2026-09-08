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
    ...locales.flatMap(locale => ["pricing", "help", "security", "cookies"].map(slug => ({
      url: `${siteUrl}/${locale}/${slug}`, lastModified: new Date("2026-09-07T00:00:00Z"), changeFrequency: "monthly" as const, priority: slug === "pricing" ? 0.9 : 0.5
    }))),
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

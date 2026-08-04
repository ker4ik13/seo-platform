import type { MetadataRoute } from "next";
import { publicToolCapabilities } from "../lib/tool-capabilities";
import { locales } from "../lib/locales";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/u, "") ??
    "http://localhost:3000";
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
    ...publicToolCapabilities().map((tool) => ({
      url: `${siteUrl}/tools/${tool.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.7
    })),
    {
      url: `${siteUrl}/docs/api`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8
    }
  ];
}

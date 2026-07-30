import type { MetadataRoute } from "next";
import { locales } from "../lib/locales";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/u, "") ??
    "http://localhost:3000";
  const lastModified = new Date();

  return locales.map((locale) => ({
    url: `${siteUrl}/${locale}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: 1
  }));
}

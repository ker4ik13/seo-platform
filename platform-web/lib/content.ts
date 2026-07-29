import type { Locale } from "./locales";

export interface MarketingPage {
  readonly title: string;
  readonly description: string;
  readonly heroTitle: string;
  readonly heroText: string;
  readonly primaryCtaLabel: string;
  readonly secondaryCtaLabel: string;
  readonly eyebrow: string;
  readonly source: "directus" | "fallback";
}

const fallback: Record<Locale, Omit<MarketingPage, "source">> = {
  ru: {
    title: "SEO Workspace — платформа для SEO-команд",
    description:
      "Семантика, позиции, частотность, конкуренты и командная работа в едином пространстве.",
    heroTitle: "SEO-работа без хаоса между таблицами и сервисами",
    heroText:
      "Собирайте семантику, следите за позициями, запускайте парсинг и работайте с командой в одном прозрачном процессе.",
    primaryCtaLabel: "Попробовать платформу",
    secondaryCtaLabel: "Посмотреть возможности",
    eyebrow: "Рабочее пространство для SEO-команд"
  },
  en: {
    title: "SEO Workspace — one platform for SEO teams",
    description:
      "Semantics, rankings, search volume, competitors and collaboration in one workspace.",
    heroTitle: "SEO operations without spreadsheet chaos",
    heroText:
      "Build semantic cores, track rankings, run data collection and collaborate with your team in one transparent workflow.",
    primaryCtaLabel: "Try the platform",
    secondaryCtaLabel: "Explore features",
    eyebrow: "The workspace for modern SEO teams"
  }
};

interface DirectusPage {
  readonly title?: string;
  readonly description?: string;
  readonly hero_title?: string;
  readonly hero_text?: string;
  readonly primary_cta_label?: string;
  readonly secondary_cta_label?: string;
  readonly eyebrow?: string;
}

export async function getMarketingPage(
  locale: Locale
): Promise<MarketingPage> {
  const fallbackPage = fallback[locale];
  const directusUrl = process.env.DIRECTUS_URL?.replace(/\/$/, "");
  if (!directusUrl) return { ...fallbackPage, source: "fallback" };

  const query = new URLSearchParams({
    "filter[slug][_eq]": "home",
    "filter[locale][_eq]": locale,
    fields:
      "title,description,hero_title,hero_text,primary_cta_label,secondary_cta_label,eyebrow",
    limit: "1"
  });

  try {
    const response = await fetch(
      `${directusUrl}/items/marketing_pages?${query.toString()}`,
      {
        headers: process.env.DIRECTUS_READ_TOKEN
          ? { Authorization: `Bearer ${process.env.DIRECTUS_READ_TOKEN}` }
          : {},
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(2_000)
      }
    );
    if (!response.ok) return { ...fallbackPage, source: "fallback" };

    const payload = (await response.json()) as {
      data?: readonly DirectusPage[];
    };
    const page = payload.data?.[0];
    if (!page) return { ...fallbackPage, source: "fallback" };

    return {
      title: page.title || fallbackPage.title,
      description: page.description || fallbackPage.description,
      heroTitle: page.hero_title || fallbackPage.heroTitle,
      heroText: page.hero_text || fallbackPage.heroText,
      primaryCtaLabel:
        page.primary_cta_label || fallbackPage.primaryCtaLabel,
      secondaryCtaLabel:
        page.secondary_cta_label || fallbackPage.secondaryCtaLabel,
      eyebrow: page.eyebrow || fallbackPage.eyebrow,
      source: "directus"
    };
  } catch {
    return { ...fallbackPage, source: "fallback" };
  }
}

import type { Locale } from "./locales";

export interface MarketingPage {
  readonly title: string;
  readonly description: string;
  readonly heroTitle: string;
  readonly heroText: string;
  readonly primaryCtaLabel: string;
  readonly secondaryCtaLabel: string;
  readonly eyebrow: string;
}

const marketingPages: Record<Locale, MarketingPage> = {
  ru: {
    title: "SEOньорита — платформа для SEO-команд",
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
    title: "SEOnorita — one platform for SEO teams",
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

export function getMarketingPage(locale: Locale): MarketingPage {
  return marketingPages[locale];
}

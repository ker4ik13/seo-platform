import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMarketingPage } from "../../lib/content";
import { isLocale, locales, type Locale } from "../../lib/locales";

interface PageProps {
  readonly params: Promise<{ locale: string }>;
}

const featureCopy: Record<Locale, readonly [string, string][]> = {
  ru: [
    ["Семантика как система", "Группы, кластеры, интенты, URL, частотности и история изменений."],
    ["Данные под контролем", "Позиции и сбор данных по расписанию с источником, свежестью и стоимостью."],
    ["Настоящая командная работа", "Роли, комментарии, присутствие и безопасные совместные изменения."]
  ],
  en: [
    ["Semantics as a system", "Groups, clusters, intent, URLs, search volume and version history."],
    ["Data under control", "Scheduled ranking and data collection with source, freshness and cost."],
    ["Real teamwork", "Roles, comments, presence and safe collaborative changes."]
  ]
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params
}: PageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) return {};
  const page = await getMarketingPage(rawLocale);

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: `/${rawLocale}`,
      languages: { ru: "/ru", en: "/en" }
    },
    openGraph: {
      title: page.title,
      description: page.description,
      type: "website",
      locale: rawLocale === "ru" ? "ru_RU" : "en_US"
    }
  };
}

export default async function MarketingPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  const locale = rawLocale;
  const page = await getMarketingPage(locale);
  const appUrl = "/app";
  const copy = locale === "ru"
    ? {
        nav: ["Продукт", "Toolbox", "API", "Цены"],
        login: "Войти",
        proof: "Для агентств, in-house команд и самостоятельных SEO-специалистов",
        dashboard: "Обзор проекта",
        visibility: "Видимость",
        top: "Запросов в топ-10",
        active: "Выполняется",
        queue: "Фоновые задачи",
        footer: "Сделано для спокойной, точной SEO-работы."
      }
    : {
        nav: ["Product", "Toolbox", "API", "Pricing"],
        login: "Sign in",
        proof: "For agencies, in-house teams and independent SEO specialists",
        dashboard: "Project overview",
        visibility: "Visibility",
        top: "Keywords in top 10",
        active: "In progress",
        queue: "Background jobs",
        footer: "Built for calm, precise SEO operations."
      };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href={`/${locale}`}><span>S</span>SEO Workspace</a>
        <nav aria-label="Основная навигация">
          {copy.nav.map((item, index) => (
            <a
              href={index === 1 ? "/tools" : index === 2 ? "/docs/api" : "#features"}
              key={item}
            >
              {item}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a className="locale" href={locale === "ru" ? "/en" : "/ru"}>
            {locale === "ru" ? "EN" : "RU"}
          </a>
          <a className="login" href={appUrl}>{copy.login}</a>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><i />{page.eyebrow}</p>
          <h1>{page.heroTitle}</h1>
          <p className="lead">{page.heroText}</p>
          <div className="hero-actions">
            <a className="primary" href={appUrl}>{page.primaryCtaLabel}<span>→</span></a>
            <a className="secondary" href="#features">{page.secondaryCtaLabel}</a>
          </div>
          <small>{copy.proof}</small>
        </div>

        <div className="product-frame" aria-label="Пример интерфейса платформы">
          <div className="frame-sidebar">
            <span className="mini-brand">S</span>
            {[1, 2, 3, 4, 5].map((item) => <i key={item} />)}
          </div>
          <div className="frame-main">
            <header><strong>{copy.dashboard}</strong><span>⌘ K</span></header>
            <div className="frame-content">
              <div className="frame-metrics">
                <article><span>{copy.visibility}</span><strong>32,8%</strong><small>+3,4%</small></article>
                <article><span>{copy.top}</span><strong>6 284</strong><small>+4,8%</small></article>
                <article><span>{copy.queue}</span><strong>3</strong><small>{copy.active}</small></article>
              </div>
              <div className="frame-grid">
                <article className="frame-chart">
                  <span>Search visibility</span>
                  <svg viewBox="0 0 500 170" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="hero-area" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stopColor="#7464ef" stopOpacity=".26" />
                        <stop offset="1" stopColor="#7464ef" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0 135 C80 130 90 105 150 112 S240 94 290 92 S365 60 410 67 S460 40 500 33 L500 170 L0 170 Z" />
                    <path className="line" d="M0 135 C80 130 90 105 150 112 S240 94 290 92 S365 60 410 67 S460 40 500 33" />
                  </svg>
                </article>
                <article className="frame-list">
                  <span>Signals</span>
                  {[42, 68, 54].map((width) => <i key={width} style={{ width: `${width}%` }} />)}
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        {featureCopy[locale].map(([title, description], index) => (
          <article key={title}>
            <span>0{index + 1}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <footer>
        <a className="brand" href={`/${locale}`}><span>S</span>SEO Workspace</a>
        <p>{copy.footer}</p>
        {page.source === "fallback" && <small>CMS fallback</small>}
      </footer>
    </main>
  );
}

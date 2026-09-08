import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMarketingPage } from "../../lib/content";
import { isLocale, locales } from "../../lib/locales";
import { webPublicOrigin } from "../../lib/server-runtime-origin";

interface PageProps {
  readonly params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) return {};

  const page = getMarketingPage(rawLocale);

  return {
    title: page.title,
    description: page.description,
    keywords: [...page.keywords],
    applicationName: rawLocale === "ru" ? "SEOньорита" : "SEOnorita",
    category: "SEO software",
    alternates: {
      canonical: `/${rawLocale}`,
      languages: { ru: "/ru", en: "/en", "x-default": "/ru" }
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1
      }
    },
    openGraph: {
      title: page.title,
      description: page.description,
      type: "website",
      url: `/${rawLocale}`,
      siteName: rawLocale === "ru" ? "SEOньорита" : "SEOnorita",
      locale: rawLocale === "ru" ? "ru_RU" : "en_US"
    },
    twitter: {
      card: "summary",
      title: page.title,
      description: page.description
    }
  };
}

function serializeJsonLd(value: object): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export default async function MarketingPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  const locale = rawLocale;
  const page = getMarketingPage(locale);
  const publicOrigin = webPublicOrigin();
  const pageUrl = `${publicOrigin}/${locale}`;
  const brandName = locale === "ru" ? "SEOньорита" : "SEOnorita";
  const appUrl = `/app/register?locale=${locale}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${publicOrigin}/#website`,
        name: brandName,
        url: publicOrigin,
        inLanguage: locale
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${pageUrl}#software`,
        name: brandName,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "SEO software",
        operatingSystem: "Web",
        url: pageUrl,
        description: page.description,
        featureList: page.capabilities.map((capability) => capability.title),
        inLanguage: locale
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        mainEntity: page.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer
          }
        })),
        inLanguage: locale
      }
    ]
  };

  return (
    <main className="landing-page">
      <script
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        type="application/ld+json"
      />

      <header className="site-header landing-header">
        <a aria-label={`${brandName} — ${locale === "ru" ? "главная" : "home"}`} className="brand" href={`/${locale}`}>
          <img alt="" aria-hidden="true" height={28} src="/brand/seonorita-mark.svg" width={28} />
          {brandName}
        </a>
        <nav aria-label={locale === "ru" ? "Основная навигация" : "Main navigation"}>
          {page.navigation.map((item) => (
            <a href={item.href} key={item.href}>{item.label}</a>
          ))}
        </nav>
        <div className="header-actions">
          <a className="locale" href={locale === "ru" ? "/en" : "/ru"} hrefLang={locale === "ru" ? "en" : "ru"}>
            {page.localeLabel}
          </a>
          <a className="login" href={`/app/login?locale=${locale}`}>{page.loginLabel}</a>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow"><i />{page.eyebrow}</p>
          <h1>{page.heroTitle}</h1>
          <p className="landing-lead">{page.heroText}</p>
          <div className="hero-actions">
            <a className="primary" href={appUrl}>{page.primaryCtaLabel}<span aria-hidden="true">→</span></a>
            <a className="secondary" href="#capabilities">{page.secondaryCtaLabel}</a>
          </div>
          <ul className="landing-proof" aria-label={locale === "ru" ? "Ключевые возможности" : "Key capabilities"}>
            {page.proofItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>

        <div className="product-frame" aria-label={locale === "ru" ? "Пример интерфейса SEO-платформы" : "SEO platform interface preview"}>
          <div className="frame-sidebar" aria-hidden="true">
            <span className="mini-brand">S</span>
            {[1, 2, 3, 4, 5].map((item) => <i key={item} />)}
          </div>
          <div className="frame-main">
            <header><strong>{page.preview.title}</strong><span>⌘ K</span></header>
            <div className="frame-content">
              <div className="frame-metrics">
                <article><span>{page.preview.searchVolumeLabel}</span><strong>{page.preview.searchVolume}</strong><small>+4,8%</small></article>
                <article><span>{page.preview.topTenLabel}</span><strong>{page.preview.topTen}</strong><small>+128</small></article>
                <article><span>{page.preview.jobsLabel}</span><strong>{page.preview.jobs}</strong><small>{locale === "ru" ? "в фоне" : "in background"}</small></article>
              </div>
              <div className="frame-grid">
                <article className="frame-chart">
                  <span>{page.preview.chartLabel}</span>
                  <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 500 170">
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
                <article className="frame-keywords">
                  <header><span>{locale === "ru" ? "Запрос" : "Keyword"}</span><span>{locale === "ru" ? "Позиция" : "Rank"}</span><span>WS</span></header>
                  {page.preview.tableRows.map(([keyword, rank, volume]) => (
                    <div key={keyword}><strong>{keyword}</strong><span>{rank}</span><span>{volume}</span></div>
                  ))}
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-values" aria-label={locale === "ru" ? "Преимущества платформы" : "Platform benefits"}>
        {page.valueItems.map(([title, description], index) => (
          <article key={title}>
            <span>0{index + 1}</span>
            <div><h2>{title}</h2><p>{description}</p></div>
          </article>
        ))}
      </section>

      <section className="landing-section" id="capabilities">
        <div className="landing-section-heading">
          <p className="section-eyebrow">{page.capabilitiesEyebrow}</p>
          <h2>{page.capabilitiesTitle}</h2>
          <p>{page.capabilitiesText}</p>
        </div>
        <div className="capability-grid">
          {page.capabilities.map((capability) => (
            <article className="capability-card" key={capability.title}>
              <span>{capability.marker}</span>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
              <ul>{capability.points.map((point) => <li key={point}>{point}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section workflow-section" id="workflow">
        <div className="landing-section-heading compact-heading">
          <p className="section-eyebrow">{page.workflowEyebrow}</p>
          <h2>{page.workflowTitle}</h2>
          <p>{page.workflowText}</p>
        </div>
        <ol className="workflow-grid">
          {page.workflow.map((step, index) => (
            <li key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section workspace-section">
        <div className="workspace-copy">
          <p className="section-eyebrow">{page.workspaceEyebrow}</p>
          <h2>{page.workspaceTitle}</h2>
          <p>{page.workspaceText}</p>
          <div className="workspace-points">
            {page.workspacePoints.map(([title, description]) => (
              <article key={title}><h3>{title}</h3><p>{description}</p></article>
            ))}
          </div>
        </div>
        <div className="workspace-visual" aria-hidden="true">
          <div className="workspace-visual-header"><i /><i /><i /><span>{page.preview.title}</span></div>
          <div className="workspace-visual-toolbar"><span>{locale === "ru" ? "Поиск по запросам" : "Search keywords"}</span><b>{locale === "ru" ? "Фильтры" : "Filters"}</b></div>
          <div className="workspace-visual-table">
            {page.preview.tableRows.map(([keyword, rank, volume], index) => (
              <div key={keyword}>
                <i>{index + 1}</i><strong>{keyword}</strong><span>{volume}</span><b>{rank}<small>↗</small></b>
              </div>
            ))}
            <div><i>4</i><strong>{locale === "ru" ? "автоматизация seo" : "seo automation"}</strong><span>1 980</span><b>14<small>↘</small></b></div>
          </div>
          <div className="workspace-visual-status"><i />{locale === "ru" ? "Данные обновляются без перезагрузки страницы" : "Data updates without a page reload"}</div>
        </div>
      </section>

      <section className="landing-section" id="integrations">
        <div className="landing-section-heading">
          <p className="section-eyebrow">{page.integrationsEyebrow}</p>
          <h2>{page.integrationsTitle}</h2>
          <p>{page.integrationsText}</p>
        </div>
        <div className="integration-grid">
          {page.integrations.map((integration) => (
            <article key={integration.title}>
              <span>{integration.label}</span>
              <h3>{integration.title}</h3>
              <p>{integration.description}</p>
              {integration.label === "API" && <a href="/docs/api">{locale === "ru" ? "Открыть документацию" : "Open documentation"}<b aria-hidden="true">↗</b></a>}
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section comparison-section">
        <div className="landing-section-heading compact-heading">
          <p className="section-eyebrow">{page.comparisonEyebrow}</p>
          <h2>{page.comparisonTitle}</h2>
          <p>{page.comparisonText}</p>
        </div>
        <div className="comparison-table" role="table" aria-label={page.comparisonTitle}>
          <div className="comparison-row comparison-head" role="row">
            {page.comparisonColumns.map((column) => <strong role="columnheader" key={column}>{column}</strong>)}
          </div>
          {page.comparisonRows.map((row) => (
            <div className="comparison-row" role="row" key={row[0]}>
              <strong role="rowheader">{row[0]}</strong><span role="cell">{row[1]}</span><span role="cell">{row[2]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section audience-section" id="for-whom">
        <div className="landing-section-heading compact-heading">
          <p className="section-eyebrow">{page.audienceEyebrow}</p>
          <h2>{page.audienceTitle}</h2>
        </div>
        <div className="audience-grid">
          {page.audiences.map((audience, index) => (
            <article key={audience.title}><span>0{index + 1}</span><h3>{audience.title}</h3><p>{audience.description}</p></article>
          ))}
        </div>
      </section>

      <section className="landing-section faq-section" id="faq">
        <div className="landing-section-heading compact-heading">
          <p className="section-eyebrow">{page.faqEyebrow}</p>
          <h2>{page.faqTitle}</h2>
          <p>{page.faqText}</p>
        </div>
        <div className="faq-list">
          {page.faqs.map((faq, index) => (
            <details key={faq.question} open={index === 0}>
              <summary><span>{faq.question}</span><i aria-hidden="true">+</i></summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-final">
        <p className="section-eyebrow">{page.finalEyebrow}</p>
        <h2>{page.finalTitle}</h2>
        <p>{page.finalText}</p>
        <a className="primary" href={appUrl}>{page.finalCtaLabel}<span aria-hidden="true">→</span></a>
      </section>

      <footer className="landing-footer">
        <div>
          <a className="brand" href={`/${locale}`}>
            <img alt="" aria-hidden="true" height={28} src="/brand/seonorita-mark.svg" width={28} />
            {brandName}
          </a>
          <p>{page.footerText}</p>
        </div>
        <nav aria-label={locale === "ru" ? "Дополнительная навигация" : "Footer navigation"}>
          {page.footerLinks.map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}
        </nav>
        <small>© {new Date().getUTCFullYear()} {brandName}</small>
      </footer>
    </main>
  );
}

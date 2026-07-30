import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { landingContent, type LandingFeature } from "../../lib/landing-content";
import { isLocale, locales, type Locale } from "../../lib/locales";
import {
  developerTelegramUrl,
  resolveTelegramChannelUrl
} from "../../lib/telegram-channel";

interface PageProps {
  readonly params: Promise<{ locale: string }>;
}

interface IconProps {
  readonly children: ReactNode;
  readonly className?: string;
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m20.7 4.4-3 14.1c-.2 1-1 1.2-1.8.8l-4.5-3.3-2.2 2.1c-.2.2-.4.5-.9.5l.3-4.6 8.3-7.5c.4-.3-.1-.5-.6-.2L6.1 12.7l-4.4-1.4c-1-.3-1-1 .2-1.4l17.3-6.7c.8-.3 1.5.2 1.5 1.2Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m3 8.2 3.1 3L13 4.8" />
    </svg>
  );
}

function BrandMark() {
  return (
    <span className="landing-brand-mark" aria-hidden="true">
      <svg viewBox="0 0 38 38">
        <path d="M19 2.5c2.4 8.2 8.3 14.1 16.5 16.5C27.3 21.4 21.4 27.3 19 35.5 16.6 27.3 10.7 21.4 2.5 19 10.7 16.6 16.6 10.7 19 2.5Z" />
        <circle cx="19" cy="19" r="3.3" />
      </svg>
    </span>
  );
}

function FeatureGlyph({ code, children, className }: IconProps & {
  readonly code: LandingFeature["code"];
}) {
  const pathByCode: Record<LandingFeature["code"], ReactNode> = {
    SEM: (
      <>
        <circle cx="10" cy="10" r="3" />
        <circle cx="30" cy="9" r="3" />
        <circle cx="32" cy="30" r="3" />
        <circle cx="9" cy="31" r="3" />
        <path d="m13 10 14-1M30 12l2 15M29 30l-17 1M10 28V13M13 12l16 15" />
      </>
    ),
    RANK: (
      <>
        <path d="M7 32V20M17 32V12M27 32V17M37 32V6" />
        <path d="m6 15 10-7 10 4L38 3" />
      </>
    ),
    TECH: (
      <>
        <path d="M22 4 8 9v11c0 9 6 15 14 19 8-4 14-10 14-19V9L22 4Z" />
        <path d="m15 21 5 5 10-11" />
      </>
    ),
    CONTENT: (
      <>
        <rect x="7" y="5" width="30" height="34" rx="4" />
        <path d="M14 14h16M14 21h16M14 28h10" />
      </>
    ),
    RIVALS: (
      <>
        <circle cx="16" cy="16" r="9" />
        <circle cx="29" cy="27" r="9" />
        <path d="M22 10c7 .3 12 6 12 13M11 25c.8 5 4.7 8.9 9.7 9.8" />
      </>
    ),
    AUTO: (
      <>
        <path d="M22 5a17 17 0 1 1-13 6" />
        <path d="M7 5v8h8M22 14v9l6 4" />
      </>
    ),
    TEAM: (
      <>
        <circle cx="16" cy="15" r="7" />
        <circle cx="32" cy="17" r="5" />
        <path d="M5 38c1-9 5-14 11-14s11 5 12 14M28 27c6 0 9 4 10 11" />
      </>
    ),
    REPORT: (
      <>
        <path d="M7 37V7h30" />
        <path d="m11 29 7-8 6 4L36 11" />
        <circle cx="18" cy="21" r="2" />
        <circle cx="24" cy="25" r="2" />
        <circle cx="36" cy="11" r="2" />
      </>
    ),
    API: (
      <>
        <path d="m15 8-9 14 9 14M29 8l9 14-9 14M25 5l-6 34" />
      </>
    ),
    COST: (
      <>
        <circle cx="22" cy="22" r="17" />
        <path d="M27 15c-1-2-3-3-6-3-4 0-6 2-6 5 0 7 14 3 14 10 0 3-3 5-7 5-3 0-6-1-8-3M22 8v28" />
      </>
    )
  };

  return (
    <span className={className}>
      <svg aria-hidden="true" viewBox="0 0 44 44">
        {pathByCode[code]}
      </svg>
      {children}
    </span>
  );
}

function LandingHeader({
  locale,
  telegramUrl
}: {
  readonly locale: Locale;
  readonly telegramUrl: string;
}) {
  const copy = landingContent[locale];
  const oppositeLocale = locale === "ru" ? "en" : "ru";

  return (
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <a className="landing-brand" href={`/${locale}`} aria-label={copy.brand}>
          <BrandMark />
          <span>
            <strong>{copy.brand}</strong>
            <small>{copy.brandDescriptor}</small>
          </span>
        </a>

        <nav className="landing-desktop-nav" aria-label={copy.navigation.product}>
          <a href="#product">{copy.navigation.product}</a>
          <a href="#capabilities">{copy.navigation.capabilities}</a>
          <a href="#roadmap">{copy.navigation.roadmap}</a>
          <a href="#about">{copy.navigation.about}</a>
        </nav>

        <div className="landing-header-actions">
          <a
            className="landing-language"
            href={`/${oppositeLocale}`}
            hrefLang={oppositeLocale}
            aria-label={copy.navigation.languageLabel}
          >
            {oppositeLocale.toUpperCase()}
          </a>
          <a
            className="landing-button landing-button-small landing-button-dark"
            href={telegramUrl}
            target="_blank"
            rel="noreferrer"
          >
            {copy.navigation.subscribe}
            <ArrowIcon />
          </a>
          <details className="landing-mobile-menu">
            <summary aria-label={copy.navigation.product}>
              <span />
              <span />
            </summary>
            <nav>
              <a href="#product">{copy.navigation.product}</a>
              <a href="#capabilities">{copy.navigation.capabilities}</a>
              <a href="#roadmap">{copy.navigation.roadmap}</a>
              <a href="#about">{copy.navigation.about}</a>
              <a href={`/${oppositeLocale}`}>{oppositeLocale.toUpperCase()}</a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function ProductPreview({ locale }: { readonly locale: Locale }) {
  const preview = landingContent[locale].preview;

  return (
    <div className="landing-preview-wrap">
      <div className="landing-preview-orbit landing-preview-orbit-one" />
      <div className="landing-preview-orbit landing-preview-orbit-two" />
      <div className="landing-preview-badge">
        <span />
        {preview.label}
      </div>
      <div className="landing-product-preview" aria-label={preview.ariaLabel}>
        <aside className="landing-preview-sidebar">
          <BrandMark />
          <div className="landing-preview-nav landing-preview-nav-active">
            <span />
          </div>
          {[1, 2, 3, 4, 5].map((item) => (
            <div className="landing-preview-nav" key={item}>
              <span />
            </div>
          ))}
          <div className="landing-preview-avatar">AK</div>
        </aside>

        <div className="landing-preview-main">
          <header>
            <div>
              <small>{preview.project}</small>
              <strong>{preview.chartTitle}</strong>
            </div>
            <button type="button" tabIndex={-1}>{preview.period}</button>
          </header>
          <div className="landing-preview-body">
            <div className="landing-preview-metrics">
              <article>
                <span>{preview.visibility}</span>
                <strong>{preview.visibilityValue}</strong>
                <small>{locale === "ru" ? "↑ 6,8%" : "↑ 6.8%"}</small>
              </article>
              <article>
                <span>{preview.topKeywords}</span>
                <strong>{preview.topKeywordsValue}</strong>
                <small>↑ 312</small>
              </article>
              <article>
                <span>{preview.tasks}</span>
                <strong>{preview.tasksValue}</strong>
                <small>{locale === "ru" ? "3 выполняются" : "3 running"}</small>
              </article>
            </div>

            <div className="landing-preview-grid">
              <article className="landing-preview-chart">
                <div className="landing-preview-card-heading">
                  <span>{preview.chartTitle}</span>
                  <small>{preview.chartDelta}</small>
                </div>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 620 215"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="seonorita-chart-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#f0523d" stopOpacity=".26" />
                      <stop offset="1" stopColor="#f0523d" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[35, 80, 125, 170].map((y) => (
                    <path className="landing-chart-grid" d={`M0 ${y}H620`} key={y} />
                  ))}
                  <path
                    className="landing-chart-area"
                    d="M0 175C45 171 73 160 105 164c37 5 51-43 89-40 39 4 53 27 94 9 38-17 47-47 90-39 42 8 57-42 101-31 39 10 66-40 141-55v207H0Z"
                  />
                  <path
                    className="landing-chart-line"
                    d="M0 175C45 171 73 160 105 164c37 5 51-43 89-40 39 4 53 27 94 9 38-17 47-47 90-39 42 8 57-42 101-31 39 10 66-40 141-55"
                  />
                  <circle cx="479" cy="83" r="5" />
                </svg>
                <div className="landing-preview-chart-labels">
                  <span>01</span><span>07</span><span>14</span><span>21</span><span>30</span>
                </div>
              </article>

              <article className="landing-preview-tasks">
                <span className="landing-preview-card-title">{preview.taskTitle}</span>
                <div>
                  {preview.taskItems.map(([title, status], index) => (
                    <div className="landing-preview-task" key={title}>
                      <span className={`landing-task-icon landing-task-icon-${index + 1}`}>
                        {index === 0 ? "✓" : index === 1 ? "↗" : "•"}
                      </span>
                      <p><strong>{title}</strong><small>{status}</small></p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>
      <div className="landing-preview-signal">
        <span>↗</span>
        <p><small>{preview.signal}</small><strong>{preview.signalText}</strong></p>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
  align = "left"
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly text?: string;
  readonly align?: "left" | "center";
}) {
  return (
    <div className={`landing-section-heading landing-section-heading-${align}`}>
      <span className="landing-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function JsonLd({ locale }: { readonly locale: Locale }) {
  const content = landingContent[locale];
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/u, "") ??
    "http://localhost:3000";
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: content.brand,
        url: `${siteUrl}/${locale}`,
        sameAs: [developerTelegramUrl]
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: `${siteUrl}/${locale}`,
        name: content.brand,
        description: content.metadata.description,
        inLanguage: locale,
        publisher: { "@id": `${siteUrl}/#organization` }
      },
      {
        "@type": "SoftwareApplication",
        name: content.brand,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "SEO software",
        operatingSystem: "Web",
        description: content.metadata.description,
        url: `${siteUrl}/${locale}`,
        releaseNotes:
          locale === "ru"
            ? "Продукт находится в разработке."
            : "The product is currently in development."
      }
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(graph).replace(/</gu, "\\u003c")
      }}
    />
  );
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params
}: PageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) return {};
  const content = landingContent[rawLocale];

  return {
    title: { absolute: content.metadata.title },
    description: content.metadata.description,
    keywords: [...content.metadata.keywords],
    alternates: {
      canonical: `/${rawLocale}`,
      languages: {
        "ru-RU": "/ru",
        "en-US": "/en",
        "x-default": "/ru"
      }
    },
    openGraph: {
      title: content.metadata.title,
      description: content.metadata.description,
      type: "website",
      url: `/${rawLocale}`,
      siteName: content.brand,
      locale: rawLocale === "ru" ? "ru_RU" : "en_US",
      alternateLocale: rawLocale === "ru" ? ["en_US"] : ["ru_RU"]
    },
    twitter: {
      card: "summary_large_image",
      title: content.metadata.title,
      description: content.metadata.description
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
    }
  };
}

export default async function MarketingPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  const locale = rawLocale;
  const content = landingContent[locale];
  const telegramUrl = resolveTelegramChannelUrl(
    process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL
  );
  const currentYear = new Date().getUTCFullYear();

  return (
    <main className="landing-page">
      <JsonLd locale={locale} />
      <LandingHeader locale={locale} telegramUrl={telegramUrl} />

      <section className="landing-hero" id="product">
        <div className="landing-container">
          <div className="landing-hero-copy">
            <p className="landing-status">
              <span />
              {content.hero.status}
            </p>
            <h1>
              {content.hero.titleBefore}
              <br />
              <em>{content.hero.titleAccent}</em> {content.hero.titleAfter}
            </h1>
            <p className="landing-hero-text">{content.hero.text}</p>
            <div className="landing-hero-actions">
              <a
                className="landing-button landing-button-primary"
                href={telegramUrl}
                target="_blank"
                rel="noreferrer"
              >
                <TelegramIcon />
                {content.hero.primaryCta}
                <ArrowIcon />
              </a>
              <a className="landing-button landing-button-ghost" href="#capabilities">
                {content.hero.secondaryCta}
              </a>
            </div>
            <p className="landing-hero-note">{content.hero.note}</p>
            <div className="landing-audience-pills" aria-label={content.audiences.eyebrow}>
              {content.hero.audience.map((item) => (
                <span key={item}><CheckIcon />{item}</span>
              ))}
            </div>
          </div>
          <ProductPreview locale={locale} />
        </div>
      </section>

      <section className="landing-problem landing-section">
        <div className="landing-container">
          <SectionHeading
            eyebrow={content.problem.eyebrow}
            title={content.problem.title}
            text={content.problem.text}
          />
          <div className="landing-problem-grid">
            {content.problem.cards.map((card) => (
              <article key={card.number}>
                <span>{card.number}</span>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-system landing-section">
        <div className="landing-container">
          <SectionHeading
            eyebrow={content.system.eyebrow}
            title={content.system.title}
            text={content.system.text}
            align="center"
          />
          <div className="landing-system-flow">
            {content.system.flow.map((step, index) => (
              <div className="landing-system-step" key={step.label}>
                <span className="landing-system-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            ))}
          </div>
          <p className="landing-system-caption">{content.system.caption}</p>
        </div>
      </section>

      <section className="landing-capabilities landing-section" id="capabilities">
        <div className="landing-container">
          <SectionHeading
            eyebrow={content.capabilities.eyebrow}
            title={content.capabilities.title}
            text={content.capabilities.text}
          />
          <div className="landing-capabilities-grid">
            {content.capabilities.items.map((feature, index) => (
              <article
                className={`landing-feature landing-feature-${feature.tone} ${
                  index === 0 || index === 7 ? "landing-feature-wide" : ""
                }`}
                key={feature.code}
              >
                <div className="landing-feature-heading">
                  <FeatureGlyph
                    className="landing-feature-icon"
                    code={feature.code}
                  >
                    <small>{feature.code}</small>
                  </FeatureGlyph>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <ul>
                  {feature.highlights.map((highlight) => (
                    <li key={highlight}><CheckIcon />{highlight}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-integrations landing-section">
        <div className="landing-container">
          <div className="landing-integrations-copy">
            <SectionHeading
              eyebrow={content.integrations.eyebrow}
              title={content.integrations.title}
              text={content.integrations.text}
            />
            <div className="landing-byok">
              <span>BYOK</span>
              <div>
                <strong>{content.integrations.byokTitle}</strong>
                <p>{content.integrations.byokText}</p>
              </div>
            </div>
          </div>
          <div className="landing-integration-cloud">
            <span className="landing-integration-label">
              {content.integrations.plannedLabel}
            </span>
            {content.integrations.items.map((integration, index) => (
              <div
                className={`landing-integration-chip landing-integration-chip-${(index % 4) + 1}`}
                key={integration}
              >
                <span>{integration.slice(0, 2).toUpperCase()}</span>
                <strong>{integration}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-audiences landing-section">
        <div className="landing-container">
          <SectionHeading
            eyebrow={content.audiences.eyebrow}
            title={content.audiences.title}
          />
          <div className="landing-audiences-grid">
            {content.audiences.items.map((audience, index) => (
              <article key={audience.label}>
                <div>
                  <span>{audience.label}</span>
                  <small>0{index + 1}</small>
                </div>
                <h3>{audience.title}</h3>
                <p>{audience.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-roadmap landing-section" id="roadmap">
        <div className="landing-container">
          <SectionHeading
            eyebrow={content.roadmap.eyebrow}
            title={content.roadmap.title}
            text={content.roadmap.text}
          />
          <div className="landing-roadmap-list">
            {content.roadmap.items.map((item, index) => (
              <article
                className={`landing-roadmap-item landing-roadmap-item-${item.status}`}
                key={item.stage}
              >
                <div className="landing-roadmap-marker">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="landing-roadmap-stage">
                  <span>{item.stage}</span>
                  {item.status === "current" && <em>{content.roadmap.currentLabel}</em>}
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-principles landing-section">
        <div className="landing-container">
          <SectionHeading
            eyebrow={content.principles.eyebrow}
            title={content.principles.title}
          />
          <div className="landing-principles-grid">
            {content.principles.items.map((principle, index) => (
              <article key={principle.title}>
                <span>0{index + 1}</span>
                <h3>{principle.title}</h3>
                <p>{principle.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-about landing-section" id="about">
        <div className="landing-container landing-about-grid">
          <div>
            <span className="landing-eyebrow">{content.about.eyebrow}</span>
            <h2>{content.about.title}</h2>
          </div>
          <div className="landing-about-copy">
            {content.about.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <blockquote>{content.about.quote}</blockquote>
          </div>
        </div>
      </section>

      <section className="landing-faq landing-section">
        <div className="landing-container landing-faq-grid">
          <SectionHeading
            eyebrow={content.faq.eyebrow}
            title={content.faq.title}
          />
          <div className="landing-faq-list">
            {content.faq.items.map((item, index) => (
              <details key={item.question}>
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {item.question}
                  <i aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-waitlist landing-section" id="waitlist">
        <div className="landing-container">
          <div className="landing-waitlist-card">
            <div className="landing-waitlist-glow" />
            <span className="landing-eyebrow">{content.waitlist.eyebrow}</span>
            <h2>{content.waitlist.title}</h2>
            <p>{content.waitlist.text}</p>
            <a
              className="landing-button landing-button-light"
              href={telegramUrl}
              target="_blank"
              rel="noreferrer"
            >
              <TelegramIcon />
              {content.waitlist.cta}
              <ArrowIcon />
            </a>
            <small>{content.waitlist.privacy}</small>
            <BrandMark />
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-top">
            <a className="landing-brand landing-brand-footer" href={`/${locale}`}>
              <BrandMark />
              <span>
                <strong>{content.brand}</strong>
                <small>{content.footer.tagline}</small>
              </span>
            </a>
            <nav aria-label={content.footer.navigationLabel}>
              <a href="#product">{content.navigation.product}</a>
              <a href="#capabilities">{content.navigation.capabilities}</a>
              <a href="#roadmap">{content.navigation.roadmap}</a>
              <a href="#about">{content.navigation.about}</a>
            </nav>
          </div>
          <div className="landing-footer-bottom">
            <p>© {currentYear} {content.brand}. {content.footer.rights}</p>
            <p>
              {content.footer.developer}{" "}
              <a href={developerTelegramUrl} target="_blank" rel="noreferrer">
                @ker4ik13
              </a>
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}

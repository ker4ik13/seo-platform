import type { ReactNode } from "react";
import type { Locale } from "../lib/locales";
import { supportTelegram } from "../lib/public-documents";

export function PublicDocumentShell({ locale, slug, children }: { locale: Locale; slug: string; children: ReactNode }) {
  const en = locale === "en";
  return <div className="public-document-site" lang={locale}>
    <header className="public-document-header"><a className="public-document-brand" href={`/${locale}`}><img alt="" height={32} width={32} src="/brand/seonorita-mark.svg" /><strong>{en ? "SEOnorita" : "SEOньорита"}</strong></a><nav aria-label={en ? "Main navigation" : "Основная навигация"}><a href={`/${locale}/pricing`}>{en ? "Pricing" : "Тарифы"}</a><a href={`/${locale}/help`}>{en ? "Help" : "Помощь"}</a><a href={supportTelegram} target="_blank" rel="noopener noreferrer">Telegram</a></nav><div className="public-document-header-actions"><a href={`/${en ? "ru" : "en"}/${slug}`} hrefLang={en ? "ru" : "en"}>{en ? "RU" : "EN"}</a><a className="public-document-button" href={`/app/login?locale=${locale}`}>{en ? "Sign in" : "Войти"}</a></div></header>
    {children}
    <footer className="public-document-footer"><span>{en ? "SEOnorita · SEO workspace" : "SEOньорита · рабочее пространство для SEO"}</span><nav aria-label={en ? "Documents" : "Документы"}><a href={`/${locale}/terms`}>{en ? "Terms" : "Условия"}</a><a href={`/${locale}/privacy`}>{en ? "Privacy" : "Конфиденциальность"}</a><a href={`/${locale}/refunds`}>{en ? "Refunds" : "Возвраты"}</a><a href={`/${locale}/cookies`}>Cookies</a><a href={`/${locale}/security`}>{en ? "Security" : "Безопасность"}</a></nav><a href={supportTelegram}>@ker4ik13</a></footer>
  </div>;
}

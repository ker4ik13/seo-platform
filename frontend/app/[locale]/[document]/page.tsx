import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDocumentShell } from "../../../components/public-document-shell";
import { isLocale } from "../../../lib/locales";
import { documentSlugs, isDocumentSlug, legalDocumentVersion, publicDocument, supportTelegram } from "../../../lib/public-documents";
import { legalProfile } from "../../../lib/legal-profile";
import "../documents.css";

type Props = { params: Promise<{ locale: string; document: string }> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, document } = await params;
  if (!isLocale(locale) || !isDocumentSlug(document)) return {};
  const copy = publicDocument(locale, document);
  return { title: `${copy.title} · ${locale === "en" ? "SEOnorita" : "SEOньорита"}`, description: copy.description, alternates: { canonical: `/${locale}/${document}`, languages: { ru: `/ru/${document}`, en: `/en/${document}` } }, robots: { index: !copy.legal || legalProfile().published, follow: true } };
}
export default async function DocumentPage({ params }: Props) {
  const { locale, document } = await params;
  if (!isLocale(locale) || !isDocumentSlug(document)) notFound();
  const copy = publicDocument(locale, document), profile = legalProfile(), en = locale === "en";
  return <PublicDocumentShell locale={locale} slug={document}>
    <main className="public-document-main"><header className="public-document-title"><p>{en ? "SEOnorita · information" : "SEOньорита · информация"}</p><h1>{copy.title}</h1><p>{copy.description}</p><small>{en ? "Version" : "Редакция"}: {legalDocumentVersion}</small></header>
      {copy.legal && !profile.published && <aside className="public-document-draft" role="note"><strong>{en ? "Draft for launch review" : "Проект редакции для запуска"}</strong><p>{en ? "Provider details and the hosting arrangement must be finalized before this version is used for paid sales. No personal name or tax ID has been published." : "До применения этой редакции для платных продаж необходимо заполнить реквизиты исполнителя и подтвердить схему размещения данных. ФИО и ИНН пока не опубликованы."}</p></aside>}
      <div className="public-document-layout"><aside className="public-document-toc"><strong>{en ? "On this page" : "На этой странице"}</strong><nav>{copy.sections.map((section, index) => <a href={`#section-${index + 1}`} key={section.title}>{section.title}</a>)}</nav><a href={supportTelegram}>{en ? "Contact support ↗" : "Написать в поддержку ↗"}</a></aside><article className="public-document-copy">
        {copy.legal && profile.published && <section><h2>{en ? "Provider" : "Исполнитель"}</h2><p>{profile.name}<br />{en ? "Russian NPD taxpayer, tax ID" : "Плательщик НПД в России, ИНН"}: {profile.inn}<br />{profile.address}</p></section>}
        {copy.sections.map((section, index) => <section id={`section-${index + 1}`} key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</section>)}
        <nav className="public-document-related" aria-label={en ? "Related pages" : "Связанные страницы"}>{documentSlugs.filter(slug => slug !== document).map(slug => <a href={`/${locale}/${slug}`} key={slug}>{publicDocument(locale, slug).title} →</a>)}</nav>
      </article></div>
    </main>
  </PublicDocumentShell>;
}

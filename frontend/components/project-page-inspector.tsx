"use client";

import { WorkspaceSidebar } from "./workspace-sidebar";
import { useEffect, useState } from "react";
import { parseProjectPagePanel, type ProjectPageSummary, type ProjectPageStatistics, type ProjectPagePanel, type ProjectPagePanelQuery, type ProjectCrawlIssueSummary } from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { pageIndexabilityLabel } from "../lib/page-presentation";
import { projectPageApiPath } from "../lib/project-pages";
import { Icon, type IconName } from "./icon";
import { CustomSelect } from "./custom-select";
import { PageTechnicalFacts, PageFactList, PageExternalUrl } from "./page-technical-panel";
import { useUiLocale, UiText } from "./ui-locale";
import styles from "./project-page-inspector.module.css";

type Tab = "OVERVIEW" | "SEMANTICS" | "SEO" | "LINKS" | "HISTORY";
const TABS: readonly [Tab, string, IconName][] = [["OVERVIEW", "Обзор", "info"], ["SEMANTICS", "Семантика", "semantic"], ["SEO", "SEO", "indexability"], ["LINKS", "Ссылки", "link"], ["HISTORY", "История", "history"]];

export function ProjectPageInspector({ page, projectId, loading, issues, issuesLoading, issuesError, canManage, canViewKeywords, statistics, dimensionKey, date, onClose, onEdit, onStatus, onRecheck, checking }: Readonly<{
  page: ProjectPageSummary; projectId: string; loading: boolean; issues: readonly ProjectCrawlIssueSummary[]; issuesLoading: boolean; issuesError?: string | undefined;
  onRecheck: () => void; checking: boolean; canManage: boolean; canViewKeywords: boolean; statistics?: ProjectPageStatistics | undefined; dimensionKey: string; date: string; onClose: () => void; onEdit: () => void; onStatus: () => void;
}>) {
  const { locale, t } = useUiLocale();
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [direction, setDirection] = useState<NonNullable<ProjectPagePanelQuery["direction"]>>("INTERNAL");
  const [panel, setPanel] = useState<ProjectPagePanel>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [cursorState, setCursorState] = useState<{ key: string; value: string }>();
  const [compareFirst, setCompareFirst] = useState("");
  const [compareSecond, setCompareSecond] = useState("");
  const panelKey = [projectId, page.id, page.version, tab, direction, dimensionKey, date].join(":");
  const cursor = cursorState?.key === panelKey ? cursorState.value : undefined;
  const setCursor = (value: string | undefined) => setCursorState(value ? { key: panelKey, value } : undefined);
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    if (!["SEMANTICS", "LINKS", "HISTORY"].includes(tab) || tab === "SEMANTICS" && !canViewKeywords) return;
    const controller = new AbortController(); setPending(true); setError(undefined);
    const query = new URLSearchParams({ section: tab, limit: "50" });
    if (tab === "LINKS") query.set("direction", direction);
    if (tab === "SEMANTICS" && dimensionKey) { query.set("dimensionKey", dimensionKey); query.set("date", date); }
    if (cursor) query.set("cursor", cursor);
    void browserApiRequest<unknown>(`${projectPageApiPath(projectId, page.id)}/panel?${query}`, { signal: controller.signal }).then(parseProjectPagePanel).then((next) => {
      if (controller.signal.aborted) return;
      setPanel((previous) => cursor && previous?.pageId === next.pageId && previous.section === next.section ? { ...next,
        ...(next.keywords ? { keywords: [...(previous.keywords ?? []), ...next.keywords] } : {}), ...(next.links ? { links: [...(previous.links ?? []), ...next.links] } : {}), ...(next.history ? { history: [...(previous.history ?? []), ...next.history] } : {}) } : next);
      setLoadedKey(panelKey);
    }).catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof BrowserApiError ? caught.message : "Не удалось загрузить данные страницы."); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [projectId, page.id, page.version, tab, direction, dimensionKey, date, cursor, revision, canViewKeywords, panelKey]);
  const currentPanel = loadedKey === panelKey ? panel : undefined;
  const history = currentPanel?.history ?? [];
  const first = history.find((row) => row.id === compareFirst) ?? history[0], second = history.find((row) => row.id === compareSecond) ?? history[1];
  return <WorkspaceSidebar side="right" aria-label={t("Информация о странице")} className={styles.inspector}>
    <header className={styles.header}><div><small><UiText text="Страница" /></small><h2>{new URL(page.normalizedUrl).pathname}</h2><PageExternalUrl url={page.normalizedUrl} /></div><button className={styles.close} aria-label={t("Закрыть страницу")} onClick={onClose} type="button"><Icon name="close" /></button></header>
    <nav className={styles.tabs} role="tablist" aria-label={t("Разделы страницы")}>{TABS.map(([key, title, icon]) => <button role="tab" aria-selected={tab === key} key={key} onClick={() => { setCursor(undefined); setTab(key); }} type="button"><Icon name={icon} /><UiText text={title} /></button>)}</nav>
    <div className={styles.body} role="tabpanel">
      {loading && <p className={styles.muted} role="status"><UiText text="Загружаем сведения об обходе…" /></p>}
      {(tab === "OVERVIEW" || tab === "SEO") && <PageTechnicalFacts page={page} detailed={tab === "SEO"} />}
      {tab === "OVERVIEW" && <><section className={styles.section}><h3><UiText text="Семантика и позиции" /></h3><div className={styles.stats}><div><small><UiText text="Назначено" /></small><strong>{page.assignedKeywordCount}</strong></div><div><small><UiText text="Измерено" /></small><strong>{statistics?.measuredCount ?? "—"}</strong></div><div><small><UiText text="Средняя позиция" /></small><strong>{statistics?.averagePosition?.toLocaleString(locale, { maximumFractionDigits: 2 }) ?? "—"}</strong></div></div><button className="text-button" onClick={() => setTab("SEMANTICS")} type="button"><UiText text="Связанные запросы" /></button></section>
        <section className={styles.section}><h3><UiText text="Проблемы" /></h3>{issuesLoading ? <p role="status"><UiText text="Загрузка…" /></p> : issuesError ? <p role="alert">{issuesError}</p> : issues.length ? issues.map((issue) => <article className={styles.issue} key={issue.id}><strong>{issue.title}</strong><small>{issue.code} · {new Date(issue.lastSeenAt).toLocaleDateString(locale)}</small><details><summary><UiText text="Доказательство" /></summary><pre>{Object.entries(issue.details).map(([key, value]) => `${key}: ${value}`).join("\n")}</pre></details></article>) : <p className={styles.muted}><UiText text={page.latestCrawl?.technicalDetails?.purpose === "TECHNICAL_AUDIT" ? "Открытых проблем не найдено." : "Полный SEO-анализ не выполнен."} /></p>}</section>
        <section className={styles.section}><h3><UiText text="Основное" /></h3><PageFactList rows={[["В sitemap", page.latestCrawl ? page.latestCrawl.inSitemap ? "Да" : "Нет" : "—"], ["Кластеров", page.assignedClusterCount], ["Приоритет", page.priority], ["Источники", page.sources.map((source) => source.source).join(", ") || "—"]]} />{page.notes && <p>{page.notes}</p>}</section></>}
      {tab === "SEMANTICS" && !canViewKeywords && <p className={styles.muted}><UiText text="Нет доступа к семантике проекта." /></p>}
      {tab === "SEMANTICS" && canViewKeywords && <section className={styles.section}><h3><UiText text="Назначенные запросы" /></h3>{statistics && <PageFactList rows={[["Средняя позиция страницы", statistics.averagePosition?.toLocaleString(locale, { maximumFractionDigits: 2 }) ?? "—"], ["Покрытие замеров", `${statistics.measuredCount} / ${statistics.assignedCount}`], ["Найден другой URL", statistics.differentPageCount], ["Не найдено", statistics.notFoundCount], ["Дата съёма", date]]} />}
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th><UiText text="Запрос / группа" /></th><th><UiText text="Позиция" /></th><th>URL</th></tr></thead><tbody>{currentPanel?.keywords?.map((keyword) => <tr key={keyword.id}><td><a href={`/app/semantics?projectId=${encodeURIComponent(projectId)}&keywordId=${encodeURIComponent(keyword.id)}`}>{keyword.query}</a><small>{keyword.groupPaths.join(" · ")}</small></td><td>{keyword.position ?? (keyword.observedAt ? t("Нет") : "—")}</td><td>{keyword.rankingUrl ? <><PageExternalUrl url={keyword.rankingUrl} />{keyword.matchesTarget === false && <small><UiText text="Другой URL" /></small>}</> : "—"}</td></tr>)}</tbody></table></div>
        {!pending && !error && currentPanel?.keywords?.length === 0 && <p className={styles.muted}><UiText text="Странице не назначены запросы." /></p>}</section>}
      {tab === "LINKS" && <><div className={styles.directions}>{([["INTERNAL", "Исходящие"], ["INCOMING", "Входящие"], ["EXTERNAL", "Внешние"]] as const).map(([key, label]) => <button aria-pressed={direction === key} key={key} onClick={() => { setCursor(undefined); setDirection(key); }} type="button"><UiText text={label} /></button>)}</div><p className={styles.muted}><UiText text="По данным выбранного обхода." /></p>
        <section className={styles.section}><h3><UiText text="URL и перенаправления" /></h3><PageFactList rows={[["Canonical", <PageExternalUrl key="canonical" url={page.latestCrawl?.canonicalUrl} />], ["Цепочка редиректа", page.latestCrawl?.redirectChain.map((url) => <PageExternalUrl key={url} url={url} />) ?? "—"]]} /></section>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>URL</th><th><UiText text="Анкор / rel" /></th></tr></thead><tbody>{currentPanel?.links?.map((link, index) => <tr key={`${link.url}:${index}`}><td><PageExternalUrl url={link.url} /></td><td>{link.anchor || "—"}<small>{link.rel.join(", ")}</small></td></tr>)}</tbody></table></div>{!pending && !error && currentPanel?.links?.length === 0 && <p className={styles.muted}><UiText text="В этом обходе ссылки не обнаружены." /></p>}</>}
      {tab === "HISTORY" && <section className={styles.section}><h3><UiText text="Сравнение снимков" /></h3>{history.length > 1 && <><div className={styles.comparison}><CustomSelect aria-label={t("Первый снимок")} selectedLabel={first && snapshotLabel(first.crawledAt, locale)} popoverMinWidth={260} value={first?.id ?? ""} onChange={(event) => setCompareFirst(event.target.value)}>{history.map((row) => <option key={row.id} value={row.id}>{new Date(row.crawledAt).toLocaleString(locale)}</option>)}</CustomSelect><CustomSelect aria-label={t("Второй снимок")} selectedLabel={second && snapshotLabel(second.crawledAt, locale)} popoverMinWidth={260} value={second?.id ?? ""} onChange={(event) => setCompareSecond(event.target.value)}>{history.map((row) => <option key={row.id} value={row.id}>{new Date(row.crawledAt).toLocaleString(locale)}</option>)}</CustomSelect></div><div className={styles.tableWrap}><table className={`${styles.table} ${styles.comparisonTable}`}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "36%" }} /><col style={{ width: "36%" }} /></colgroup><thead><tr><th><UiText text="Поле" /></th><th><UiText text="Первый" /></th><th><UiText text="Второй" /></th></tr></thead><tbody>{(["statusCode", "indexability", "title", "canonicalUrl", "robots"] as const).map((field) => <tr key={field}><td>{({ statusCode: "HTTP", indexability: "Индексация", title: "Title", canonicalUrl: "Canonical", robots: "Robots" })[field]}</td><td>{field === "indexability" && first ? <UiText text={pageIndexabilityLabel(first.indexability)} /> : first?.[field] || "—"}</td><td>{field === "indexability" && second ? <UiText text={pageIndexabilityLabel(second.indexability)} /> : second?.[field] || "—"}</td></tr>)}</tbody></table></div></>}
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th><UiText text="Дата" /></th><th>HTTP</th><th><UiText text="Изменения" /></th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td>{new Date(row.crawledAt).toLocaleString(locale)}</td><td>{row.statusCode || "—"}</td><td>{row.changedFields.join(", ") || "—"}</td></tr>)}</tbody></table></div>{!pending && !error && history.length === 0 && <p className={styles.muted}><UiText text="История обходов пока пуста." /></p>}</section>}
      {pending && <p className={styles.muted} role="status"><UiText text="Загрузка…" /></p>}
      {error && <div role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setRevision((value) => value + 1)} type="button"><UiText text="Повторить" /></button></div>}
      {currentPanel?.nextCursor && <button className="secondary-button" disabled={pending} onClick={() => setCursor(currentPanel.nextCursor)} type="button"><UiText text="Показать ещё" /></button>}
    </div>
    <footer className={styles.footer}><button className={`secondary-button ${styles.recheck}`} disabled={!canManage || checking} onClick={onRecheck} type="button"><Icon name="refresh" /><UiText text={checking ? "Проверяем…" : "Перепроверить"} /></button>{canManage && <><button className="secondary-button" onClick={onEdit} type="button"><UiText text="Изменить" /></button><button className="secondary-button" onClick={onStatus} type="button"><UiText text={page.lifecycleStatus === "ACTIVE" ? "В архив" : "Восстановить"} /></button></>}</footer>
  </WorkspaceSidebar>;
}

function snapshotLabel(value: string, locale: string) {
  const date = new Date(value);
  return <span className={styles.snapshotLabel}><span>{date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "2-digit" })}</span><span>{date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></span>;
}

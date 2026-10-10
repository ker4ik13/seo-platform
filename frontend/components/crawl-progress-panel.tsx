"use client";
import { useEffect, useState } from "react";
import type { CrawlOperationResultPage, TechnicalCrawlSummary } from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { projectPagesReturnTo } from "../lib/project-pages";
import { mergeOperationResultRows, operationResultApiPath, operationResultHref } from "../lib/operation-result-routes";
import { OperationStopConfirmation } from "./operation-stop-confirmation";
import { CrawlResultTable } from "./crawl-result-table";
import { UiText, useUiLocale } from "./ui-locale";
import { Icon } from "./icon";
import styles from "./http-status-check-tool.module.css";

const ACTIVE = new Set(["QUEUED", "RUNNING", "CANCEL_REQUESTED"]);
export function CrawlProgressPanel({ initial, projectId, onNew, canStop }: Readonly<{ initial: TechnicalCrawlSummary; projectId: string; onNew: () => void; canStop: boolean }>) {
  const { locale } = useUiLocale();
  const [result, setResult] = useState<CrawlOperationResultPage>();
  const [error, setError] = useState<string>();
  const [stopOpen, setStopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const crawl = result?.crawl ?? initial;
  const active = ACTIVE.has(crawl.status);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const next = await browserApiRequest<CrawlOperationResultPage>(operationResultApiPath(projectId, "crawl", initial.id, { limit: 50 }), { signal: controller.signal });
        if (!controller.signal.aborted) { setResult((old) => ({ ...next, crawl: old && old.crawl.version > next.crawl.version ? old.crawl : next.crawl, rows: old ? mergeOperationResultRows(old.rows, next.rows) : next.rows, page: old && old.rows.length > next.rows.length ? old.page : next.page })); setError(undefined); }
      } catch (caught) {
        if (!controller.signal.aborted) { if (caught instanceof BrowserApiError && [401, 403, 404].includes(caught.status)) setResult(undefined); setError("Не удалось обновить результат обхода."); }
      } finally { inFlight = false; }
    };
    void poll();
    const timer = active ? window.setInterval(() => void poll(), 5_000) : undefined;
    const visible = () => { if (active) void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); if (timer) window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [projectId, initial.id, active, refresh]);
  async function stop() {
    if (stopping) return; setStopping(true); setError(undefined);
    try {
      const latest = await browserApiRequest<TechnicalCrawlSummary>(`/app/api/projects/${encodeURIComponent(projectId)}/crawls/${initial.id}`);
      if (ACTIVE.has(latest.status)) await browserApiRequest<TechnicalCrawlSummary>(`/app/api/projects/${encodeURIComponent(projectId)}/crawls/${initial.id}/cancel`, { method: "POST", body: {}, ifMatch: latest.version });
      setStopOpen(false); setRefresh((value) => value + 1);
    } catch (caught) { setError(caught instanceof BrowserApiError ? caught.message : "Не удалось остановить обход."); }
    finally { setStopping(false); }
  }
  async function more() {
    if (!result?.page.nextCursor || loadingMore) return;
    const cursor = result.page.nextCursor; setLoadingMore(true);
    try {
      const next = await browserApiRequest<CrawlOperationResultPage>(operationResultApiPath(projectId, "crawl", initial.id, { limit: 50, cursor }));
      setResult((old) => old ? { ...next, rows: mergeOperationResultRows(old.rows, next.rows) } : next);
    } catch { setError("Не удалось загрузить следующие результаты."); }
    finally { setLoadingMore(false); }
  }
  const status = crawl.backoffUntil && active ? "Сайт ограничил обход" : ({ QUEUED: "Обход в очереди", RUNNING: "Обход выполняется", CANCEL_REQUESTED: "Останавливаем обход", CANCELLED: "Обход остановлен", PARTIALLY_COMPLETED: "Обход завершён частично", COMPLETED: "Обход завершён", FAILED: "Обход не завершён" })[crawl.status];
  return <div className={styles.progressWorkspace}><section className={styles.panel}><header className={styles.progressHeader}><h2><UiText text={status} /></h2><a className="text-button" href={operationResultHref("crawl", crawl.id)}><UiText text="Операция" /></a></header>
    {crawl.backoffUntil && active && <div className={styles.backoff} role="status"><UiText text="Следующая попытка" />: {new Date(crawl.backoffUntil).toLocaleString(locale)} · <UiText text={crawl.backoffCode === "HOST_RATE_LIMIT" ? "сайт ограничил скорость" : "сайт временно не отвечает"} /></div>}
    <div className={styles.progressNumbers}>{([["Обработано", crawl.processedUrls], ["Найдено", crawl.discoveredUrls], [active ? "В очереди" : "Не проверено", Math.max(0, crawl.discoveredUrls - crawl.processedUrls)], ["Ошибки", crawl.failedUrls], ["Запрет robots", crawl.blockedUrls ?? 0]] as const).map(([label, value]) => <div key={label}><small><UiText text={label} /></small><strong>{value.toLocaleString(locale)}</strong></div>)}</div>
    <div className={styles.progressTrack} role="progressbar" aria-label="Обработанные URL" aria-valuemin={0} aria-valuemax={Math.max(crawl.discoveredUrls, 1)} aria-valuenow={crawl.processedUrls}><span style={{ width: `${Math.min(100, crawl.processedUrls / Math.max(crawl.discoveredUrls, 1) * 100)}%` }} /></div>
    {crawl.failureCode && <p role="alert"><UiText text={crawl.failureCode === "MAX_RUNTIME_EXCEEDED" ? "Достигнут лимит времени." : crawl.failureCode === "ROBOTS_UNAVAILABLE" ? "Не удалось получить robots.txt." : crawl.failureCode === "SITEMAP_UNAVAILABLE" ? "Не удалось прочитать sitemap." : crawl.failureCode === "CRAWL_FINALIZATION_FAILED" ? "Страницы обработаны, но не удалось завершить анализ результатов." : "Обход завершён с ошибкой. Сохранённые результаты доступны."} /></p>}
    <div className={styles.progressActions}>{active ? <button className="secondary-button" disabled={!canStop || crawl.status === "CANCEL_REQUESTED"} onClick={() => setStopOpen(true)} type="button"><Icon name="stop" /><UiText text="Остановить" /></button> : <button className="secondary-button" onClick={onNew} type="button"><UiText text="Новый обход" /></button>}<a className="primary-button" href={projectPagesReturnTo(projectId)}><Icon name="pages" /><UiText text="Карта страниц" /></a></div>
  </section>{error && <div className={styles.error} role="alert">{error}<button className="text-button" onClick={() => setRefresh((value) => value + 1)} type="button"><UiText text="Повторить" /></button></div>}
  {result && <><CrawlResultTable result={result} compact />{result.page.nextCursor && <button className="secondary-button" disabled={loadingMore} onClick={() => void more()} type="button"><UiText text={loadingMore ? "Загрузка…" : "Показать ещё"} /></button>}</>}
  {stopOpen && <OperationStopConfirmation busy={stopping} title="Обход сайта" description={`${Math.max(0, crawl.discoveredUrls - crawl.processedUrls)} URL останутся непроверенными.`} onCancel={() => setStopOpen(false)} onConfirm={() => void stop()} />}</div>;
}

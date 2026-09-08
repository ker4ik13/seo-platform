"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type RankHistoryItem, type SemanticKeywordCompetitorSnapshot } from "@seo-platform/contracts";
import { browserApiCollectionRequest } from "../lib/browser-api";
import { SemanticCompetitorSnapshots } from "./semantic-competitor-snapshots";
import { SemanticModal } from "./semantic-modal";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticKeywordSerpHistory({ projectId, keywordId, keywordText, createdAt, projectDomain, dimensionKey, onClose }: {
  projectId: string; keywordId: string; keywordText: string; createdAt: string; projectDomain: string; dimensionKey?: string | undefined; onClose: () => void;
}) {
  const { t } = useUiLocale();
  const [items, setItems] = useState<readonly RankHistoryItem[]>([]), [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string>(), [error, setError] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined), busy = useRef(false);
  const [before] = useState(() => new Date(Date.now() + 1_000).toISOString());
  const load = useCallback(async (next?: string) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(undefined);
    const controller = new AbortController(); request.current = controller;
    try {
      const query = new URLSearchParams({ keywordId, observedFrom: new Date(createdAt).toISOString(), observedBefore: before, limit: "5", mode: "SERP", ...(dimensionKey ? { dimensionKey } : {}), ...(next ? { cursor: next } : {}) });
      const page = await browserApiCollectionRequest<RankHistoryItem>(`/app/api/projects/${projectId}/rank-history?${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (page.data.some(row => !row.searchEngine || !row.serpResults?.length)) throw new Error("Invalid SERP history");
      setItems(current => next ? [...current, ...page.data.filter(row => !current.some(value => value.snapshotId === row.snapshotId))] : page.data);
      setCursor(page.page.nextCursor);
    } catch { if (!controller.signal.aborted) setError("Не удалось загрузить историю выдачи. Повторите загрузку."); }
    finally { if (request.current === controller) { busy.current = false; if (!controller.signal.aborted) setLoading(false); } }
  }, [before, createdAt, dimensionKey, keywordId, projectId]);
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = undefined; busy.current = false; }; }, [load]);
  const snapshots: readonly SemanticKeywordCompetitorSnapshot[] = items.flatMap(item => item.searchEngine && item.provider !== "MANUAL_IMPORT" ? [{
    snapshotId: item.snapshotId, trackingContextId: item.trackingContextId, contextName: item.contextName ?? "", searchEngine: item.searchEngine,
    ...(item.searchSource ? { searchSource: item.searchSource } : {}), ...(item.dimensionKey ? { dimensionKey: item.dimensionKey } : {}),
    ...(item.regionCode ? { regionCode: item.regionCode } : {}), ...(item.regionLabel ? { regionLabel: item.regionLabel } : {}),
    ...(item.device ? { device: item.device } : {}), provider: item.provider, observedAt: item.observedAt,
    results: (item.serpResults ?? []).map(row => ({ position: row.position, url: row.rankingUrl, ...(row.faviconUrl ? { faviconUrl: row.faviconUrl } : {}), ...(row.title ? { title: row.title } : {}), ...(row.snippet ? { snippet: row.snippet } : {}) }))
  }] : []);
  return <SemanticModal title={t("История выдачи · {0}", [keywordText])} description={t("Все сохранённые снимки выдачи выбранного среза. В каждом — исходные позиции, URL, заголовки и описания.")} onClose={onClose} size="large">
    <div className="semantic-serp-history-list"><SemanticCompetitorSnapshots projectDomain={projectDomain} snapshots={snapshots} showEmpty={!loading && !error} heading={t("Сохранённая выдача")} />
      {error && <div className="inline-alert danger" role="alert"><UiText text={error} /></div>}
      {loading ? <p role="status"><UiText text="Загружаем выдачу…" /></p> : cursor || error ? <button className="secondary-button" type="button" onClick={() => void load(cursor)}><UiText text={error ? "Повторить" : "Загрузить предыдущие съёмы"} /></button> : null}
    </div>
  </SemanticModal>;
}

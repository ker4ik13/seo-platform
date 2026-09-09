"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type RankHistoryItem, type SemanticKeywordCompetitorSnapshot } from "@seo-platform/contracts";
import { browserApiCollectionRequest } from "../lib/browser-api";
import { serpMovementKey, serpMovements } from "../lib/serp-movement";
import { SemanticCompetitorSnapshots } from "./semantic-competitor-snapshots";
import { SemanticModal } from "./semantic-modal";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticKeywordSerpHistory({ projectId, keywordId, keywordText, createdAt, currentUserId, projectDomain, dimensionKey, onClose }: {
  projectId: string; keywordId: string; keywordText: string; createdAt: string; currentUserId: string; projectDomain: string; dimensionKey?: string | undefined; onClose: () => void;
}) {
  const { t } = useUiLocale();
  const [items, setItems] = useState<readonly RankHistoryItem[]>([]), [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string>(), [error, setError] = useState<string>();
  const [showMovement, setShowMovement] = useState(false);
  const request = useRef<AbortController | undefined>(undefined), busy = useRef(false);
  const [before] = useState(() => new Date(Date.now() + 1_000).toISOString());
  useEffect(() => {
    setShowMovement(readMovementPreference(currentUserId));
  }, [currentUserId]);
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
  const snapshots = useMemo<readonly SemanticKeywordCompetitorSnapshot[]>(() =>
    items.flatMap(item => item.searchEngine && item.provider !== "MANUAL_IMPORT" ? [{
      snapshotId: item.snapshotId, trackingContextId: item.trackingContextId, contextName: item.contextName ?? "", searchEngine: item.searchEngine,
      ...(item.searchSource ? { searchSource: item.searchSource } : {}), ...(item.dimensionKey ? { dimensionKey: item.dimensionKey } : {}),
      ...(item.regionCode ? { regionCode: item.regionCode } : {}), ...(item.regionLabel ? { regionLabel: item.regionLabel } : {}),
      ...(item.device ? { device: item.device } : {}), provider: item.provider, observedAt: item.observedAt,
      results: (item.serpResults ?? []).map(row => ({ position: row.position, url: row.rankingUrl, ...(row.faviconUrl ? { faviconUrl: row.faviconUrl } : {}), ...(row.title ? { title: row.title } : {}), ...(row.snippet ? { snippet: row.snippet } : {}) }))
    }] : []).sort((left, right) => right.observedAt.localeCompare(left.observedAt)),
    [items]
  );
  const movements = useMemo(() => serpMovements(snapshots), [snapshots]);
  const canShowMovement = snapshots.length > 1;
  const movementForResult = showMovement && canShowMovement
    ? (snapshotId: string, resultUrl: string) => movements.get(serpMovementKey(snapshotId, resultUrl))
    : undefined;
  return <SemanticModal
    bodyLayout="edge"
    description={t("Все сохранённые снимки выдачи выбранного среза. В каждом — исходные позиции, URL, заголовки и описания.")}
    headerActions={(
      <label className="semantic-serp-movement-toggle" title={canShowMovement ? undefined : t("Для сравнения нужны минимум два съёма")}>
        <input
          checked={showMovement}
          disabled={!canShowMovement}
          onChange={(event) => {
            setShowMovement(event.target.checked);
            writeMovementPreference(currentUserId, event.target.checked);
          }}
          type="checkbox"
        />
        <UiText text="Показать движение" />
      </label>
    )}
    onClose={onClose}
    size="large"
    title={t("История выдачи · {0}", [keywordText])}
  >
    <div className="semantic-serp-history-list"><SemanticCompetitorSnapshots projectDomain={projectDomain} snapshots={snapshots} showEmpty={!loading && !error} heading={t("Сохранённая выдача")} {...(movementForResult ? { movementForResult } : {})} />
      {error && <div className="inline-alert danger" role="alert"><UiText text={error} /></div>}
      {loading ? <p role="status"><UiText text="Загружаем выдачу…" /></p> : cursor || error ? <button className="secondary-button" type="button" onClick={() => void load(cursor)}><UiText text={error ? "Повторить" : "Загрузить предыдущие съёмы"} /></button> : null}
    </div>
  </SemanticModal>;
}

function movementPreferenceKey(currentUserId: string): string {
  return `seonorita:serp-history-movement:v1:${currentUserId}`;
}

function readMovementPreference(currentUserId: string): boolean {
  try {
    return localStorage.getItem(movementPreferenceKey(currentUserId)) === "true";
  } catch {
    return false;
  }
}

function writeMovementPreference(currentUserId: string, value: boolean): void {
  try {
    localStorage.setItem(movementPreferenceKey(currentUserId), String(value));
  } catch {
    // Browser storage is optional; the in-memory choice still works.
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import { parseProjectPageStatisticsCollection, type ProjectPageStatistics } from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "./browser-api";

type StatisticsState = Readonly<{ key: string; values: Readonly<Record<string, ProjectPageStatistics>>; loading: boolean; date?: string; error?: string }>;

export function usePageStatistics(projectId: string, pageIds: readonly string[], dimensionKey: string, date: string, revision: number, enabled: boolean) {
  const key = `${projectId}:${dimensionKey}:${date}:${revision}`;
  const ids = [...new Set(pageIds)].slice(0, 100).sort().join(",");
  const [state, setState] = useState<StatisticsState>({ key: "", values: {}, loading: false });
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!enabled || !dimensionKey) { setState({ key, values: {}, loading: false }); return; }
    if (date !== "latest" && !/^\d{4}-\d{2}-\d{2}$/u.test(date)) { setState({ key, values: {}, loading: false, error: "Выберите дату замера." }); return; }
    const cached = stateRef.current.key === key ? stateRef.current : undefined;
    const missing = ids ? ids.split(",").filter((id) => !cached?.values[id]) : [];
    if (missing.length === 0) {
      setState({ key, values: cached?.values ?? {}, loading: false, ...(cached?.date ? { date: cached.date } : {}) });
      return;
    }
    const controller = new AbortController();
    setState({ key, values: cached?.values ?? {}, loading: true, ...(cached?.date ? { date: cached.date } : {}) });
    const query = new URLSearchParams({ pageIds: missing.join(","), dimensionKey, date });
    void browserApiRequest<unknown>(`/app/api/projects/${encodeURIComponent(projectId)}/pages/rank-statistics?${query}`, { signal: controller.signal }).then(parseProjectPageStatisticsCollection).then((result) => {
      if (controller.signal.aborted) return;
      if (result.dimensionKey !== dimensionKey || date !== "latest" && result.date !== date) throw new TypeError("Page statistics scope mismatch");
      setState((old) => ({ key, values: { ...(old.key === key && old.date === result.date ? old.values : {}), ...Object.fromEntries(result.pages.map((page) => [page.pageId, page])) }, loading: false, date: result.date }));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState((old) => ({ key, values: old.key === key && !(error instanceof BrowserApiError && [401, 403, 404].includes(error.status)) ? old.values : {}, loading: false, error: "Не удалось обновить статистику позиций.", ...(old.key === key && old.date ? { date: old.date } : {}) }));
    });
    return () => controller.abort();
  }, [projectId, key, ids, dimensionKey, date, enabled, state.date]);
  return state.key === key ? state : { key, values: {} as Readonly<Record<string, ProjectPageStatistics>>, loading: enabled && Boolean(dimensionKey), date: undefined, error: undefined };
}

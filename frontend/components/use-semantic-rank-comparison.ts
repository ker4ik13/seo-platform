"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseSemanticRankComparisonItems,
  parseSemanticRankDimensionCatalog,
  type SemanticRankComparisonItem,
  type SemanticRankDimension
} from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import {
  mergeRankComparisonItems,
  unresolvedRankComparisonKeywordIds
} from "../lib/rank-comparison-cache";

const emptyComparisonItems: ReadonlyMap<string, SemanticRankComparisonItem> = new Map();

type CatalogState = Readonly<{
  projectId: string;
  dimensions: readonly SemanticRankDimension[];
  loading: boolean;
  error?: string;
}>;

type ComparisonState = Readonly<{
  projectId: string;
  scopeKey: string;
  items: ReadonlyMap<string, SemanticRankComparisonItem>;
  loading: boolean;
  error?: string;
}>;

export function useSemanticRankComparison(
  projectId: string,
  keywordSignature: string,
  dimensionSignature: string,
  refreshKey: string,
  catalogRefreshKey: string
) {
  const [catalog, setCatalog] = useState<CatalogState>({
    projectId,
    dimensions: [],
    loading: true
  });
  const [comparison, setComparison] = useState<ComparisonState>({
    projectId,
    scopeKey: "",
    items: emptyComparisonItems,
    loading: false
  });
  const [revision, setRevision] = useState(0);
  const comparisonCache = useRef<Readonly<{
    contextKey: string;
    items: ReadonlyMap<string, SemanticRankComparisonItem>;
    resolvedKeys: ReadonlySet<string>;
  }>>({
    contextKey: "",
    items: emptyComparisonItems,
    resolvedKeys: new Set()
  });
  const dimensions = catalog.projectId === projectId ? catalog.dimensions : [];
  const effectiveDimensionSignature = dimensionSignature === "ALL"
    ? JSON.stringify(dimensions.map(dimension => dimension.key))
    : dimensionSignature;
  const comparisonRequestKey = JSON.stringify([
    projectId,
    keywordSignature,
    effectiveDimensionSignature,
    refreshKey,
    revision
  ]);
  const comparisonScopeKey = JSON.stringify([
    projectId,
    effectiveDimensionSignature
  ]);
  const comparisonDataContextKey = JSON.stringify([
    comparisonScopeKey,
    refreshKey,
    revision
  ]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(current => ({
      projectId,
      dimensions: current.projectId === projectId ? current.dimensions : [],
      loading: true
    }));
    void browserApiRequest<unknown>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keyword-ranks/dimensions`,
      { signal: controller.signal }
    )
      .then(value => {
        const result = parseSemanticRankDimensionCatalog(value);
        if (!controller.signal.aborted) {
          setCatalog({
            projectId,
            dimensions: result.dimensions,
            loading: false,
            ...(result.truncated
              ? { error: "Список срезов очень большой. Часть параметров доступна в истории профилей." }
              : {})
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCatalog(current => ({
            projectId,
            dimensions: current.projectId === projectId ? current.dimensions : [],
            loading: false,
            error: "Не удалось загрузить города и устройства. Повторите загрузку."
          }));
        }
      });
    return () => controller.abort();
  }, [projectId, catalogRefreshKey, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const keywordIds = JSON.parse(keywordSignature) as string[];
    const dimensionKeys = JSON.parse(effectiveDimensionSignature) as string[];
    if (!keywordIds.length || !dimensionKeys.length) {
      setComparison({
        projectId,
        scopeKey: comparisonScopeKey,
        items: emptyComparisonItems,
        loading: false
      });
      return () => controller.abort();
    }
    const reusable = comparisonCache.current.contextKey ===
      comparisonDataContextKey;
    const cachedItems = reusable
      ? comparisonCache.current.items
      : emptyComparisonItems;
    const resolvedKeys = new Set(
      reusable ? comparisonCache.current.resolvedKeys : []
    );
    const unresolvedKeywordIds = unresolvedRankComparisonKeywordIds(
      keywordIds,
      dimensionKeys,
      resolvedKeys
    );
    if (unresolvedKeywordIds.length === 0) {
      setComparison({
        projectId,
        scopeKey: comparisonScopeKey,
        items: cachedItems,
        loading: false
      });
      return () => controller.abort();
    }
    setComparison(current => ({
      projectId,
      scopeKey: comparisonScopeKey,
      // Keep already resolved cells while a different virtual viewport or a
      // fresh server revision is loading. Rows may unmount during scrolling,
      // but their values must not be replaced by an ellipsis when they return.
      items: current.projectId === projectId && current.scopeKey === comparisonScopeKey
        ? current.items
        : emptyComparisonItems,
      loading: true
    }));
    void (async () => {
        const next = new Map<string, SemanticRankComparisonItem>();
        // Bound both axes. The table supplies all rows from pages already
        // received from the server, so values are warm before they scroll
        // into the virtual viewport.
        for (let offset = 0; offset < dimensionKeys.length; offset += 24) {
          const selectedDimensions = dimensionKeys.slice(offset, offset + 24);
          const pageSize = Math.min(
            1_000,
            Math.floor(2_000 / selectedDimensions.length)
          );
          for (let start = 0; start < unresolvedKeywordIds.length; start += pageSize) {
            const scope = {
              keywordIds: unresolvedKeywordIds.slice(start, start + pageSize),
              dimensionKeys: selectedDimensions
            };
            const payload = await loadRankComparison(
              `/app/api/projects/${encodeURIComponent(projectId)}/keyword-ranks/comparison`,
              scope,
              controller.signal
            );
            for (const item of parseSemanticRankComparisonItems(payload, scope)) {
              next.set(`${item.keywordId}:${item.dimensionKey}`, item);
            }
            for (const keywordId of scope.keywordIds) {
              for (const dimensionKey of scope.dimensionKeys) {
                resolvedKeys.add(`${keywordId}:${dimensionKey}`);
              }
            }
            if (!controller.signal.aborted) {
              const items = mergeRankComparisonItems(cachedItems, next);
              comparisonCache.current = {
                contextKey: comparisonDataContextKey,
                items,
                resolvedKeys
              };
              setComparison({
                projectId,
                scopeKey: comparisonScopeKey,
                items,
                loading: true
              });
            }
          }
        }
        if (!controller.signal.aborted) {
          const items = mergeRankComparisonItems(cachedItems, next);
          comparisonCache.current = {
            contextKey: comparisonDataContextKey,
            items,
            resolvedKeys
          };
          setComparison({
            projectId,
            scopeKey: comparisonScopeKey,
            items,
            loading: false
          });
        }
      })().catch(() => {
        if (!controller.signal.aborted) {
          setComparison(current => ({
            projectId,
            scopeKey: comparisonScopeKey,
            items: current.projectId === projectId && current.scopeKey === comparisonScopeKey
              ? current.items
              : emptyComparisonItems,
            loading: false,
            error: "Не удалось загрузить сравнение позиций. Повторите загрузку."
          }));
        }
      });
    return () => controller.abort();
  }, [comparisonDataContextKey, comparisonRequestKey, comparisonScopeKey, effectiveDimensionSignature, keywordSignature, projectId, refreshKey, revision]);

  const currentComparison = comparison.projectId === projectId &&
    comparison.scopeKey === comparisonScopeKey
    ? comparison
    : { projectId, scopeKey: comparisonScopeKey, items: emptyComparisonItems, loading: true };
  return {
    dimensions,
    items: currentComparison.items,
    loading: catalog.loading || currentComparison.loading,
    error: currentComparison.error,
    catalogError: catalog.projectId === projectId ? catalog.error : undefined,
    refresh: () => setRevision(value => value + 1)
  };
}

async function loadRankComparison(
  path: string,
  scope: Readonly<{
    keywordIds: readonly string[];
    dimensionKeys: readonly string[];
  }>,
  signal: AbortSignal
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await browserApiRequest<unknown>(path, {
        method: "POST",
        body: scope,
        signal
      });
    } catch (error) {
      if (
        signal.aborted ||
        !(error instanceof BrowserApiError) ||
        !error.retryable ||
        attempt >= 2
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

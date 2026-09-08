"use client";

import { useEffect, useState } from "react";
import {
  parseSemanticRankComparisonItems,
  parseSemanticRankDimensionCatalog,
  type SemanticRankComparisonItem,
  type SemanticRankDimension
} from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";

const emptyComparisonItems: ReadonlyMap<string, SemanticRankComparisonItem> = new Map();

type CatalogState = Readonly<{
  projectId: string;
  dimensions: readonly SemanticRankDimension[];
  error?: string;
}>;

type ComparisonState = Readonly<{
  projectId: string;
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
    dimensions: []
  });
  const [comparison, setComparison] = useState<ComparisonState>({
    projectId,
    items: emptyComparisonItems,
    loading: false
  });
  const [revision, setRevision] = useState(0);
  const dimensions = catalog.projectId === projectId ? catalog.dimensions : [];
  const effectiveDimensionSignature = dimensionSignature === "ALL"
    ? JSON.stringify(dimensions.map(dimension => dimension.key))
    : dimensionSignature;

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(current => ({
      projectId,
      dimensions: current.projectId === projectId ? current.dimensions : []
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
        items: emptyComparisonItems,
        loading: false
      });
      return () => controller.abort();
    }
    setComparison(current => ({
      projectId,
      items: current.projectId === projectId ? current.items : emptyComparisonItems,
      loading: true
    }));
    const timer = setTimeout(() => {
      void (async () => {
        const next = new Map<string, SemanticRankComparisonItem>();
        // Bound both axes. The table supplies only its virtual viewport rows.
        for (let offset = 0; offset < dimensionKeys.length; offset += 24) {
          const selectedDimensions = dimensionKeys.slice(offset, offset + 24);
          const pageSize = Math.min(
            1_000,
            Math.floor(2_000 / selectedDimensions.length)
          );
          for (let start = 0; start < keywordIds.length; start += pageSize) {
            const scope = {
              keywordIds: keywordIds.slice(start, start + pageSize),
              dimensionKeys: selectedDimensions
            };
            const payload = await browserApiRequest<unknown>(
              `/app/api/projects/${encodeURIComponent(projectId)}/keyword-ranks/comparison`,
              {
                method: "POST",
                body: scope,
                signal: controller.signal
              }
            );
            for (const item of parseSemanticRankComparisonItems(payload, scope)) {
              next.set(`${item.keywordId}:${item.dimensionKey}`, item);
            }
          }
        }
        if (!controller.signal.aborted) {
          setComparison({ projectId, items: next, loading: false });
        }
      })()
        .catch(() => {
          if (!controller.signal.aborted) {
            setComparison(current => ({
              projectId,
              items: current.projectId === projectId
                ? current.items
                : emptyComparisonItems,
              loading: false,
              error: "Не удалось загрузить сравнение позиций. Повторите загрузку."
            }));
          }
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, keywordSignature, effectiveDimensionSignature, refreshKey, revision]);

  const currentComparison = comparison.projectId === projectId
    ? comparison
    : { projectId, items: emptyComparisonItems, loading: false };
  return {
    dimensions,
    items: currentComparison.items,
    loading: currentComparison.loading,
    error: currentComparison.error,
    catalogError: catalog.projectId === projectId ? catalog.error : undefined,
    refresh: () => setRevision(value => value + 1)
  };
}

"use client";

import { useEffect, useState } from "react";
import type {
  SemanticKeywordInsights,
  FrequencySeasonalityPointSummary,
} from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { SemanticModal } from "./semantic-modal";
import { SemanticSeasonalityCharts } from "./semantic-seasonality-chart";
import { UiText } from "./ui-locale";

export function KeywordSeasonalityModal({
  projectId,
  keywordId,
  keywordText,
  onClose,
}: Readonly<{
  projectId: string;
  keywordId: string;
  keywordText: string;
  onClose: () => void;
}>) {
  const [points, setPoints] =
    useState<readonly FrequencySeasonalityPointSummary[]>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPoints(undefined);
    setError(undefined);
    void browserApiRequest<SemanticKeywordInsights>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/insights`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setPoints(value.seasonality ?? []);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof BrowserApiError && failure.status === 403
              ? "Недостаточно прав для просмотра сезонности."
              : "Не удалось загрузить сезонность.",
          );
      });
    return () => controller.abort();
  }, [keywordId, projectId, revision]);
  return (
    <SemanticModal
      description={keywordText}
      onClose={onClose}
      title="Сезонность"
    >
      {error ? (
        <div className="inline-alert danger" role="alert">
          <UiText text={error} />
          <button
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
            type="button"
          >
            <UiText text="Повторить" />
          </button>
        </div>
      ) : !points ? (
        <div className="rankings-state" role="status">
          <UiText text="Загружаем сезонность…" />
        </div>
      ) : points.length ? (
        <SemanticSeasonalityCharts points={points} />
      ) : (
        <div className="rankings-state">
          <UiText text="Сезонность ещё не собрана" />
        </div>
      )}
    </SemanticModal>
  );
}

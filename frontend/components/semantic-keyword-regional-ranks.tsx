"use client";

import type {
  SemanticRankComparisonItem,
  SemanticRankDimension
} from "@seo-platform/contracts";
import { useEffect, useMemo, type ReactNode } from "react";
import { rankDimensionLabel } from "../lib/rank-dimension-presentation";
import { searchRegionDisplayName } from "../lib/seo-regions";
import { useSemanticRankComparison } from "./use-semantic-rank-comparison";
import { SearchEngineLogo } from "./search-engine-logo";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SemanticRankDeviceBadge } from "./semantic-rank-context";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticKeywordRegionalRanks({
  projectId,
  keywordId,
  dimensionKey,
  onDimensionChange,
  onDimensionFallback,
  onHistory,
  revision
}: Readonly<{
  projectId: string;
  keywordId: string;
  dimensionKey: string;
  onDimensionChange: (key: string) => void;
  onDimensionFallback?: (key: string) => void;
  onHistory: () => void;
  revision: string;
}>) {
  const { locale, t } = useUiLocale();
  const comparison = useSemanticRankComparison(
    projectId,
    JSON.stringify([keywordId]),
    "ALL",
    false,
    revision,
    projectId
  );
  const rowsByDimension = useMemo(
    () => new Map(
      [...comparison.items.values()]
        .filter((row) => row.keywordId === keywordId)
        .map((row) => [row.dimensionKey, row] as const)
    ),
    [comparison.items, keywordId]
  );
  const availableRows = useMemo(
    () => [...rowsByDimension.values()].sort((left, right) =>
      Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
      left.dimensionKey.localeCompare(right.dimensionKey)
    ),
    [rowsByDimension]
  );
  const sortedDimensions = useMemo(
    () => [...comparison.dimensions].sort((left, right) =>
      engineOrder(left.searchEngine) - engineOrder(right.searchEngine) ||
      rankDimensionRegionLabel(left).localeCompare(
        rankDimensionRegionLabel(right),
        locale,
        { sensitivity: "base" }
      ) ||
      deviceOrder(left.device) - deviceOrder(right.device) ||
      left.key.localeCompare(right.key)
    ),
    [comparison.dimensions, locale]
  );

  useEffect(() => {
    if (
      comparison.loading ||
      (dimensionKey && rowsByDimension.has(dimensionKey))
    ) return;
    const first = availableRows[0];
    (onDimensionFallback ?? onDimensionChange)(first?.dimensionKey ?? "");
  }, [availableRows, comparison.loading, dimensionKey, onDimensionChange, onDimensionFallback, rowsByDimension]);

  return (
    <div className="semantic-regional-ranks">
      <header className="semantic-inspector-section-heading">
        <h3>
          <UiText text="Позиции по городам" />
          <span
            className="semantic-regional-rank-count"
            title={t("Количество срезов с сохранённым съёмом")}
          >
            {availableRows.length.toLocaleString(locale)}
          </span>
        </h3>
        <button disabled={availableRows.length === 0} type="button" onClick={onHistory}>
          <Icon name="history" /><UiText text="История" />
        </button>
      </header>
      <CustomSelect
        aria-label={t("Город, устройство и поисковик")}
        disabled={comparison.dimensions.length === 0}
        onChange={(event) => onDimensionChange(event.target.value)}
        placeholder={t(comparison.loading ? "Загружаем позиции…" : "Позиция не снималась")}
        popoverClassName="semantic-rank-dimension-popover"
        value={dimensionKey}
      >
        {sortedDimensions.map((dimension) => {
          const row = rowsByDimension.get(dimension.key);
          return (
            <option disabled={!row} key={dimension.key} value={dimension.key}>
              <RankDimensionOption
                dimension={dimension}
                locale={locale}
                {...(row ? { row } : {})}
              />
            </option>
          );
        })}
      </CustomSelect>
      {comparison.error || comparison.catalogError ? (
        <div className="inline-alert warning">
          <UiText text={comparison.error ?? comparison.catalogError!} />
          <button type="button" onClick={comparison.refresh}><UiText text="Повторить" /></button>
        </div>
      ) : null}
      {!comparison.loading && availableRows.length === 0 && (
        <p className="semantic-inspector-muted"><UiText text="Позиция не снималась" /></p>
      )}
    </div>
  );
}

function RankDimensionOption({
  dimension,
  locale,
  row
}: Readonly<{
  dimension: SemanticRankDimension;
  locale: string;
  row?: SemanticRankComparisonItem;
}>) {
  const measured = Boolean(row);
  const delta = row ? rankDelta(row) : undefined;
  return (
    <span className={`semantic-rank-dimension-option${measured ? " measured" : " unavailable"}`}>
      <span className="semantic-rank-dimension-main">
        <SearchEngineLogo engine={dimension.searchEngine} size="compact" />
        <span className="semantic-rank-dimension-copy">
          <strong className="semantic-rank-dimension-heading">
            <span className="semantic-rank-dimension-engine">
              {dimension.searchEngine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}
            </span>
            <span aria-hidden="true" className="semantic-rank-dimension-separator">·</span>
            <span className="semantic-rank-dimension-region">{rankDimensionRegionLabel(dimension)}</span>
            <SemanticRankDeviceBadge device={dimension.device} />
          </strong>
          <small className="semantic-rank-dimension-meta">
            {row
              ? <>{formatRankDate(row.observedAt, locale)} · {row.provider}{row.searchSource ? ` · ${row.searchSource}` : ""}</>
              : <UiText text="Для этого запроса съёмов нет" />}
          </small>
        </span>
      </span>
      <span className={`semantic-rank-dimension-position${row?.found ? " found" : row ? " missing" : ""}`}>
        <strong>{row ? row.position ?? "×" : "—"}</strong>
        {delta && <small className={delta.tone}>{delta.label}</small>}
      </span>
      <span className="visually-hidden">{rankDimensionLabel(dimension, locale)}</span>
    </span>
  );
}

function rankDimensionRegionLabel(dimension: SemanticRankDimension): string {
  return searchRegionDisplayName(
    dimension.searchEngine,
    dimension.regionCode,
    dimension.regionLabel
  );
}

function engineOrder(engine: SemanticRankDimension["searchEngine"]): number {
  return engine === "YANDEX" ? 0 : 1;
}

function deviceOrder(device: SemanticRankDimension["device"]): number {
  return device === "DESKTOP" ? 0 : 1;
}

function formatRankDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function rankDelta(row: SemanticRankComparisonItem): Readonly<{
  label: ReactNode;
  tone: "declined" | "improved" | "new" | "unchanged";
}> {
  if (!row.found) {
    return {
      label: row.previousPosition === undefined
        ? <UiText text="Не найдена" />
        : <UiText text="Была {0}" values={[String(row.previousPosition)]} />,
      tone: "declined"
    };
  }
  if (row.position === undefined || row.previousPosition === undefined) {
    return { label: <UiText text="Новая" />, tone: "new" };
  }
  const difference = row.previousPosition - row.position;
  return {
    label: difference === 0
      ? "—"
      : `${difference > 0 ? "▲" : "▼"}${Math.abs(difference)}`,
    tone: difference > 0
      ? "improved"
      : difference < 0
        ? "declined"
        : "unchanged"
  };
}

"use client";
import type { SemanticRankDimension } from "@seo-platform/contracts";
import { rankDimensionLabel } from "../lib/rank-dimension-presentation";
import { useSemanticRankComparison } from "./use-semantic-rank-comparison";
import { SemanticRankComparisonCell } from "./semantic-rank-comparison-cell";
import { SearchEngineLogo } from "./search-engine-logo";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SemanticRankDeviceBadge } from "./semantic-rank-context";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticKeywordRegionalRanks({ projectId, keywordId, dimensionKey, onDimensionChange, onHistory, onSerpHistory, revision }: {
  projectId: string; keywordId: string; dimensionKey: string;
  onDimensionChange: (key: string) => void; onHistory: () => void; onSerpHistory: () => void; revision: string;
}) {
  const { locale, t } = useUiLocale();
  const comparison = useSemanticRankComparison(projectId, JSON.stringify([keywordId]), dimensionKey ? JSON.stringify([dimensionKey]) : "ALL", revision, projectId);
  const rows = [...comparison.items.values()].filter(row => row.keywordId === keywordId && (!dimensionKey || row.dimensionKey === dimensionKey));
  return <div className="semantic-regional-ranks">
    <header className="semantic-inspector-section-heading"><h3><UiText text="Позиции по городам" /></h3><button type="button" onClick={onHistory}><Icon name="history" /><UiText text="История" /></button></header>
    <CustomSelect aria-label={t("Город, устройство и поисковик")} value={dimensionKey} searchable searchPlaceholder={t("Найти город или устройство")} onChange={event => onDimensionChange(event.target.value)}>
      <option value=""><UiText text="Все города и устройства" /></option>
      {comparison.dimensions.map(dimension => (
        <option key={dimension.key} value={dimension.key}>
          <RankDimensionOption dimension={dimension} locale={locale} />
        </option>
      ))}
    </CustomSelect>
    {comparison.error || comparison.catalogError ? <div className="inline-alert warning"><UiText text={comparison.error ?? comparison.catalogError!} /><button type="button" onClick={comparison.refresh}><UiText text="Повторить" /></button></div> : null}
    <div className="semantic-regional-rank-list" aria-busy={comparison.loading}>
      {rows.map(row => {
        const dimension = comparison.dimensions.find(value => value.key === row.dimensionKey);
        return <div className="semantic-regional-rank-row" key={row.dimensionKey}>
          <button className="semantic-regional-rank-label" type="button" onClick={() => onDimensionChange(row.dimensionKey)} title={t("Открыть историю этого среза")}>
            <SearchEngineLogo engine={row.searchEngine} size="compact" />
            <span>
              <span className="semantic-regional-rank-title">
                {dimension ? rankDimensionRegionLabel(dimension) : row.dimensionKey}
                {dimension && <SemanticRankDeviceBadge device={dimension.device} />}
              </span>
              <small>{new Date(row.observedAt).toLocaleString(locale)} · {row.provider} · {row.searchSource ?? ""}</small>
            </span>
          </button>
          <SemanticRankComparisonCell item={row} metric="position" loading={comparison.loading} />
        </div>;
      })}
      {!rows.length && <p className="semantic-inspector-muted"><UiText text={comparison.loading ? "Загружаем позиции…" : "В выбранных городах запрос ещё не проверялся"} /></p>}
    </div>
    {!dimensionKey && rows.length > 1 && <p className="semantic-inspector-muted"><UiText text="Выберите срез, чтобы увидеть его график и историю отдельно." /></p>}
    <button className="secondary-button semantic-serp-history-button" type="button" onClick={onSerpHistory}><Icon name="history" /><UiText text="История выдачи и конкурентов" /></button>
  </div>;
}

function RankDimensionOption({
  dimension,
  locale
}: Readonly<{
  dimension: SemanticRankDimension;
  locale: string;
}>) {
  return (
    <span className="semantic-rank-dimension-option">
      <SearchEngineLogo engine={dimension.searchEngine} size="compact" />
      <span>{rankDimensionRegionLabel(dimension)}</span>
      <SemanticRankDeviceBadge device={dimension.device} />
      <span className="visually-hidden">{rankDimensionLabel(dimension, locale)}</span>
    </span>
  );
}

function rankDimensionRegionLabel(dimension: SemanticRankDimension): string {
  return dimension.regionLabel || dimension.regionCode;
}

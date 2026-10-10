"use client";

import {
  parseSemanticRankColumnKey,
  type SemanticRankDimension,
  type SemanticSavedViewColumnKey,
} from "@seo-platform/contracts";
import { semanticColumnLabel } from "../lib/semantic-column-presentation";
import { searchRegionDisplayName } from "../lib/seo-regions";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticColumnHeader({
  column,
  customColumns = [],
  rankDimensions = [],
}: Readonly<{
  column: SemanticSavedViewColumnKey;
  customColumns?: readonly Readonly<{ id: string; name: string }>[];
  rankDimensions?: readonly SemanticRankDimension[];
}>) {
  const { locale } = useUiLocale();
  const rank = parseSemanticRankColumnKey(column);
  if (rank) {
    const dimension =
      rankDimensions.find(({ key }) => key === rank.dimension.key) ??
      rank.dimension;
    const aiMetric = rank.metric.startsWith("ai");
    const metricLabel =
      rank.metric === "position" || rank.metric === "aiPosition"
        ? aiMetric
          ? "ИИ-позиция"
          : "Позиция"
        : rank.metric === "url" || rank.metric === "aiUrl"
          ? aiMetric
            ? "URL в ИИ"
            : "URL"
          : aiMetric
            ? "Дата ИИ"
            : "Дата";
    return (
      <span
        className="semantic-rank-column-header"
        title={semanticColumnLabel(
          column,
          customColumns,
          rankDimensions,
          locale,
        )}
      >
        <SearchEngineLogo engine={dimension.searchEngine} size="compact" />
        <span>
          {searchRegionDisplayName(
            dimension.searchEngine,
            dimension.regionCode,
            dimension.regionLabel,
          )}
          <small>
            {aiMetric && <Icon name="ai" />}
            <UiText
              text={dimension.device === "DESKTOP" ? "ПК" : "Телефон"}
            />{" "}
            · <UiText text={metricLabel} />
          </small>
        </span>
      </span>
    );
  }
  const frequency =
    column === "frequency" ||
    column === "frequencyExact" ||
    column === "frequencyFixed";
  const engine =
    frequency || column.startsWith("yandex")
      ? "YANDEX"
      : column.startsWith("google")
        ? "GOOGLE"
        : undefined;
  if (engine) {
    const aiMetric = column.includes("Ai");
    const label = frequency
      ? column === "frequency"
        ? "База"
        : column === "frequencyExact"
          ? '""'
          : '"!"'
      : column.endsWith("Position")
        ? aiMetric
          ? "ИИ позиция"
          : "Позиция"
        : column.endsWith("RelevantUrl")
          ? aiMetric
            ? "ИИ URL"
            : "URL"
          : aiMetric
            ? "ИИ съём"
            : "Съём";
    return (
      <span
        className={`semantic-engine-header${aiMetric ? " semantic-ai-column-header" : ""}`}
      >
        <SearchEngineLogo engine={engine} size="compact" />
        {aiMetric && <Icon name="ai" />}
        <UiText text={label} />
      </span>
    );
  }
  const label = semanticColumnLabel(
    column,
    customColumns,
    rankDimensions,
    locale,
  );
  if (column.startsWith("custom:")) return label;
  return <UiText text={label} />;
}

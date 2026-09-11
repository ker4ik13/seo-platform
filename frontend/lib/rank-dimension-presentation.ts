import { parseSemanticRankColumnKey, semanticRankColumnKey, type SemanticRankDimension } from "@seo-platform/contracts";
import { searchRegionDisplayName } from "./seo-regions.ts";

export function rankDimensionLabel(dimension: SemanticRankDimension, locale: string): string {
  const english = locale.startsWith("en");
  return `${dimension.searchEngine === "YANDEX" ? english ? "Yandex" : "Яндекс" : "Google"} · ${searchRegionDisplayName(dimension.searchEngine, dimension.regionCode, dimension.regionLabel)} · ${dimension.device === "DESKTOP" ? english ? "Desktop" : "ПК" : english ? "Mobile" : "Телефон"}${dimension.language !== "ru" ? ` · ${dimension.language}` : ""}`;
}
export function rankDimensionColumns(dimensions: readonly SemanticRankDimension[], locale: string) {
  const labels = locale.startsWith("en")
    ? { position: "Position", url: "Ranking URL", checkedAt: "Checked at", aiPosition: "AI position", aiUrl: "AI URL", aiCheckedAt: "AI checked at" }
    : { position: "Позиция", url: "Найденный URL", checkedAt: "Дата съёма", aiPosition: "ИИ-позиция", aiUrl: "URL в ИИ", aiCheckedAt: "Дата ИИ-съёма" };
  return dimensions.flatMap(dimension =>
    (["position", "url", "checkedAt", "aiPosition", "aiUrl", "aiCheckedAt"] as const)
      .map(metric => ({
        key: semanticRankColumnKey(dimension.key, metric),
        label: `${rankDimensionLabel(dimension, locale)} · ${labels[metric]}`
      }))
  );
}
export function rankColumnLabel(key: string, dimensions: readonly SemanticRankDimension[], locale: string): string | undefined {
  const column = parseSemanticRankColumnKey(key);
  if (!column) return undefined;
  return rankDimensionColumns([dimensions.find(value => value.key === column.dimension.key) ?? column.dimension], locale).find(value => value.key === key)?.label;
}

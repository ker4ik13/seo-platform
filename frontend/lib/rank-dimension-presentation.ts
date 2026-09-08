import { parseSemanticRankColumnKey, semanticRankColumnKey, type SemanticRankDimension } from "@seo-platform/contracts";

export function rankDimensionLabel(dimension: SemanticRankDimension, locale: string): string {
  const english = locale.startsWith("en");
  return `${dimension.searchEngine === "YANDEX" ? english ? "Yandex" : "Яндекс" : "Google"} · ${dimension.regionLabel || dimension.regionCode} · ${dimension.device === "DESKTOP" ? english ? "Desktop" : "ПК" : english ? "Mobile" : "Телефон"}${dimension.language !== "ru" ? ` · ${dimension.language}` : ""}`;
}
export function rankDimensionColumns(dimensions: readonly SemanticRankDimension[], locale: string) {
  const labels = locale.startsWith("en") ? { position: "Position", url: "Ranking URL", checkedAt: "Checked at" } : { position: "Позиция", url: "Найденный URL", checkedAt: "Дата съёма" };
  return dimensions.flatMap(dimension => (["position", "url", "checkedAt"] as const).map(metric => ({ key: semanticRankColumnKey(dimension.key, metric), label: `${rankDimensionLabel(dimension, locale)} · ${labels[metric]}` })));
}
export function rankColumnLabel(key: string, dimensions: readonly SemanticRankDimension[], locale: string): string | undefined {
  const column = parseSemanticRankColumnKey(key);
  if (!column) return undefined;
  return rankDimensionColumns([dimensions.find(value => value.key === column.dimension.key) ?? column.dimension], locale).find(value => value.key === key)?.label;
}

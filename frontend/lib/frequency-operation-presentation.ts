import type { FrequencyCollectionSummary } from "@seo-platform/contracts";

export function frequencyCollectionTitle(
  value: Pick<FrequencyCollectionSummary, "mode">
): "Сбор частотности" | "Сбор сезонности" {
  return value.mode === "SEASONALITY" ? "Сбор сезонности" : "Сбор частотности";
}

export function frequencyCollectionCompactTitle(
  value: Pick<FrequencyCollectionSummary, "mode" | "types">
): string {
  return value.mode === "SEASONALITY"
    ? "Сезонность Wordstat"
    : `Частотность · ${value.types.map(frequencyTypeLabel).join(" + ")}`;
}

export function frequencyCollectionParameters(
  value: Pick<FrequencyCollectionSummary, "mode" | "types" | "seasonality">
): string {
  if (value.mode !== "SEASONALITY") {
    return value.types.map(frequencyTypeLabel).join(" + ");
  }
  const request = value.seasonality;
  return request
    ? `${seasonalityGranularityLabel(request.granularity)} · ${request.observedFrom} — ${request.observedThrough}`
    : "Сезонность · параметры недоступны";
}

export function frequencyTypeLabel(type: string): string {
  return ({ BASE: "Базовая", EXACT: "Фразовая", FIXED: "Точная" } as const)[
    type as "BASE" | "EXACT" | "FIXED"
  ] ?? type;
}

export function seasonalityGranularityLabel(value: string): string {
  return ({ MONTH: "По месяцам", WEEK: "По неделям", DAY: "По дням" } as const)[
    value as "MONTH" | "WEEK" | "DAY"
  ] ?? value;
}

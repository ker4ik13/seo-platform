import { parseSemanticRankColumnKey } from "@seo-platform/contracts";
import type { SemanticViewConfig, SemanticViewColumn } from "../components/semantic-view-types.ts";

export const semanticViewPresets = [
  { id: "POSITIONS", label: "Позиции" }, { id: "WORDSTAT", label: "Wordstat" },
  { id: "AI", label: "ИИ" }, { id: "URL", label: "Работа с URL" }
] as const;
export type SemanticViewPreset = typeof semanticViewPresets[number]["id"];

export function applySemanticViewPreset(config: SemanticViewConfig, preset: SemanticViewPreset, rankColumns: readonly SemanticViewColumn[]): SemanticViewConfig {
  const metrics = rankColumns.flatMap(key => {
    const parsed = parseSemanticRankColumnKey(key);
    return parsed ? [{ key, metric: parsed.metric }] : [];
  });
  const dynamic = metrics.filter(({ metric }) => preset === "AI" ? metric === "aiPosition" || metric === "aiUrl"
    : preset === "URL" ? metric === "url" : metric === "position").map(({ key }) => key).slice(0, 48);
  const selected: readonly SemanticViewColumn[] = preset === "WORDSTAT" ? ["query", "frequency", "frequencyExact", "frequencyFixed"]
    : preset === "URL" ? ["query", "targetUrl", ...(dynamic.length ? dynamic : ["yandexRelevantUrl", "googleRelevantUrl"] as const)]
    : preset === "AI" ? ["query", ...(dynamic.length ? dynamic : ["yandexAiPosition", "googleAiPosition"] as const)]
    : ["query", ...(dynamic.length ? dynamic : ["yandexPosition", "googlePosition"] as const)];
  const columns = [...new Set([...selected, ...config.columns.filter(key => key.startsWith("custom:"))])];
  return { ...config, columns, columnOrder: [...new Set([...columns, ...(config.columnOrder ?? [])])] };
}

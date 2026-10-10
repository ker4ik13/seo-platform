import {
  parseSemanticPositionHistoryImportOptions, semanticPositionHistoryColumnHeader,
  type SemanticImportColumnPreview, type SemanticImportMappingColumn, type SemanticImportTarget,
  type SemanticPositionHistoryDateColumn, type SemanticPositionHistoryImportOptions,
} from "@seo-platform/contracts";

export type PositionImportColumnChoice = SemanticImportTarget | "history.position" | "history.url";

export function initialPositionHistoryColumns(columns: readonly SemanticImportColumnPreview[], defaults: SemanticPositionHistoryImportOptions): readonly SemanticPositionHistoryDateColumn[] {
  const dates: SemanticPositionHistoryDateColumn[] = columns.flatMap(column => {
    const header = semanticPositionHistoryColumnHeader(column.sourceName);
    if (header?.kind !== "POSITION") return [];
    const context = header.searchEngine && header.searchEngine !== defaults.searchEngine ? {
      searchEngine: header.searchEngine, countryCode: "RU", regionCode: header.searchEngine === "GOOGLE" ? "1011969" : "213",
      regionLabel: "Москва", language: defaults.language, device: defaults.device,
    } : undefined;
    return [{ sourceIndex: column.index, observedAt: header.observedAt, ...(context ? { context } : {}) }];
  });
  for (const column of columns) {
    const header = semanticPositionHistoryColumnHeader(column.sourceName);
    if (header?.kind !== "URL") continue;
    const matches = dates.filter(date => date.observedAt === header.observedAt &&
      (!header.searchEngine || (date.context?.searchEngine ?? defaults.searchEngine) === header.searchEngine));
    if (matches.length === 1) {
      const index = dates.indexOf(matches[0]!);
      dates[index] = { ...matches[0]!, rankingUrlSourceIndex: column.index };
    }
  }
  return dates;
}

export function positionImportColumnChoice(sourceIndex: number, mapping: ReadonlyMap<number, SemanticImportMappingColumn>, history?: SemanticPositionHistoryImportOptions): PositionImportColumnChoice {
  if (history?.layout !== "LONG" && history?.dateColumns?.some(column => column.sourceIndex === sourceIndex)) return "history.position";
  if (history?.layout !== "LONG" && history?.dateColumns?.some(column => column.rankingUrlSourceIndex === sourceIndex)) return "history.url";
  return mapping.get(sourceIndex)?.target ?? "ignore";
}

export function removePositionHistorySource(history: SemanticPositionHistoryImportOptions, sourceIndex: number): SemanticPositionHistoryImportOptions {
  const dateColumns = (history.dateColumns ?? []).filter(column => column.sourceIndex !== sourceIndex).map(column => {
    if (column.rankingUrlSourceIndex !== sourceIndex) return column;
    const { rankingUrlSourceIndex: _removed, ...rest } = column;
    return rest;
  });
  return { ...history, dateColumns };
}

export function positionHistoryMappingError(history: SemanticPositionHistoryImportOptions | undefined, columns: readonly SemanticImportMappingColumn[]): string | undefined {
  if (!history) return undefined;
  if (history.layout === "LONG" && !history.observedAt && !columns.some(column => column.target === "metric.observed_at")) return "Укажите дату снимка или колонку с датой.";
  if (history.layout === "LONG" && !columns.some(column => ["ranking.position", "ranking.yandex.position", "ranking.google.position"].includes(column.target))) return "Выберите колонку позиции.";
  try { parseSemanticPositionHistoryImportOptions(history); }
  catch { return "Проверьте даты, привязку URL и параметры снимков: одна дата и один срез не должны повторяться."; }
  return undefined;
}

export function spreadsheetColumnLetter(index: number): string {
  let value = index + 1, label = "";
  while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return label;
}

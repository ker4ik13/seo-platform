import {
  parseSemanticRankDimensionKey, semanticPositionHistoryColumnHeader, semanticPositionHistoryObservedAt,
  semanticRankDimensionKey, type SemanticImportMapping, type SemanticImportRankHistoryValue,
  type SemanticPositionHistoryImportContext, type SemanticPositionHistoryImportOptions, type SemanticPositionHistoryDateColumn,
} from "@seo-platform/contracts";
import { googleRussiaRegionRows, yandexRussiaRegionRows } from "@seo-platform/contracts/seo-regions";

export const POSITION_HISTORY_MAX_DATE_COLUMNS = 1_100;
const HEADER_ALIASES = {
  "context.search_engine": ["поисковик", "поисковая система", "search engine", "engine"],
  "context.region_code": ["код региона", "region code", "region id"],
  "context.region": ["город", "регион", "city", "region"],
  "context.country": ["страна", "country"],
  "context.language": ["язык выдачи", "язык", "language", "serp language"],
  "context.device": ["устройство", "device"],
  "metric.observed_at": ["дата", "дата снимка", "дата проверки", "дата съема", "дата съёма", "date", "checked at", "observed at"],
  "ranking.position": ["позиция", "position", "rank"],
  "ranking.url": ["url", "урл", "url из поиска", "url из выдачи", "урл из выдачи", "ссылка из выдачи", "найденный url", "найденная страница", "релевантный url", "релевантная страница", "url позиции", "ranking url", "ranking page", "serp url", "result url", "relevant url"],
} as const;
const REGION_ROWS = { YANDEX: yandexRussiaRegionRows, GOOGLE: googleRussiaRegionRows };
const REGION_BY_NAME = { YANDEX: regionNames(yandexRussiaRegionRows), GOOGLE: regionNames(googleRussiaRegionRows) };
const REGION_CODES: Record<"YANDEX" | "GOOGLE", ReadonlySet<string>> = {
  YANDEX: new Set(yandexRussiaRegionRows.map(([code]) => code)),
  GOOGLE: new Set(googleRussiaRegionRows.map(([code]) => code)),
};
const REGION_LABELS = { YANDEX: new Map<string, string>(REGION_ROWS.YANDEX), GOOGLE: new Map<string, string>(REGION_ROWS.GOOGLE) };

export function positionHistoryDateColumns(headers: readonly string[]) {
  const dates = headers.flatMap((header, sourceIndex) => {
    const date = semanticPositionHistoryColumnHeader(header);
    return date?.kind === "POSITION" ? [{ sourceIndex, observedAt: date.observedAt }] : [];
  });
  return dates.length < 1 || dates.length > POSITION_HISTORY_MAX_DATE_COLUMNS ||
    new Set(dates.map(item => item.observedAt)).size !== dates.length ? [] : dates;
}
export function positionHistoryMetadataHeader(value: string): boolean {
  return Object.values(HEADER_ALIASES).some(aliases => (aliases as readonly string[]).includes(normalize(value)));
}
export function isPositionHistorySummary(value: string): boolean {
  return /^(?:ТОП|TOP)\s*[-–—]?\s*\d+$/iu.test(value.normalize("NFKC").trim());
}

export function importedPositionHistory(
  headers: readonly string[], values: readonly string[], defaults: SemanticPositionHistoryImportOptions,
  issues: Set<string>, mapping?: SemanticImportMapping,
): readonly SemanticImportRankHistoryValue[] {
  const cell = (target: SemanticImportMapping["columns"][number]["target"]): string => {
    const mapped = mapping?.columns.find(column => column.target === target);
    if (mapped) return normalizedCell(values[mapped.sourceIndex]);
    const aliases = HEADER_ALIASES[target as keyof typeof HEADER_ALIASES] as readonly string[] | undefined;
    const index = aliases ? headers.findIndex((header, index) => aliases.includes(normalize(header)) &&
      !mapping?.columns.some(column => column.sourceIndex === index)) : -1;
    return normalizedCell(values[index]);
  };
  if (defaults.layout === "LONG") {
    const yandex = cell("ranking.yandex.position"), google = cell("ranking.google.position");
    const candidates = yandex || google
      ? [...(yandex ? [{ engine: "YANDEX" as const, raw: yandex }] : []), ...(google ? [{ engine: "GOOGLE" as const, raw: google }] : [])]
      : [{ engine: optionalEngine(cell("context.search_engine")) ?? defaults.searchEngine, raw: cell("ranking.position") }];
    const result: SemanticImportRankHistoryValue[] = [];
    for (const candidate of candidates) {
      if (!candidate.raw) continue;
      const observedAt = semanticPositionHistoryObservedAt(cell("metric.observed_at") || defaults.observedAt || "");
      if (!observedAt) { issues.add("INVALID_OBSERVED_AT"); continue; }
      const context = rowContext(candidate.engine, defaults, cell, issues);
      if (!context) continue;
      const point = positionPoint(candidate.raw, cell(rankingUrlTarget(candidate.engine)) || cell("ranking.url"), context, observedAt, issues, true);
      if (point) result.push(point);
    }
    return result;
  }
  const dates: readonly SemanticPositionHistoryDateColumn[] = defaults.dateColumns ?? positionHistoryDateColumns(headers);
  if (!dates.length) { issues.add("POSITION_HISTORY_DATES_REQUIRED"); return []; }
  const result: SemanticImportRankHistoryValue[] = [];
  for (const column of dates) {
    const raw = normalizedCell(values[column.sourceIndex]);
    if (!raw) continue;
    const override = column.context;
    const selected = override ?? defaults;
    const engine = optionalEngine(cell("context.search_engine"));
    if (!defaults.dateColumns && engine && engine !== defaults.searchEngine) { issues.add("POSITION_HISTORY_CONTEXT_INVALID"); continue; }
    const context = rowContext(override?.searchEngine ?? engine ?? defaults.searchEngine, selected, override ? () => "" : cell, issues);
    if (!context) continue;
    const urlIndex = column.rankingUrlSourceIndex;
    const rawUrl = urlIndex !== undefined ? normalizedCell(values[urlIndex]) : cell(rankingUrlTarget(context.searchEngine)) || cell("ranking.url");
    const point = positionPoint(raw, rawUrl, context, column.observedAt, issues, false);
    if (point) result.push(point);
  }
  return result;
}

function rowContext(
  engine: "YANDEX" | "GOOGLE", defaults: SemanticPositionHistoryImportContext,
  cell: (target: SemanticImportMapping["columns"][number]["target"]) => string, issues: Set<string>,
): SemanticPositionHistoryImportContext | undefined {
  const engineRaw = cell("context.search_engine"), deviceRaw = cell("context.device");
  const device = optionalDevice(deviceRaw);
  const countryCode = (cell("context.country") || defaults.countryCode).toUpperCase();
  let regionCode = cell("context.region_code"), regionLabel = cell("context.region");
  const languageRaw = cell("context.language") || defaults.language;
  let language: string;
  try { language = Intl.getCanonicalLocales(languageRaw)[0]!; }
  catch { issues.add("POSITION_HISTORY_CONTEXT_INVALID"); return undefined; }
  if ((engineRaw && !optionalEngine(engineRaw)) || (deviceRaw && !device) || !/^[A-Z]{2}$/u.test(countryCode)) {
    issues.add("POSITION_HISTORY_CONTEXT_INVALID"); return undefined;
  }
  if (regionCode) {
    const other = engine === "YANDEX" ? "GOOGLE" : "YANDEX";
    if (countryCode === "RU" && REGION_CODES[other].has(regionCode) && !REGION_CODES[engine].has(regionCode)) { issues.add("POSITION_HISTORY_CONTEXT_INVALID"); return undefined; }
    regionLabel ||= REGION_LABELS[engine].get(regionCode) ?? (regionCode === defaults.regionCode ? defaults.regionLabel : "");
  } else if (regionLabel || engine !== defaults.searchEngine) {
    regionLabel ||= defaults.regionLabel;
    const candidates = countryCode === "RU" ? REGION_BY_NAME[engine].get(normalize(regionLabel)) : undefined;
    if (!candidates || candidates.length !== 1) { issues.add("POSITION_HISTORY_CONTEXT_INVALID"); return undefined; }
    [regionCode, regionLabel] = candidates[0]!;
  } else {
    regionCode = defaults.regionCode;
    regionLabel = defaults.regionLabel;
  }
  const context = { searchEngine: engine, countryCode, regionCode, regionLabel, language, device: device ?? defaults.device };
  if (!regionLabel || regionLabel.length > 160 || !parseSemanticRankDimensionKey(semanticRankDimensionKey(context))) { issues.add("POSITION_HISTORY_CONTEXT_INVALID"); return undefined; }
  return context;
}

function positionPoint(raw: string, rawUrl: string, context: SemanticPositionHistoryImportContext, observedAt: string, issues: Set<string>, legacyLong: boolean): SemanticImportRankHistoryValue | undefined {
  if (/^(?:[-–—]{1,2}|не найден[ао]?|not found)$/iu.test(raw) || (legacyLong && raw === "0")) return { ...context, observedAt, found: false };
  const normalized = raw.replace(/[\s\u00a0]+/gu, "").replace(",", ".");
  if (!/^(?:[1-9]\d?|100)(?:\.0+)?$/u.test(normalized)) { issues.add("INVALID_POSITION"); return undefined; }
  const rankingUrl = importedRankingUrl(rawUrl, issues);
  return { ...context, observedAt, found: true, position: Number(normalized), ...(rankingUrl ? { rankingUrl } : {}) };
}

export function importedRankingUrl(value: string | undefined, issues: Set<string>): string | undefined {
  if (!value) return undefined;
  const candidates = [value.trim(), ...value.split(/[\s;]+/u)].map(candidate => candidate.trim())
    .filter((candidate, index, values) => candidate.length > 0 && candidate.length <= 8_192 && values.indexOf(candidate) === index);
  for (const candidate of candidates) {
    try { const url = new URL(candidate); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return candidate; }
    catch { /* Some exports prepend text or keep several URLs in one cell. */ }
  }
  issues.add("INVALID_RANKING_URL");
  return undefined;
}
function regionNames(rows: readonly (readonly [string, string])[]) {
  const result = new Map<string, (readonly [string, string])[]>();
  for (const row of rows) {
    for (const key of new Set([normalize(row[1]), normalize(row[1].split(" · ")[0]!)])) result.set(key, [...(result.get(key) ?? []), row]);
  }
  return result;
}
function rankingUrlTarget(engine: "YANDEX" | "GOOGLE") { return engine === "YANDEX" ? "ranking.yandex.url" as const : "ranking.google.url" as const; }
function normalize(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase("ru"); }
function normalizedCell(value: string | undefined): string { return value?.normalize("NFKC").trim() ?? ""; }
function optionalEngine(value: string): "YANDEX" | "GOOGLE" | undefined {
  return /^(?:yandex|яндекс)(?: live| xml)?$/iu.test(value) ? "YANDEX" : /^(?:google|гугл)$/iu.test(value) ? "GOOGLE" : undefined;
}
function optionalDevice(value: string): "DESKTOP" | "MOBILE" | undefined {
  const text = normalize(value);
  return ["desktop", "десктоп", "пк", "computer"].includes(text) ? "DESKTOP" : ["mobile", "мобильное", "мобильный", "мобайл", "телефон", "phone"].includes(text) ? "MOBILE" : undefined;
}

import {
  parseSemanticRankDimensionKey,
  semanticPositionHistoryHeaderDate,
  semanticRankDimensionKey,
  type SemanticImportMapping,
  type SemanticImportRankHistoryValue,
  type SemanticPositionHistoryImportOptions
} from "@seo-platform/contracts";

export const POSITION_HISTORY_MAX_DATE_COLUMNS = 1_100;

const HEADER_ALIASES = {
  engine: new Set(["поисковик", "поисковая система", "search engine", "engine"]),
  regionCode: new Set(["код региона", "region code", "region id"]),
  regionLabel: new Set(["город", "регион", "city", "region"]),
  country: new Set(["страна", "country"]),
  language: new Set(["язык", "language"]),
  device: new Set(["устройство", "device"]),
  observedAt: new Set(["дата", "дата проверки", "дата съема", "date", "checked at", "observed at"]),
  position: new Set(["позиция", "position", "rank"]),
  rankingUrl: new Set([
    "url",
    "урл",
    "url из выдачи",
    "урл из выдачи",
    "ссылка из выдачи",
    "найденный url",
    "найденная страница",
    "релевантный url",
    "релевантная страница",
    "url позиции",
    "ranking url",
    "ranking page",
    "serp url",
    "result url",
    "relevant url"
  ])
};

export function positionHistoryDateColumns(headers: readonly string[]): readonly Readonly<{ sourceIndex: number; observedAt: string }>[] {
  const dates = headers.flatMap((header, sourceIndex) => {
    const date = semanticPositionHistoryHeaderDate(header);
    return date ? [{ sourceIndex, observedAt: `${date}T12:00:00.000Z` }] : [];
  });
  if (dates.length < 1 || dates.length > POSITION_HISTORY_MAX_DATE_COLUMNS || new Set(dates.map(item => item.observedAt)).size !== dates.length) return [];
  return dates;
}

export function positionHistoryMetadataHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return Object.values(HEADER_ALIASES).some(aliases => aliases.has(normalized));
}

export function isPositionHistorySummary(value: string): boolean {
  return /^(?:ТОП|TOP)\s*[-–—]?\s*\d+$/iu.test(value.normalize("NFKC").trim());
}

export function importedPositionHistory(
  headers: readonly string[], values: readonly string[], defaults: SemanticPositionHistoryImportOptions, issues: Set<string>, mapping?: SemanticImportMapping
): readonly SemanticImportRankHistoryValue[] {
  if (defaults.layout === "LONG") {
    return importedLongPositionHistory(headers, values, defaults, issues, mapping);
  }
  const dates = positionHistoryDateColumns(headers);
  if (!dates.length) { issues.add("POSITION_HISTORY_DATES_REQUIRED"); return []; }
  if (dates.every(({ sourceIndex }) => !(values[sourceIndex]?.trim()))) return [];
  const index = (aliases: ReadonlySet<string>) => headers.findIndex(header => aliases.has(normalizeHeader(header)));
  const engineRaw = normalizedCell(values[index(HEADER_ALIASES.engine)]);
  const deviceRaw = normalizedCell(values[index(HEADER_ALIASES.device)]);
  const countryRaw = normalizedCell(values[index(HEADER_ALIASES.country)]);
  const regionCodeRaw = normalizedCell(values[index(HEADER_ALIASES.regionCode)]);
  const regionLabelRaw = normalizedCell(values[index(HEADER_ALIASES.regionLabel)]);
  const languageRaw = normalizedCell(values[index(HEADER_ALIASES.language)]);
  const engine = optionalEngine(engineRaw);
  const device = optionalDevice(deviceRaw);
  const countryCode = (countryRaw || defaults.countryCode).toUpperCase();
  const regionCode = regionCodeRaw || defaults.regionCode;
  const regionLabel = regionLabelRaw || defaults.regionLabel;
  const language = languageRaw || defaults.language;
  const finalDevice = device ?? defaults.device;
  const rankingUrl = importedRankingUrl(
    mappedValue(mapping, values, rankingUrlTarget(defaults.searchEngine)) ||
      mappedValue(mapping, values, "ranking.url") ||
      normalizedCell(values[index(HEADER_ALIASES.rankingUrl)]),
    issues
  );
  const dimensionKey = semanticRankDimensionKey({ searchEngine: defaults.searchEngine, countryCode, regionCode, language, device: finalDevice });
  if (
    (engineRaw && !engine) || (engine && engine !== defaults.searchEngine) ||
    (deviceRaw && !device) || countryRaw.length > 2 || regionCodeRaw.length > 100 ||
    regionLabelRaw.length > 160 || languageRaw.length > 16 || !regionLabel ||
    !parseSemanticRankDimensionKey(dimensionKey)
  ) {
    issues.add("POSITION_HISTORY_CONTEXT_INVALID"); return [];
  }
  const result: SemanticImportRankHistoryValue[] = [];
  for (const { sourceIndex, observedAt } of dates) {
    const raw = values[sourceIndex]?.normalize("NFKC").trim() ?? "";
    if (!raw) continue; // Empty means this date was never checked.
    if (/^[-–—]$/u.test(raw)) {
      result.push({ searchEngine: defaults.searchEngine, countryCode, regionCode, regionLabel, language, device: finalDevice, observedAt, found: false });
      continue;
    }
    const normalized = raw.replace(/[\s\u00a0]+/gu, "");
    if (!/^(?:[1-9]\d?|100)(?:[.,]0+)?$/u.test(normalized)) { issues.add("INVALID_POSITION"); continue; }
    const position = Number(normalized.replace(",", "."));
    if (!Number.isSafeInteger(position) || position < 1 || position > 100) { issues.add("INVALID_POSITION"); continue; }
    result.push({
      searchEngine: defaults.searchEngine,
      countryCode,
      regionCode,
      regionLabel,
      language,
      device: finalDevice,
      observedAt,
      found: true,
      position,
      ...(rankingUrl ? { rankingUrl } : {})
    });
  }
  return result;
}

function importedLongPositionHistory(
  headers: readonly string[],
  values: readonly string[],
  defaults: SemanticPositionHistoryImportOptions,
  issues: Set<string>,
  mapping?: SemanticImportMapping
): readonly SemanticImportRankHistoryValue[] {
  const mapped = (target: SemanticImportMapping["columns"][number]["target"]): string => {
    const column = mapping?.columns.find((candidate) => candidate.target === target);
    return normalizedCell(column ? values[column.sourceIndex] : undefined);
  };
  const indexed = (aliases: ReadonlySet<string>): string => {
    const sourceIndex = headers.findIndex((header) => aliases.has(normalizeHeader(header)));
    return normalizedCell(values[sourceIndex]);
  };
  const engineRaw = mapped("context.search_engine") || indexed(HEADER_ALIASES.engine);
  const explicitEngine = optionalEngine(engineRaw);
  const yandexPosition = mapped("ranking.yandex.position");
  const googlePosition = mapped("ranking.google.position");
  const searchEngine = yandexPosition
    ? "YANDEX"
    : googlePosition
      ? "GOOGLE"
      : explicitEngine ?? defaults.searchEngine;
  const rawPosition = yandexPosition || googlePosition || mapped("ranking.position") || indexed(HEADER_ALIASES.position);
  const rawRankingUrl = mapped(rankingUrlTarget(searchEngine)) ||
    mapped("ranking.url") ||
    indexed(HEADER_ALIASES.rankingUrl);
  const rawObservedAt = mapped("metric.observed_at") || indexed(HEADER_ALIASES.observedAt);
  if ((engineRaw && !explicitEngine) || !rawPosition || !rawObservedAt) {
    issues.add("POSITION_HISTORY_CONTEXT_INVALID");
    return [];
  }
  const observedAt = normalizedObservedAt(rawObservedAt);
  if (!observedAt) {
    issues.add("INVALID_OBSERVED_AT");
    return [];
  }
  const deviceRaw = indexed(HEADER_ALIASES.device);
  const device = optionalDevice(deviceRaw);
  const countryRaw = indexed(HEADER_ALIASES.country);
  const regionCodeRaw = indexed(HEADER_ALIASES.regionCode);
  const regionLabelRaw = mapped("context.region") || indexed(HEADER_ALIASES.regionLabel);
  const languageRaw = indexed(HEADER_ALIASES.language);
  const countryCode = (countryRaw || defaults.countryCode).toUpperCase();
  const regionCode = regionCodeRaw || defaults.regionCode;
  const regionLabel = regionLabelRaw || defaults.regionLabel;
  const language = languageRaw || defaults.language;
  const finalDevice = device ?? defaults.device;
  if (
    (deviceRaw && !device) ||
    countryCode.length !== 2 ||
    !regionCode || regionCode.length > 100 ||
    !regionLabel || regionLabel.length > 160 ||
    !parseSemanticRankDimensionKey(semanticRankDimensionKey({ searchEngine, countryCode, regionCode, language, device: finalDevice }))
  ) {
    issues.add("POSITION_HISTORY_CONTEXT_INVALID");
    return [];
  }
  if (/^(?:0|-|–|—|не найден[ао]?)$/iu.test(rawPosition)) {
    return [{ searchEngine, countryCode, regionCode, regionLabel, language, device: finalDevice, observedAt, found: false }];
  }
  const normalized = rawPosition.replace(/[\s\u00a0]+/gu, "").replace(",", ".");
  const position = Number(normalized);
  if (!/^(?:[1-9]\d?|100)(?:\.0+)?$/u.test(normalized) || !Number.isSafeInteger(position)) {
    issues.add("INVALID_POSITION");
    return [];
  }
  const rankingUrl = importedRankingUrl(rawRankingUrl, issues);
  return [{
    searchEngine,
    countryCode,
    regionCode,
    regionLabel,
    language,
    device: finalDevice,
    observedAt,
    found: true,
    position,
    ...(rankingUrl ? { rankingUrl } : {})
  }];
}

export function importedRankingUrl(
  value: string | undefined,
  issues: Set<string>
): string | undefined {
  if (!value) return undefined;
  const candidates = [value.trim(), ...value.split(/[\s;]+/u)]
    .map((candidate) => candidate.trim())
    .filter((candidate, index, values) =>
      candidate.length > 0 &&
      candidate.length <= 8_192 &&
      values.indexOf(candidate) === index
    );
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (["http:", "https:"].includes(url.protocol)) return candidate;
    } catch {
      // Some exports prepend text or keep several URLs in one cell.
    }
  }
  issues.add("INVALID_RANKING_URL");
  return undefined;
}

function mappedValue(
  mapping: SemanticImportMapping | undefined,
  values: readonly string[],
  target: SemanticImportMapping["columns"][number]["target"]
): string {
  const column = mapping?.columns.find((candidate) => candidate.target === target);
  return normalizedCell(column ? values[column.sourceIndex] : undefined);
}

function rankingUrlTarget(
  searchEngine: "YANDEX" | "GOOGLE"
): "ranking.yandex.url" | "ranking.google.url" {
  return searchEngine === "YANDEX"
    ? "ranking.yandex.url"
    : "ranking.google.url";
}

function normalizedObservedAt(value: string): string | undefined {
  const dateOnly = semanticPositionHistoryHeaderDate(value);
  if (dateOnly) return `${dateOnly}T12:00:00.000Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeHeader(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase("ru"); }
function normalizedCell(value: string | undefined): string { return value?.normalize("NFKC").trim() ?? ""; }
function optionalEngine(value: string | undefined): "YANDEX" | "GOOGLE" | undefined { const text = normalizeHeader(value ?? ""); return text.includes("янд") || text === "yandex" ? "YANDEX" : text.includes("google") || text.includes("гугл") ? "GOOGLE" : undefined; }
function optionalDevice(value: string | undefined): "DESKTOP" | "MOBILE" | undefined { const text = normalizeHeader(value ?? ""); return ["desktop", "десктоп", "пк", "computer"].includes(text) ? "DESKTOP" : ["mobile", "мобильное", "мобайл", "телефон", "phone"].includes(text) ? "MOBILE" : undefined; }

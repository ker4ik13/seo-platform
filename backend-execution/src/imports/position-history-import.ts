import {
  parseSemanticRankDimensionKey,
  semanticPositionHistoryHeaderDate,
  semanticRankDimensionKey,
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
  device: new Set(["устройство", "device"])
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
  headers: readonly string[], values: readonly string[], defaults: SemanticPositionHistoryImportOptions, issues: Set<string>
): readonly SemanticImportRankHistoryValue[] {
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
    result.push({ searchEngine: defaults.searchEngine, countryCode, regionCode, regionLabel, language, device: finalDevice, observedAt, found: true, position });
  }
  return result;
}

function normalizeHeader(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase("ru"); }
function normalizedCell(value: string | undefined): string { return value?.normalize("NFKC").trim() ?? ""; }
function optionalEngine(value: string | undefined): "YANDEX" | "GOOGLE" | undefined { const text = normalizeHeader(value ?? ""); return text.includes("янд") || text === "yandex" ? "YANDEX" : text.includes("google") || text.includes("гугл") ? "GOOGLE" : undefined; }
function optionalDevice(value: string | undefined): "DESKTOP" | "MOBILE" | undefined { const text = normalizeHeader(value ?? ""); return ["desktop", "десктоп", "пк", "computer"].includes(text) ? "DESKTOP" : ["mobile", "мобильное", "мобайл", "телефон", "phone"].includes(text) ? "MOBILE" : undefined; }

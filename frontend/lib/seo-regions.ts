import {
  googleRussiaRegionRows,
  resolveSeoRegionLabel,
  yandexRussiaRegionRows,
  type SeoRegionCodeKind,
  type SeoRegionRow
} from "@seo-platform/contracts/seo-regions";
import type { ProjectSearchCity } from "@seo-platform/contracts";

export interface SeoRegionOption {
  readonly code: string;
  readonly label: string;
}

export type { SeoRegionCodeKind } from "@seo-platform/contracts/seo-regions";

const ADMINISTRATIVE_REGION_PATTERN =
  /(?:область|край|район|округ|республика|автономная область|автономный округ|федеральный округ)$/iu;

export const yandexRussiaSeoRegions = options(yandexRussiaRegionRows);
export const googleRussiaSeoRegions = options(googleRussiaRegionRows);
export const russianSearchCities = pairedRussianSearchCities();

export function seoRegionOptions(
  kind: SeoRegionCodeKind
): readonly SeoRegionOption[] {
  return kind === "GOOGLE_RANK"
    ? googleRussiaSeoRegions
    : yandexRussiaSeoRegions;
}

/**
 * Provider region codes are stable identifiers, not user-facing labels.
 * Legacy snapshots may omit regionLabel or contain the numeric code in it,
 * so every presentation surface resolves the canonical catalogue label here.
 */
export function seoRegionDisplayName(
  kind: SeoRegionCodeKind,
  regionCode: string | number | null | undefined,
  regionLabel?: string | null
): string {
  const code = normalizedRegionValue(regionCode);
  const resolved = resolveSeoRegionLabel(kind, code, regionLabel);
  if (resolved) return resolved;

  if (code === "ALL" || code === "0") return "Все регионы";
  return "Другой регион";
}

export function searchRegionDisplayName(
  searchEngine: "GOOGLE" | "YANDEX",
  regionCode: string | number | null | undefined,
  regionLabel?: string | null
): string {
  return seoRegionDisplayName(
    searchEngine === "GOOGLE" ? "GOOGLE_RANK" : "YANDEX_RANK",
    regionCode,
    regionLabel
  );
}

/** Replaces a legacy generated `· 213 ·` segment without rewriting custom names. */
export function searchContextDisplayName(
  contextName: string,
  searchEngine: "GOOGLE" | "YANDEX",
  regionCode: string | number | null | undefined,
  regionLabel?: string | null
): string {
  const code = normalizedRegionValue(regionCode);
  if (!code) return contextName;
  const region = searchRegionDisplayName(searchEngine, code, regionLabel);
  return contextName
    .split("·")
    .map((part) => part.trim() === code ? ` ${region} ` : part)
    .join("·")
    .trim();
}

function options(rows: readonly SeoRegionRow[]): readonly SeoRegionOption[] {
  return rows.map(([code, label]) => ({ code, label }));
}

function normalizedRegionValue(
  value: string | number | null | undefined
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string"
      ? value.normalize("NFKC").replace(/\s+/gu, " ").trim()
      : "";
}

function pairedRussianSearchCities(): readonly ProjectSearchCity[] {
  const yandexByName = cityRows(yandexRussiaRegionRows);
  const googleByName = cityRows(googleRussiaRegionRows);
  const cities: ProjectSearchCity[] = [];
  for (const [key, yandexRows] of yandexByName) {
    const googleRows = googleByName.get(key);
    if (!yandexRows?.length || !googleRows?.length) continue;
    // Provider catalogs occasionally keep a legacy code for the same exact
    // locality. The generated lists put the canonical/current row first, so
    // retaining that order keeps the project-level pair deterministic.
    const yandex = yandexRows[0];
    const google = googleRows[0];
    if (!yandex || !google) continue;
    cities.push({
      name: cityName(yandex[1]),
      yandexRegionCode: yandex[0],
      googleRegionCode: google[0]
    });
  }
  return cities.sort((left, right) =>
    left.name.localeCompare(right.name, "ru")
  );
}

function cityRows(
  rows: readonly SeoRegionRow[]
): ReadonlyMap<string, readonly SeoRegionRow[]> {
  const result = new Map<string, SeoRegionRow[]>();
  for (const row of rows) {
    const name = cityName(row[1]);
    if (!name || ADMINISTRATIVE_REGION_PATTERN.test(name)) continue;
    const key = name.toLocaleLowerCase("ru").replaceAll("ё", "е");
    const bucket = result.get(key) ?? [];
    bucket.push(row);
    result.set(key, bucket);
  }
  return result;
}

function cityName(label: string): string {
  return label.split(" · ", 1)[0]?.trim() ?? "";
}

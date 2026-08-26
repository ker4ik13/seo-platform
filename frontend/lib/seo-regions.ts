import {
  googleRussiaRegionRows,
  yandexRussiaRegionRows,
  type SeoRegionRow
} from "./seo-regions.generated.ts";
import type { ProjectSearchCity } from "@seo-platform/contracts";

export interface SeoRegionOption {
  readonly code: string;
  readonly label: string;
}

export type SeoRegionCodeKind = "WORDSTAT" | "YANDEX_RANK" | "GOOGLE_RANK";

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

function options(rows: readonly SeoRegionRow[]): readonly SeoRegionOption[] {
  return rows.map(([code, label]) => ({ code, label }));
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

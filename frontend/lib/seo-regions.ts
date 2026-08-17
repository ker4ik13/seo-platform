import {
  googleRussiaRegionRows,
  yandexRussiaRegionRows,
  type SeoRegionRow
} from "./seo-regions.generated.ts";

export interface SeoRegionOption {
  readonly code: string;
  readonly label: string;
}

export type SeoRegionCodeKind = "WORDSTAT" | "YANDEX_RANK" | "GOOGLE_RANK";

export const yandexRussiaSeoRegions = options(yandexRussiaRegionRows);
export const googleRussiaSeoRegions = options(googleRussiaRegionRows);

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

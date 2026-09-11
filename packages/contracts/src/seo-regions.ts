import {
  googleRussiaRegionRows,
  yandexRussiaRegionRows,
  type SeoRegionRow
} from "./seo-regions.generated.js";

export type SeoRegionCodeKind = "WORDSTAT" | "YANDEX_RANK" | "GOOGLE_RANK";

const yandexRegionLabels = new Map<string, string>(yandexRussiaRegionRows);
const googleRegionLabels = new Map<string, string>(googleRussiaRegionRows);

export {
  googleRussiaRegionRows,
  yandexRussiaRegionRows,
  type SeoRegionRow
};

/**
 * Resolves provider geography metadata without ever returning a bare numeric
 * identifier as a label. Callers own the localized fallback for unknown IDs.
 */
export function resolveSeoRegionLabel(
  kind: SeoRegionCodeKind,
  regionCode: string | number | null | undefined,
  regionLabel?: string | null
): string | undefined {
  const code = normalizedRegionValue(regionCode);
  const primary = (kind === "GOOGLE_RANK"
    ? googleRegionLabels
    : yandexRegionLabels).get(code);
  if (primary) return primary;

  const explicit = normalizedRegionValue(regionLabel);
  if (explicit && !/^\d+$/u.test(explicit)) {
    return withoutProviderCodeSuffix(explicit, code);
  }

  // The current Yandex and Google catalogues have no intersecting numeric IDs.
  // This recovers legacy imports that lost their search-engine metadata.
  return (kind === "GOOGLE_RANK"
    ? yandexRegionLabels
    : googleRegionLabels).get(code);
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

function withoutProviderCodeSuffix(
  label: string,
  code: string
): string | undefined {
  if (!code) return label;
  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return label
    .replace(new RegExp(`\\s*(?:\\[${escapedCode}\\]|\\(${escapedCode}\\))$`, "u"), "")
    .trim() || undefined;
}

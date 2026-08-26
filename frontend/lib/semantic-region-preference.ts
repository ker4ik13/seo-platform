import {
  russianSearchCities,
  seoRegionOptions,
  type SeoRegionCodeKind,
  type SeoRegionOption
} from "./seo-regions.ts";
import type { ProjectSearchCity } from "@seo-platform/contracts";

export type SemanticRegionPreferenceScope =
  | "FREQUENCY"
  | "POSITIONS"
  | "AI_ANSWERS"
  | "CLUSTERING";

export type SemanticSearchEngine = "YANDEX" | "GOOGLE";

export type SemanticSearchRegions = Readonly<
  Record<SemanticSearchEngine, SeoRegionOption>
>;

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = "seo:last-semantic-region";

const DEFAULT_REGIONS: Readonly<Record<SeoRegionCodeKind, SeoRegionOption>> = {
  WORDSTAT: { code: "225", label: "Россия" },
  YANDEX_RANK: { code: "213", label: "Москва" },
  GOOGLE_RANK: { code: "1011969", label: "Москва" }
};

export function defaultSemanticRegion(
  kind: SeoRegionCodeKind
): SeoRegionOption {
  return DEFAULT_REGIONS[kind];
}

export function defaultSemanticSearchRegions(): SemanticSearchRegions {
  return {
    YANDEX: defaultSemanticRegion("YANDEX_RANK"),
    GOOGLE: defaultSemanticRegion("GOOGLE_RANK")
  };
}

export function readLastSemanticRegion(
  storage: PreferenceStorage,
  projectId: string,
  scope: SemanticRegionPreferenceScope,
  kind: SeoRegionCodeKind
): SeoRegionOption {
  return readStoredSemanticRegion(storage, projectId, scope, kind) ??
    defaultSemanticRegion(kind);
}

export function readStoredSemanticRegion(
  storage: PreferenceStorage,
  projectId: string,
  scope: SemanticRegionPreferenceScope,
  kind: SeoRegionCodeKind
): SeoRegionOption | undefined {
  const key = preferenceKey(projectId, scope, kind);
  try {
    const storedCode = storage.getItem(key);
    if (!storedCode) return undefined;
    const option = regionOption(kind, storedCode);
    if (option) return option;
    storage.removeItem(key);
    return undefined;
  } catch {
    return undefined;
  }
}

export function projectSemanticSearchRegions(
  city: ProjectSearchCity | undefined
): SemanticSearchRegions | undefined {
  return city
    ? {
        YANDEX: { code: city.yandexRegionCode, label: city.name },
        GOOGLE: { code: city.googleRegionCode, label: city.name }
      }
    : undefined;
}

export function pairedSemanticSearchRegions(
  kind: Extract<SeoRegionCodeKind, "YANDEX_RANK" | "GOOGLE_RANK">,
  region: SeoRegionOption
): SemanticSearchRegions | undefined {
  const city = russianSearchCities.find((candidate) =>
    kind === "YANDEX_RANK"
      ? candidate.yandexRegionCode === region.code
      : candidate.googleRegionCode === region.code
  );
  return projectSemanticSearchRegions(city);
}

export function readLastSemanticSearchRegions(
  storage: PreferenceStorage,
  projectId: string,
  scope: Exclude<SemanticRegionPreferenceScope, "FREQUENCY">
): SemanticSearchRegions {
  return {
    YANDEX: readLastSemanticRegion(
      storage,
      projectId,
      scope,
      "YANDEX_RANK"
    ),
    GOOGLE: readLastSemanticRegion(
      storage,
      projectId,
      scope,
      "GOOGLE_RANK"
    )
  };
}

export function writeLastSemanticRegion(
  storage: PreferenceStorage,
  projectId: string,
  scope: SemanticRegionPreferenceScope,
  kind: SeoRegionCodeKind,
  regionCode: string
): void {
  if (!regionOption(kind, regionCode)) return;
  try {
    storage.setItem(preferenceKey(projectId, scope, kind), regionCode);
  } catch {
    // Browser storage is progressive enhancement and never blocks a paid run.
  }
}

export function searchRegionKind(
  searchEngine: SemanticSearchEngine
): Extract<SeoRegionCodeKind, "YANDEX_RANK" | "GOOGLE_RANK"> {
  return searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK";
}

function regionOption(
  kind: SeoRegionCodeKind,
  code: string
): SeoRegionOption | undefined {
  if (kind === "WORDSTAT" && code === "ALL") {
    return { code, label: "Без ограничения" };
  }
  return seoRegionOptions(kind).find((option) => option.code === code);
}

function preferenceKey(
  projectId: string,
  scope: SemanticRegionPreferenceScope,
  kind: SeoRegionCodeKind
): string {
  return `${STORAGE_PREFIX}:${scope}:${projectId}:${kind}`;
}

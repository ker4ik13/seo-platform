import {
  rankSearchSourceFromProviderMappingVersion,
  type RankSearchSource,
  type SemanticKeywordListSiteResult
} from "@seo-platform/contracts";

export interface StoredRankSerpProjection {
  readonly position: number;
  readonly rankingUrl: string;
  readonly normalizedRankingUrl: string;
  readonly faviconUrl?: string | null;
  readonly title?: string | null;
  readonly snippet?: string | null;
}

export function projectSiteResults(
  results: readonly StoredRankSerpProjection[],
  projectDomain: string
): readonly SemanticKeywordListSiteResult[] {
  const seen = new Set<string>();
  return results.flatMap((result) => {
    if (
      !projectUrlBelongsToDomain(result.rankingUrl, projectDomain) ||
      seen.has(result.normalizedRankingUrl)
    ) {
      return [];
    }
    seen.add(result.normalizedRankingUrl);
    return [{
      position: result.position,
      rankingUrl: result.rankingUrl,
      ...(result.faviconUrl === null || result.faviconUrl === undefined
        ? {}
        : { faviconUrl: result.faviconUrl }),
      ...(result.title === null || result.title === undefined
        ? {}
        : { title: result.title }),
      ...(result.snippet === null || result.snippet === undefined
        ? {}
        : { snippet: result.snippet })
    }];
  });
}

export function rankHistorySearchSource(
  value: unknown,
  searchEngine: "GOOGLE" | "YANDEX"
): RankSearchSource | undefined {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    !("providerMappingVersion" in value) ||
    typeof value.providerMappingVersion !== "string"
  ) return undefined;
  return rankSearchSourceFromProviderMappingVersion(
    searchEngine,
    value.providerMappingVersion
  );
}

export function projectUrlBelongsToDomain(
  value: string,
  projectDomain: string
): boolean {
  try {
    const host = normalizedProjectHost(new URL(value).hostname);
    const projectHost = normalizedProjectHost(
      new URL(
        projectDomain.includes("://")
          ? projectDomain
          : `https://${projectDomain}`
      ).hostname
    );
    return host === projectHost || host.endsWith(`.${projectHost}`);
  } catch {
    return false;
  }
}

function normalizedProjectHost(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\.$/u, "")
    .replace(/^www\./u, "");
}

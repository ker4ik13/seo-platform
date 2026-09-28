import type {
  SemanticKeywordPositionHistoryProvider
} from "@seo-platform/contracts";

export type SemanticRankEngine = "YANDEX" | "GOOGLE";

export type SemanticRankChangeTone =
  | "declined"
  | "improved"
  | "new"
  | "unchanged";

export interface SemanticRankChangePresentation {
  readonly ariaLabel: string;
  readonly label: string;
  readonly title: string;
  readonly tone: SemanticRankChangeTone;
}

export type SemanticRankingUrlMatch = "MATCH" | "MISMATCH" | "NO_TARGET";

export interface SemanticRankContextPoint {
  readonly trackingContextId: string;
  readonly searchEngine: SemanticRankEngine;
  readonly observedAt: string;
}

export interface SemanticRankHistoryPoint extends SemanticRankContextPoint {
  readonly snapshotId: string;
}

export const semanticRankHistoryPointLimit = 14 as const;

export interface SemanticRankEngineHistorySeries<
  T extends SemanticRankHistoryPoint
> {
  readonly searchEngine: SemanticRankEngine;
  readonly points: readonly T[];
}

/**
 * Keyword history belongs to the canonical keyword, not to one technical
 * tracking context. A manual run may create a new context, so the inspector
 * must take the latest immutable snapshots before it groups them for display.
 */
export function latestSemanticRankHistory<
  T extends SemanticRankHistoryPoint
>(values: readonly T[]): readonly T[] {
  return [...values]
    .sort((left, right) =>
      timestamp(right.observedAt) - timestamp(left.observedAt) ||
      right.snapshotId.localeCompare(left.snapshotId)
    )
    .slice(0, semanticRankHistoryPointLimit);
}

export function semanticRankHistoryByEngine<
  T extends SemanticRankHistoryPoint
>(values: readonly T[]): readonly SemanticRankEngineHistorySeries<T>[] {
  const byEngine = new Map<SemanticRankEngine, T[]>();
  for (const point of [...values].sort((left, right) =>
    timestamp(left.observedAt) - timestamp(right.observedAt) ||
    left.snapshotId.localeCompare(right.snapshotId)
  )) {
    const points = byEngine.get(point.searchEngine) ?? [];
    points.push(point);
    byEngine.set(point.searchEngine, points);
  }
  return (["YANDEX", "GOOGLE"] as const).flatMap((searchEngine) => {
    const points = byEngine.get(searchEngine);
    return points ? [{ searchEngine, points }] : [];
  });
}

/**
 * The inspector is an engine-level summary. When several technical tracking
 * contexts exist for one engine, use the context updated most recently and
 * keep the choice deterministic for equal timestamps.
 */
export function primaryRankContextIds<T extends SemanticRankContextPoint>(
  values: readonly T[]
): ReadonlyMap<SemanticRankEngine, string> {
  const contexts = new Map<string, {
    readonly id: string;
    readonly engine: SemanticRankEngine;
    count: number;
    latestAt: number;
  }>();

  for (const value of values) {
    const key = `${value.searchEngine}:${value.trackingContextId}`;
    const observedAt = Date.parse(value.observedAt);
    const current = contexts.get(key);
    if (current) {
      current.count += 1;
      current.latestAt = Math.max(
        current.latestAt,
        Number.isFinite(observedAt) ? observedAt : Number.NEGATIVE_INFINITY
      );
      continue;
    }
    contexts.set(key, {
      id: value.trackingContextId,
      engine: value.searchEngine,
      count: 1,
      latestAt: Number.isFinite(observedAt)
        ? observedAt
        : Number.NEGATIVE_INFINITY
    });
  }

  const selected = new Map<SemanticRankEngine, string>();
  for (const engine of ["YANDEX", "GOOGLE"] as const) {
    const candidate = [...contexts.values()]
      .filter(({ engine: contextEngine }) => contextEngine === engine)
      .sort((left, right) =>
        right.latestAt - left.latestAt ||
        right.count - left.count ||
        left.id.localeCompare(right.id)
      )[0];
    if (candidate) selected.set(engine, candidate.id);
  }
  return selected;
}

export function rankEngineLabel(engine: SemanticRankEngine): string {
  return engine === "YANDEX" ? "Яндекс" : "Google";
}

export function sameSemanticRankingUrl(
  targetUrl: string,
  rankingUrl: string
): boolean {
  try {
    return normalizedSemanticPageUrl(targetUrl) ===
      normalizedSemanticPageUrl(rankingUrl);
  } catch {
    return targetUrl.trim() === rankingUrl.trim();
  }
}

export function semanticRankingUrlMatch(
  targetUrl: string | undefined,
  rankingUrl: string
): SemanticRankingUrlMatch {
  if (!targetUrl?.trim()) return "NO_TARGET";
  return sameSemanticRankingUrl(targetUrl, rankingUrl) ? "MATCH" : "MISMATCH";
}

export function hasSemanticAiAnswerSnapshot(
  snapshots: readonly Readonly<{ observedAt: string }>[] | undefined
): boolean {
  return (snapshots?.length ?? 0) > 0;
}

/**
 * Accept a full URL, a host without protocol, or a path relative to the
 * project. The API still receives one canonical absolute HTTP(S) URL.
 */
export function normalizeSemanticTargetUrlInput(
  value: string,
  projectDomain: string
): string | undefined {
  const source = value.normalize("NFKC").trim();
  if (
    source.length === 0 ||
    source.length > 2_048 ||
    [...source].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return undefined;
  }

  const projectOrigin = semanticProjectOrigin(projectDomain);
  let candidate = source;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else {
    const scheme = candidate.match(/^([a-z][a-z0-9+.-]*):/iu)?.[1];
    if (scheme) {
      if (
        !["http", "https"].includes(scheme.toLocaleLowerCase("en")) ||
        !/^https?:\/\//iu.test(candidate)
      ) {
        return undefined;
      }
    } else {
      const withoutLeadingSlash = candidate.replace(/^\/+/u, "");
      const firstSegment = withoutLeadingSlash.split(/[/?#]/u)[0] ?? "";
      const startsWithSlash = candidate.startsWith("/");
      const explicitHost = startsWithSlash
        ? projectOrigin !== undefined &&
          normalizedSemanticHost(firstSegment) ===
            normalizedSemanticHost(new URL(projectOrigin).host)
        : looksLikeHttpHost(firstSegment);

      if (explicitHost) {
        candidate = `https://${withoutLeadingSlash}`;
      } else if (projectOrigin) {
        candidate = new URL(
          startsWithSlash ? candidate : `/${candidate}`,
          projectOrigin
        ).toString();
      } else {
        return undefined;
      }
    }
  }

  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return undefined;
    }
    const normalized = url.toString();
    return normalized.length <= 2_048 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export function semanticUrlBelongsToProject(
  value: string,
  projectDomain: string
): boolean {
  try {
    const host = normalizedSemanticHost(new URL(value).hostname);
    const projectHost = normalizedSemanticHost(
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

/** Keep the real href intact while hiding the transport protocol in SERP UI. */
export function semanticDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value.replace(/^https?:\/\//iu, "");
  }
}

/**
 * SERP providers do not consistently return favicon metadata. Prefer the
 * result site's conventional root icon and retain a provider URL only as a
 * fallback when it is present.
 */
export function semanticSiteFaviconSources(
  pageUrl: string,
  providerFaviconUrl?: string
): readonly string[] {
  const candidates = [
    rootFaviconUrl(pageUrl),
    safeHttpUrl(providerFaviconUrl)
  ].filter((value): value is string => value !== undefined);
  return [...new Set(candidates)];
}

export function rankHistoryProviderLabel(
  provider: SemanticKeywordPositionHistoryProvider
): string {
  if (provider === "KEY_COLLECTOR") return "Key Collector · импорт";
  if (provider === "MANUAL_IMPORT") return "Ручной импорт";
  return provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools";
}

function normalizedSemanticPageUrl(value: string): string {
  const url = new URL(value);
  const path = decodeURIComponent(url.pathname)
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "") || "/";
  return `${normalizedSemanticHost(url.hostname)}${path}`
    .toLocaleLowerCase("en");
}

function normalizedSemanticHost(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\.$/u, "")
    .replace(/^www\./u, "");
}

function semanticProjectOrigin(value: string): string | undefined {
  try {
    const source = value.normalize("NFKC").trim();
    const url = new URL(
      /^https?:\/\//iu.test(source) ? source : `https://${source}`
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function looksLikeHttpHost(value: string): boolean {
  return (
    value === "localhost" ||
    value.includes(".") ||
    /^\[[0-9a-f:]+\](?::\d{1,5})?$/iu.test(value) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/u.test(value)
  );
}

function rootFaviconUrl(value: string): string | undefined {
  const page = safeHttpUrl(value);
  if (!page) return undefined;
  return new URL("/favicon.ico", page).toString();
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function rankChangePresentation(
  position: number,
  previousPosition: number | undefined
): SemanticRankChangePresentation {
  if (previousPosition === undefined) {
    return {
      ariaLabel: `Текущая позиция ${position}. Новая позиция`,
      label: "Новая",
      title: "Предыдущего замера с найденной позицией нет",
      tone: "new"
    };
  }
  const delta = previousPosition - position;
  if (delta > 0) {
    return {
      ariaLabel: `Текущая позиция ${position}. Рост на ${delta}. Было ${previousPosition}`,
      label: `▲${delta}`,
      title: `Было ${previousPosition} · рост на ${delta}`,
      tone: "improved"
    };
  }
  if (delta < 0) {
    return {
      ariaLabel: `Текущая позиция ${position}. Снижение на ${Math.abs(delta)}. Было ${previousPosition}`,
      label: `▼${Math.abs(delta)}`,
      title: `Было ${previousPosition} · снижение на ${Math.abs(delta)}`,
      tone: "declined"
    };
  }
  return {
    ariaLabel: `Текущая позиция ${position}. Без изменений`,
    label: "—",
    title: `Без изменений · было ${previousPosition}`,
    tone: "unchanged"
  };
}

export function rankSearchSystemLabel(
  engine: SemanticRankEngine,
  searchSource: "LIVE" | "SEARCH_API" | undefined,
  provider?: SemanticKeywordPositionHistoryProvider
): string {
  if (engine === "GOOGLE") {
    return searchSource === "LIVE"
      ? provider === "XMLSTOCK" ? "Google XML" : "Google Live"
      : "Google";
  }
  if (searchSource === "LIVE") return "Яндекс Live";
  if (searchSource === "SEARCH_API") return "Яндекс XML";
  return "Яндекс";
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

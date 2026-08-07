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

export interface SemanticRankContextPoint {
  readonly trackingContextId: string;
  readonly searchEngine: SemanticRankEngine;
  readonly observedAt: string;
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

export function rankHistoryProviderLabel(
  provider: SemanticKeywordPositionHistoryProvider
): string {
  if (provider === "KEY_COLLECTOR") return "Key Collector · импорт";
  return provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools";
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
  searchSource: "LIVE" | "SEARCH_API" | undefined
): string {
  if (engine === "GOOGLE") {
    return searchSource === "LIVE" ? "Google Live" : "Google";
  }
  if (searchSource === "LIVE") return "Яндекс Live";
  if (searchSource === "SEARCH_API") return "Яндекс XML";
  return "Яндекс";
}

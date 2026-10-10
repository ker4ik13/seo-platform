import {
  analyticsLatencyBuckets,
  type AnalyticsEventKind,
  type AnalyticsSection,
} from "@seo-platform/contracts";

export const analyticsBrowserEvent = "seo:product-metric";
export interface BrowserAnalyticsMetric {
  readonly section: AnalyticsSection;
  readonly kind: AnalyticsEventKind;
  readonly value: number;
}
export function analyticsSection(path: string): AnalyticsSection {
  if (/\/analytics\//u.test(path)) return "OTHER";
  if (/billing|operation-estimates/u.test(path)) return "BILLING";
  if (/imports|uploads/u.test(path)) return "IMPORT";
  if (/exports/u.test(path)) return "EXPORT";
  if (/seasonality|frequenc|wordstat|keyword-research/u.test(path))
    return "WORDSTAT";
  if (/ai-answer|ai-serp/u.test(path)) return "AI";
  if (/cluster/u.test(path)) return "CLUSTERING";
  if (/crawl|http-status/u.test(path)) return "CRAWL";
  if (/serp|competitor/u.test(path)) return "SERP";
  if (/rank|tracking-context/u.test(path)) return "RANKINGS";
  if (/members|invites|team/u.test(path)) return "TEAM";
  if (/settings|preferences|integration/u.test(path)) return "SETTINGS";
  if (/semantic|keywords|keyword-groups/u.test(path)) return "SEMANTICS";
  if (path === "/app" || /dashboard|overview/u.test(path)) return "DASHBOARD";
  return "OTHER";
}
const seenResults = new Map<string, number>();
export function isAnalyticsCommand(
  path: string,
  method: string,
  isRead: boolean,
): boolean {
  if (
    method === "GET" ||
    isRead ||
    /preferences|saved-views|presence|activity|push-subscriptions|realtime|operation-estimates|bulk-preview|\/list(?:\?|$)/u.test(
      path,
    )
  )
    return false;
  return (
    /\/projects\/[^/]+\/(?:keywords|keyword-groups|imports|uploads|exports|rank-runs|rank-checks|frequency-collections|keyword-research|ai-answer|clustering|technical-crawls|crawl|tracking-contexts|notes|pages)/u.test(
      path,
    ) || /\/workspaces\/[^/]+\/(?:projects|members|invites|billing)/u.test(path)
  );
}
export function hasAnalyticsResult(path: string, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const data = (payload as { data?: unknown }).data;
  if (/\/insights(?:\?|$)/u.test(path))
    return Boolean(
      data &&
        typeof data === "object" &&
        [
          "positions",
          "positionHistory",
          "frequencies",
          "seasonality",
          "competitorSnapshots",
          "aiPositionHistory",
          "aiCompetitorSnapshots",
        ].some(
          (key) =>
            Array.isArray((data as Record<string, unknown>)[key]) &&
            ((data as Record<string, unknown>)[key] as unknown[]).length > 0,
        ),
    );
  if (/\/rank-history(?:\?|$)/u.test(path))
    return Array.isArray(data) && data.length > 0;
  if (/\/position-history(?:\?|$)/u.test(path))
    return Boolean(
      data &&
        typeof data === "object" &&
        Array.isArray((data as { points?: unknown }).points) &&
        (data as { points: unknown[] }).points.length > 0,
    );
  return /\/result(?:\?|$)/u.test(path) && data !== undefined && data !== null;
}
export function recordAnalyticsRequest(
  path: string,
  method: string,
  duration: number,
  status: number,
  isRead: boolean,
  resultAvailable = false,
): void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof document.hasFocus !== "function" ||
    path.includes("/analytics/") ||
    document.hidden ||
    !document.hasFocus()
  )
    return;
  const section = analyticsSection(path),
    value = Math.max(0, Math.min(60_000, Math.round(duration)));
  const emit = (kind: AnalyticsEventKind, value = 0) =>
    window.dispatchEvent(
      new CustomEvent<BrowserAnalyticsMetric>(analyticsBrowserEvent, {
        detail: { section, kind, value },
      }),
    );
  emit("API_TIMING", value);
  if (status >= 400 || status === 0) emit("API_ERROR");
  if (status >= 200 && status < 300 && isAnalyticsCommand(path, method, isRead))
    emit("ACTION");
  if (resultAvailable && status >= 200 && status < 300 && method === "GET") {
    const identity = path.split("?", 1)[0]!;
    const now = Date.now();
    if (now - (seenResults.get(identity) ?? 0) >= 300_000) {
      if (seenResults.size >= 256)
        seenResults.delete(seenResults.keys().next().value!);
      seenResults.set(identity, now);
      emit("RESULT_VIEW");
    }
  }
}
export function analyticsLatencyBin(duration: number): number {
  const index = analyticsLatencyBuckets.findIndex((bound) => duration <= bound);
  return index < 0 ? analyticsLatencyBuckets.length : index;
}
export function isAnalyticsEngaged(
  visible: boolean,
  focused: boolean,
  lastInputAt: number,
  now: number,
): boolean {
  return (
    visible && focused && now >= lastInputAt && now - lastInputAt < 120_000
  );
}

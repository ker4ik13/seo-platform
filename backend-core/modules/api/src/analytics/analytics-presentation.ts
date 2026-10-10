import {
  analyticsLatencyBuckets,
  type AnalyticsActivityBatch,
  type AnalyticsActivityTotals,
  type AnalyticsInterval,
} from "@seo-platform/contracts";

export const emptyAnalyticsTotals = (): AnalyticsActivityTotals => ({
  users: 0,
  workspaces: 0,
  projects: 0,
  seconds: 0,
  views: 0,
  actions: 0,
  results: 0,
  sessions: 0,
  errors: 0,
});
export function analyticsNumber(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error("Invalid analytics aggregate");
  return number;
}
export function analyticsTotals(
  row?: Record<string, unknown>,
): AnalyticsActivityTotals {
  return Object.fromEntries(
    Object.keys(emptyAnalyticsTotals()).map((key) => [
      key,
      analyticsNumber(row?.[key]),
    ]),
  ) as unknown as AnalyticsActivityTotals;
}
export function analyticsHistogramP95(
  histogram: readonly number[],
): number | null {
  const count = histogram.reduce((sum, item) => sum + item, 0);
  if (count === 0) return null;
  const threshold = Math.ceil(count * 0.95);
  let sum = 0;
  for (let index = 0; index < histogram.length; index++) {
    sum += histogram[index] ?? 0;
    if (sum >= threshold) return analyticsLatencyBuckets[index] ?? 60_000;
  }
  return null;
}
export function analyticsPeriod(days: 7 | 30 | 90, now = new Date()) {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return {
    today: new Date(today),
    before: new Date(today + 86_400_000),
    from: new Date(today - (days - 1) * 86_400_000),
    previousFrom: new Date(today - (2 * days - 1) * 86_400_000),
  };
}
export function analyticsMasks(
  interval: AnalyticsInterval,
  batch: AnalyticsActivityBatch,
) {
  const masks = new Map<number, bigint>();
  // Completed seconds only: no rounded-up time, and overlap across tabs is a union.
  const start = Math.ceil(Date.parse(interval.startedAt) / 1000);
  const end = Math.floor(
    (Date.parse(interval.startedAt) + interval.durationMs) / 1000,
  );
  for (let second = start; second < end; second++) {
    const minute = Math.floor(second / 60) * 60_000;
    masks.set(minute, (masks.get(minute) ?? 0n) | (1n << BigInt(second % 60)));
  }
  return {
    id: interval.id,
    occurredAt: interval.startedAt,
    endedAt: new Date(
      Date.parse(interval.startedAt) + interval.durationMs,
    ).toISOString(),
    masks: [...masks].flatMap(([minute, mask]) => [
      {
        minuteAt: new Date(minute).toISOString(),
        scopeKey: "all",
        section: "ALL",
        mask: mask.toString(),
      },
      {
        minuteAt: new Date(minute).toISOString(),
        scopeKey: `${interval.section}:${batch.workspaceId ?? ""}:${batch.projectId ?? ""}`,
        section: interval.section,
        mask: mask.toString(),
      },
    ]),
  };
}

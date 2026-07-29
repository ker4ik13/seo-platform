import type { RankCheckFinalStatus } from "../api/rank-runs.js";

export type RankCheckCompletedStatus = Extract<
  RankCheckFinalStatus,
  "COMPLETED" | "PARTIALLY_COMPLETED"
>;

/**
 * Exact redacted data for seo.rank-check.completed.v1. The event deliberately
 * excludes keyword text/IDs, URLs, credential/binding IDs, provider request
 * IDs, raw data and failure details.
 */
export interface RankCheckCompletedEventDataV1 {
  readonly jobId: string;
  readonly manifestId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly status: RankCheckCompletedStatus;
  readonly pairCount: string;
  readonly persistedCount: string;
  readonly foundCount: string;
  readonly notFoundCount: string;
  readonly completedAt: string;
}

export function rankCheckCompletedEventDataV1(input: {
  readonly jobId: string;
  readonly manifestId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly status: RankCheckCompletedStatus;
  readonly pairCount: string;
  readonly persistedCount: string;
  readonly foundCount: string;
  readonly notFoundCount: string;
  readonly completedAt: Date;
}): RankCheckCompletedEventDataV1 {
  assertRankCheckCompletedCounts(input);

  return {
    jobId: input.jobId,
    manifestId: input.manifestId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    trackingContextId: input.trackingContextId,
    configurationVersion: input.configurationVersion,
    status: input.status,
    pairCount: input.pairCount,
    persistedCount: input.persistedCount,
    foundCount: input.foundCount,
    notFoundCount: input.notFoundCount,
    completedAt: input.completedAt.toISOString()
  };
}

function assertRankCheckCompletedCounts(input: {
  readonly status: RankCheckCompletedStatus;
  readonly pairCount: string;
  readonly persistedCount: string;
  readonly foundCount: string;
  readonly notFoundCount: string;
}): void {
  if (
    input.status !== "COMPLETED" &&
    input.status !== "PARTIALLY_COMPLETED"
  ) {
    throw new TypeError("Invalid rank check completion status");
  }

  const pairCount = parseCount(input.pairCount);
  const persistedCount = parseCount(input.persistedCount);
  const foundCount = parseCount(input.foundCount);
  const notFoundCount = parseCount(input.notFoundCount);

  if (
    pairCount === 0n ||
    persistedCount !== foundCount + notFoundCount ||
    persistedCount > pairCount ||
    (input.status === "COMPLETED" && persistedCount !== pairCount) ||
    (input.status === "PARTIALLY_COMPLETED" &&
      (persistedCount === 0n || persistedCount >= pairCount))
  ) {
    throw new TypeError("Invalid rank check completion counts");
  }
}

function parseCount(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError("Invalid rank check completion counts");
  }

  return BigInt(value);
}

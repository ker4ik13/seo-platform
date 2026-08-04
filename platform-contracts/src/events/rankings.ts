import type {
  InternalRankCheckFinalizationReceipt,
  RankCheckFinalStatus
} from "../api/rank-runs.js";
import { rankProviderKeywordLimit } from "../api/rank-estimates.js";

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
  assertUuidV7(input.jobId);
  assertUuidV7(input.manifestId);
  assertUuidV7(input.workspaceId);
  assertUuidV7(input.projectId);
  assertUuidV7(input.trackingContextId);
  if (
    !Number.isSafeInteger(input.configurationVersion) ||
    input.configurationVersion < 1 ||
    !(input.completedAt instanceof Date) ||
    Number.isNaN(input.completedAt.getTime())
  ) {
    throw new TypeError("Invalid rank check completion event");
  }
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

/**
 * Derives the redacted event payload from the immutable SEO Data finalize
 * receipt. Non-completion terminal states never produce this event.
 */
export function rankCheckCompletedEventDataFromFinalizationReceiptV1(
  receipt: InternalRankCheckFinalizationReceipt
): RankCheckCompletedEventDataV1 {
  const pairCount = parseCount(receipt.pairCount);
  const persistedCount = parseCount(receipt.persistedCount);
  const missingCount = parseCount(receipt.missingCount);
  if (
    receipt.schemaVersion !== "rank-finalize@1" ||
    (receipt.status !== "COMPLETED" &&
    receipt.status !== "PARTIALLY_COMPLETED") ||
    missingCount !== pairCount - persistedCount ||
    !isCanonicalIsoInstant(receipt.finalizedAt) ||
    typeof receipt.requestHash !== "object" ||
    receipt.requestHash === null ||
    receipt.requestHash.algorithm !== "SHA_256" ||
    typeof receipt.requestHash.value !== "string" ||
    !/^[0-9a-f]{64}$/u.test(receipt.requestHash.value)
  ) {
    throw new TypeError("Invalid rank check completion receipt");
  }

  return rankCheckCompletedEventDataV1({
    jobId: receipt.jobId,
    manifestId: receipt.manifestId,
    workspaceId: receipt.workspaceId,
    projectId: receipt.projectId,
    trackingContextId: receipt.trackingContextId,
    configurationVersion: receipt.configurationVersion,
    status: receipt.status,
    pairCount: receipt.pairCount,
    persistedCount: receipt.persistedCount,
    foundCount: receipt.foundCount,
    notFoundCount: receipt.notFoundCount,
    completedAt: new Date(receipt.finalizedAt)
  });
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
  const maximumPairCount = BigInt(rankProviderKeywordLimit);

  if (
    pairCount === 0n ||
    pairCount > maximumPairCount ||
    persistedCount > maximumPairCount ||
    foundCount > maximumPairCount ||
    notFoundCount > maximumPairCount ||
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
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 5 ||
    !/^(0|[1-9]\d*)$/u.test(value)
  ) {
    throw new TypeError("Invalid rank check completion counts");
  }

  return BigInt(value);
}

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assertUuidV7(value: string): void {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new TypeError("Invalid rank check completion event");
  }
}

function isCanonicalIsoInstant(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length === 24 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

import type { SemanticRankDimensionMetadata } from "./rank-dimensions.js";
import type { JobCapacityEntitlement } from "./billing.js";
import type { SemanticKeywordBulkSelection } from "./keywords.js";
import type {
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope
} from "./integrations.js";
import type {
  RankEstimateProvider,
  RankSearchSource
} from "./rank-estimates.js";
import type {
  SemanticAiAnswerCompetitorSnapshot,
  SemanticAiAnswerHistoryItem
} from "./ai-answer-collections.js";

export const frequencyCollectionProviders = ["XMLSTOCK", "ARSENKIN"] as const;
export type FrequencyCollectionProvider =
  (typeof frequencyCollectionProviders)[number];

/** Platform selection boundary; workers split independent keywords into provider batches. */
export const frequencyCollectionKeywordLimit = 300_000 as const;
/** Physical Arsenkin batch limit, independent of the complete operation size. */
export const arsenkinWordstatKeywordLimit = 10_000 as const;

/** XMLStock has no 200-keyword command limit; execution stays one keyword per call. */
export const xmlStockWordstatKeywordLimit = 10_000 as const;

/** Bounded internal transport chunks; these are not provider task limits. */
export const internalFrequencyResolveBatchLimit = 1_000 as const;
export const internalFrequencyPersistBatchLimit = 500 as const;
export const internalFrequencySeasonalityPersistBatchLimit = 100 as const;

export const semanticFrequencyTypes = ["BASE", "EXACT", "FIXED"] as const;
export type SemanticFrequencyType = (typeof semanticFrequencyTypes)[number];
/** Live XMLStock history returns one base series; quoted phrases are ignored and `!` is rejected. */
export const semanticSeasonalityFrequencyTypes = ["BASE"] as const;

export const frequencyCollectionModes = ["FREQUENCY", "SEASONALITY"] as const;
export type FrequencyCollectionMode = (typeof frequencyCollectionModes)[number];

export const frequencySeasonalityGranularities = ["MONTH", "WEEK", "DAY"] as const;
export type FrequencySeasonalityGranularity =
  (typeof frequencySeasonalityGranularities)[number];
export const frequencySeasonalitySeriesPointLimit = 240 as const;
export const frequencySeasonalityPointLimit = 720 as const;

export interface FrequencySeasonalityRequest {
  readonly granularity: FrequencySeasonalityGranularity;
  /** Inclusive canonical UTC calendar date. */
  readonly observedFrom: string;
  /** Inclusive canonical UTC calendar date. */
  readonly observedThrough: string;
}

export function parseFrequencySeasonalityRequest(
  value: unknown
): FrequencySeasonalityRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid frequency seasonality request");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some((key) =>
      key !== "granularity" &&
      key !== "observedFrom" &&
      key !== "observedThrough"
    ) ||
    !frequencySeasonalityGranularities.includes(
      input.granularity as FrequencySeasonalityGranularity
    ) ||
    typeof input.observedFrom !== "string" ||
    typeof input.observedThrough !== "string" ||
    !canonicalCalendarDate(input.observedFrom) ||
    !canonicalCalendarDate(input.observedThrough)
  ) {
    throw new TypeError("Invalid frequency seasonality request");
  }
  const from = new Date(`${input.observedFrom}T00:00:00.000Z`);
  const through = new Date(`${input.observedThrough}T00:00:00.000Z`);
  const days = Math.round((through.getTime() - from.getTime()) / 86_400_000) + 1;
  const granularity = input.granularity as FrequencySeasonalityGranularity;
  if (
    !Number.isSafeInteger(days) ||
    days < 3 ||
    (granularity === "DAY" && days > 60) ||
    (granularity === "WEEK" &&
      (days < 21 || days > 2 * 366 || from.getUTCDay() !== 1 || through.getUTCDay() !== 0)) ||
    (granularity === "MONTH" &&
      (days > 12 * 366 ||
        from.getUTCDate() !== 1 ||
        new Date(Date.UTC(
          through.getUTCFullYear(),
          through.getUTCMonth() + 1,
          0
        )).getUTCDate() !== through.getUTCDate() ||
        monthSpan(from, through) < 3))
  ) {
    throw new TypeError("Invalid frequency seasonality request");
  }
  return {
    granularity,
    observedFrom: input.observedFrom,
    observedThrough: input.observedThrough
  };
}

function canonicalCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthSpan(from: Date, through: Date): number {
  return (
    (through.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    through.getUTCMonth() -
    from.getUTCMonth() +
    1
  );
}

export const semanticFrequencyDevices = [
  "ALL",
  "DESKTOP",
  "MOBILE",
  "PHONE_ONLY",
  "TABLET_ONLY"
] as const;
export type SemanticFrequencyDevice =
  (typeof semanticFrequencyDevices)[number];

export const semanticFrequencyQualityFlags = [
  "CONTEXT_INCOMPLETE",
  "STALE",
  "PARTIAL",
  "ESTIMATED"
] as const;
export type SemanticFrequencyQualityFlag =
  (typeof semanticFrequencyQualityFlags)[number];

export const frequencyCollectionStatuses = [
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRY_SCHEDULED",
  "ACTION_REQUIRED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL"
] as const;
export type FrequencyCollectionStatus =
  (typeof frequencyCollectionStatuses)[number];

export interface CreateFrequencyCollectionInput {
  readonly items: readonly SemanticKeywordBulkSelection[];
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  /** Missing legacy values mean an ordinary frequency collection. */
  readonly mode?: FrequencyCollectionMode;
  readonly seasonality?: FrequencySeasonalityRequest;
}

export interface InternalCreateFrequencyCollectionInput
  extends CreateFrequencyCollectionInput {
  readonly billing?: import("./paid-operations.js").InternalPaidOperationAdmission;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface InternalCancelFrequencyCollectionInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalRetryFrequencyCollectionInput
  extends InternalCancelFrequencyCollectionInput {
  readonly version: number;
}

export interface FrequencyCollectionSummary {
  readonly credentialMode?: "BYOK_API_KEY" | "PLATFORM_PAID";
  readonly requiresUsageReview?: boolean;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId?: string;
  readonly provider: FrequencyCollectionProvider;
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
  readonly status: FrequencyCollectionStatus;
  readonly stage?: string;
  readonly selectedKeywords: number;
  readonly completedKeywords: number;
  readonly failedKeywords: number;
  readonly mode: FrequencyCollectionMode;
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly seasonality?: FrequencySeasonalityRequest;
  readonly retryAt?: string;
  readonly failureCode?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface FrequencySnapshotSummary {
  readonly type: SemanticFrequencyType;
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly period?: string;
  readonly value?: string;
  readonly provider: string;
  readonly sourceMode: "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL";
  readonly jobId: string;
  readonly qualityFlags: readonly SemanticFrequencyQualityFlag[];
  readonly observedAt: string;
}

export interface FrequencySeasonalityPointSummary {
  readonly type: SemanticFrequencyType;
  readonly granularity: FrequencySeasonalityGranularity;
  readonly periodStart: string;
  readonly value: string;
  readonly share?: string;
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly provider: FrequencyCollectionProvider;
  readonly sourceMode: "BYOK" | "PLATFORM";
  readonly jobId: string;
  readonly observedAt: string;
}

export interface InternalResolveFrequencyKeywordInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly keywordId: string;
  readonly version: number;
}

export interface InternalFrequencyKeyword {
  readonly id: string;
  readonly text: string;
  readonly version: number;
}

export interface InternalResolveFrequencyKeywordsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly items: readonly SemanticKeywordBulkSelection[];
}

export interface InternalFrequencyKeywords {
  readonly items: readonly InternalFrequencyKeyword[];
}

export interface InternalPersistFrequencySnapshotsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly observedAt: string;
  readonly snapshots: readonly InternalFrequencySnapshotValue[];
}

export interface InternalFrequencySnapshotValue {
  readonly type: SemanticFrequencyType;
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly period?: string;
  readonly value: string;
  readonly provider: FrequencyCollectionProvider;
  readonly sourceMode: "BYOK" | "PLATFORM";
  readonly qualityFlags: readonly SemanticFrequencyQualityFlag[];
}

export interface InternalPersistFrequencySnapshotBatchItem {
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly snapshots: readonly InternalFrequencySnapshotValue[];
}

export interface InternalPersistFrequencySnapshotBatchInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly observedAt: string;
  readonly items: readonly InternalPersistFrequencySnapshotBatchItem[];
}

export interface InternalFrequencySeasonalityPoint {
  readonly type: SemanticFrequencyType;
  readonly granularity: FrequencySeasonalityGranularity;
  readonly periodStart: string;
  readonly value: string;
  readonly share?: string;
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly provider: FrequencyCollectionProvider;
  readonly sourceMode: "BYOK" | "PLATFORM";
}

export interface InternalPersistFrequencySeasonalityBatchItem {
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly points: readonly InternalFrequencySeasonalityPoint[];
}

export interface InternalPersistFrequencySeasonalityBatchInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly observedAt: string;
  readonly items: readonly InternalPersistFrequencySeasonalityBatchItem[];
}

export interface SemanticKeywordInsights {
  readonly keywordId: string;
  readonly note?: string;
  readonly frequencies: readonly FrequencySnapshotSummary[];
  readonly seasonality?: readonly FrequencySeasonalityPointSummary[];
  readonly positions: readonly SemanticKeywordPositionSummary[];
  readonly positionHistory: readonly SemanticKeywordPositionHistoryPoint[];
  readonly competitorSnapshots?: readonly SemanticKeywordCompetitorSnapshot[];
  readonly aiPositionHistory?: readonly SemanticAiAnswerHistoryItem[];
  readonly aiCompetitorSnapshots?: readonly SemanticAiAnswerCompetitorSnapshot[];
}

export interface SemanticKeywordCompetitorSnapshot extends SemanticRankDimensionMetadata {
  readonly snapshotId: string;
  readonly trackingContextId: string;
  readonly contextName: string;
  readonly searchEngine: "GOOGLE" | "YANDEX";
  readonly searchSource?: RankSearchSource;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly observedAt: string;
  readonly results: readonly SemanticKeywordCompetitorResult[];
}

export interface SemanticKeywordCompetitorResult {
  readonly position: number;
  readonly url: string;
  readonly faviconUrl?: string;
  readonly title?: string;
  readonly snippet?: string;
}

export interface SemanticKeywordPositionSummary extends SemanticRankDimensionMetadata {
  readonly trackingContextId: string;
  readonly contextName: string;
  readonly searchEngine: "GOOGLE" | "YANDEX";
  readonly device: "DESKTOP" | "MOBILE";
  readonly regionCode: string;
  readonly found: boolean;
  readonly position?: number;
  readonly previousPosition?: number;
  readonly rankingUrl?: string;
  readonly observedAt: string;
}

export type SemanticKeywordPositionHistoryProvider =
  | RankEstimateProvider
  | "KEY_COLLECTOR"
  | "MANUAL_IMPORT";

export interface SemanticKeywordPositionHistoryPoint extends SemanticRankDimensionMetadata {
  readonly snapshotId: string;
  readonly trackingContextId: string;
  readonly contextName: string;
  readonly searchEngine: "GOOGLE" | "YANDEX";
  readonly searchSource?: RankSearchSource;
  readonly device: "DESKTOP" | "MOBILE";
  readonly regionCode: string;
  readonly regionLabel?: string;
  readonly countryCode?: string;
  readonly language?: string;
  readonly depth?: number;
  readonly provider: SemanticKeywordPositionHistoryProvider;
  readonly found: boolean;
  readonly position?: number;
  readonly observedAt: string;
}

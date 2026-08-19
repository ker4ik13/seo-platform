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

/** Platform command boundary; provider-specific calls may use smaller chunks. */
export const arsenkinWordstatKeywordLimit = 10_000 as const;

/** XMLStock has no 200-keyword command limit; execution stays one keyword per call. */
export const xmlStockWordstatKeywordLimit = 10_000 as const;

/** Bounded internal transport chunks; these are not provider task limits. */
export const internalFrequencyResolveBatchLimit = 1_000 as const;
export const internalFrequencyPersistBatchLimit = 500 as const;

export const semanticFrequencyTypes = ["BASE", "EXACT", "FIXED"] as const;
export type SemanticFrequencyType = (typeof semanticFrequencyTypes)[number];

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
}

export interface InternalCreateFrequencyCollectionInput
  extends CreateFrequencyCollectionInput {
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
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: FrequencyCollectionProvider;
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
  readonly status: FrequencyCollectionStatus;
  readonly stage?: string;
  readonly selectedKeywords: number;
  readonly completedKeywords: number;
  readonly failedKeywords: number;
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
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
  readonly sourceMode: "BYOK";
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

export interface SemanticKeywordInsights {
  readonly keywordId: string;
  readonly note?: string;
  readonly frequencies: readonly FrequencySnapshotSummary[];
  readonly positions: readonly SemanticKeywordPositionSummary[];
  readonly positionHistory: readonly SemanticKeywordPositionHistoryPoint[];
  readonly competitorSnapshots?: readonly SemanticKeywordCompetitorSnapshot[];
  readonly aiPositionHistory?: readonly SemanticAiAnswerHistoryItem[];
  readonly aiCompetitorSnapshots?: readonly SemanticAiAnswerCompetitorSnapshot[];
}

export interface SemanticKeywordCompetitorSnapshot {
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

export interface SemanticKeywordPositionSummary {
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
  | "KEY_COLLECTOR";

export interface SemanticKeywordPositionHistoryPoint {
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

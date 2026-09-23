import type { JobCapacityEntitlement } from "./billing.js";
import type { SemanticKeywordBulkSelection } from "./keywords.js";
import type {
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope
} from "./integrations.js";

export const aiAnswerSearchEngines = ["YANDEX", "GOOGLE"] as const;
export type AiAnswerSearchEngine = (typeof aiAnswerSearchEngines)[number];

export const aiAnswerDevices = ["DESKTOP", "MOBILE"] as const;
export type AiAnswerDevice = (typeof aiAnswerDevices)[number];

export const aiAnswerCollectionPurposes = [
  "POSITION_TRACKING",
  "COMPETITOR_SERP"
] as const;
export type AiAnswerCollectionPurpose =
  (typeof aiAnswerCollectionPurposes)[number];

/** Platform selection may contain multiple independent provider tasks. */
export const aiAnswerCollectionKeywordLimit = 300_000 as const;
/** Maximum physical Arsenkin task; do not raise with the platform selection. */
export const arsenkinAiAnswerKeywordLimit = 10_000 as const;
export const internalAiAnswerResolveBatchLimit = 1_000 as const;
export const internalAiAnswerPersistBatchLimit = 25 as const;
export const aiAnswerHistoryMaxPageSize = 200 as const;

export const aiAnswerCollectionStatuses = [
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRY_SCHEDULED",
  "ACTION_REQUIRED",
  "CANCELLED",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL"
] as const;
export type AiAnswerCollectionStatus =
  (typeof aiAnswerCollectionStatuses)[number];

export interface CreateAiAnswerCollectionInput {
  readonly items: readonly SemanticKeywordBulkSelection[];
  readonly credentialId?: string;
  readonly searchEngine: AiAnswerSearchEngine;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly host: string;
  readonly excludeSubdomains: boolean;
  readonly brands: readonly string[];
  /** Omitted by legacy clients and treated as POSITION_TRACKING. */
  readonly purpose?: AiAnswerCollectionPurpose;
  /** Available only for COMPETITOR_SERP. */
  readonly saveProjectPosition?: boolean;
}

export interface InternalCreateAiAnswerCollectionInput
  extends CreateAiAnswerCollectionInput {
  readonly billing?: import("./paid-operations.js").InternalPaidOperationAdmission;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface InternalCancelAiAnswerCollectionInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface AiAnswerCollectionSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId?: string;
  readonly provider: "ARSENKIN";
  readonly purpose?: AiAnswerCollectionPurpose;
  readonly saveProjectPosition?: boolean;
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
  readonly status: AiAnswerCollectionStatus;
  readonly stage?: string;
  readonly selectedKeywords: number;
  readonly completedKeywords: number;
  readonly failedKeywords: number;
  readonly searchEngine: AiAnswerSearchEngine;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly host: string;
  readonly retryAt?: string;
  readonly failureCode?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface InternalAiAnswerKeyword {
  readonly id: string;
  readonly text: string;
  readonly version: number;
}

export interface InternalResolveAiAnswerKeywordsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly items: readonly SemanticKeywordBulkSelection[];
}

export interface InternalAiAnswerKeywords {
  readonly items: readonly InternalAiAnswerKeyword[];
}

export interface InternalAiAnswerSourceValue {
  readonly providerId?: number;
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
}

export interface InternalAiAnswerSnapshotValue {
  readonly answerPresent: boolean;
  readonly siteFound: boolean;
  readonly position?: number;
  readonly rankingUrl?: string;
  readonly brandFound: boolean;
  readonly answerMarkdown?: string;
  readonly sources: readonly InternalAiAnswerSourceValue[];
}

export interface InternalPersistAiAnswerSnapshotBatchItem {
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly positionTrackingEnabled: boolean;
  readonly snapshot: InternalAiAnswerSnapshotValue;
}

export interface InternalPersistAiAnswerSnapshotBatchInput {
  readonly sourceMode?: "BYOK" | "PLATFORM";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly searchEngine: AiAnswerSearchEngine;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly provider: "ARSENKIN";
  readonly host: string;
  readonly observedAt: string;
  readonly items: readonly InternalPersistAiAnswerSnapshotBatchItem[];
}

export interface SemanticAiAnswerSummary {
  readonly searchEngine: AiAnswerSearchEngine;
  readonly answerPresent: boolean;
  readonly siteFound: boolean;
  readonly position?: number;
  /** Previous found position for this canonical keyword in the same city/device slice. */
  readonly previousPosition?: number;
  readonly rankingUrl?: string;
  readonly brandFound: boolean;
  readonly observedAt: string;
}

/** Immutable AI-position point used by the inspector graph and full history. */
export interface SemanticAiAnswerHistoryItem extends SemanticAiAnswerSummary {
  readonly snapshotId: string;
  readonly keywordId: string;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly provider: "ARSENKIN";
  readonly results: readonly SemanticAiAnswerCompetitorResult[];
}

export interface AiAnswerHistoryQuery {
  /** Include saved competitor runs without promoting them to tracked positions. */
  readonly includeCompetitors?: boolean;
  readonly limit: number;
  readonly cursor?: string;
}

export interface InternalAiAnswerHistoryQuery extends AiAnswerHistoryQuery {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly keywordId: string;
}

export interface AiAnswerHistoryCursorPage {
  readonly hasNext: boolean;
  readonly nextCursor?: string;
}

/** Tenant-bound Core SEO response validated and redacted by Platform API. */
export interface InternalAiAnswerHistoryCollection {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly keywordId: string;
  readonly items: readonly SemanticAiAnswerHistoryItem[];
  readonly page: AiAnswerHistoryCursorPage;
}

export interface SemanticAiAnswerSource {
  readonly position: number;
  readonly providerId?: number;
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly belongsToProject: boolean;
}

export interface SemanticAiAnswerDetail extends SemanticAiAnswerSummary {
  readonly snapshotId: string;
  readonly keywordId: string;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly answerMarkdown?: string;
  readonly sources: readonly SemanticAiAnswerSource[];
  readonly provider: "ARSENKIN";
  readonly host: string;
  readonly jobId: string;
}

export interface SemanticAiAnswerCompetitorSnapshot {
  readonly answerPresent?: boolean;
  readonly snapshotId: string;
  readonly searchEngine: AiAnswerSearchEngine;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly provider: "ARSENKIN";
  readonly observedAt: string;
  readonly results: readonly SemanticAiAnswerCompetitorResult[];
}

export interface SemanticAiAnswerCompetitorResult {
  readonly position: number;
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
}

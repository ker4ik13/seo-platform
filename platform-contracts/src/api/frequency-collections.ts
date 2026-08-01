import type { SemanticKeywordBulkSelection } from "./keywords.js";

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
}

export interface InternalCancelFrequencyCollectionInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalRetryFrequencyCollectionInput
  extends InternalCancelFrequencyCollectionInput {}

export interface FrequencyCollectionSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: "XMLSTOCK";
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
  readonly provider: "XMLSTOCK";
  readonly sourceMode: "BYOK";
  readonly qualityFlags: readonly SemanticFrequencyQualityFlag[];
}

export interface SemanticKeywordInsights {
  readonly keywordId: string;
  readonly frequencies: readonly FrequencySnapshotSummary[];
  readonly positions: readonly SemanticKeywordPositionSummary[];
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

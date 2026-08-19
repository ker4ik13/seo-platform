import type {
  SemanticKeywordIntent,
  SemanticKeywordSort
} from "./keywords.js";
import type { JobCapacityEntitlement } from "./billing.js";
import type { SemanticSavedViewColumnKey } from "./semantic-saved-views.js";

export const semanticExportFormats = [
  "CSV",
  "TSV",
  "JSON",
  "NDJSON",
  "GOOGLE_CSV",
  "XLSX"
] as const;

export type SemanticExportFormat =
  (typeof semanticExportFormats)[number];

export const semanticExportScopes = [
  "SELECTED",
  "CURRENT_PAGE",
  "CURRENT_FILTER",
  "GROUP_SUBTREE",
  "FULL_CORE"
] as const;

export type SemanticExportScope =
  (typeof semanticExportScopes)[number];

export const semanticExportLocales = ["en", "ru"] as const;

export type SemanticExportLocale =
  (typeof semanticExportLocales)[number];

export interface SemanticExportFilters {
  readonly search?: string;
  readonly tag?: string;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly groupIds?: readonly string[];
  readonly clusterId?: string;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly priorityMin?: number;
  readonly priorityMax?: number;
}

export interface InternalCreateSemanticExportInput
  extends CreateSemanticExportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface InternalCancelSemanticExportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export const semanticExportJobStatuses = [
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "RETRY_SCHEDULED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL"
] as const;

export type SemanticExportJobStatus =
  (typeof semanticExportJobStatuses)[number];

export interface SemanticExportJobSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly format: SemanticExportFormat;
  readonly scope: SemanticExportScope;
  readonly status: SemanticExportJobStatus;
  readonly stage?: string;
  readonly processedRows: number;
  readonly totalRows?: number;
  readonly rowCount?: number;
  readonly filename?: string;
  readonly contentType?: string;
  readonly sizeBytes?: string;
  readonly failureCode?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface SemanticExportCollection {
  readonly exports: readonly SemanticExportJobSummary[];
}

export interface SemanticExportDownload {
  readonly url: string;
  readonly filename: string;
  readonly contentType: string;
  readonly rowCount: number;
  readonly sizeBytes: string;
}

export const semanticPositionHistorySearchEngines = [
  "YANDEX",
  "GOOGLE"
] as const;

export type SemanticPositionHistorySearchEngine =
  (typeof semanticPositionHistorySearchEngines)[number];

/**
 * Optional XLSX report mode. The interval is immutable and half-open:
 * observedFrom is inclusive, observedBefore is exclusive. History is merged
 * per keyword and engine independently of the tracking context that produced
 * a snapshot.
 */
export interface SemanticPositionHistoryExportOptions {
  readonly observedFrom: string;
  readonly observedBefore: string;
  readonly searchEngines: readonly SemanticPositionHistorySearchEngine[];
}

export interface SemanticPositionHistoryExportSnapshot {
  readonly searchEngine: SemanticPositionHistorySearchEngine;
  readonly observedDate: string;
  readonly found: boolean;
  readonly position?: number;
}

export interface SemanticPositionHistoryExportRow {
  readonly keywordId: string;
  readonly text: string;
  readonly createdAt: string;
  readonly groupPath?: string;
  readonly snapshots: readonly SemanticPositionHistoryExportSnapshot[];
}

export interface CreateSemanticExportInput {
  readonly format: SemanticExportFormat;
  readonly scope: SemanticExportScope;
  readonly locale: SemanticExportLocale;
  readonly columns: readonly SemanticSavedViewColumnKey[];
  readonly filters?: SemanticExportFilters;
  readonly sort?: SemanticKeywordSort;
  readonly keywordIds?: readonly string[];
  readonly includeBom?: boolean;
  /** When present, format must be XLSX and columns are ignored by the workbook layout. */
  readonly positionHistory?: SemanticPositionHistoryExportOptions;
}

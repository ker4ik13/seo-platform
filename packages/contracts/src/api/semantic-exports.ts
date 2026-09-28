import type { SemanticRankDimension, SemanticRankDimensionMetadata } from "./rank-dimensions.js";
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
  "FOLDER_MAP",
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
  readonly frequencyBaseMin?: string;
  readonly frequencyBaseMax?: string;
  readonly frequencyExactMin?: string;
  readonly frequencyExactMax?: string;
  readonly frequencyFixedMin?: string;
  readonly frequencyFixedMax?: string;
  readonly wordCountMin?: number;
  readonly wordCountMax?: number;
  readonly targetUrlState?: "SET" | "EMPTY";
  readonly rankDimensionKey?: string;
  readonly rankState?: "CHECKED" | "FOUND" | "NOT_FOUND" | "NOT_CHECKED";
  readonly rankPositionMin?: number;
  readonly rankPositionMax?: number;
  readonly rankCheckedFrom?: string;
  readonly rankCheckedBefore?: string;
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
  "EXPIRED",
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
  /** One explicit city/device slice per selected engine; worker reads it in bounded batches. */
  readonly dimensionKeys?: readonly string[];
  /** Include every active keyword in the selected scope, even without snapshots. */
  readonly includeAllKeywords?: boolean;
  /** Internal stable read cutoff owned by the export job. */
  readonly storedBefore?: string;
}

/**
 * XLSX folder-map mode. `groupIds` contains the explicitly selected roots;
 * descendants are resolved by the export worker from the current project tree.
 */
export interface SemanticFolderMapExportOptions {
  readonly groupIds: readonly string[];
  readonly includeDescendants: boolean;
}

export interface SemanticPositionHistoryExportSnapshot extends SemanticRankDimensionMetadata {
  readonly searchEngine: SemanticPositionHistorySearchEngine;
  readonly observedDate: string;
  readonly found: boolean;
  readonly position?: number;
}

export interface SemanticPositionHistoryExportRow {
  readonly keywordId: string;
  readonly text: string;
  /** Keyword language is separate from the search-result language. */
  readonly keywordLanguage: string;
  readonly createdAt: string;
  readonly groupPath?: string;
  readonly dimension?: SemanticRankDimension;
  readonly snapshots: readonly SemanticPositionHistoryExportSnapshot[];
}

/** Bound one history response to roughly 20k daily values, independent of project size. */
export function semanticPositionHistoryReadPageSize(options: SemanticPositionHistoryExportOptions): number {
  const days = Math.max(1, Math.ceil((Date.parse(options.observedBefore) - Date.parse(options.observedFrom)) / 86_400_000));
  const dimensions = Math.max(1, Math.min(4, options.dimensionKeys?.length ?? 4));
  return Math.max(1, Math.min(100, Math.floor(20_000 / (days * dimensions))));
}

export const semanticCompetitorExportSources = ["SERP", "AI"] as const;

export type SemanticCompetitorExportSource =
  (typeof semanticCompetitorExportSources)[number];

export const semanticCompetitorExportColumnKeys = [
  "serpCompetitorUrls",
  "serpCompetitorSerp",
  "aiCompetitorUrls",
  "aiCompetitorSerp"
] as const;
export const semanticCompetitorRowColumnKeys = [
  "competitorEngine", "competitorRegion", "competitorRegionCode", "competitorDevice", "competitorPosition",
  "competitorUrl", "competitorTitle", "competitorDescription", "competitorObservedAt", "competitorProvider"
] as const;

export type SemanticCompetitorExportColumnKey =
  (typeof semanticCompetitorExportColumnKeys)[number];

/** Export-only columns that do not become visible table or saved-view columns. */
export type SemanticExportColumnKey =
  | SemanticSavedViewColumnKey
  | SemanticCompetitorExportColumnKey
  | (typeof semanticCompetitorRowColumnKeys)[number];

/**
 * Read the latest available competitor projection for every keyword and
 * search engine in the immutable semantic scope. The selected sources are
 * derived from the export columns requested by the worker.
 */
export interface SemanticCompetitorExportOptions {
  readonly sources: readonly SemanticCompetitorExportSource[];
  readonly dimensionKeys?: readonly string[];
}

/** Internal SEO read projection consumed only by the export worker. */
export interface SemanticCompetitorExportItem extends SemanticRankDimensionMetadata {
  readonly source: SemanticCompetitorExportSource;
  readonly url: string;
  readonly normalizedUrl: string;
  readonly title?: string;
  readonly description?: string;
  readonly searchEngine?: "YANDEX" | "GOOGLE";
  readonly position?: number;
  readonly observedAt?: string;
  readonly provider?: string;
  readonly searchSource?: "LIVE" | "SEARCH_API";
  readonly snapshotId?: string;
  readonly trackingContextId?: string;
  readonly configurationVersion?: number;
}

/** One paginated keyword unit with its latest SERP/AI competitor rows. */
export interface SemanticCompetitorExportKeyword {
  readonly keywordId: string;
  readonly competitors: readonly SemanticCompetitorExportItem[];
}

export interface CreateSemanticExportInput {
  readonly format: SemanticExportFormat;
  readonly scope: SemanticExportScope;
  readonly locale: SemanticExportLocale;
  readonly columns: readonly SemanticExportColumnKey[];
  readonly filters?: SemanticExportFilters;
  readonly sort?: SemanticKeywordSort;
  readonly rankSortDimensionKey?: string;
  readonly keywordIds?: readonly string[];
  readonly includeBom?: boolean;
  /** One row per stored organic result, with its geographic provenance. */
  readonly competitorRows?: boolean;
  /** When present, format must be XLSX and columns are ignored by the workbook layout. */
  readonly positionHistory?: SemanticPositionHistoryExportOptions;
  /** When present, format must be XLSX and scope must be FOLDER_MAP. */
  readonly folderMap?: SemanticFolderMapExportOptions;
}

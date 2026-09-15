import { parseSemanticRankDimensionKey, semanticRankDimensionKey } from "./rank-dimensions.js";

export const semanticImportEncodings = [
  "AUTO",
  "UTF_8",
  "WINDOWS_1251"
] as const;

export type SemanticImportEncoding =
  (typeof semanticImportEncodings)[number];

export const semanticImportDelimiters = [
  "AUTO",
  "COMMA",
  "SEMICOLON",
  "TAB"
] as const;

export type SemanticImportDelimiter =
  (typeof semanticImportDelimiters)[number];

/**
 * Native project formats may contain deeply nested folder trees. The limit is
 * deliberately high enough for real Key Collector projects while still
 * bounding recursive validation and group creation work.
 */
export const semanticImportMaxGroupDepth = 64;
/**
 * Native projects carry empty folders outside keyword rows. Keep the manifest
 * bounded independently from the per-project entitlement while accepting
 * real multi-thousand-folder Key Collector projects.
 */
export const semanticImportMaxGroupManifestEntries = 20_000;

export const semanticImportHeaderModes = [
  "AUTO",
  "PRESENT",
  "ABSENT"
] as const;

export type SemanticImportHeaderMode =
  (typeof semanticImportHeaderModes)[number];

export const semanticImportStatuses = [
  "QUEUED",
  "PARSING",
  "AWAITING_MAPPING",
  "VALIDATING",
  "AWAITING_CONFIRMATION",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "COMPLETED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED"
] as const;

export type SemanticImportStatus =
  (typeof semanticImportStatuses)[number];

export const semanticImportTargets = [
  "ignore",
  "keyword.text",
  "keyword.language",
  "keyword.priority",
  "keyword.favorite",
  "keyword.tracked",
  "keyword.note",
  "keyword.intent",
  "group.path",
  "page.target_url",
  "frequency.base",
  "frequency.exact",
  "frequency.fixed",
  "ranking.position",
  "ranking.yandex.position",
  "ranking.yandex.change",
  "ranking.yandex.url",
  "ranking.google.position",
  "ranking.google.change",
  "ranking.google.url",
  "context.search_engine",
  "context.region",
  "metric.observed_at",
  "keyword.tags",
  "metric.kei",
  "custom"
] as const;

/** Bounded normalization batch shared by Jobs and the SEO data owner. */
export const semanticImportNormalizeMaxRows = 5_000;
/** Bounded publication transaction shared by Jobs and the SEO data owner. */
export const semanticImportPublishMaxRows = 5_000;

export type SemanticImportTarget =
  (typeof semanticImportTargets)[number];

export const semanticImportDuplicatePolicies = [
  "SKIP_EXISTING",
  "MERGE_NON_EMPTY",
  "OVERWRITE_MAPPED"
] as const;

export type SemanticImportDuplicatePolicy =
  (typeof semanticImportDuplicatePolicies)[number];

export interface CreateSemanticImportInput {
  readonly uploadId: string;
  readonly parse?: {
    readonly encoding?: SemanticImportEncoding;
    readonly delimiter?: SemanticImportDelimiter;
    readonly headerMode?: SemanticImportHeaderMode;
  };
}

export interface InternalCreateSemanticImportInput
  extends CreateSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  /** Trusted normalized project host captured by Platform API. */
  readonly projectDomain: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly jobCapacity: import("./billing.js").JobCapacityEntitlement;
  /** Trusted capacity snapshot used by automatic native KC4 publication. */
  readonly semanticCapacity?: import("./billing.js").SemanticCapacityEntitlement;
}

export interface SemanticImportColumnPreview {
  readonly index: number;
  readonly sourceName: string;
  readonly suggestedTarget: string;
  readonly confidence: number;
}

export interface SemanticImportPreview {
  readonly columns: readonly SemanticImportColumnPreview[];
  readonly sampleRows: readonly (readonly string[])[];
  readonly totalRows: string;
  readonly validRows: string;
  readonly warningRows: string;
  readonly errorRows: string;
}

/** Preview rows are streamed in fixed pages so even very large native projects stay responsive. */
export const semanticImportPreviewPageSize = 100 as const;

export const semanticImportPreviewSortDirections = ["ASC", "DESC"] as const;

export type SemanticImportPreviewSortDirection =
  (typeof semanticImportPreviewSortDirections)[number];

export interface SemanticImportPreviewRowsQuery {
  readonly cursor?: string;
  readonly sortColumn?: number;
  readonly sortDirection?: SemanticImportPreviewSortDirection;
}

export interface SemanticImportPreviewRow {
  readonly rowNumber: string;
  readonly values: readonly string[];
}

export interface SemanticImportPreviewRowsPage {
  readonly rows: readonly SemanticImportPreviewRow[];
  readonly page: {
    readonly hasNext: boolean;
    readonly nextCursor?: string;
    readonly totalRows: string;
  };
}

export interface SemanticImportMappingColumn {
  readonly sourceIndex: number;
  readonly target: SemanticImportTarget;
  readonly customName?: string;
}

export interface SemanticImportMapping {
  readonly columns: readonly SemanticImportMappingColumn[];
  readonly defaultLanguage: string;
  readonly groupSeparator: string;
  readonly duplicatePolicy: SemanticImportDuplicatePolicy;
  /**
   * When false, rows that do not resolve to an existing project keyword are
   * excluded from publication. Existing persisted mappings without this field
   * are interpreted by the execution service as the legacy create-enabled
   * behaviour so an in-flight import can resume safely after deployment.
   */
  readonly createMissingKeywords: boolean;
  /** Wide history table: one keyword row and one measurement date per column. */
  readonly positionHistory?: SemanticPositionHistoryImportOptions;
}

export interface SemanticPositionHistoryImportOptions {
  /** WIDE reads one date per column; LONG reads date and position mappings per row. */
  readonly layout?: "WIDE" | "LONG";
  /** One uploaded file represents exactly one search engine. */
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly countryCode: string;
  readonly regionCode: string;
  readonly regionLabel: string;
  readonly language: string;
  readonly device: "DESKTOP" | "MOBILE";
}

export function parseSemanticPositionHistoryImportOptions(value: unknown): SemanticPositionHistoryImportOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid position history options");
  const input = value as Record<string, unknown>;
  const allowed = ["layout", "searchEngine", "countryCode", "regionCode", "regionLabel", "language", "device"];
  if (Object.keys(input).some(key => !allowed.includes(key)) ||
    (input.layout !== undefined && input.layout !== "WIDE" && input.layout !== "LONG") ||
    (input.searchEngine !== "YANDEX" && input.searchEngine !== "GOOGLE") ||
    typeof input.countryCode !== "string" || !/^[A-Za-z]{2}$/u.test(input.countryCode) ||
    typeof input.regionCode !== "string" || !input.regionCode.trim() || input.regionCode.length > 100 ||
    typeof input.regionLabel !== "string" || !input.regionLabel.trim() || input.regionLabel.length > 160 ||
    typeof input.language !== "string" || !input.language.trim() || input.language.length > 16 ||
    (input.device !== "DESKTOP" && input.device !== "MOBILE")) throw new TypeError("Invalid position history context");
  let language: string;
  try { language = Intl.getCanonicalLocales(input.language.trim())[0]!; } catch { throw new TypeError("Invalid position history language"); }
  const result: SemanticPositionHistoryImportOptions = {
    ...(input.layout ? { layout: input.layout as "WIDE" | "LONG" } : {}),
    searchEngine: input.searchEngine as "YANDEX" | "GOOGLE",
    countryCode: input.countryCode.toUpperCase(),
    regionCode: input.regionCode.normalize("NFKC").trim(),
    regionLabel: input.regionLabel.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    language,
    device: input.device as "DESKTOP" | "MOBILE"
  };
  if (!parseSemanticRankDimensionKey(semanticRankDimensionKey(result))) {
    throw new TypeError("Invalid position history context");
  }
  return result;
}

/** Canonicalizes ISO and common Russian/European spreadsheet date headers. */
export function semanticPositionHistoryHeaderDate(value: string): string | undefined {
  const source = value.normalize("NFKC").trim();
  let year: number, month: number, day: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:T00:00:00(?:\.000)?Z)?$/u.exec(source);
  if (match) [, year, month, day] = [match[0], Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/u.exec(source);
    if (!match) return undefined;
    [, day, month, year] = [match[0], Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : undefined;
}

export interface ConfigureSemanticImportInput
  extends SemanticImportMapping {
  readonly version: number;
}

export interface InternalConfigureSemanticImportInput
  extends ConfigureSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface ConfirmSemanticImportInput {
  readonly version: number;
}

export interface InternalConfirmSemanticImportInput
  extends ConfirmSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}

export interface CancelSemanticImportInput {
  readonly version?: number;
}

export interface InternalCancelSemanticImportInput
  extends CancelSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface SemanticImportValidationSummary {
  readonly totalRows: string;
  readonly validRows: string;
  readonly warningRows: string;
  readonly errorRows: string;
  readonly duplicateRowsInFile: string;
  readonly existingKeywordsInProject: string;
  readonly newKeywordsSkipped: string;
  readonly uniqueKeywordsToProcess: string;
  readonly issueCounts: Readonly<Record<string, string>>;
}

export interface SemanticImportResultSummary {
  readonly partial: boolean;
  readonly semanticVersionId: string;
  readonly semanticVersionNumber: number;
  readonly createdKeywords: string;
  readonly updatedKeywords: string;
  readonly skippedKeywords: string;
  readonly createdGroups: string;
  readonly createdPages: string;
  readonly createdTags: string;
  readonly createdMetricSnapshots: string;
  readonly trashedDuplicateCandidates?: readonly SemanticImportTrashCandidate[];
  readonly trashedDuplicateCandidatesTruncated?: boolean;
}

export interface SemanticImportTrashCandidate {
  readonly keywordId: string;
  readonly version: number;
  readonly text: string;
  readonly language: string;
}

export interface SemanticImportSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly uploadId: string;
  readonly status: SemanticImportStatus;
  readonly stage: string;
  readonly sourceFormat: string;
  readonly encoding?: Exclude<SemanticImportEncoding, "AUTO">;
  readonly delimiter?: Exclude<SemanticImportDelimiter, "AUTO">;
  readonly headerMode: SemanticImportHeaderMode;
  readonly progressBytes: string;
  readonly totalBytes: string;
  readonly preview?: SemanticImportPreview;
  readonly mapping?: SemanticImportMapping;
  readonly validation?: SemanticImportValidationSummary;
  readonly result?: SemanticImportResultSummary;
  readonly failureCode?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly version: number;
}

export interface InternalNormalizeSemanticKeywordsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly importId: string;
  readonly rows: readonly {
    readonly rowNumber: string;
    readonly text: string;
    readonly language: string;
  }[];
}

export interface InternalNormalizedSemanticKeyword {
  readonly rowNumber: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly normalizedHash: string;
  readonly language: string;
  readonly existsInProject: boolean;
}

export interface InternalNormalizeSemanticKeywordsResult {
  readonly rows: readonly InternalNormalizedSemanticKeyword[];
}

export interface SemanticImportFrequencyValue {
  readonly type: "BASE" | "EXACT" | "FIXED";
  readonly value: string;
}

export interface SemanticImportPositionValue {
  readonly source?: "KEY_COLLECTOR";
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly countryCode?: string;
  readonly regionCode?: string;
  readonly regionLabel?: string;
  readonly language?: string;
  readonly device?: "DESKTOP" | "MOBILE";
  readonly observedAt?: string;
  readonly found: boolean;
  readonly position?: number;
  readonly previousPosition?: number;
  readonly rankingUrl?: string;
  readonly serpResults?: readonly SemanticImportSerpResultValue[];
}

export interface SemanticImportSerpResultValue {
  readonly position: number;
  readonly rankingUrl: string;
  readonly title?: string;
  readonly snippet?: string;
}

export interface SemanticImportRankHistoryValue {
  readonly source?: "KEY_COLLECTOR";
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly countryCode: string;
  readonly regionCode: string;
  readonly regionLabel?: string;
  readonly language: string;
  readonly device: "DESKTOP" | "MOBILE";
  readonly observedAt: string;
  readonly found: boolean;
  readonly position?: number;
  readonly rankingUrl?: string;
  readonly serpResults?: readonly SemanticImportSerpResultValue[];
}

export interface SemanticImportPublishRow {
  readonly sourceRowNumber: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly normalizedHash: string;
  readonly language: string;
  readonly priority?: number;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly note?: string;
  readonly intent?: import("./keywords.js").SemanticKeywordIntent;
  readonly groupPath?: readonly string[];
  readonly groupPaths?: readonly (readonly string[])[];
  readonly targetUrl?: string;
  readonly frequencies?: readonly SemanticImportFrequencyValue[];
  readonly positions?: readonly SemanticImportPositionValue[];
  readonly positionHistory?: readonly SemanticImportRankHistoryValue[];
  readonly observedAt?: string;
  readonly tags?: readonly string[];
  readonly customValues: Readonly<Record<string, string>>;
}

export interface SemanticImportGroupMetadata {
  readonly path: readonly string[];
  readonly color?: string;
}

export interface InternalBeginSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly importId: string;
  readonly mappingHash: string;
  readonly duplicatePolicy: SemanticImportDuplicatePolicy;
  readonly createMissingKeywords: boolean;
  readonly expectedChunks: number;
  readonly expectedUniqueRows: string;
  readonly expectedNewKeywords: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}

export interface InternalSemanticImportReceipt {
  readonly importId: string;
  readonly status: "RECEIVING" | "COMPLETED" | "ABORTED";
  readonly receivedChunks: number;
  readonly expectedChunks: number;
}

export interface InternalApplySemanticImportChunkInput {
  readonly workspaceId: string;
  readonly projectId: string;
  /** Optional only for compatibility with imports created before this field. */
  readonly projectDomain?: string;
  readonly actorId: string;
  readonly importId: string;
  readonly chunkIndex: number;
  readonly payloadHash: string;
  readonly duplicatePolicy: SemanticImportDuplicatePolicy;
  readonly createMissingKeywords: boolean;
  readonly groupPaths?: readonly (readonly string[])[];
  readonly groupMetadata?: readonly SemanticImportGroupMetadata[];
  readonly rows: readonly SemanticImportPublishRow[];
}

export interface InternalSemanticImportChunkResult {
  readonly chunkIndex: number;
  readonly createdKeywords: string;
  readonly updatedKeywords: string;
  readonly skippedKeywords: string;
  readonly createdGroups: string;
  readonly createdPages: string;
  readonly createdTags: string;
  readonly createdMetricSnapshots: string;
  readonly trashedDuplicateCandidates: readonly SemanticImportTrashCandidate[];
}

export interface InternalCompleteSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly importId: string;
  readonly partial?: boolean;
}

export interface InternalAbortSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly importId: string;
  readonly reason: "CANCELLED" | "FAILED_FINAL";
}

export interface InternalAbortSemanticImportResult {
  readonly importId: string;
  readonly status: "ABORTED" | "RECEIVING" | "COMPLETED";
  readonly receivedChunks: number;
}

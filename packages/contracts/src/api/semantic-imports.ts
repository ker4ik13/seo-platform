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
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly jobCapacity: import("./billing.js").JobCapacityEntitlement;
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
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly found: boolean;
  readonly position?: number;
  readonly previousPosition?: number;
  readonly rankingUrl?: string;
}

export interface SemanticImportPublishRow {
  readonly sourceRowNumber: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly normalizedHash: string;
  readonly language: string;
  readonly priority?: number;
  readonly isFavorite?: boolean;
  readonly intent?: import("./keywords.js").SemanticKeywordIntent;
  readonly groupPath?: readonly string[];
  readonly groupPaths?: readonly (readonly string[])[];
  readonly targetUrl?: string;
  readonly frequencies?: readonly SemanticImportFrequencyValue[];
  readonly positions?: readonly SemanticImportPositionValue[];
  readonly observedAt?: string;
  readonly tags?: readonly string[];
  readonly customValues: Readonly<Record<string, string>>;
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
  readonly actorId: string;
  readonly importId: string;
  readonly chunkIndex: number;
  readonly payloadHash: string;
  readonly duplicatePolicy: SemanticImportDuplicatePolicy;
  readonly createMissingKeywords: boolean;
  readonly groupPaths?: readonly (readonly string[])[];
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

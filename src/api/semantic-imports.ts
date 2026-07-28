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
  "group.path",
  "page.target_url",
  "frequency.base",
  "frequency.exact",
  "frequency.fixed",
  "ranking.position",
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

export interface SemanticImportPublishRow {
  readonly sourceRowNumber: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly normalizedHash: string;
  readonly language: string;
  readonly groupPath?: readonly string[];
  readonly targetUrl?: string;
  readonly frequencies?: readonly SemanticImportFrequencyValue[];
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
  readonly expectedChunks: number;
  readonly expectedUniqueRows: string;
}

export interface InternalSemanticImportReceipt {
  readonly importId: string;
  readonly status: "RECEIVING" | "COMPLETED";
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
}

export interface InternalCompleteSemanticImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly importId: string;
  readonly partial?: boolean;
}

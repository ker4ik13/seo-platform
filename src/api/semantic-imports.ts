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

export type SemanticImportStatus =
  | "QUEUED"
  | "PARSING"
  | "AWAITING_MAPPING"
  | "READY_TO_PUBLISH"
  | "PUBLISHING"
  | "COMPLETED"
  | "FAILED"
  | "CANCEL_REQUESTED"
  | "CANCELLED";

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
  readonly failureCode?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly version: number;
}

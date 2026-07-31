import type { SemanticCapacityEntitlement } from "./billing.js";
import type { SemanticImportDuplicatePolicy } from "./semantic-imports.js";

export const keysSoDatabases = [
  "msk",
  "gru",
  "zen",
  "gkv",
  "rnd",
  "ekb",
  "ufa",
  "sar",
  "krr",
  "prm",
  "sam",
  "kry",
  "oms",
  "kzn",
  "che",
  "nsk",
  "nnv",
  "vlg",
  "vrn",
  "spb",
  "mns",
  "tmn",
  "gmns",
  "tom",
  "gny"
] as const;

export type KeysSoDatabase = (typeof keysSoDatabases)[number];

export const keywordResearchStatuses = [
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "READY_TO_IMPORT",
  "IMPORT_QUEUED",
  "IMPORTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
] as const;

export type KeywordResearchStatus =
  (typeof keywordResearchStatuses)[number];

export interface KeywordResearchRow {
  readonly id: string;
  readonly keyword: string;
  readonly url?: string;
  readonly frequencyBase?: number;
  readonly frequencyExact?: number;
  readonly frequencyFixed?: number;
  readonly position?: number;
  readonly kei?: number;
  readonly selected: boolean;
}

export interface KeywordResearchRunSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly provider: "KEYS_SO";
  readonly domain: string;
  readonly database: KeysSoDatabase;
  readonly maxKeywords: number;
  readonly status: KeywordResearchStatus;
  readonly totalAvailable?: number;
  readonly collectedKeywords: number;
  readonly selectedKeywords: number;
  readonly importedKeywords: number;
  readonly rows: readonly KeywordResearchRow[];
  readonly retryAt?: string;
  readonly failureCode?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt?: string;
}

export const keywordResearchMutationRestrictions = [
  "NONE",
  "MISSING_PERMISSION",
  "WORKSPACE_READ_ONLY",
  "PROJECT_ARCHIVED",
  "CONNECTOR_NOT_READY"
] as const;

export type KeywordResearchMutationRestriction =
  (typeof keywordResearchMutationRestrictions)[number];

export interface KeywordResearchAccess {
  readonly canRun: boolean;
  readonly canImport: boolean;
  readonly canCancel: boolean;
  readonly mutationRestriction: KeywordResearchMutationRestriction;
}

export interface KeywordResearchCollection {
  readonly runs: readonly KeywordResearchRunSummary[];
  readonly access: KeywordResearchAccess;
}

export interface CreateKeywordResearchRunInput {
  readonly domain: string;
  readonly database: KeysSoDatabase;
  readonly maxKeywords: number;
}

export interface InternalCreateKeywordResearchRunInput
  extends CreateKeywordResearchRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface ConfirmKeywordResearchRunInput {
  readonly selectedRowIds: readonly string[];
  readonly duplicatePolicy: SemanticImportDuplicatePolicy;
}

export interface InternalConfirmKeywordResearchRunInput
  extends ConfirmKeywordResearchRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
  readonly entitlement: SemanticCapacityEntitlement;
}

export interface InternalCancelKeywordResearchRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

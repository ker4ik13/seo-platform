import type {
  JobCapacityEntitlement,
  SemanticCapacityEntitlement
} from "./billing.js";
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

export const keywordResearchSources = [
  "KEYS_SO",
  "ARSENKIN_WORDSTAT",
  "XMLSTOCK_WORDSTAT"
] as const;

export type KeywordResearchSource = (typeof keywordResearchSources)[number];

export const wordstatExpansionDevices = [
  "ALL",
  "DESKTOP",
  "MOBILE",
  "PHONE_ONLY",
  "TABLET_ONLY"
] as const;

export type WordstatExpansionDevice =
  (typeof wordstatExpansionDevices)[number];

export const arsenkinWordstatExpansionSeedLimit = 500;
export const arsenkinWordstatExpansionResultLimit = 10_000;
export const keywordResearchRowPageDefaultSize = 200;
export const keywordResearchRowPageMaxSize = 500;

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
  readonly ordinal: number;
  readonly keyword: string;
  readonly url?: string;
  readonly frequencyBase?: number;
  readonly frequencyExact?: number;
  readonly frequencyFixed?: number;
  readonly position?: number;
  readonly kei?: number;
  readonly sourceQuery?: string;
  readonly sourceColumn?: "LEFT" | "RIGHT";
  readonly selected: boolean;
}

export interface KeywordResearchRowPage {
  readonly rows: readonly KeywordResearchRow[];
  readonly page: {
    readonly hasNext: boolean;
    readonly nextCursor?: string;
  };
}

export interface KeysSoDomainOverview {
  readonly top1: number;
  readonly top3: number;
  readonly top5: number;
  readonly top10: number;
  readonly top50: number;
  readonly visibility?: number;
  readonly pagesInIndex?: number;
  readonly aiAnswers?: number;
}

export interface KeysSoCompetitor {
  readonly domain: string;
  readonly commonKeywords: number;
  readonly similarity?: number;
  readonly thematicity?: number;
  readonly top10?: number;
  readonly top50?: number;
  readonly visibility?: number;
}

export interface KeywordResearchRunSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId?: string;
  readonly source: KeywordResearchSource;
  readonly provider: "KEYS_SO" | "ARSENKIN" | "XMLSTOCK";
  readonly domain?: string;
  readonly database?: KeysSoDatabase;
  readonly regionCode?: string;
  readonly device?: WordstatExpansionDevice;
  readonly seedCount?: number;
  readonly includeRightColumn?: boolean;
  readonly overview?: KeysSoDomainOverview;
  readonly competitors?: readonly KeysSoCompetitor[];
  readonly maxKeywords: number;
  readonly status: KeywordResearchStatus;
  readonly totalAvailable?: number;
  readonly collectedKeywords: number;
  readonly selectedKeywords: number;
  readonly importedKeywords: number;
  readonly rows: readonly KeywordResearchRow[];
  readonly targetGroupPath?: string;
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

export interface CreateKeysSoKeywordResearchRunInput {
  readonly source: "KEYS_SO";
  readonly domain: string;
  readonly database: KeysSoDatabase;
  readonly maxKeywords: number;
}

export interface CreateWordstatExpansionRunInput {
  readonly source: "ARSENKIN_WORDSTAT" | "XMLSTOCK_WORDSTAT";
  readonly queries: readonly string[];
  readonly regionCode: string;
  readonly device: WordstatExpansionDevice;
  readonly minusWords: readonly string[];
  readonly clearMinusPhrases: boolean;
  readonly includeRightColumn: boolean;
  readonly clearPlus: boolean;
  readonly maxKeywords: number;
}

export type CreateKeywordResearchRunInput =
  | CreateKeysSoKeywordResearchRunInput
  | CreateWordstatExpansionRunInput;

export type InternalCreateKeywordResearchRunInput =
  CreateKeywordResearchRunInput & {
  readonly billing?: import("./paid-operations.js").InternalPaidOperationAdmission;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly jobCapacity: JobCapacityEntitlement;
};

export interface ConfirmKeywordResearchRunInput {
  readonly selectionMode: "ALL" | "SELECTED";
  readonly selectedRowIds?: readonly string[];
  readonly excludedRowIds?: readonly string[];
  readonly duplicatePolicy: SemanticImportDuplicatePolicy;
  readonly targetGroupPath?: string;
  readonly rowDestinations?: readonly KeywordResearchRowDestination[];
  readonly distributionMode?: WordstatImportDistributionMode;
}

export const wordstatImportDistributionModes = [
  "SINGLE_GROUP",
  "BY_SOURCE_QUERY"
] as const;

export type WordstatImportDistributionMode =
  (typeof wordstatImportDistributionModes)[number];

export interface KeywordResearchRowDestination {
  readonly rowId: string;
  readonly targetGroupPath: string;
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

export interface InternalRetryKeywordResearchImportInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

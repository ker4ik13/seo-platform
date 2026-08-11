export const semanticKeywordSourceModes = [
  "BYOK",
  "PLATFORM",
  "IMPORT",
  "MANUAL"
] as const;

export type SemanticKeywordSourceMode =
  (typeof semanticKeywordSourceModes)[number];

export const semanticKeywordIntents = [
  "INFORMATIONAL",
  "NAVIGATIONAL",
  "COMMERCIAL",
  "TRANSACTIONAL",
  "LOCAL",
  "MIXED"
] as const;

export type SemanticKeywordIntent =
  (typeof semanticKeywordIntents)[number];

export const semanticKeywordDuplicatePolicies = [
  "SKIP_EXISTING",
  "REJECT_EXISTING",
  "ADD_TO_GROUP",
  "RESTORE_TRASHED"
] as const;

export type SemanticKeywordDuplicatePolicy =
  (typeof semanticKeywordDuplicatePolicies)[number];

export const semanticKeywordCreateOutcomes = [
  "CREATED",
  "RESTORED",
  "LINKED_EXISTING",
  "SKIPPED_EXISTING",
  "REJECTED_EXISTING",
  "FAILED"
] as const;

export type SemanticKeywordCreateOutcome =
  (typeof semanticKeywordCreateOutcomes)[number];

export const semanticKeywordSorts = [
  "CREATED_DESC",
  "CREATED_ASC",
  "UPDATED_DESC",
  "UPDATED_ASC",
  "TEXT_ASC",
  "TEXT_DESC",
  "PRIORITY_DESC",
  "PRIORITY_ASC",
  "SOURCE_ASC",
  "SOURCE_DESC",
  "TAGS_ASC",
  "TAGS_DESC",
  "FREQUENCY_BASE_DESC",
  "FREQUENCY_BASE_ASC",
  "FREQUENCY_EXACT_DESC",
  "FREQUENCY_EXACT_ASC",
  "FREQUENCY_FIXED_DESC",
  "FREQUENCY_FIXED_ASC",
  "YANDEX_POSITION_ASC",
  "YANDEX_POSITION_DESC",
  "GOOGLE_POSITION_ASC",
  "GOOGLE_POSITION_DESC",
  "YANDEX_CHECKED_AT_ASC",
  "YANDEX_CHECKED_AT_DESC",
  "GOOGLE_CHECKED_AT_ASC",
  "GOOGLE_CHECKED_AT_DESC"
] as const;

export type SemanticKeywordSort =
  (typeof semanticKeywordSorts)[number];

export const semanticKeywordPageSizes = [100, 200, 500, 1_000] as const;
export const semanticKeywordDefaultPageSize = semanticKeywordPageSizes[0];
export type SemanticKeywordPageSize =
  (typeof semanticKeywordPageSizes)[number];
export const semanticKeywordMaxPageSize: SemanticKeywordPageSize = 1_000;

export interface KeywordListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  /** Case-insensitive substring matched against normalized active tag names. */
  readonly tag?: string;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  /** Union of explicitly selected groups. Mutually exclusive with groupId. */
  readonly groupIds?: readonly string[];
  readonly clusterId?: string;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly priorityMin?: number;
  readonly priorityMax?: number;
  readonly sort?: SemanticKeywordSort;
}

export interface SemanticKeywordListItem {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly groupPath?: string;
  readonly clusterId?: string;
  readonly clusterName?: string;
  readonly targetPageId?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  /** The list never exposes the note body, only its presence. */
  readonly hasNote?: boolean;
  readonly customValues?: readonly import("./semantic-custom-columns.js").SemanticKeywordCustomValue[];
  readonly frequency?: SemanticKeywordListFrequency;
  readonly frequencies?: readonly SemanticKeywordListFrequencyValue[];
  readonly positions?: readonly SemanticKeywordListPosition[];
  readonly sourceMode: SemanticKeywordSourceMode;
  readonly trashed?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  /** Present only in a create response; list responses omit it. */
  readonly createOutcome?: Exclude<
    SemanticKeywordCreateOutcome,
    "REJECTED_EXISTING" | "FAILED"
  >;
}

export interface SemanticKeywordListFrequency {
  readonly value?: string;
  readonly regionCode: string;
  readonly device: import("./frequency-collections.js").SemanticFrequencyDevice;
  readonly provider: string;
  readonly observedAt: string;
}

export interface SemanticKeywordListFrequencyValue
  extends SemanticKeywordListFrequency {
  readonly type: import("./frequency-collections.js").SemanticFrequencyType;
}

export interface SemanticKeywordListPosition {
  readonly searchEngine: "GOOGLE" | "YANDEX";
  readonly found: boolean;
  readonly position?: number;
  readonly previousPosition?: number;
  readonly rankingUrl?: string;
  readonly observedAt: string;
}

export interface ProjectPositionSummary {
  readonly positionedKeywordCount: number;
  readonly averagePosition?: number;
}

export interface CreateSemanticKeywordInput {
  readonly text: string;
  readonly note?: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly clusterId?: string;
  readonly targetUrl?: string;
  readonly tagNames: readonly string[];
  /** Defaults to REJECT_EXISTING for the legacy single-create endpoint. */
  readonly duplicatePolicy?: SemanticKeywordDuplicatePolicy;
}

export type SemanticKeywordBulkCreateItemInput = Omit<
  CreateSemanticKeywordInput,
  "duplicatePolicy"
>;

export interface SemanticKeywordBulkCreateInput {
  readonly items: readonly SemanticKeywordBulkCreateItemInput[];
  readonly duplicatePolicy: SemanticKeywordDuplicatePolicy;
}

export interface SemanticKeywordBulkCreateRow {
  readonly index: number;
  readonly outcome: SemanticKeywordCreateOutcome;
  readonly keywordId?: string;
  readonly version?: number;
  /** True only when SKIPPED_EXISTING matched the system trash. */
  readonly trashed?: boolean;
  readonly errorCode?: string;
}

export interface SemanticKeywordBulkCreateResult {
  readonly selected: number;
  readonly created: number;
  readonly restored: number;
  readonly linked: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly failed: number;
  readonly rows: readonly SemanticKeywordBulkCreateRow[];
}

export interface UpdateSemanticKeywordInput {
  readonly text?: string;
  readonly language?: string;
  readonly priority?: number;
  readonly isFavorite?: boolean;
  readonly intent?: SemanticKeywordIntent | null;
  readonly groupId?: string | null;
  readonly clusterId?: string | null;
  readonly targetUrl?: string | null;
  readonly tagNames?: readonly string[];
  readonly note?: string | null;
}

export interface InternalCreateSemanticKeywordInput
  extends CreateSemanticKeywordInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
  readonly duplicatePolicy: SemanticKeywordDuplicatePolicy;
}

export interface InternalSemanticKeywordBulkCreateInput
  extends SemanticKeywordBulkCreateInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}

export interface InternalUpdateSemanticKeywordInput
  extends UpdateSemanticKeywordInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteSemanticKeywordInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
  readonly permanent?: boolean;
}

export const semanticKeywordGroupSystemKinds = ["UNGROUPED", "TRASH"] as const;

export type SemanticKeywordGroupSystemKind =
  (typeof semanticKeywordGroupSystemKinds)[number];

export interface SemanticKeywordGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly position: number;
  readonly keywordCount: number;
  readonly systemKind?: SemanticKeywordGroupSystemKind;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSemanticKeywordGroupInput {
  readonly name: string;
  readonly parentId?: string;
  readonly color?: string;
}

export interface UpdateSemanticKeywordGroupInput {
  readonly name: string;
  readonly parentId?: string | null;
  readonly color?: string | null;
  readonly position?: number;
}

export interface InternalCreateSemanticKeywordGroupInput
  extends CreateSemanticKeywordGroupInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}

export interface InternalUpdateSemanticKeywordGroupInput
  extends UpdateSemanticKeywordGroupInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteSemanticKeywordGroupInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
  readonly deleteKeywords: boolean;
}

export interface SemanticKeywordBulkSelection {
  readonly id: string;
  readonly version: number;
}

export interface SemanticKeywordBulkPatch {
  readonly priority?: number;
  readonly isFavorite?: boolean;
  readonly intent?: SemanticKeywordIntent | null;
  readonly groupId?: string | null;
  readonly clusterId?: string | null;
  readonly targetUrl?: string | null;
  readonly tagNames?: readonly string[];
}

export interface SemanticKeywordBulkInput {
  readonly items: readonly SemanticKeywordBulkSelection[];
  readonly patch: SemanticKeywordBulkPatch;
}

export interface InternalSemanticKeywordBulkInput
  extends SemanticKeywordBulkInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface SemanticKeywordBulkResult {
  readonly selected: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly conflicted: number;
  readonly updatedItems: readonly SemanticKeywordListItem[];
  readonly conflictedIds: readonly string[];
  readonly skippedIds: readonly string[];
  readonly failedIds: readonly string[];
}

export const semanticKeywordCleaningCases = [
  "KEEP",
  "LOWER",
  "UPPER"
] as const;

export type SemanticKeywordCleaningCase =
  (typeof semanticKeywordCleaningCases)[number];

export interface SemanticKeywordCleaningRules {
  readonly collapseWhitespace?: boolean;
  readonly normalizeQuotes?: boolean;
  readonly normalizeDashes?: boolean;
  readonly normalizeYo?: boolean;
  readonly removeSearchOperators?: boolean;
  readonly letterCase?: SemanticKeywordCleaningCase;
}

export interface SemanticKeywordCleaningInput {
  readonly items: readonly SemanticKeywordBulkSelection[];
  readonly rules: SemanticKeywordCleaningRules;
}

export interface InternalSemanticKeywordCleaningInput
  extends SemanticKeywordCleaningInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export const semanticKeywordCleaningStates = [
  "APPLICABLE",
  "UNCHANGED",
  "CONFLICTED",
  "UNAVAILABLE",
  "DUPLICATE",
  "INVALID"
] as const;

export type SemanticKeywordCleaningState =
  (typeof semanticKeywordCleaningStates)[number];

export interface SemanticKeywordCleaningPreviewChange {
  readonly keywordId: string;
  readonly state: SemanticKeywordCleaningState;
  readonly expectedVersion: number;
  readonly currentVersion?: number;
  readonly beforeText?: string;
  readonly afterText?: string;
}

export interface SemanticKeywordCleaningPreview {
  readonly selected: number;
  readonly applicable: number;
  readonly unchanged: number;
  readonly conflicted: number;
  readonly failed: number;
  readonly changes: readonly SemanticKeywordCleaningPreviewChange[];
}

export interface SemanticKeywordCleaningResult {
  readonly selected: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly conflicted: number;
  readonly failed: number;
  readonly updatedItems: readonly SemanticKeywordListItem[];
  readonly unchangedIds: readonly string[];
  readonly conflictedIds: readonly string[];
  readonly failedIds: readonly string[];
}

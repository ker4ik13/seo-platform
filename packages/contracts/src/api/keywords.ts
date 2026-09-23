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
  "MOVE_TO_GROUP",
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

export const semanticRankDimensionSorts = [
  "RANK_POSITION_ASC",
  "RANK_POSITION_DESC",
  "RANK_CHECKED_AT_ASC",
  "RANK_CHECKED_AT_DESC",
  "RANK_AI_POSITION_ASC",
  "RANK_AI_POSITION_DESC",
  "RANK_AI_CHECKED_AT_ASC",
  "RANK_AI_CHECKED_AT_DESC"
] as const;

export type SemanticRankDimensionSort =
  (typeof semanticRankDimensionSorts)[number];

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
  "GOOGLE_CHECKED_AT_DESC",
  "YANDEX_AI_POSITION_ASC",
  "YANDEX_AI_POSITION_DESC",
  "GOOGLE_AI_POSITION_ASC",
  "GOOGLE_AI_POSITION_DESC",
  "YANDEX_AI_CHECKED_AT_ASC",
  "YANDEX_AI_CHECKED_AT_DESC",
  "GOOGLE_AI_CHECKED_AT_ASC",
  "GOOGLE_AI_CHECKED_AT_DESC",
  ...semanticRankDimensionSorts
] as const;

export type SemanticKeywordSort =
  (typeof semanticKeywordSorts)[number];

export function isSemanticRankDimensionSort(
  sort: SemanticKeywordSort
): sort is SemanticRankDimensionSort {
  return semanticRankDimensionSorts.some((value) => value === sort);
}

export const semanticKeywordPageSizes = [100, 200, 500, 1_000] as const;
export const semanticKeywordDefaultPageSize = semanticKeywordPageSizes[0];
export type SemanticKeywordPageSize =
  (typeof semanticKeywordPageSizes)[number];
export const semanticKeywordMaxPageSize: SemanticKeywordPageSize = 1_000;
export const semanticKeywordNotesMaxPageSize = 200;
export const semanticKeywordMultiSearchMaxTerms = 500;

export interface SemanticKeywordTagOption {
  readonly id: string;
  readonly name: string;
  readonly keywordCount: number;
}

export interface SemanticKeywordTagDeleteResult {
  readonly tagId: string;
  readonly name: string;
  readonly detachedKeywordCount: number;
}

export const semanticKeywordMultiSearchModes = [
  "EXACT",
  "CONTAINS",
  "ALL_WORDS"
] as const;
export type SemanticKeywordMultiSearchMode =
  (typeof semanticKeywordMultiSearchModes)[number];

export interface SemanticKeywordMultiSearch {
  readonly terms: readonly string[];
  readonly mode: SemanticKeywordMultiSearchMode;
}

export interface KeywordListQuery {
  readonly limit: number;
  readonly cursor?: string;
  /** Expensive list enrichments explicitly requested by the current table layout. */
  readonly metricProjection?: readonly SemanticKeywordMetricProjection[];
  /** Exact dynamic city/device columns rendered by the current table layout. */
  readonly rankColumnKeys?: readonly import("./rank-dimensions.js").SemanticRankColumnKey[];
  /** Include the full keyword note for API/export consumers; false by default. */
  readonly includeNotes?: boolean;
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
  /** Required only when sort addresses one exact geographic rank dimension. */
  readonly rankSortDimensionKey?: string;
  readonly sort?: SemanticKeywordSort;
  /** Body-only multiline search. It is never serialized into a URL. */
  readonly multiSearch?: SemanticKeywordMultiSearch;
}

export interface SemanticKeywordMultiSearchInput {
  readonly query: Omit<KeywordListQuery, "multiSearch">;
  readonly search: SemanticKeywordMultiSearch;
}

export interface SemanticKeywordListItem {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  /** Legacy rolling-deployment preference; the table no longer renders a shortcut. */
  readonly showAiAnswerButton: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly groupPath?: string;
  /** Number of active regular folders containing this canonical keyword. */
  readonly groupMembershipCount?: number;
  readonly clusterId?: string;
  readonly clusterName?: string;
  readonly targetPageId?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  /** Cheap note-presence marker returned for every list projection. */
  readonly hasNote?: boolean;
  /** Returned only when the caller explicitly requests includeNotes=true. */
  readonly note?: string;
  /** A current found URL differs from the configured target URL. */
  readonly hasTargetUrlMismatch?: boolean;
  /** At least one current city/device snapshot contains several project URLs. */
  readonly hasMultipleRankingUrls?: boolean;
  readonly customValues?: readonly import("./semantic-custom-columns.js").SemanticKeywordCustomValue[];
  readonly frequency?: SemanticKeywordListFrequency;
  readonly frequencies?: readonly SemanticKeywordListFrequencyValue[];
  readonly positions?: readonly SemanticKeywordListPosition[];
  readonly aiAnswers?: readonly import("./ai-answer-collections.js").SemanticAiAnswerSummary[];
  /** Exact rank cells resolved inside the same page read. */
  readonly rankComparison?: Readonly<{
    readonly dimensionKeys: readonly string[];
    readonly items: readonly import("./rank-dimensions.js").SemanticRankComparisonItem[];
  }>;
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

export const semanticKeywordMetricProjections = [
  "BASE",
  "FREQUENCIES",
  "POSITIONS",
  "AI_ANSWERS",
  "TARGET_URL_INDICATOR",
  "MULTIPLE_URL_INDICATOR",
  "RANKING_SITE_RESULTS"
] as const;

export type SemanticKeywordMetricProjection =
  (typeof semanticKeywordMetricProjections)[number];

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
  /** Exact city/device slice that supplied this engine-level latest value. */
  readonly dimension?: import("./rank-dimensions.js").SemanticRankDimension;
  readonly found: boolean;
  readonly position?: number;
  readonly previousPosition?: number;
  readonly rankingUrl?: string;
  /** Pages of the tracked project present in the latest stored SERP. */
  readonly siteResults?: readonly SemanticKeywordListSiteResult[];
  readonly observedAt: string;
}

export interface SemanticKeywordListSiteResult {
  readonly position: number;
  readonly rankingUrl: string;
  readonly faviconUrl?: string;
  readonly title?: string;
  readonly snippet?: string;
}

export const projectPositionTopThresholds = [1, 3, 5, 10, 30, 50] as const;
export type ProjectPositionTopThreshold =
  (typeof projectPositionTopThresholds)[number];

export const projectPositionHistoryDefaultSlices = 30 as const;
export const projectPositionHistoryMaxPoints = 100 as const;

export interface ProjectPositionTopCounts {
  readonly top1KeywordCount: number;
  readonly top3KeywordCount: number;
  readonly top5KeywordCount: number;
  readonly top10KeywordCount: number;
  readonly top30KeywordCount: number;
  readonly top50KeywordCount: number;
}

export interface ProjectPositionSummary extends ProjectPositionTopCounts {
  readonly positionedKeywordCount: number;
  readonly averagePosition?: number;
}

export interface ProjectPositionHistoryPoint extends ProjectPositionTopCounts {
  /** Stable UTC calendar day represented by this aggregate. */
  readonly id: string;
  /** YYYY-MM-DD in the server's UTC reporting calendar. */
  readonly date: string;
  /** Latest source observation included in this daily aggregate. */
  readonly observedAt: string;
  readonly measuredKeywordCount: number;
  readonly positionedKeywordCount: number;
}

export interface ProjectPositionHistory {
  readonly points: readonly ProjectPositionHistoryPoint[];
  /** More immutable slices exist before the bounded projection. */
  readonly truncated: boolean;
}

export interface ProjectPositionHistoryQuery {
  /** Include active keywords that are currently excluded from rank tracking. */
  readonly includeUntracked: boolean;
  /** Optional exact search engine, city, language and device slice. */
  readonly rankDimensionKey?: string;
}

export interface CreateSemanticKeywordInput {
  readonly text: string;
  readonly note?: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  /** Defaults to true when omitted by an older client. */
  readonly isTracked?: boolean;
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
> & Readonly<{
  /** Optional row-level override; the bulk policy remains the fallback. */
  duplicatePolicy?: SemanticKeywordDuplicatePolicy;
  /** Folder used when ADD_TO_GROUP or MOVE_TO_GROUP resolves an existing row. */
  duplicateGroupId?: string;
}>;

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

export const semanticKeywordBulkCreatePreviewMaxItems = 100;
export const semanticKeywordBulkCreatePreviewMaxGroups = 50;

export const semanticKeywordBulkCreatePreviewStates = [
  "NEW",
  "ACTIVE_DUPLICATE",
  "TRASHED_DUPLICATE",
  "RESTORABLE_DELETED"
] as const;

export type SemanticKeywordBulkCreatePreviewState =
  (typeof semanticKeywordBulkCreatePreviewStates)[number];

export interface SemanticKeywordBulkCreatePreviewItemInput {
  readonly text: string;
  readonly language: string;
  readonly groupId?: string;
}

export interface SemanticKeywordBulkCreatePreviewInput {
  readonly items: readonly SemanticKeywordBulkCreatePreviewItemInput[];
}

export interface SemanticKeywordBulkCreatePreviewGroup {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly systemKind?: SemanticKeywordGroupSystemKind;
}

export interface SemanticKeywordBulkCreatePreviewRow {
  readonly index: number;
  readonly state: SemanticKeywordBulkCreatePreviewState;
  readonly keywordId?: string;
  readonly version?: number;
  readonly groups: readonly SemanticKeywordBulkCreatePreviewGroup[];
  readonly groupsTruncated: boolean;
  readonly inTargetGroup: boolean;
}

export interface SemanticKeywordBulkCreatePreviewResult {
  readonly selected: number;
  readonly newKeywords: number;
  readonly activeDuplicates: number;
  readonly trashedDuplicates: number;
  readonly restorableDeleted: number;
  readonly rows: readonly SemanticKeywordBulkCreatePreviewRow[];
}

export interface UpdateSemanticKeywordInput {
  readonly text?: string;
  readonly language?: string;
  readonly priority?: number;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly showAiAnswerButton?: boolean;
  readonly intent?: SemanticKeywordIntent | null;
  readonly groupId?: string | null;
  readonly clusterId?: string | null;
  readonly targetUrl?: string | null;
  readonly tagNames?: readonly string[];
  /** Explicit tag deltas preserve every other existing membership. */
  readonly addTagNames?: readonly string[];
  readonly removeTagNames?: readonly string[];
  readonly note?: string | null;
}

export interface InternalCreateSemanticKeywordInput
  extends CreateSemanticKeywordInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
  readonly duplicatePolicy: SemanticKeywordDuplicatePolicy;
  readonly duplicateGroupId?: string;
}

export interface InternalSemanticKeywordBulkCreateInput
  extends SemanticKeywordBulkCreateInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}

export interface InternalSemanticKeywordBulkCreatePreviewInput
  extends SemanticKeywordBulkCreatePreviewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
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

/** Stable project palette shared by group editing and its team legend. */
export const semanticGroupPaletteColors = [
  "#ff0000",
  "#ff8a00",
  "#f2c94c",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#2563eb",
  "#4f46e5",
  "#6758ef",
  "#ec4899",
  "#a8a5b8",
  "#8b4513",
  "#9f1239",
  "#0f766e",
  "#334155"
] as const;

export type SemanticGroupPaletteColor =
  (typeof semanticGroupPaletteColors)[number];

export const semanticGroupColorLegendNoteMaxLength = 240;

export interface SemanticGroupColorLegendEntry {
  readonly color: SemanticGroupPaletteColor;
  readonly note: string;
}

/**
 * Core SEO projection. Version 0 is a virtual, not-yet-created legend and is
 * accepted as the first-update precondition and as an empty seen-state no-op.
 */
export interface SemanticGroupColorLegendState {
  readonly entries: readonly SemanticGroupColorLegendEntry[];
  readonly version: number;
  readonly unread: boolean;
  readonly updatedAt?: string;
  readonly updatedByUserId?: string;
}

export interface SemanticGroupColorLegend extends SemanticGroupColorLegendState {
  readonly access: Readonly<{ canManage: boolean }>;
}

export interface UpdateSemanticGroupColorLegendInput {
  readonly entries: readonly SemanticGroupColorLegendEntry[];
}

export interface InternalUpdateSemanticGroupColorLegendInput
  extends UpdateSemanticGroupColorLegendInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly canManage: boolean;
  readonly version: number;
}

export interface InternalMarkSemanticGroupColorLegendSeenInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface CreateSemanticKeywordGroupInput {
  readonly name: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly position?: number;
}

/** A single interactive command stays bounded even when a project has no folder limit. */
export const semanticKeywordGroupBulkCreateMaxItems = 200;

export interface CreateSemanticKeywordGroupsInput {
  readonly names: readonly string[];
  readonly parentId?: string;
  readonly color?: string;
  readonly position?: number;
}

export interface DuplicateSemanticKeywordGroupInput {
  readonly name: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly includeDescendants: boolean;
  readonly includeKeywords: boolean;
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

export interface InternalCreateSemanticKeywordGroupsInput
  extends CreateSemanticKeywordGroupsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}

export interface InternalDuplicateSemanticKeywordGroupInput
  extends DuplicateSemanticKeywordGroupInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
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
  readonly promoteChildren: boolean;
}

export interface SemanticKeywordBulkSelection {
  readonly id: string;
  readonly version: number;
}

/** Lightweight server projection used to freeze large operation scopes. */
export interface SemanticOperationScopeKeyword
  extends SemanticKeywordBulkSelection {
  readonly isTracked: boolean;
}

export interface SemanticOperationScopePageInput {
  readonly groupIds?: readonly string[];
  readonly cursor?: string;
}

export const semanticOperationScopePageSize = 10_000 as const;
export const semanticOperationScopeGroupLimit = 20_000 as const;

/** Synchronous write batch; clients split larger selections without losing the full selection. */
export const semanticKeywordBulkCommandMaxItems = 200;

export interface SemanticKeywordBulkPatch {
  readonly priority?: number;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly intent?: SemanticKeywordIntent | null;
  readonly groupId?: string | null;
  readonly clusterId?: string | null;
  readonly targetUrl?: string | null;
  readonly tagNames?: readonly string[];
  /** Safe additive bulk edit; does not replace the tags already on each row. */
  readonly addTagNames?: readonly string[];
  /** Removes only these explicitly selected tags, preserving all other tags. */
  readonly removeTagNames?: readonly string[];
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

export interface SemanticKeywordMergeSelection {
  readonly id: string;
  readonly version: number;
}

/** The keeper remains visible; every source becomes a historical alias. */
export interface SemanticKeywordMergeInput {
  readonly keeper: SemanticKeywordMergeSelection;
  readonly sources: readonly SemanticKeywordMergeSelection[];
}

export interface InternalSemanticKeywordMergeInput
  extends SemanticKeywordMergeInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface SemanticKeywordMergeResult {
  readonly keeperKeywordId: string;
  readonly keeperVersion: number;
  readonly mergedKeywordIds: readonly string[];
  readonly mergedAt: string;
}

export interface SemanticKeywordMergeSuggestion {
  readonly source: SemanticKeywordMergeSelection & Readonly<{
    text: string;
  }>;
  readonly candidate: SemanticKeywordMergeSelection & Readonly<{
    text: string;
  }>;
  readonly similarity: number;
  readonly reason: "BROKEN_ENCODING" | "SIMILAR_TEXT";
}

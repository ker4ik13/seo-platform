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

export const semanticKeywordSorts = [
  "CREATED_DESC",
  "CREATED_ASC",
  "UPDATED_DESC",
  "TEXT_ASC",
  "PRIORITY_DESC"
] as const;

export type SemanticKeywordSort =
  (typeof semanticKeywordSorts)[number];

export interface KeywordListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
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
  readonly targetPageId?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  readonly customValues?: readonly import("./semantic-custom-columns.js").SemanticKeywordCustomValue[];
  readonly sourceMode: SemanticKeywordSourceMode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface CreateSemanticKeywordInput {
  readonly text: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly targetUrl?: string;
  readonly tagNames: readonly string[];
}

export interface UpdateSemanticKeywordInput {
  readonly text?: string;
  readonly language?: string;
  readonly priority?: number;
  readonly isFavorite?: boolean;
  readonly intent?: SemanticKeywordIntent | null;
  readonly groupId?: string | null;
  readonly targetUrl?: string | null;
  readonly tagNames?: readonly string[];
}

export interface InternalCreateSemanticKeywordInput
  extends CreateSemanticKeywordInput {
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
}

export interface SemanticKeywordGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly position: number;
  readonly keywordCount: number;
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
}

export interface InternalCreateSemanticKeywordGroupInput
  extends CreateSemanticKeywordGroupInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
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

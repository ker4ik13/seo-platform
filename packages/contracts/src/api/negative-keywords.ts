import type { SemanticKeywordBulkSelection } from "./keywords.js";

export const semanticNegativeKeywordMatchModes = [
  "CONTAINS",
  "WHOLE_WORD",
  "EXACT_PHRASE",
  "WORD_FORM_FAST",
  "WORD_FORM_PRECISE"
] as const;

export type SemanticNegativeKeywordMatchMode =
  (typeof semanticNegativeKeywordMatchModes)[number];

export const semanticNegativeKeywordScopeKinds = [
  "PROJECT",
  "GROUP",
  "SELECTION"
] as const;

export type SemanticNegativeKeywordScopeKind =
  (typeof semanticNegativeKeywordScopeKinds)[number];

export const semanticNegativeKeywordWordLimit = 1_200;
export const semanticNegativeKeywordGroupScopeLimit = 2_000;

export interface SemanticNegativeKeywordRules {
  readonly words: readonly string[];
  readonly matchMode: SemanticNegativeKeywordMatchMode;
  readonly caseSensitive: boolean;
  readonly ignoreWordOrder: boolean;
  readonly ignorePunctuation: boolean;
}

export interface SemanticNegativeKeywordPreset {
  readonly id: string;
  readonly name: string;
  readonly rules: SemanticNegativeKeywordRules;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSemanticNegativeKeywordPresetInput {
  readonly name: string;
  readonly rules: SemanticNegativeKeywordRules;
}

export interface UpdateSemanticNegativeKeywordPresetInput {
  readonly name?: string;
  readonly rules?: SemanticNegativeKeywordRules;
}

export interface SemanticNegativeKeywordScope {
  readonly kind: SemanticNegativeKeywordScopeKind;
  /** Legacy single-folder field accepted during rolling deployments. */
  readonly groupId?: string;
  /** Selected folders after their visible descendants have been resolved. */
  readonly groupIds?: readonly string[];
  readonly items?: readonly SemanticKeywordBulkSelection[];
}

export interface SemanticNegativeKeywordCommandInput {
  readonly presetId?: string;
  readonly rules?: SemanticNegativeKeywordRules;
  readonly scope: SemanticNegativeKeywordScope;
}

export const semanticNegativeKeywordPreviewPageSizes = [100, 200] as const;
export type SemanticNegativeKeywordPreviewPageSize =
  (typeof semanticNegativeKeywordPreviewPageSizes)[number];

export const semanticNegativeKeywordExclusionLimit = 2_000;

export interface SemanticNegativeKeywordPreviewInput
  extends SemanticNegativeKeywordCommandInput {
  readonly page: number;
  readonly pageSize: SemanticNegativeKeywordPreviewPageSize;
}

export interface SemanticNegativeKeywordHighlightRange {
  /** UTF-16 offsets used directly by JavaScript String.slice. */
  readonly start: number;
  readonly end: number;
}

export interface SemanticNegativeKeywordMatch {
  readonly keywordId: string;
  readonly text: string;
  readonly version: number;
  readonly matchedWords: readonly string[];
  readonly highlightRanges: readonly SemanticNegativeKeywordHighlightRange[];
}

export interface SemanticNegativeKeywordPreview {
  readonly scannedCount: number;
  readonly matchedCount: number;
  readonly batchCount: number;
  readonly hasMore: boolean;
  readonly previewHash: string;
  readonly matches: readonly SemanticNegativeKeywordMatch[];
  readonly matchesTruncated: boolean;
  readonly page: number;
  readonly pageSize: SemanticNegativeKeywordPreviewPageSize;
  readonly pageCount: number;
}

export interface ApplySemanticNegativeKeywordsInput
  extends SemanticNegativeKeywordCommandInput {
  readonly previewHash: string;
  /** Matches explicitly unchecked by the user and therefore left active. */
  readonly excludedKeywordIds?: readonly string[];
}

export interface SemanticNegativeKeywordApplyResult {
  readonly deletedCount: number;
  readonly deletedKeywordIds: readonly string[];
  readonly hasMore: boolean;
}

export interface InternalCreateSemanticNegativeKeywordPresetInput
  extends CreateSemanticNegativeKeywordPresetInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalUpdateSemanticNegativeKeywordPresetInput
  extends UpdateSemanticNegativeKeywordPresetInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteSemanticNegativeKeywordPresetInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalSemanticNegativeKeywordCommandInput
  extends SemanticNegativeKeywordCommandInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalSemanticNegativeKeywordPreviewInput
  extends SemanticNegativeKeywordPreviewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalApplySemanticNegativeKeywordsInput
  extends ApplySemanticNegativeKeywordsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

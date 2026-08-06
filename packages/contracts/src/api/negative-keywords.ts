import type { SemanticKeywordBulkSelection } from "./keywords.js";

export const semanticNegativeKeywordMatchModes = [
  "CONTAINS",
  "WHOLE_WORD"
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

export interface SemanticNegativeKeywordRules {
  readonly words: readonly string[];
  readonly matchMode: SemanticNegativeKeywordMatchMode;
  readonly caseSensitive: boolean;
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
  readonly groupId?: string;
  readonly items?: readonly SemanticKeywordBulkSelection[];
}

export interface SemanticNegativeKeywordCommandInput {
  readonly presetId?: string;
  readonly rules?: SemanticNegativeKeywordRules;
  readonly scope: SemanticNegativeKeywordScope;
}

export interface SemanticNegativeKeywordMatch {
  readonly keywordId: string;
  readonly text: string;
  readonly version: number;
  readonly matchedWords: readonly string[];
}

export interface SemanticNegativeKeywordPreview {
  readonly scannedCount: number;
  readonly matchedCount: number;
  readonly batchCount: number;
  readonly hasMore: boolean;
  readonly previewHash: string;
  readonly matches: readonly SemanticNegativeKeywordMatch[];
  readonly matchesTruncated: boolean;
}

export interface ApplySemanticNegativeKeywordsInput
  extends SemanticNegativeKeywordCommandInput {
  readonly previewHash: string;
}

export interface SemanticNegativeKeywordApplyResult {
  readonly deletedCount: number;
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

export interface InternalApplySemanticNegativeKeywordsInput
  extends ApplySemanticNegativeKeywordsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

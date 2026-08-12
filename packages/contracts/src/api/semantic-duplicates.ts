import type { SemanticKeywordBulkSelection } from "./keywords.js";

export const semanticDuplicateAnalysisModes = [
  "EXACT",
  "WORD_FORM_PRECISE"
] as const;

export type SemanticDuplicateAnalysisMode =
  (typeof semanticDuplicateAnalysisModes)[number];

export const semanticDuplicateKeeperStrategies = [
  "HIGHEST_FREQUENCY",
  "HIGHEST_PRIORITY",
  "OLDEST"
] as const;

export type SemanticDuplicateKeeperStrategy =
  (typeof semanticDuplicateKeeperStrategies)[number];

export const semanticDuplicateScopeKinds = [
  "PROJECT",
  "GROUP",
  "SELECTION"
] as const;

export type SemanticDuplicateScopeKind =
  (typeof semanticDuplicateScopeKinds)[number];

export interface SemanticDuplicateRules {
  readonly analysisMode: SemanticDuplicateAnalysisMode;
  readonly caseSensitive: boolean;
  readonly ignorePunctuation: boolean;
  /** Words omitted from every phrase before its order-independent signature is built. */
  readonly ignoredWords: readonly string[];
}

export interface SemanticDuplicateScope {
  readonly kind: SemanticDuplicateScopeKind;
  readonly groupId?: string;
  readonly items?: readonly SemanticKeywordBulkSelection[];
}

export interface SemanticDuplicateCommandInput {
  readonly rules: SemanticDuplicateRules;
  readonly scope: SemanticDuplicateScope;
  readonly keeperStrategy: SemanticDuplicateKeeperStrategy;
}

export interface SemanticDuplicatePreviewItem {
  readonly keywordId: string;
  readonly text: string;
  readonly version: number;
  readonly groupPaths: readonly string[];
  readonly priority: number;
  readonly baseFrequency?: string;
  readonly keep: boolean;
}

export interface SemanticDuplicatePreviewGroup {
  /** Opaque deterministic identifier; the comparison signature is never exposed. */
  readonly id: string;
  readonly keeperKeywordId: string;
  readonly items: readonly SemanticDuplicatePreviewItem[];
  readonly itemsTruncated: boolean;
}

export interface SemanticDuplicatePreview {
  readonly scannedCount: number;
  readonly duplicateGroupCount: number;
  /** All active phrases participating in duplicate groups, including keepers. */
  readonly duplicateKeywordCount: number;
  /** Phrases recommended for the trash across the complete scope. */
  readonly deletionCount: number;
  /** Phrases committed by the preview hash and removed by the next apply call. */
  readonly batchItems: readonly SemanticKeywordBulkSelection[];
  readonly hasMore: boolean;
  readonly previewHash: string;
  readonly groups: readonly SemanticDuplicatePreviewGroup[];
  readonly groupsTruncated: boolean;
}

export interface SemanticDuplicateGroupDecision {
  /** Opaque preview group identifier. */
  readonly groupId: string;
  readonly keeper: SemanticKeywordBulkSelection;
  /** Every other visible phrase in this group that the user explicitly sends to trash. */
  readonly deletions: readonly SemanticKeywordBulkSelection[];
}

export interface ApplySemanticDuplicatesInput
  extends SemanticDuplicateCommandInput {
  readonly previewHash: string;
  /** Only groups explicitly selected in the reviewed preview are changed. */
  readonly decisions: readonly SemanticDuplicateGroupDecision[];
}

export interface SemanticDuplicateApplyResult {
  readonly deletedCount: number;
  readonly deletedKeywordIds: readonly string[];
  readonly hasMore: boolean;
}

export interface InternalSemanticDuplicateCommandInput
  extends SemanticDuplicateCommandInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalApplySemanticDuplicatesInput
  extends ApplySemanticDuplicatesInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

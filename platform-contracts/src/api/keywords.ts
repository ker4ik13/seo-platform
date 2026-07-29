export const semanticKeywordSourceModes = [
  "BYOK",
  "PLATFORM",
  "IMPORT",
  "MANUAL"
] as const;

export type SemanticKeywordSourceMode =
  (typeof semanticKeywordSourceModes)[number];

export interface KeywordListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
}

export interface SemanticKeywordListItem {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isTracked: boolean;
  readonly groupPath?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  readonly sourceMode: SemanticKeywordSourceMode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

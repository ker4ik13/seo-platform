export const semanticVersionReasons = [
  "KEYWORD_CREATE",
  "KEYWORD_UPDATE",
  "KEYWORD_DELETE",
  "BULK_UPDATE",
  "IMPORT",
  "UNDO",
  "LEGACY"
] as const;

export type SemanticVersionReason =
  (typeof semanticVersionReasons)[number];

export const semanticVersionChangeStates = [
  "APPLICABLE",
  "CONFLICTED",
  "UNSUPPORTED"
] as const;

export type SemanticVersionChangeState =
  (typeof semanticVersionChangeStates)[number];

export interface SemanticVersionListItem {
  readonly id: string;
  readonly number: number;
  readonly reason: SemanticVersionReason;
  readonly actorId: string;
  readonly sourceJobId?: string;
  readonly parentVersionId?: string;
  readonly summary: string;
  readonly affectedCount: number;
  readonly reversible: boolean;
  readonly finalizedAt?: string;
  readonly createdAt: string;
}

export interface SemanticVersionChangePreview {
  readonly entityType: "KEYWORD";
  readonly entityId: string;
  readonly operation: "CREATE" | "UPDATE" | "DELETE";
  readonly state: SemanticVersionChangeState;
  readonly expectedCurrentVersion: number;
  readonly currentVersion?: number;
  readonly conflictCode?: string;
}

export interface SemanticVersionUndoPreview {
  readonly version: SemanticVersionListItem;
  readonly applicable: number;
  readonly conflicted: number;
  readonly unsupported: number;
  readonly changes: readonly SemanticVersionChangePreview[];
}

export interface SemanticVersionUndoResult {
  readonly sourceVersionId: string;
  readonly createdVersion?: SemanticVersionListItem;
  readonly applied: number;
  readonly conflicted: number;
  readonly unsupported: number;
  readonly changes: readonly SemanticVersionChangePreview[];
}

export interface InternalUndoSemanticVersionInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export const semanticClusterMethods = ["MANUAL"] as const;

export type SemanticClusterMethod =
  (typeof semanticClusterMethods)[number];

export interface SemanticCluster {
  readonly id: string;
  readonly name: string;
  readonly method: SemanticClusterMethod;
  readonly keywordCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSemanticClusterInput {
  readonly name: string;
}

export interface UpdateSemanticClusterInput {
  readonly name: string;
}

export interface InternalCreateSemanticClusterInput
  extends CreateSemanticClusterInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalUpdateSemanticClusterInput
  extends UpdateSemanticClusterInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteSemanticClusterInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

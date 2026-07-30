export const semanticCustomColumnTypes = [
  "TEXT",
  "LONG_TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "SELECT",
  "MULTI_SELECT",
  "URL",
  "USER",
  "STATUS"
] as const;

export type SemanticCustomColumnType =
  (typeof semanticCustomColumnTypes)[number];

export interface SemanticCustomColumnOption {
  readonly id: string;
  readonly label: string;
  readonly color?: string;
}

export interface SemanticCustomColumnConfig {
  readonly required: boolean;
  readonly options?: readonly SemanticCustomColumnOption[];
}

export interface SemanticCustomColumn {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly type: SemanticCustomColumnType;
  readonly config: SemanticCustomColumnConfig;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSemanticCustomColumnInput {
  readonly name: string;
  readonly description?: string;
  readonly type: SemanticCustomColumnType;
  readonly config: SemanticCustomColumnConfig;
}

export interface UpdateSemanticCustomColumnInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly config?: SemanticCustomColumnConfig;
}

export interface InternalCreateSemanticCustomColumnInput
  extends CreateSemanticCustomColumnInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalUpdateSemanticCustomColumnInput
  extends UpdateSemanticCustomColumnInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteSemanticCustomColumnInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export type SemanticCustomColumnValueData =
  | string
  | number
  | boolean
  | readonly string[];

export interface SemanticKeywordCustomValue {
  readonly columnId: string;
  readonly value: SemanticCustomColumnValueData;
  readonly version: number;
  readonly updatedAt: string;
}

export interface SetSemanticKeywordCustomValueInput {
  readonly expectedVersion: number | null;
  readonly value: SemanticCustomColumnValueData;
}

export interface InternalSetSemanticKeywordCustomValueInput
  extends SetSemanticKeywordCustomValueInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalDeleteSemanticKeywordCustomValueInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

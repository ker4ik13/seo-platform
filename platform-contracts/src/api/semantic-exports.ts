import type {
  SemanticKeywordIntent,
  SemanticKeywordListItem,
  SemanticKeywordSort
} from "./keywords.js";
import type { SemanticSavedViewColumnKey } from "./semantic-saved-views.js";

export const semanticExportFormats = [
  "CSV",
  "TSV",
  "JSON",
  "NDJSON",
  "GOOGLE_CSV"
] as const;

export type SemanticExportFormat =
  (typeof semanticExportFormats)[number];

export const semanticExportScopes = [
  "SELECTED",
  "CURRENT_PAGE",
  "CURRENT_FILTER",
  "GROUP_SUBTREE",
  "FULL_CORE"
] as const;

export type SemanticExportScope =
  (typeof semanticExportScopes)[number];

export const semanticExportLocales = ["en", "ru"] as const;

export type SemanticExportLocale =
  (typeof semanticExportLocales)[number];

export interface SemanticExportFilters {
  readonly search?: string;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly priorityMin?: number;
  readonly priorityMax?: number;
}

export interface CreateSemanticExportInput {
  readonly format: SemanticExportFormat;
  readonly scope: SemanticExportScope;
  readonly locale: SemanticExportLocale;
  readonly columns: readonly SemanticSavedViewColumnKey[];
  readonly filters?: SemanticExportFilters;
  readonly sort?: SemanticKeywordSort;
  readonly keywordIds?: readonly string[];
  readonly includeBom?: boolean;
}

export interface SemanticExportDocument {
  readonly format: SemanticExportFormat;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly rowCount: number;
}

export interface SemanticExportDataset {
  readonly items: readonly SemanticKeywordListItem[];
  readonly customColumnNames: Readonly<Record<string, string>>;
}

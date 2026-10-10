import { parseSemanticRankDimensionKey } from "./rank-dimensions.js";

export const projectPageSortFields = ["URL", "HTTP", "INDEXABILITY", "KEYWORDS", "AVERAGE_POSITION", "TITLE", "H1", "RESPONSE_TIME", "SIZE", "ISSUES", "UPDATED_AT"] as const;
export type ProjectPageSortField = (typeof projectPageSortFields)[number];
export interface ProjectPageListOptions {
  readonly sort?: ProjectPageSortField;
  readonly sortDirection?: "ASC" | "DESC";
  readonly dimensionKey?: string;
  readonly date?: string;
  readonly includeStructure?: boolean;
}
export function parseProjectPageListOptions(value: Readonly<Record<string, unknown>>): ProjectPageListOptions {
  const { sort, sortDirection, dimensionKey, date, includeStructure } = value;
  if (sort !== undefined && !projectPageSortFields.includes(sort as ProjectPageSortField)) throw new TypeError("Invalid page sort");
  if (sortDirection !== undefined && sortDirection !== "ASC" && sortDirection !== "DESC") throw new TypeError("Invalid page direction");
  if (dimensionKey !== undefined && (typeof dimensionKey !== "string" || !parseSemanticRankDimensionKey(dimensionKey))) throw new TypeError("Invalid page dimension");
  if (date !== undefined && (typeof date !== "string" || (date !== "latest" && (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)))) throw new TypeError("Invalid page date");
  if (sort === "AVERAGE_POSITION" && !dimensionKey) throw new TypeError("Page position sort requires a dimension");
  if (includeStructure !== undefined && ![true, false, "true", "false"].includes(includeStructure as boolean)) throw new TypeError("Invalid structure flag");
  return { ...(sort === undefined ? {} : { sort: sort as ProjectPageSortField }), ...(sortDirection === undefined ? {} : { sortDirection }),
    ...(dimensionKey === undefined ? {} : { dimensionKey: dimensionKey as string }), ...(date === undefined ? {} : { date: date as string }),
    ...(includeStructure === undefined ? {} : { includeStructure: includeStructure === true || includeStructure === "true" }) };
}

export interface PageStatusInput {
  readonly operation: "archive" | "restore";
  readonly pageIds?: readonly string[];
  readonly pathPrefix?: string;
}
export interface PageStatusJobSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly status: "QUEUED" | "RUNNING" | "CANCEL_REQUESTED" | "CANCELLED" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED_FINAL";
  readonly processed: number;
  readonly total: number | null;
  readonly changed: number;
  readonly blocked: number;
  readonly errorCode?: string;
}
export interface PageStatusBatchResult { readonly changed: number; readonly blocked: number; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function pageStatusRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError("Invalid page status input");
  return value as Record<string, unknown>;
}
export function pageStatusId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new TypeError("Invalid page identifier");
  return value.toLowerCase();
}
export function pageStatusIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 50000) throw new TypeError("Invalid page selection");
  const ids = value.map(pageStatusId);
  if (new Set(ids).size !== ids.length) throw new TypeError("Duplicate page identifier");
  return ids;
}
export function parsePageStatusInput(value: unknown): PageStatusInput {
  const row = pageStatusRecord(value, ["operation", "pageIds", "pathPrefix"]);
  if (row.operation !== "archive" && row.operation !== "restore") throw new TypeError("Invalid page status action");
  if ((row.pageIds === undefined) === (row.pathPrefix === undefined)) throw new TypeError("Choose one page scope");
  if (row.pageIds !== undefined) {
    const pageIds = pageStatusIds(row.pageIds);
    if (!pageIds.length) throw new TypeError("Empty page selection");
    return { operation: row.operation, pageIds };
  }
  if (typeof row.pathPrefix !== "string" || !row.pathPrefix.startsWith("/") || row.pathPrefix.length > 2048 || /[?#\r\n]/u.test(row.pathPrefix)) throw new TypeError("Invalid page section");
  return { operation: row.operation, pathPrefix: row.pathPrefix };
}
export function parsePageStatusBatchResult(value: unknown): PageStatusBatchResult {
  const row = pageStatusRecord(value, ["changed", "blocked"]);
  if (![row.changed, row.blocked].every(count => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 200) || Number(row.changed) + Number(row.blocked) > 200) throw new TypeError("Invalid page action result");
  return { changed: Number(row.changed), blocked: Number(row.blocked) };
}
export function parsePageStatusJobSummary(value: unknown): PageStatusJobSummary {
  const row = pageStatusRecord(value, ["id", "workspaceId", "projectId", "status", "processed", "total", "changed", "blocked", "errorCode"]);
  if (!["QUEUED", "RUNNING", "CANCEL_REQUESTED", "CANCELLED", "COMPLETED", "PARTIALLY_COMPLETED", "FAILED_FINAL"].includes(String(row.status)) ||
      ![row.processed, row.changed, row.blocked].every(count => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 50000) ||
      (row.total !== null && (!Number.isSafeInteger(row.total) || Number(row.total) < Number(row.processed) || Number(row.total) > 50000)) ||
      Number(row.changed) + Number(row.blocked) !== Number(row.processed) ||
      (row.errorCode !== undefined && (typeof row.errorCode !== "string" || !/^[A-Z0-9_]{1,64}$/u.test(row.errorCode)))) throw new TypeError("Invalid page status job");
  return { id: pageStatusId(row.id), workspaceId: pageStatusId(row.workspaceId), projectId: pageStatusId(row.projectId), status: row.status as PageStatusJobSummary["status"], processed: Number(row.processed), total: row.total === null ? null : Number(row.total), changed: Number(row.changed), blocked: Number(row.blocked), ...(row.errorCode ? { errorCode: String(row.errorCode) } : {}) };
}

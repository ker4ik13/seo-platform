export const adminDirectorySorts = ["CREATED_DESC", "CREATED_ASC", "NAME_ASC", "NAME_DESC"] as const;
export type AdminDirectorySort = (typeof adminDirectorySorts)[number];

export interface AdminStateCommand {
  readonly status: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly confirmId: string;
  readonly confirmed: true;
  readonly reason: string;
}
export interface AdminStateResult {
  readonly id: string;
  readonly status: "ACTIVE" | "READ_ONLY" | "SUSPENDED" | "PENDING_VERIFICATION";
  readonly version: number;
}
export function parseAdminStateCommand(value: unknown): AdminStateCommand {
  const input = record(value, ["status", "confirmId", "confirmed", "reason"]);
  if (!["ACTIVE", "READ_ONLY", "SUSPENDED"].includes(String(input.status)) || input.confirmed !== true ||
      typeof input.confirmId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.confirmId) ||
      typeof input.reason !== "string" || input.reason.trim().length < 8 || input.reason.trim().length > 500) invalid();
  return { status: input.status as AdminStateCommand["status"], confirmId: input.confirmId, confirmed: true, reason: input.reason.trim() };
}
export function parseAdminStateResult(value: unknown): AdminStateResult {
  const input = record(value, ["id", "status", "version"]);
  if (typeof input.id !== "string" || !["ACTIVE", "READ_ONLY", "SUSPENDED", "PENDING_VERIFICATION"].includes(String(input.status)) ||
      !Number.isSafeInteger(input.version) || Number(input.version) < 1) invalid();
  return { id: input.id, status: input.status as AdminStateResult["status"], version: Number(input.version) };
}
export interface AdminCancelOperationCommand {
  readonly confirmId: string;
  readonly confirmed: true;
  readonly reason: string;
}
export function parseAdminCancelOperationCommand(value: unknown): AdminCancelOperationCommand {
  const input = record(value, ["confirmId", "confirmed", "reason"]);
  const parsed = parseAdminStateCommand({ ...input, status: "SUSPENDED" });
  return { confirmId: parsed.confirmId, confirmed: true, reason: parsed.reason };
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) invalid();
  return value as Record<string, unknown>;
}
function invalid(): never { throw new TypeError("Invalid administration command"); }

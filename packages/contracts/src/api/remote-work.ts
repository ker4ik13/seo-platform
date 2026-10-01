import { workerCapabilities, type WorkerCapability } from "./worker-nodes.js";

export const remoteWorkCommands = ["PROVIDER_HTTP", "CRAWL_RESOURCE", "IMPORT_ROWS", "EXPORT_FILE", "UPLOAD_INSPECTION"] as const;
export type RemoteWorkCommand = typeof remoteWorkCommands[number];
export type RemoteWorkResource = "HTTP" | "CPU";

/** Request material is delivered only to the assigned authenticated node. */
export interface RemoteWorkTask {
  readonly schemaVersion: "worker-work-task@1";
  readonly id: string;
  readonly ticket: string;
  readonly capability: WorkerCapability;
  readonly command: RemoteWorkCommand;
  readonly resource: RemoteWorkResource;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly deadline: string;
}

export interface RemoteWorkClaim {
  readonly httpSlots: number;
  readonly cpuSlots: number;
  readonly capabilitySlots: Readonly<Partial<Record<WorkerCapability, number>>>;
}

export interface RemoteWorkReceipt {
  readonly id: string;
  readonly state: "PENDING" | "CLAIMED" | "COMPLETED" | "FAILED" | "ABANDONED";
  readonly result?: Readonly<Record<string, unknown>>;
  readonly errorCode?: string;
}

export function parseRemoteWorkTask(value: unknown): RemoteWorkTask {
  const row = exact(value, ["schemaVersion", "id", "ticket", "capability", "command", "resource", "payload", "deadline"]);
  if (row.schemaVersion !== "worker-work-task@1" || !uuid(row.id) || typeof row.ticket !== "string" || row.ticket.length > 4096 ||
    !workerCapabilities.includes(row.capability as WorkerCapability) || !remoteWorkCommands.includes(row.command as RemoteWorkCommand) ||
    !["HTTP", "CPU"].includes(String(row.resource)) || typeof row.deadline !== "string" || !Number.isFinite(Date.parse(row.deadline))) invalid();
  object(row.payload);
  return row as unknown as RemoteWorkTask;
}

export function parseRemoteWorkClaim(value: unknown): RemoteWorkClaim {
  const row = exact(value, ["httpSlots", "cpuSlots", "capabilitySlots"]);
  if (!slots(row.httpSlots, 512) || !slots(row.cpuSlots, 128)) invalid();
  return { httpSlots: row.httpSlots, cpuSlots: row.cpuSlots, capabilitySlots: parseWorkerCapabilitySlots(row.capabilitySlots) };
}

export function parseWorkerCapabilitySlots(value: unknown): Readonly<Partial<Record<WorkerCapability, number>>> {
  const row = object(value);
  if (Object.keys(row).some((key) => !workerCapabilities.includes(key as WorkerCapability) || !slots(row[key], 512))) invalid();
  return row as Partial<Record<WorkerCapability, number>>;
}

export function parseRemoteWorkReceipt(value: unknown): RemoteWorkReceipt {
  const row = exact(value, ["id", "state", ...(has(value, "result") ? ["result"] : []), ...(has(value, "errorCode") ? ["errorCode"] : [])]);
  if (!uuid(row.id) || !["PENDING", "CLAIMED", "COMPLETED", "FAILED", "ABANDONED"].includes(String(row.state)) ||
    (row.errorCode !== undefined && (typeof row.errorCode !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(row.errorCode)))) invalid();
  if (row.result !== undefined) object(row.result);
  if ((row.state === "COMPLETED") !== (row.result !== undefined)) invalid();
  return row as unknown as RemoteWorkReceipt;
}

function has(value: unknown, key: string): boolean { return !!value && typeof value === "object" && Object.hasOwn(value, key); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }
function slots(value: unknown, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> { const row = object(value); if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key))) invalid(); return row; }
function invalid(): never { throw new TypeError("Invalid remote work contract"); }

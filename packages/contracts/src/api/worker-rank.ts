/**
 * Private Worker Gateway wire contract. The secret and keyword text exist
 * only in the HTTPS response for an assigned call. Neither may be persisted
 * on a worker, put in a queue, or exposed to a browser. A trusted worker may
 * log a bounded keyword excerpt only with explicit WORKER_LOG_QUERIES opt-in;
 * the credential and provider task ID are never logged.
 */
export interface RemoteRankClaimV1 {
  readonly availableSlots: number;
}

export function parseRemoteRankClaim(value: unknown): RemoteRankClaimV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 1 || !Object.hasOwn(value, "availableSlots")) {
    throw new TypeError("Invalid remote rank claim");
  }
  const availableSlots = (value as Record<string, unknown>).availableSlots;
  if (typeof availableSlots !== "number" || !Number.isSafeInteger(availableSlots) ||
    availableSlots < 1 || availableSlots > 512) {
    throw new TypeError("Invalid remote rank claim");
  }
  return { availableSlots };
}

export interface RemoteRankPollTaskV1 {
  readonly schemaVersion: "worker-rank-poll-task@1";
  readonly ticket: string;
  readonly provider: "XMLSTOCK";
  readonly providerTaskId: string;
  readonly requestSnapshot: unknown;
  readonly providerProgress?: unknown;
  readonly secret: {
    readonly apiKey: string;
    readonly accountIdentifier?: string;
  };
  readonly softId?: string;
  readonly timeoutMs: number;
}

export interface RemoteRankPollResultV1 {
  readonly schemaVersion: "worker-rank-poll-result@1";
  readonly ticket: string;
  readonly requestSnapshot: unknown;
  readonly outcome: unknown;
}

/** Several independent fenced receipts in one worker-to-center HTTPS call. */
export interface RemoteRankPollResultBatchV1 {
  readonly schemaVersion: "worker-rank-poll-result-batch@1";
  readonly entries: readonly RemoteRankPollResultV1[];
}

export function parseRemoteRankPollResultBatch(value: unknown): RemoteRankPollResultBatchV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid rank result batch");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || row.schemaVersion !== "worker-rank-poll-result-batch@1" ||
    !Array.isArray(row.entries) || row.entries.length < 1 || row.entries.length > 8) {
    throw new TypeError("Invalid rank result batch");
  }
  for (const entry of row.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Invalid rank result entry");
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).length !== 4 || item.schemaVersion !== "worker-rank-poll-result@1" ||
      typeof item.ticket !== "string" || item.ticket.length < 1 || item.ticket.length > 4096 ||
      !Object.hasOwn(item, "requestSnapshot") || !Object.hasOwn(item, "outcome")) {
      throw new TypeError("Invalid rank result entry");
    }
  }
  return row as unknown as RemoteRankPollResultBatchV1;
}

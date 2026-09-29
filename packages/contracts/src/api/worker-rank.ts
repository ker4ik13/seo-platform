/**
 * Private Worker Gateway wire contract. The secret and keyword text exist
 * only in the HTTPS response for an assigned call. Neither may be logged,
 * persisted on a worker, put in a queue, or exposed to a browser.
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

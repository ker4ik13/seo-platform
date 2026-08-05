export const realtimeTicketRequestSchemaVersion =
  "realtime-project-ticket-request@1" as const;
export const realtimeCollaborationNamespace =
  "/collaboration" as const;
export const realtimeTicketTtlMilliseconds = 30_000;
export const realtimeAuthorizationLeaseMilliseconds = 60_000;

export interface IssueRealtimeProjectTicketInput {
  readonly clientInstanceId: string;
}

/**
 * Trusted Platform API -> Realtime command. Tenant, membership and session
 * fields are injected from server-side authorization state and are never
 * copied from the browser request body.
 */
export interface InternalIssueRealtimeProjectTicketInput
  extends IssueRealtimeProjectTicketInput {
  readonly schemaVersion: "realtime-project-ticket-request@1";
  readonly userId: string;
  readonly sessionId: string;
  readonly sessionFamilyId: string;
  readonly sessionExpiresAt: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly origin: string;
}

export interface RealtimeProjectTicket {
  /** One-time 256-bit bearer capability. Only its SHA-256 hash is persisted. */
  readonly ticket: string;
  readonly namespace: "/collaboration";
  readonly issuedAt: string;
  /** Exactly 30 seconds after issuedAt. */
  readonly expiresAt: string;
  /** Exactly 60 seconds after issuedAt and never after the source session. */
  readonly authorizationExpiresAt: string;
}

export interface RealtimeReadyEvent {
  readonly connectionId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly clientInstanceId: string;
  readonly authorizationExpiresAt: string;
}

export type PresenceJoinResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly connectionId: string;
        readonly projectId: string;
        readonly authorizationExpiresAt: string;
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "UNAUTHENTICATED" | "VALIDATION_FAILED";
        readonly message: string;
      };
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// A canonical unpadded base64url encoding of exactly 32 bytes has 43
// characters. The final character contains four data bits and two zero bits.
// Keeping this check browser-safe prevents the root contracts export from
// depending on Node's Buffer implementation.
const OPAQUE_TICKET_PATTERN =
  /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;

export class InvalidRealtimeTicketContractError extends Error {
  public constructor() {
    super("Invalid realtime ticket contract");
    this.name = "InvalidRealtimeTicketContractError";
  }
}

export function issueRealtimeProjectTicketInput(
  value: unknown
): IssueRealtimeProjectTicketInput {
  const input = exactRecord(value, ["clientInstanceId"]);
  return {
    clientInstanceId: uuid(input.clientInstanceId)
  };
}

export function internalIssueRealtimeProjectTicketInput(
  value: unknown
): InternalIssueRealtimeProjectTicketInput {
  const input = exactRecord(value, [
    "schemaVersion",
    "userId",
    "sessionId",
    "sessionFamilyId",
    "sessionExpiresAt",
    "workspaceId",
    "projectId",
    "membershipId",
    "membershipVersion",
    "clientInstanceId",
    "origin"
  ]);
  if (
    input.schemaVersion !== realtimeTicketRequestSchemaVersion ||
    !Number.isSafeInteger(input.membershipVersion) ||
    Number(input.membershipVersion) < 1 ||
    Number(input.membershipVersion) > 2_147_483_647
  ) {
    invalid();
  }
  return {
    schemaVersion: realtimeTicketRequestSchemaVersion,
    userId: uuid(input.userId),
    sessionId: uuid(input.sessionId),
    sessionFamilyId: uuid(input.sessionFamilyId),
    sessionExpiresAt: isoTimestamp(input.sessionExpiresAt),
    workspaceId: uuid(input.workspaceId),
    projectId: uuid(input.projectId),
    membershipId: uuid(input.membershipId),
    membershipVersion: Number(input.membershipVersion),
    clientInstanceId: uuid(input.clientInstanceId),
    origin: canonicalOrigin(input.origin)
  };
}

export function realtimeProjectTicket(
  value: unknown
): RealtimeProjectTicket {
  const ticket = exactRecord(value, [
    "ticket",
    "namespace",
    "issuedAt",
    "expiresAt",
    "authorizationExpiresAt"
  ]);
  if (
    typeof ticket.ticket !== "string" ||
    !OPAQUE_TICKET_PATTERN.test(ticket.ticket) ||
    ticket.namespace !== realtimeCollaborationNamespace
  ) {
    invalid();
  }
  const issuedAt = isoTimestamp(ticket.issuedAt);
  const expiresAt = isoTimestamp(ticket.expiresAt);
  const authorizationExpiresAt = isoTimestamp(
    ticket.authorizationExpiresAt
  );
  if (
    Date.parse(expiresAt) - Date.parse(issuedAt) !==
      realtimeTicketTtlMilliseconds ||
    Date.parse(authorizationExpiresAt) - Date.parse(issuedAt) !==
      realtimeAuthorizationLeaseMilliseconds
  ) {
    invalid();
  }
  return {
    ticket: ticket.ticket,
    namespace: realtimeCollaborationNamespace,
    issuedAt,
    expiresAt,
    authorizationExpiresAt
  };
}

export function isRealtimeOpaqueTicket(value: unknown): value is string {
  return (
    typeof value === "string" &&
    OPAQUE_TICKET_PATTERN.test(value)
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalid();
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (
    keys.length !== fields.length ||
    !keys.every((key) => fields.includes(key))
  ) {
    return invalid();
  }
  return record;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    return invalid();
  }
  return value;
}

function canonicalOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return invalid();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    parsed.origin !== value
  ) {
    return invalid();
  }
  return value;
}

function invalid(): never {
  throw new InvalidRealtimeTicketContractError();
}

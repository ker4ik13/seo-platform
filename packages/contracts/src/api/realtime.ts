export const realtimeTicketRequestSchemaVersion =
  "realtime-project-ticket-request@1" as const;
export const realtimeCollaborationNamespace =
  "/collaboration" as const;
export const realtimeCollaborationEvents = {
  ready: "realtime.ready",
  presenceJoin: "presence.join",
  presenceUpdate: "presence.update",
  presenceJoined: "presence.joined",
  presenceUpdated: "presence.updated",
  presenceLeft: "presence.left"
} as const;
export const realtimeTicketTtlMilliseconds = 30_000;
export const realtimeAuthorizationLeaseMilliseconds = 60_000;
export const projectPresenceCursorIntervalMilliseconds = 80;
export const projectPresenceHeartbeatMilliseconds = 15_000;
export const projectPresenceTtlMilliseconds = 30_000;
export const projectPresenceMaximumSelectionIds = 50;
export const projectPresenceMaximumViewGroupIds = 50;
export const projectPresenceMaximumMembers = 200;
export const projectPresenceMaximumConnections = 500;

export type ProjectPresenceStatus = "ACTIVE" | "AWAY";
export type ProjectPresenceSelectionEntity = "KEYWORD" | "PAGE" | "NOTE";

export interface ProjectPresenceCursor {
  /** Viewport-relative coordinates in the inclusive 0..1 range. */
  readonly x: number;
  readonly y: number;
  /** Optional stable DOM anchor; never contains visible/user-entered text. */
  readonly targetKey: string | null;
  readonly targetX: number | null;
  readonly targetY: number | null;
}

export interface ProjectPresenceSelection {
  readonly entity: ProjectPresenceSelectionEntity;
  readonly selectedIds: readonly string[];
  readonly highlightedIds: readonly string[];
  readonly columnId: string | null;
}

export interface ProjectPresenceViewContext {
  readonly kind: "SEMANTIC_CORE";
  /** Empty means the root "all keywords" view. */
  readonly groupIds: readonly string[];
}

export const projectPresenceActivities = [
  "SEMANTIC_ADD",
  "SEMANTIC_IMPORT",
  "SEMANTIC_FREQUENCY",
  "SEMANTIC_POSITIONS",
  "SEMANTIC_AI_ANSWERS",
  "SEMANTIC_CLUSTERING",
  "SEMANTIC_NEGATIVE_KEYWORDS",
  "SEMANTIC_DUPLICATES",
  "SEMANTIC_DELETE",
  "SEMANTIC_EXPORT",
  "SEMANTIC_HISTORY",
  "SEMANTIC_OPERATIONS",
  "SEMANTIC_LAYOUT",
  "SEMANTIC_KEYWORD",
  "SEMANTIC_GROUP",
  "SEMANTIC_MOVE",
  "SEMANTIC_EDIT"
] as const;

export type ProjectPresenceActivity =
  (typeof projectPresenceActivities)[number];

export interface ProjectPresenceUpdateInput {
  /** Normalized application pathname without query string or fragment. */
  readonly route: string;
  readonly status: ProjectPresenceStatus;
  readonly cursor: ProjectPresenceCursor | null;
  readonly selection: ProjectPresenceSelection | null;
  readonly view: ProjectPresenceViewContext | null;
  /** Stable UI activity code. Visible text and modal contents never leave the client. */
  readonly activity: ProjectPresenceActivity | null;
  readonly editing: boolean;
  readonly sequence: number;
}

export interface ProjectPresenceParticipant
  extends ProjectPresenceUpdateInput {
  readonly connectionId: string;
  readonly userId: string;
  readonly clientInstanceId: string;
  readonly updatedAt: string;
}

export interface ProjectPresenceMember {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUpdatedAt?: string;
}

export interface ProjectPresenceParticipantEvent {
  readonly participant: ProjectPresenceParticipant;
}

export interface ProjectPresenceLeftEvent {
  readonly connectionId: string;
  readonly userId: string;
  readonly occurredAt: string;
}

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
        readonly participant: ProjectPresenceParticipant;
        readonly participants: readonly ProjectPresenceParticipant[];
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "UNAUTHENTICATED"
          | "VALIDATION_FAILED"
          | "PROVIDER_UNAVAILABLE";
        readonly message: string;
      };
    };

export type PresenceUpdateResult =
  | {
      readonly ok: true;
      readonly data: ProjectPresenceParticipant;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "UNAUTHENTICATED"
          | "VALIDATION_FAILED"
          | "RATE_LIMITED"
          | "PROVIDER_UNAVAILABLE";
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

export function projectPresenceUpdateInput(
  value: unknown
): ProjectPresenceUpdateInput {
  const input = optionalExactRecord(
    value,
    ["route", "status", "cursor", "selection", "editing", "sequence"],
    ["view", "activity"]
  );
  if (
    typeof input.route !== "string" ||
    input.route.length > 256 ||
    !/^\/app(?:\/[A-Za-z0-9_-]{1,80}){0,8}$/u.test(input.route) ||
    (input.status !== "ACTIVE" && input.status !== "AWAY") ||
    typeof input.editing !== "boolean" ||
    !Number.isSafeInteger(input.sequence) ||
    Number(input.sequence) < 0 ||
    Number(input.sequence) > 2_147_483_647
  ) {
    return invalid();
  }
  return {
    route: input.route,
    status: input.status,
    cursor:
      input.cursor === null
        ? null
        : projectPresenceCursor(input.cursor),
    selection:
      input.selection === null
        ? null
        : projectPresenceSelection(input.selection),
    view:
      input.view === undefined || input.view === null
        ? null
        : projectPresenceViewContext(input.view),
    activity:
      input.activity === undefined || input.activity === null
        ? null
        : projectPresenceActivity(input.activity),
    editing: input.editing,
    sequence: Number(input.sequence)
  };
}

export function projectPresenceMembers(
  value: unknown
): readonly ProjectPresenceMember[] {
  if (
    !Array.isArray(value) ||
    value.length > projectPresenceMaximumMembers
  ) {
    return invalid();
  }
  return value.map((candidate) => {
    const member = optionalExactRecord(
      candidate,
      ["userId", "displayName"],
      ["avatarUpdatedAt"]
    );
    if (
      typeof member.displayName !== "string" ||
      member.displayName.length < 1 ||
      member.displayName.length > 160 ||
      member.displayName.trim() !== member.displayName
    ) {
      return invalid();
    }
    return {
      userId: uuid(member.userId),
      displayName: member.displayName,
      ...(member.avatarUpdatedAt === undefined
        ? {}
        : { avatarUpdatedAt: isoTimestamp(member.avatarUpdatedAt) })
    };
  });
}

export function projectPresenceParticipant(
  value: unknown
): ProjectPresenceParticipant {
  const participant = optionalExactRecord(
    value,
    [
      "connectionId",
      "userId",
      "clientInstanceId",
      "route",
      "status",
      "cursor",
      "selection",
      "editing",
      "sequence",
      "updatedAt"
    ],
    ["view", "activity"]
  );
  if (
    typeof participant.connectionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(participant.connectionId)
  ) {
    return invalid();
  }
  const update = projectPresenceUpdateInput({
    route: participant.route,
    status: participant.status,
    cursor: participant.cursor,
    selection: participant.selection,
    view: participant.view ?? null,
    activity: participant.activity ?? null,
    editing: participant.editing,
    sequence: participant.sequence
  });
  return {
    connectionId: participant.connectionId,
    userId: uuid(participant.userId),
    clientInstanceId: uuid(participant.clientInstanceId),
    ...update,
    updatedAt: isoTimestamp(participant.updatedAt)
  };
}

function projectPresenceActivity(value: unknown): ProjectPresenceActivity {
  if (
    typeof value !== "string" ||
    !(projectPresenceActivities as readonly string[]).includes(value)
  ) {
    return invalid();
  }
  return value as ProjectPresenceActivity;
}

function projectPresenceViewContext(
  value: unknown
): ProjectPresenceViewContext {
  const view = exactRecord(value, ["kind", "groupIds"]);
  if (
    view.kind !== "SEMANTIC_CORE" ||
    !Array.isArray(view.groupIds) ||
    view.groupIds.length > projectPresenceMaximumViewGroupIds
  ) {
    return invalid();
  }
  return {
    kind: "SEMANTIC_CORE",
    groupIds: [...uniqueUuids(view.groupIds)].sort()
  };
}

function projectPresenceCursor(value: unknown): ProjectPresenceCursor {
  const cursor = exactRecord(value, [
    "x",
    "y",
    "targetKey",
    "targetX",
    "targetY"
  ]);
  const targetKey = cursor.targetKey;
  const targetX = cursor.targetX;
  const targetY = cursor.targetY;
  if (
    !unitCoordinate(cursor.x) ||
    !unitCoordinate(cursor.y) ||
    (targetKey !== null &&
      (typeof targetKey !== "string" ||
        !/^[A-Za-z0-9:_-]{1,180}$/u.test(targetKey))) ||
    (targetKey === null && (targetX !== null || targetY !== null)) ||
    (targetKey !== null &&
      (!unitCoordinate(targetX) || !unitCoordinate(targetY)))
  ) {
    return invalid();
  }
  return {
    x: Number(cursor.x),
    y: Number(cursor.y),
    targetKey,
    targetX: targetX === null ? null : Number(targetX),
    targetY: targetY === null ? null : Number(targetY)
  };
}

function projectPresenceSelection(
  value: unknown
): ProjectPresenceSelection {
  const selection = exactRecord(value, [
    "entity",
    "selectedIds",
    "highlightedIds",
    "columnId"
  ]);
  if (
    !["KEYWORD", "PAGE", "NOTE"].includes(String(selection.entity)) ||
    !Array.isArray(selection.selectedIds) ||
    !Array.isArray(selection.highlightedIds) ||
    selection.selectedIds.length > projectPresenceMaximumSelectionIds ||
    selection.highlightedIds.length > projectPresenceMaximumSelectionIds ||
    (selection.columnId !== null &&
      (typeof selection.columnId !== "string" ||
        !/^[A-Za-z0-9:_-]{1,80}$/u.test(selection.columnId)))
  ) {
    return invalid();
  }
  const selectedIds = uniqueUuids(selection.selectedIds);
  const highlightedIds = uniqueUuids(selection.highlightedIds);
  return {
    entity: selection.entity as ProjectPresenceSelectionEntity,
    selectedIds,
    highlightedIds,
    columnId: selection.columnId as string | null
  };
}

function uniqueUuids(values: readonly unknown[]): readonly string[] {
  const result = values.map(uuid);
  if (new Set(result).size !== result.length) return invalid();
  return result;
}

function unitCoordinate(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
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

function optionalExactRecord(
  value: unknown,
  requiredFields: readonly string[],
  optionalFields: readonly string[]
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
    !requiredFields.every((field) => keys.includes(field)) ||
    !keys.every(
      (key) =>
        requiredFields.includes(key) || optionalFields.includes(key)
    )
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

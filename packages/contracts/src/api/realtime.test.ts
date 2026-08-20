import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  internalIssueRealtimeProjectTicketInput,
  InvalidRealtimeTicketContractError,
  isRealtimeOpaqueTicket,
  issueRealtimeProjectTicketInput,
  projectPresenceMembers,
  projectPresenceParticipant,
  projectPresenceUpdateInput,
  realtimeAuthorizationLeaseMilliseconds,
  realtimeProjectTicket,
  realtimeTicketRequestSchemaVersion,
  realtimeTicketTtlMilliseconds
} from "./realtime.js";

const ID = "0198f258-8cc7-7abc-8def-1234567890ab";

test("accepts only the browser client instance field", () => {
  assert.deepEqual(issueRealtimeProjectTicketInput({ clientInstanceId: ID }), {
    clientInstanceId: ID
  });
  assert.throws(
    () =>
      issueRealtimeProjectTicketInput({
        clientInstanceId: ID,
        projectId: ID
      }),
    InvalidRealtimeTicketContractError
  );
});

test("parses an exact trusted project, membership and session snapshot", () => {
  const input = internalInput();
  assert.deepEqual(internalIssueRealtimeProjectTicketInput(input), input);

  for (const mutation of [
    { ...input, membershipVersion: 0 },
    { ...input, origin: "https://app.example.test/path" },
    { ...input, sessionFamilyId: input.sessionFamilyId.toUpperCase() },
    { ...input, unknown: true }
  ]) {
    assert.throws(
      () => internalIssueRealtimeProjectTicketInput(mutation),
      InvalidRealtimeTicketContractError
    );
  }
});

test("requires a canonical 256-bit ticket with exact ticket and lease TTLs", () => {
  const issuedAt = new Date("2026-07-30T12:00:00.000Z");
  const value = {
    ticket: randomBytes(32).toString("base64url"),
    namespace: "/collaboration",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + realtimeTicketTtlMilliseconds
    ).toISOString(),
    authorizationExpiresAt: new Date(
      issuedAt.getTime() + realtimeAuthorizationLeaseMilliseconds
    ).toISOString()
  };
  assert.deepEqual(realtimeProjectTicket(value), value);
  assert.throws(
    () =>
      realtimeProjectTicket({
        ...value,
        expiresAt: new Date(issuedAt.getTime() + 29_999).toISOString()
      }),
    InvalidRealtimeTicketContractError
  );
  assert.throws(
    () =>
      realtimeProjectTicket({
        ...value,
        ticket: `${"A".repeat(42)}B`
      }),
    InvalidRealtimeTicketContractError
  );

  for (let lowNibble = 0; lowNibble < 16; lowNibble += 1) {
    const bytes = Buffer.alloc(32);
    bytes[31] = lowNibble;
    assert.equal(
      isRealtimeOpaqueTicket(bytes.toString("base64url")),
      true
    );
  }
  assert.equal(isRealtimeOpaqueTicket(`${"A".repeat(42)}B`), false);
});

test("accepts only bounded cursor coordinates and semantic selection identifiers", () => {
  const value = {
    route: "/app/semantics",
    status: "ACTIVE",
    cursor: {
      x: 0.25,
      y: 0.75,
      targetKey: `keyword:${ID}`,
      targetX: 0.5,
      targetY: 0.5
    },
    selection: {
      entity: "KEYWORD",
      selectedIds: [ID],
      highlightedIds: [
        "0198f258-8cc7-7abc-8def-1234567890ac"
      ],
      columnId: "query"
    },
    editing: false,
    sequence: 7
  } as const;
  assert.deepEqual(projectPresenceUpdateInput(value), value);

  for (const mutation of [
    { ...value, route: "/app/semantics?secret=value" },
    { ...value, projectId: ID },
    { ...value, cursor: { ...value.cursor, x: 1.01 } },
    {
      ...value,
      cursor: { ...value.cursor, targetKey: "visible keyword text" }
    },
    {
      ...value,
      selection: {
        ...value.selection,
        selectedIds: [ID, ID]
      }
    }
  ]) {
    assert.throws(
      () => projectPresenceUpdateInput(mutation),
      InvalidRealtimeTicketContractError
    );
  }
});

test("parses a bounded project presence profile directory", () => {
  const members = [
    {
      userId: ID,
      displayName: "Анна Иванова",
      avatarUpdatedAt: "2026-08-20T10:00:00.000Z"
    },
    {
      userId: "0198f258-8cc7-7abc-8def-1234567890ac",
      displayName: "Борис"
    }
  ];
  assert.deepEqual(projectPresenceMembers(members), members);
  assert.throws(
    () =>
      projectPresenceMembers([
        ...members,
        { userId: ID, displayName: " Ведущий пробел" }
      ]),
    InvalidRealtimeTicketContractError
  );
  assert.throws(
    () =>
      projectPresenceMembers(
        Array.from({ length: 201 }, () => members[0])
      ),
    InvalidRealtimeTicketContractError
  );
});

test("parses an exact ephemeral participant without tenant authority", () => {
  const participant = {
    connectionId: "socket_connection_01",
    userId: ID,
    clientInstanceId: "0198f258-8cc7-7abc-8def-1234567890b1",
    route: "/app/semantics",
    status: "AWAY",
    cursor: null,
    selection: null,
    editing: false,
    sequence: 8,
    updatedAt: "2026-08-20T10:00:00.000Z"
  } as const;
  assert.deepEqual(projectPresenceParticipant(participant), participant);
  assert.throws(
    () =>
      projectPresenceParticipant({
        ...participant,
        connectionId: "room:project:foreign"
      }),
    InvalidRealtimeTicketContractError
  );
  assert.throws(
    () => projectPresenceParticipant({ ...participant, projectId: ID }),
    InvalidRealtimeTicketContractError
  );
});

function internalInput() {
  return {
    schemaVersion: realtimeTicketRequestSchemaVersion,
    userId: ID,
    sessionId: "0198f258-8cc7-7abc-8def-1234567890ac",
    sessionFamilyId: "0198f258-8cc7-7abc-8def-1234567890ad",
    sessionExpiresAt: "2026-08-30T12:00:00.000Z",
    workspaceId: "0198f258-8cc7-7abc-8def-1234567890ae",
    projectId: "0198f258-8cc7-7abc-8def-1234567890af",
    membershipId: "0198f258-8cc7-7abc-8def-1234567890b0",
    membershipVersion: 4,
    clientInstanceId: "0198f258-8cc7-7abc-8def-1234567890b1",
    origin: "https://app.example.test"
  } as const;
}

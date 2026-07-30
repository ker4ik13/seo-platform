import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  internalIssueRealtimeProjectTicketInput,
  InvalidRealtimeTicketContractError,
  isRealtimeOpaqueTicket,
  issueRealtimeProjectTicketInput,
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

import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { signRankPollTicket, verifyRankPollTicket } from "./worker-task-ticket.js";

const id = "01900000-0000-7000-8000-000000000001";
const other = "01900000-0000-7000-8000-000000000002";
const config = {
  integrationCredentials: {
    activeKeyVersion: 1,
    keys: new Map([[1, Buffer.alloc(32, 7)]])
  }
} as unknown as AppConfig;

test("task ticket binds node, lease, physical quota and expiry without secrets", () => {
  const ticket = signRankPollTicket(config, {
    nodeId: id,
    workspaceId: id,
    executionId: id,
    providerTaskId: "task-123",
    leaseOwner: `remote:${id}:${other}`,
    leaseToken: other,
    leaseGeneration: 1,
    executionVersion: 3,
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    requestHash: "a".repeat(64),
    physicalKeyScopeId: id,
    product: "YANDEX_LIVE",
    quotaMember: other,
    settlementGrantId: null
  });
  assert.equal(verifyRankPollTicket(config, ticket, id).executionVersion, 3);
  assert.equal(ticket.includes("apiKey"), false);
  assert.throws(() => verifyRankPollTicket(config, ticket, other));
  assert.throws(() => verifyRankPollTicket(config, `${ticket}x`, id));
});

import assert from "node:assert/strict";
import test from "node:test";
import { domainEventTypes } from "./catalog.js";
import { sessionFamilyRevokedEventDataV1 } from "./identity.js";

test("session family revoke has a stable versioned event name", () => {
  assert.equal(
    domainEventTypes.sessionFamilyRevoked,
    "identity.session-family.revoked.v1"
  );
});

test("session family revoke payload is exact, ISO and redacted", () => {
  const payload = sessionFamilyRevokedEventDataV1({
    userId: "01900000-0000-7000-8000-000000000001",
    sessionFamilyId: "01900000-0000-7000-8000-000000000002",
    revokedAt: new Date("2026-07-29T15:30:45.123Z"),
    reason: "must not cross the event boundary",
    sessionId: "must not cross the event boundary",
    email: "must-not-cross@example.com",
    token: "must not cross the event boundary"
  } as {
    userId: string;
    sessionFamilyId: string;
    revokedAt: Date;
    reason: string;
    sessionId: string;
    email: string;
    token: string;
  });

  assert.deepEqual(payload, {
    userId: "01900000-0000-7000-8000-000000000001",
    sessionFamilyId: "01900000-0000-7000-8000-000000000002",
    revokedAt: "2026-07-29T15:30:45.123Z"
  });
  assert.deepEqual(Object.keys(payload), [
    "userId",
    "sessionFamilyId",
    "revokedAt"
  ]);
});

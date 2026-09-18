import assert from "node:assert/strict";
import test from "node:test";
import { operationConfirmationExpiryDelay } from "./operation-confirmation-expiry.ts";

test("operation confirmation schedules only the exact expiry boundary", () => {
  const now = Date.parse("2026-09-18T20:00:00.000Z");
  assert.equal(
    operationConfirmationExpiryDelay("2026-09-18T20:10:00.000Z", now),
    600_000
  );
  assert.equal(
    operationConfirmationExpiryDelay("2026-09-18T19:59:59.000Z", now),
    0
  );
  assert.equal(
    operationConfirmationExpiryDelay("9999-12-31T23:59:59.000Z", now),
    2_147_483_647
  );
});

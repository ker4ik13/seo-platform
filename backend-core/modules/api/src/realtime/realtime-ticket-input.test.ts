import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { realtimeTicketInput } from "./realtime-ticket-input.js";

const CLIENT_ID = "0198f258-8cc7-7abc-8def-1234567890ab";

test("accepts only a canonical client instance UUID", () => {
  assert.deepEqual(realtimeTicketInput({ clientInstanceId: CLIENT_ID }), {
    clientInstanceId: CLIENT_ID
  });
  for (const value of [
    {},
    { clientInstanceId: CLIENT_ID.toUpperCase() },
    { clientInstanceId: CLIENT_ID, projectId: CLIENT_ID }
  ]) {
    assert.throws(
      () => realtimeTicketInput(value),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "VALIDATION_FAILED" &&
        error.statusCode === 422
    );
  }
});

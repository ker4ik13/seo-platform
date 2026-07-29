import assert from "node:assert/strict";
import test from "node:test";
import { integrationCredentialId } from "./integration-credential-id.js";

test("creates an RFC 9562 UUIDv7 with the supplied millisecond timestamp", () => {
  const timestamp = 1_721_234_567_890;
  const id = integrationCredentialId(timestamp);

  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
  assert.equal(
    Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16),
    timestamp
  );
});

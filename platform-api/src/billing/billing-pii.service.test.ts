import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { BillingPiiService } from "./billing-pii.service.js";

function service(): BillingPiiService {
  return new BillingPiiService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      AUTH_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url")
    })
  );
}

test("encrypts billing PII with a purpose-bound authenticated envelope", () => {
  const pii = service();
  const sealed = pii.seal(
    JSON.stringify({ email: "owner@example.test", inn: "1234567890" }),
    "order:order-1:buyer"
  );

  assert.doesNotMatch(sealed, /owner@example/u);
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./u);
  assert.equal(
    pii.open(sealed, "order:order-1:buyer"),
    JSON.stringify({ email: "owner@example.test", inn: "1234567890" })
  );
  assert.throws(
    () => pii.open(sealed, "order:order-2:buyer"),
    /Invalid encrypted billing PII/u
  );
});

test("rejects tampered or oversized billing PII", () => {
  const pii = service();
  const sealed = pii.seal("private", "order:order-1:buyer");
  assert.throws(
    () => pii.open(`${sealed.slice(0, -1)}A`, "order:order-1:buyer"),
    /Invalid encrypted billing PII/u
  );
  assert.throws(
    () => pii.seal("x".repeat(2_049), "order:order-1:buyer"),
    /outside the supported size/u
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { createAdminHttpHeaderRules } from "./http-security-policy.ts";

function headers(nodeEnvironment: string): ReadonlyMap<string, string> {
  const [rule] = createAdminHttpHeaderRules(nodeEnvironment);
  assert.ok(rule);
  assert.equal(rule.source, "/:path*");
  return new Map(
    rule.headers.map(({ key, value }) => [key.toLowerCase(), value])
  );
}

test("marks every admin response private, non-indexable and non-embeddable", () => {
  const values = headers("test");

  assert.equal(values.get("cache-control"), "private, no-store");
  assert.equal(
    values.get("x-robots-tag"),
    "noindex, nofollow, noarchive"
  );
  assert.equal(values.get("x-content-type-options"), "nosniff");
  assert.equal(values.get("x-frame-options"), "DENY");
  assert.equal(
    values.get("content-security-policy"),
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
  );
  assert.equal(values.get("referrer-policy"), "no-referrer");
  assert.equal(
    values.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
});

test("emits HSTS only in a production build", () => {
  assert.equal(
    headers("production").get("strict-transport-security"),
    "max-age=31536000; includeSubDomains"
  );
  assert.equal(
    headers("development").get("strict-transport-security"),
    undefined
  );
});

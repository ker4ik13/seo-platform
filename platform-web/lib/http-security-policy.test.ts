import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebHttpHeaderRules,
  type HttpHeaderRule
} from "./http-security-policy.ts";

function rule(
  rules: readonly HttpHeaderRule[],
  source: string
): HttpHeaderRule {
  const matchingRule = rules.find((candidate) => candidate.source === source);
  assert.ok(matchingRule, `Missing header rule for ${source}`);
  return matchingRule;
}

function headersByName(
  headerRule: HttpHeaderRule
): ReadonlyMap<string, string> {
  return new Map(
    headerRule.headers.map(({ key, value }) => [key.toLowerCase(), value])
  );
}

test("keeps public marketing cache policy untouched while applying security headers", () => {
  const headers = headersByName(
    rule(createWebHttpHeaderRules("development"), "/:path*")
  );

  assert.equal(headers.get("cache-control"), undefined);
  assert.equal(headers.get("x-robots-tag"), undefined);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(
    headers.get("content-security-policy"),
    "frame-ancestors 'none'"
  );
  assert.equal(
    headers.get("referrer-policy"),
    "strict-origin-when-cross-origin"
  );
  assert.equal(
    headers.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
  assert.equal(headers.get("strict-transport-security"), undefined);
});

test("keeps every /app response private and non-indexable", () => {
  const headers = headersByName(
    rule(createWebHttpHeaderRules("test"), "/app/:path*")
  );

  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(
    headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive"
  );
});

test("adds production HSTS without introducing an unsafe script CSP", () => {
  const headers = headersByName(
    rule(createWebHttpHeaderRules("production"), "/:path*")
  );

  assert.equal(
    headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains"
  );
  assert.equal(
    headers.get("content-security-policy"),
    "frame-ancestors 'none'"
  );
  assert.equal(
    headers.get("content-security-policy")?.includes("unsafe-"),
    false
  );
});

test("keeps the service worker revalidation-only and scoped to /app", () => {
  const headers = headersByName(
    rule(createWebHttpHeaderRules("production"), "/push-service-worker.js")
  );

  assert.equal(headers.get("cache-control"), "no-cache");
  assert.equal(headers.get("service-worker-allowed"), "/app/");
});

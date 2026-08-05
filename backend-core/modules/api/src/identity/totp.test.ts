import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeBase32,
  matchTotp,
  normalizeRecoveryCode,
  totpCode
} from "./totp.js";

const RFC_SECRET = encodeBase32(
  Buffer.from("12345678901234567890", "ascii")
);

test("matches RFC 6238 SHA-1 vectors", () => {
  assert.equal(totpCode(RFC_SECRET, 59_000, 8), "94287082");
  assert.equal(totpCode(RFC_SECRET, 1_111_111_109_000, 8), "07081804");
  assert.equal(totpCode(RFC_SECRET, 2_000_000_000_000, 8), "69279037");
});

test("accepts a six-digit code once inside the configured window", () => {
  const timestamp = 1_700_000_000_000;
  const code = totpCode(RFC_SECRET, timestamp);
  const match = matchTotp(RFC_SECRET, code, timestamp);

  assert.ok(match);
  assert.equal(matchTotp(RFC_SECRET, code, timestamp, 1, match.counter), undefined);
});

test("normalizes human-friendly recovery codes", () => {
  assert.equal(normalizeRecoveryCode("abcd-2345 efgh"), "ABCD2345EFGH");
});

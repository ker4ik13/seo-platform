import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafePublicLogoUrl,
  fetchPublicLogoResource,
  isPublicLogoAddress,
  PublicLogoFetchError
} from "./project-logo-public-http.js";

test("accepts canonical public logo URLs and rejects local targets", () => {
  assert.equal(
    assertSafePublicLogoUrl("https://www.example.org/favicon.svg").toString(),
    "https://www.example.org/favicon.svg"
  );
  for (const value of [
    "http://localhost/favicon.ico",
    "http://127.0.0.1/favicon.ico",
    "http://[::1]/favicon.ico",
    "ftp://example.org/favicon.ico",
    "https://user:password@example.org/favicon.ico",
    "https://example.org:8443/favicon.ico"
  ]) {
    assert.throws(() => assertSafePublicLogoUrl(value), PublicLogoFetchError);
  }
});

test("classifies private, reserved and public resolved addresses", () => {
  for (const value of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.51.100.2",
    "::1",
    "fc00::1",
    "2001:db8::1"
  ]) {
    assert.equal(isPublicLogoAddress(value), false, value);
  }
  assert.equal(isPublicLogoAddress("8.8.8.8"), true);
  assert.equal(isPublicLogoAddress("2606:4700:4700::1111"), true);
});

test("rejects a hostname when any resolved destination is private", async () => {
  await assert.rejects(
    fetchPublicLogoResource(
      "https://example.org/favicon.ico",
      { timeoutMs: 100, maxBytes: 1_024, accept: "image/*" },
      async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 }
      ]
    ),
    (error: unknown) =>
      error instanceof PublicLogoFetchError &&
      error.code === "FORBIDDEN_ADDRESS"
  );
});

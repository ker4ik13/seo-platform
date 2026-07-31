import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PublicFetchError,
  assertSafeCrawlUrl,
  fetchPublicResource,
  isPublicAddress
} from "./public-http.js";

test("sends the guarded request through the already validated address", async () => {
  const source = await readFile(
    new URL("./public-http.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /hostname: selected\.address/u);
  assert.match(source, /servername: url\.hostname/u);
  assert.match(source, /Host: url\.host/u);
  assert.match(source, /request\.end\(\);/u);
});

test("allows public IPv4 and IPv6 while denying every internal family", () => {
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e"
  ]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1"
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("allows only credential-free HTTP(S) on canonical ports", () => {
  assert.equal(
    assertSafeCrawlUrl("HTTPS://Example.COM:443/path").toString(),
    "https://example.com/path"
  );
  for (const value of [
    "file:///etc/passwd",
    "http://localhost/",
    "http://service.internal/",
    "http://example.com:8080/",
    "https://user:secret@example.com/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "https://example.com/#fragment"
  ]) {
    assert.throws(
      () => assertSafeCrawlUrl(value),
      PublicFetchError,
      value
    );
  }
});

test("rejects DNS answers containing a private or metadata address before network", async () => {
  let resolved = false;
  await assert.rejects(
    fetchPublicResource(
      "https://example.com/",
      {
        timeoutMs: 1_000,
        maxBytes: 1_000,
        maxRedirects: 0,
        accept: "text/html",
        allowedContentTypes: ["text/html"]
      },
      async () => {
        resolved = true;
        return [
          { address: "8.8.8.8", family: 4 },
          { address: "169.254.169.254", family: 4 }
        ];
      }
    ),
    (error: unknown) =>
      error instanceof PublicFetchError &&
      error.code === "FORBIDDEN_ADDRESS"
  );
  assert.equal(resolved, true);
});

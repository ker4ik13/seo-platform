import assert from "node:assert/strict";
import test from "node:test";
import { technicalCrawlHomepageProbeUrls } from "./crawls.js";

test("builds bounded homepage redirect probes without duplicating the canonical root", () => {
  assert.deepEqual(
    technicalCrawlHomepageProbeUrls("https://example.com/catalog?utm=x", [
      "HTTP_TO_HTTPS",
      "WWW_CANONICAL",
      "MULTIPLE_SLASHES"
    ]),
    [
      "http://example.com/",
      "https://www.example.com/",
      "https://example.com//",
      "https://example.com///",
      "https://example.com////",
      "https://example.com/////"
    ]
  );
});

test("checks the non-www variant when the configured domain already uses www", () => {
  assert.deepEqual(
    technicalCrawlHomepageProbeUrls("https://www.example.com/", [
      "WWW_CANONICAL"
    ]),
    ["https://example.com/"]
  );
});

test("does not invent a www hostname for an IP project", () => {
  assert.deepEqual(
    technicalCrawlHomepageProbeUrls("https://203.0.113.10/", [
      "WWW_CANONICAL"
    ]),
    []
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { crawlIndexingDirectives, parseCrawlTechnicalDetails, parseTechnicalCrawlRuntimeOptions } from "./crawl-page-facts.js";

test("crawl defaults match the controls and remain strict", () => {
  assert.deepEqual(parseTechnicalCrawlRuntimeOptions({ purpose: "TECHNICAL_AUDIT" }), { conditionalRequests: true, respectNofollow: false, requestTimeoutMs: 20_000, maxResponseBytes: 2_000_000, maxRedirects: 5 });
  assert.equal(parseTechnicalCrawlRuntimeOptions({ purpose: "HTTP_STATUS_CHECK" }).conditionalRequests, false);
  for (const value of [null, "true", 1]) assert.throws(() => parseTechnicalCrawlRuntimeOptions({ conditionalRequests: value }));
  for (const value of [0, 30_001, 1.5]) assert.throws(() => parseTechnicalCrawlRuntimeOptions({ requestTimeoutMs: value }));
});
test("Google-specific HTML directives do not become Yandex directives", () => {
  const tags = [{ name: "googlebot", content: "noindex" }, { name: "yandex", content: "index, follow" }];
  assert.equal(crawlIndexingDirectives(tags, "googlebot").noindex, true);
  assert.equal(crawlIndexingDirectives(tags, "yandex").noindex, false);
  assert.equal(crawlIndexingDirectives(tags, "robots").noindex, false);
  assert.equal(crawlIndexingDirectives([...tags, { name: "robots", content: "none" }], "yandex").noindex, true);
});
test("HTTP rules keep each header's agent scope and reject HTML http-equiv impersonation", () => {
  const tags = [{ httpEquiv: "X-Robots-Tag", source: "HTTP" as const, content: "googlebot: noindex, nofollow\nyandex: index, follow" }];
  assert.equal(crawlIndexingDirectives(tags, "googlebot").noindex, true);
  assert.equal(crawlIndexingDirectives(tags, "yandex").noindex, false);
  assert.equal(crawlIndexingDirectives([{ httpEquiv: "X-Robots-Tag", content: "noindex" }], "googlebot").noindex, false);
  assert.equal(crawlIndexingDirectives([{ httpEquiv: "X-Robots-Tag", source: "HTTP", content: "none" }], "yandex").nofollow, true);
});
test("technical facts have finite scope and bounded evidence", () => {
  assert.deepEqual(parseCrawlTechnicalDetails({ responseHeadersCaptured: true, links: [{ url: "https://example.com/a", anchor: "A", rel: ["nofollow"], kind: "INTERNAL" }] }).links?.[0]?.anchor, "A");
  assert.throws(() => parseCrawlTechnicalDetails({ cookies: "secret" }));
  assert.throws(() => parseCrawlTechnicalDetails({ responseHeadersCaptured: 1 }));
  assert.throws(() => parseCrawlTechnicalDetails({ links: [{ url: "https://example.com/a", anchor: "a".repeat(501), rel: [], kind: "INTERNAL" }] }));
});

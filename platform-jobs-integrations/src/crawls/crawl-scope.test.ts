import assert from "node:assert/strict";
import test from "node:test";
import {
  crawlScopeAllows,
  normalizedScopeUrl,
  validCrawlPathPattern
} from "./crawl-scope.js";

test("applies deterministic query policy without dropping business parameters", () => {
  assert.equal(
    normalizedScopeUrl(
      "HTTPS://Example.COM/catalog/?utm_source=x&page=2&gclid=y",
      "DROP_TRACKING"
    ),
    "https://example.com/catalog/?page=2"
  );
  assert.equal(
    normalizedScopeUrl("https://example.com/a?sku=10", "DROP_ALL"),
    "https://example.com/a"
  );
  assert.equal(
    normalizedScopeUrl("https://example.com/a?sku=10", "PRESERVE"),
    "https://example.com/a?sku=10"
  );
});

test("matches bounded include and exclude path globs", () => {
  const scope = {
    includePatterns: ["/catalog/**"],
    excludePatterns: ["/catalog/private/*"]
  };
  assert.equal(
    crawlScopeAllows("https://example.com/catalog/a/b", scope),
    true
  );
  assert.equal(
    crawlScopeAllows("https://example.com/catalog/private/a", scope),
    false
  );
  assert.equal(crawlScopeAllows("https://example.com/blog/a", scope), false);
  assert.equal(validCrawlPathPattern("/catalog/**"), true);
  assert.equal(validCrawlPathPattern("catalog/**"), false);
});

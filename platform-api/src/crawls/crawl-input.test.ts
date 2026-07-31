import assert from "node:assert/strict";
import test from "node:test";
import { createTechnicalCrawlInput } from "./crawl-input.js";

test("accepts one same-origin bounded crawl command", () => {
  assert.deepEqual(
    createTechnicalCrawlInput({
      startUrls: ["HTTPS://Example.COM/"],
      maxUrls: 100,
      maxDepth: 3,
      requestsPerMinute: 30,
      obeyRobots: true
    }),
    {
      startUrls: ["https://example.com/"],
      maxUrls: 100,
      maxDepth: 3,
      requestsPerMinute: 30,
      obeyRobots: true
    }
  );
});

test("rejects cross-origin, credential and robots bypass commands", () => {
  const base = {
    startUrls: ["https://example.com/"],
    maxUrls: 100,
    maxDepth: 3,
    requestsPerMinute: 30,
    obeyRobots: true
  };
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...base,
      startUrls: ["https://example.com/", "https://other.example/"]
    })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...base,
      startUrls: ["https://user:secret@example.com/"]
    })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({ ...base, obeyRobots: false })
  );
});

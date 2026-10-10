import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { RemoteCrawlRequestPacer } from "./remote-crawl-request-pacer.js";

test("one crawl batch and its redirects share a clock across all HTTP slots", async () => {
  const pacer = new RemoteCrawlRequestPacer(), id = randomUUID(), times: number[] = [];
  await Promise.all(Array.from({ length: 6 }, async () => { await pacer.wait(id, 240, Date.now() + 10000); times.push(Date.now()); }));
  assert.equal(times.length, 6);
  for (let index = 1; index < times.length; index++) assert.ok(times[index]! - times[index - 1]! >= 245);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pacer.wait(id, 240, Date.now() + 10000, controller.signal));
  await assert.rejects(pacer.wait(randomUUID(), 240, Date.now() - 1));
});

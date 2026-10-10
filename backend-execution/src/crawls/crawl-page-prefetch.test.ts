import assert from "node:assert/strict";
import test from "node:test";
import { CrawlPagePrefetch, crawlPagePrefetchCapacity } from "./crawl-page-prefetch.js";

test("prefetch retains a bounded window and consumes results in checkpoint order", async () => {
  const started: string[] = [], finish = new Map<string, (value: string) => void>();
  const pages = ["a", "b", "c"].map(url => ({ url }));
  const prefetch = new CrawlPagePrefetch(2, async (page: { url: string }) => {
    started.push(page.url);
    return new Promise<string>(resolve => finish.set(page.url, resolve));
  }, () => true);
  prefetch.fill(pages);
  assert.deepEqual(started, ["a", "b"]);
  finish.get("b")!("second");
  finish.get("a")!("first");
  assert.equal(await prefetch.take(pages[0]!), "first");
  prefetch.fill(pages.slice(1));
  assert.deepEqual(started, ["a", "b", "c"]);
  assert.equal(await prefetch.take(pages[1]!), "second");
  finish.get("c")!("third");
  assert.equal(await prefetch.take(pages[2]!), "third");
  await prefetch.close();
});

test("a fatal site response stops queued HTTP and close drains admitted work", async () => {
  const failure = new Error("HOST_RATE_LIMIT");
  let unblock!: () => void, active = 0;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  const prefetch = new CrawlPagePrefetch(3, async (page: { url: string }, assertOpen) => {
    if (page.url === "first") throw failure;
    await gate;
    assertOpen();
    active++;
    return page.url;
  }, () => true);
  const pages = ["first", "queued", "later"].map(url => ({ url }));
  prefetch.fill(pages);
  await assert.rejects(prefetch.take(pages[0]!), error => error === failure);
  let drained = false;
  const closed = prefetch.close().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  unblock();
  await closed;
  assert.equal(active, 0);
});

test("prefetch capacity follows the chosen rate and bounds retained bodies", () => {
  assert.equal(crawlPagePrefetchCapacity(180, 2_000_000), 12);
  assert.equal(crawlPagePrefetchCapacity(240, 2_000_000), 16);
  assert.equal(crawlPagePrefetchCapacity(240, 10_000_000), 3);
  assert.equal(crawlPagePrefetchCapacity(10, 2_000_000), 1);
});

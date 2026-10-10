import assert from "node:assert/strict";
import test from "node:test";
import { encodeRankReadCursor, decodeRankReadCursor, rankReadPage, rankReadWindow, RankReadWindowCache } from "./rank-read-window.js";

test("keyset window uses the opaque last ID, not a growing SQL offset", () => {
  const ids = ["018e6f70-0000-7000-8000-000000000001", "018e6f70-0000-7000-8000-000000000002", "018e6f70-0000-7000-8000-000000000003"];
  const window = rankReadWindow(ids), asOf = new Date().toISOString();
  const first = rankReadPage(window, undefined, 2);
  const cursor = decodeRankReadCursor(encodeRankReadCursor(first.ids[1]!, asOf, "tenant-filter"), "tenant-filter");
  assert.deepEqual(rankReadPage(window, cursor.anchor, 2), { ids: [ids[2]], hasNext: false });
  assert.throws(() => decodeRankReadCursor(encodeRankReadCursor(ids[1]!, asOf, "other-tenant"), "tenant-filter"));
  assert.throws(() => rankReadPage(window, "missing", 2));
});
test("read window cache coalesces pending preparation and enforces memory and idle bounds", async () => {
  let now = 0, count = 0;
  const cache = new RankReadWindowCache(20, () => now);
  const load = async () => ({ value: ++count, bytes: 12 });
  assert.deepEqual(await Promise.all([cache.read("same", load), cache.read("same", load)]), [1, 1]);
  assert.equal(await cache.read("same", load), 1);
  await cache.read("other", load);
  assert.equal(await cache.read("same", load), 3);
  now = 120_001;
  assert.equal(await cache.read("same", load), 4);
});

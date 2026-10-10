import assert from "node:assert/strict";
import test from "node:test";
import { virtualWindow } from "./virtual-window.ts";

test("virtual window bounds the DOM without changing row ordinals", () => {
  const result = virtualWindow(100_000, { height: 600, scrollTop: 44_038 }, 44, 38, 12, 500);
  assert.equal(result.start, 988);
  assert.equal(result.end - result.start, 38);
  assert.equal(result.paddingTop + (result.end - result.start) * 44 + result.paddingBottom, 4_400_000);
});
test("virtual window handles empty, short and shortened lists", () => {
  assert.deepEqual(virtualWindow(0, { height: 600, scrollTop: 0 }, 28),
    { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 });
  assert.equal(virtualWindow(210, { height: 600, scrollTop: 10_000 }, 44, 38, 12, 500).start, 0);
  assert.equal(virtualWindow(10, { height: 600, scrollTop: 100_000 }, 28).end, 10);
  assert.throws(() => virtualWindow(10, { height: 600, scrollTop: 0 }, 0), RangeError);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createReadCoalescer } from "./coalesced-read.ts";

test("pending reads share one owner but resolved reads are not cached", async () => {
  const read = createReadCoalescer();
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([read("session:project", load), read("session:project", load)]), [1, 1]);
  assert.equal(await read("session:project", load), 2);
  assert.equal(await read("other-session:project", load), 3);
});
test("closing one consumer does not cancel another; last consumer aborts the owner", async () => {
  const read = createReadCoalescer(), first = new AbortController(), second = new AbortController();
  let owner: AbortSignal | undefined;
  let finish: ((value: number) => void) | undefined;
  const load = (signal: AbortSignal) => { owner = signal; return new Promise<number>(resolve => { finish = resolve; }); };
  const one = read("same", load, first.signal), two = read("same", load, second.signal);
  await Promise.resolve();
  first.abort();
  await assert.rejects(one, { name: "AbortError" });
  assert.equal(owner?.aborted, false);
  finish?.(42);
  assert.equal(await two, 42);
  const three = read("alone", load, second.signal);
  await Promise.resolve();
  second.abort();
  await assert.rejects(three, { name: "AbortError" });
  assert.equal(owner?.aborted, true);
  finish?.(0);
});

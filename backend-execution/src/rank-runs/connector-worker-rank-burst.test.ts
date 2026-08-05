import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../connector-worker.main.ts", import.meta.url);

test("connector dispatcher fills the dedicated rank worker pool", async () => {
  const source = await readFile(workerUrl, "utf8");

  assert.match(source, /const rankBurst = config\.connectorRuntime\.rankConcurrency \* 2;/u);
  assert.match(source, /slot < rankBurst; slot \+= 1/u);
  assert.match(source, /dispatchBucket \* rankBurst \+ slot/u);
  assert.match(source, /RANK_CONNECTOR_RUNTIME_QUEUE/u);
  assert.match(source, /FREQUENCY_COLLECTION_RUNTIME_QUEUE/u);
});

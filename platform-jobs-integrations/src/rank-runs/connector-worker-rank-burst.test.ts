import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../connector-worker.main.ts", import.meta.url);

test("connector dispatcher enqueues one runtime claim per active Arsenkin slot", async () => {
  const source = await readFile(workerUrl, "utf8");

  assert.match(source, /const RANK_CONNECTOR_RUNTIME_BURST = 5;/u);
  assert.match(
    source,
    /slot < RANK_CONNECTOR_RUNTIME_BURST; slot \+= 1/u
  );
  assert.match(
    source,
    /dispatchBucket \* RANK_CONNECTOR_RUNTIME_BURST \+ slot/u
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../connector-worker.main.ts", import.meta.url);

test("connector dispatcher probes cheaply and fills the rank pool after activity", async () => {
  const source = await readFile(workerUrl, "utf8");

  assert.match(
    source,
    /const rankDispatchStride =\s*config\.connectorRuntime\.rankConcurrency \* 2;/u
  );
  assert.match(source, /const rankBurst = adaptiveRankDispatchBurst\(/u);
  assert.match(source, /activeRankDispatchUntil/u);
  assert.match(source, /rankRuntimeOutcomeHasWork\(outcome\)/u);
  assert.match(source, /slot < rankBurst; slot \+= 1/u);
  assert.match(source, /shardedDispatchSequence\(/u);
  assert.match(source, /config\.connectorRuntime\.shardIndex/u);
  assert.match(source, /config\.connectorRuntime\.shardCount/u);
  assert.match(source, /if \(!paidRuntimeEnabled\) return;/u);
  assert.match(source, /paidRuntimeEnabled \? new Worker<RankConnectorRuntimeJobData>/u);
  assert.match(source, /RANK_CONNECTOR_RUNTIME_QUEUE/u);
  assert.match(source, /FREQUENCY_COLLECTION_RUNTIME_QUEUE/u);
});

test("connector failures retain only a safe diagnostic summary", async () => {
  const source = await readFile(workerUrl, "utf8");

  assert.match(source, /runtimeWorker\.on\("failed", \(job, error\) =>/u);
  assert.match(source, /safeErrorSummary\(error\)/u);
  assert.doesNotMatch(source, /error\.stack/u);
});

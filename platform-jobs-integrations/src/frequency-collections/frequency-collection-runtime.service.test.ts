import assert from "node:assert/strict";
import test from "node:test";
import { FrequencyCollectionRuntimeService } from "./frequency-collection-runtime.service.js";

test("runtime drains a bounded batch and stops when the broker is idle", async () => {
  const runtime = new RuntimeHarness([
    "COMPLETED_ITEM",
    "FAILED_ITEM",
    "COMPLETED_ITEM",
    "IDLE"
  ]);
  assert.deepEqual(await runtime.processBatch("connector-123456", 10), {
    processed: 3,
    result: "IDLE"
  });
});

test("runtime stops a batch after scheduling a provider retry", async () => {
  const runtime = new RuntimeHarness([
    "COMPLETED_ITEM",
    "RETRY_SCHEDULED",
    "COMPLETED_ITEM"
  ]);
  assert.deepEqual(await runtime.processBatch("connector-123456", 10), {
    processed: 2,
    result: "RETRY_SCHEDULED"
  });
});

class RuntimeHarness extends FrequencyCollectionRuntimeService {
  public constructor(private readonly results: string[]) {
    super(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never);
  }

  public override async processOne(): Promise<string> {
    return this.results.shift() ?? "IDLE";
  }
}

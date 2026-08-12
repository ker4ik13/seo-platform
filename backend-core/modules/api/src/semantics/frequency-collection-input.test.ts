import assert from "node:assert/strict";
import test from "node:test";
import {
  createFrequencyCollectionInput,
  frequencyCancelInput,
  frequencyIdempotencyKey,
  frequencyRetryInput
} from "./frequency-collection-input.js";

const keywordId = "01900000-0000-7000-8000-000000000001";

test("accepts an exact bounded frequency collection command", () => {
  assert.deepEqual(
    createFrequencyCollectionInput({
      items: [{ id: keywordId, version: 3 }],
      types: ["BASE", "EXACT", "FIXED"],
      regionCode: "213",
      device: "MOBILE"
    }),
    {
      items: [{ id: keywordId, version: 3 }],
      types: ["BASE", "EXACT", "FIXED"],
      regionCode: "213",
      device: "MOBILE"
    }
  );
  assert.equal(frequencyIdempotencyKey("frequency-command-123"), "frequency-command-123");
  assert.deepEqual(frequencyCancelInput({}), {});
  assert.deepEqual(frequencyRetryInput({ version: 7 }), { version: 7 });
});

test("rejects duplicate keywords, unknown fields and blind retries", () => {
  assert.throws(() =>
    createFrequencyCollectionInput({
      items: [{ id: keywordId, version: 3 }, { id: keywordId, version: 3 }],
      types: ["BASE"],
      regionCode: "213",
      device: "ALL"
    })
  );
  assert.throws(() => frequencyCancelInput({ version: 1 }));
  assert.throws(() => frequencyRetryInput({ version: 0 }));
  assert.throws(() => frequencyRetryInput({ version: 1, force: true }));
});

test("accepts one 10,000-keyword Arsenkin batch and rejects overflow", () => {
  const items = Array.from({ length: 10_000 }, (_, index) => ({
    id: keywordIdAt(index),
    version: 1
  }));

  assert.equal(
    createFrequencyCollectionInput({
      items,
      types: ["BASE"],
      regionCode: "213",
      device: "ALL"
    }).items.length,
    10_000
  );
  assert.throws(() =>
    createFrequencyCollectionInput({
      items: [...items, { id: keywordIdAt(10_000), version: 1 }],
      types: ["BASE"],
      regionCode: "213",
      device: "ALL"
    })
  );
});

function keywordIdAt(index: number): string {
  return `01900000-0000-7000-8000-${(index + 1)
    .toString(16)
    .padStart(12, "0")}`;
}

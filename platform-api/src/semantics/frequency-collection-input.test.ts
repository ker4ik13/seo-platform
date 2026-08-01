import assert from "node:assert/strict";
import test from "node:test";
import {
  createFrequencyCollectionInput,
  frequencyCancelInput,
  frequencyIdempotencyKey
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
  assert.deepEqual(frequencyCancelInput({ version: 7 }), { version: 7 });
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
  assert.throws(() => frequencyCancelInput({ version: 0 }));
  assert.throws(() => frequencyCancelInput({ version: 1, force: true }));
});

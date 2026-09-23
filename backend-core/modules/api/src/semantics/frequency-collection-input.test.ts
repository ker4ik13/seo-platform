import assert from "node:assert/strict";
import test from "node:test";
import {
  createFrequencyCollectionInput,
  frequencyCancelInput,
  frequencyIdempotencyKey,
  frequencyRetryInput,
  semanticFrequencyContextRoute
} from "./frequency-collection-input.js";

const keywordId = "01900000-0000-7000-8000-000000000001";
const credentialId = "01900000-0000-7000-8000-000000000002";

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
  assert.deepEqual(
    semanticFrequencyContextRoute("EXACT", "213", "MOBILE"),
    { type: "EXACT", regionCode: "213", device: "MOBILE" }
  );
});

test("preserves an exact provider route selected in the dialog", () => {
  assert.deepEqual(
    createFrequencyCollectionInput({
      items: [{ id: keywordId, version: 3 }],
      types: ["BASE"],
      regionCode: "213",
      device: "ALL",
      provider: "XMLSTOCK",
      credentialId
    }),
    {
      items: [{ id: keywordId, version: 3 }],
      types: ["BASE"],
      regionCode: "213",
      device: "ALL",
      provider: "XMLSTOCK",
      credentialId
    }
  );
  assert.throws(() =>
    createFrequencyCollectionInput({
      items: [{ id: keywordId, version: 3 }],
      types: ["BASE"],
      regionCode: "213",
      device: "ALL",
      provider: "XMLSTOCK"
    })
  );
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
  assert.throws(() => semanticFrequencyContextRoute("UNKNOWN", "213", "ALL"));
  assert.throws(() => semanticFrequencyContextRoute("BASE", "../213", "ALL"));
  assert.throws(() => semanticFrequencyContextRoute("BASE", "213", "TV"));
});

test("accepts bounded seasonality types and a normalized calendar range", () => {
  assert.deepEqual(createFrequencyCollectionInput({
    items: [{ id: keywordId, version: 3 }],
    mode: "SEASONALITY",
    types: ["BASE"],
    regionCode: "213",
    device: "DESKTOP",
    seasonality: {
      granularity: "MONTH",
      observedFrom: "2026-01-01",
      observedThrough: "2026-03-31"
    }
  }), {
    items: [{ id: keywordId, version: 3 }],
    mode: "SEASONALITY",
    types: ["BASE"],
    regionCode: "213",
    device: "DESKTOP",
    seasonality: {
      granularity: "MONTH",
      observedFrom: "2026-01-01",
      observedThrough: "2026-03-31"
    }
  });
  assert.throws(() => createFrequencyCollectionInput({
    items: [{ id: keywordId, version: 3 }],
    mode: "SEASONALITY",
    types: ["EXACT"],
    regionCode: "213",
    device: "DESKTOP",
    seasonality: {
      granularity: "MONTH",
      observedFrom: "2026-01-01",
      observedThrough: "2026-03-31"
    }
  }));
});

test("accepts a 50,000-keyword operation and rejects command overflow", () => {
  const items = Array.from({ length: 50_000 }, (_, index) => ({
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
    50_000
  );
  assert.throws(() =>
    createFrequencyCollectionInput({
      items: Array.from({ length: 300_001 }),
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

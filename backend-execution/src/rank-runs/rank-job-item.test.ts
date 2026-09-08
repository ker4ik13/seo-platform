import assert from "node:assert/strict";
import test from "node:test";
import { rankJobItemReference } from "./rank-job-item.js";

const reference = {
  schemaVersion: "rank-job-item@1",
  manifestId: "01900000-0000-7000-8000-000000000001",
  chunkIndex: 2
};

test("parses only the exact immutable manifest chunk reference", () => {
  assert.deepEqual(rankJobItemReference(reference), {
    manifestId: reference.manifestId,
    chunkIndex: 2
  });
  assert.deepEqual(
    rankJobItemReference({ ...reference, chunkIndex: 4 }),
    {
      manifestId: reference.manifestId,
      chunkIndex: 4
    }
  );
  assert.deepEqual(
    rankJobItemReference({ ...reference, chunkIndex: 14_999 }),
    {
      manifestId: reference.manifestId,
      chunkIndex: 14_999
    }
  );
  for (const candidate of [
    { ...reference, keywordText: "must-not-cross" },
    { ...reference, manifestId: "not-a-uuid" },
    { ...reference, chunkIndex: 300_000 }
  ]) {
    assert.throws(() => rankJobItemReference(candidate), /Invalid rank/u);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  EARLIEST_SEMANTIC_SERP_HISTORY_INSTANT,
  semanticSerpHistoryQuery
} from "./semantic-serp-history.ts";

test("SERP history includes imported snapshots older than the keyword record", () => {
  const query = semanticSerpHistoryQuery({
    before: "2026-09-15T12:00:00.000Z",
    dimensionKey: "YANDEX|RU|213|ru|DESKTOP",
    keywordId: "01a0a372-5a3c-7378-91ed-d7e489cf6a45"
  });

  assert.equal(query.get("observedFrom"), EARLIEST_SEMANTIC_SERP_HISTORY_INSTANT);
  assert.equal(query.get("observedBefore"), "2026-09-15T12:00:00.000Z");
  assert.equal(query.get("limit"), "5");
  assert.equal(query.get("mode"), "SERP");
  assert.equal(query.has("createdAt"), false);
});

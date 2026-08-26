import assert from "node:assert/strict";
import test from "node:test";
import {
  wordstatResultLimit,
  wordstatScopeIsResolving,
  wordstatStoredResultSafetyLimit
} from "./wordstat-expansion-form.ts";

test("a stale project scope request does not block pasted Wordstat queries", () => {
  assert.equal(wordstatScopeIsResolving("PROJECT", true), true);
  assert.equal(wordstatScopeIsResolving("TEXT", true), false);
});

test("Arsenkin has no user-defined result limit", () => {
  assert.equal(
    wordstatResultLimit("ARSENKIN", "not-a-number"),
    wordstatStoredResultSafetyLimit
  );
});

test("XMLStock keeps its bounded result limit", () => {
  assert.equal(wordstatResultLimit("XMLSTOCK", "5000"), 5000);
  assert.equal(wordstatResultLimit("XMLSTOCK", "0"), undefined);
  assert.equal(wordstatResultLimit("XMLSTOCK", "10001"), undefined);
});

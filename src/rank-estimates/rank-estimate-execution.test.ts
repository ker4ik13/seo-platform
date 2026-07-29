import assert from "node:assert/strict";
import test from "node:test";
import {
  rankEstimateExecutionHash,
  rankEstimateExecutionParameters,
  storedRankEstimateExecution
} from "./rank-estimate-execution.js";

const configuration = {
  searchEngine: "GOOGLE",
  countryCode: "US",
  regionCode: "US-NY",
  language: "en",
  device: "DESKTOP",
  depth: 30,
  domainMatchRule: { mode: "EXACT_HOST" },
  safeSearch: false
} as const;

test("persists and verifies exact provider-effective execution", () => {
  const execution = rankEstimateExecutionParameters(configuration);
  assert.ok(execution);
  assert.deepEqual(
    storedRankEstimateExecution(
      execution,
      rankEstimateExecutionHash(execution)
    ),
    execution
  );
  assert.equal(
    rankEstimateExecutionHash(execution).toString("hex"),
    "b4c719cbd5fb884ec469cce342b9e88fbebead1a4c6aebbd2214f767e52f90f6"
  );
});

test("keeps incompatible estimates viewable without executable data", () => {
  assert.equal(
    rankEstimateExecutionParameters({
      ...configuration,
      searchEngine: "YANDEX"
    }),
    undefined
  );
  assert.equal(storedRankEstimateExecution(null, null), undefined);
});

test("rejects hash drift, unknown fields and half-present snapshots", () => {
  const execution = rankEstimateExecutionParameters(configuration);
  assert.ok(execution);
  assert.throws(
    () =>
      storedRankEstimateExecution(
        { ...execution, secret: "must-not-pass" },
        rankEstimateExecutionHash(execution)
      ),
    /Invalid immutable/u
  );
  assert.throws(
    () =>
      storedRankEstimateExecution(
        execution,
        Buffer.alloc(32)
      ),
    /Invalid immutable/u
  );
  assert.throws(
    () => storedRankEstimateExecution(execution, null),
    /Invalid immutable/u
  );
});

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
  regionCode: "1023191",
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
    "1f3f038ee48aaf19e70f6849c930735c3c0f98a363becc7e9ef17f22da27a124"
  );
});

test("keeps incompatible estimates viewable without executable data", () => {
  for (const incompatible of [
    { ...configuration, searchEngine: "YANDEX" as const },
    { ...configuration, regionCode: "US-NY" },
    {
      searchEngine: "GOOGLE" as const,
      countryCode: "US",
      language: "en",
      device: "DESKTOP" as const,
      depth: 30 as const,
      domainMatchRule: { mode: "EXACT_HOST" as const },
      safeSearch: false
    },
    { ...configuration, safeSearch: true },
    {
      ...configuration,
      domainMatchRule: { mode: "ANY_PROJECT_MIRROR" as const }
    },
    {
      ...configuration,
      domainMatchRule: { mode: "CANONICAL_DOMAIN" as const }
    }
  ]) {
    assert.equal(
      rankEstimateExecutionParameters(incompatible),
      undefined
    );
  }
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

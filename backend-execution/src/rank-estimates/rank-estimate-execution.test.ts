import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ARSENKIN_GOOGLE_LIVE_MAPPING_VERSION,
  ARSENKIN_CHECK_TOP_GOOGLE_LIVE_MAPPING_VERSION,
  ARSENKIN_CHECK_TOP_YANDEX_XML_MAPPING_VERSION,
  ARSENKIN_YANDEX_LIVE_MAPPING_VERSION,
  ARSENKIN_YANDEX_SEARCH_API_MAPPING_VERSION,
  XMLSTOCK_GOOGLE_LIVE_MAPPING_VERSION,
  XMLSTOCK_YANDEX_LIVE_MAPPING_VERSION,
  XMLSTOCK_YANDEX_LIVE_TURBO_MAPPING_VERSION,
  XMLSTOCK_YANDEX_SEARCH_API_MAPPING_VERSION,
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
    "db32de5f3a4dffd582304429501ee316b684b4e2708f36ad13cbdd2ca20153ec"
  );
});

test("keeps Yandex and supported Google depths executable", () => {
  for (const executable of [
    { ...configuration, searchEngine: "YANDEX" as const, depth: 30 as const },
    { ...configuration, depth: 100 as const, device: "MOBILE" as const }
  ]) {
    const execution = rankEstimateExecutionParameters(executable);
    assert.ok(execution);
    assert.equal(execution.searchEngine, executable.searchEngine);
    assert.equal(execution.depth, executable.depth);
    assert.deepEqual(
      storedRankEstimateExecution(
        execution,
        rankEstimateExecutionHash(execution)
      ),
      execution
    );
  }
});

test("maps every supported provider, source, device and depth combination", () => {
  const cases = [
    ...(["SEARCH_API", "LIVE"] as const).flatMap((source) =>
      (["DESKTOP", "MOBILE"] as const).map((device) => ({
        provider: "ARSENKIN" as const,
        searchEngine: "YANDEX" as const,
        source,
        device,
        depth: 30 as const,
        mapping: source === "LIVE"
          ? ARSENKIN_YANDEX_LIVE_MAPPING_VERSION
          : ARSENKIN_YANDEX_SEARCH_API_MAPPING_VERSION
      }))
    ),
    ...([30, 50, 100] as const).flatMap((depth) =>
      (["DESKTOP", "MOBILE"] as const).map((device) => ({
        provider: "ARSENKIN" as const,
        searchEngine: "GOOGLE" as const,
        source: "LIVE" as const,
        device,
        depth,
        mapping: ARSENKIN_GOOGLE_LIVE_MAPPING_VERSION
      }))
    ),
    ...(["SEARCH_API", "LIVE"] as const).flatMap((source) =>
      ([30, 50, 100] as const).flatMap((depth) =>
        (["DESKTOP", "MOBILE"] as const).map((device) => ({
          provider: "XMLSTOCK" as const,
          searchEngine: "YANDEX" as const,
          source,
          device,
          depth,
          mapping: source === "LIVE"
            ? XMLSTOCK_YANDEX_LIVE_MAPPING_VERSION
            : XMLSTOCK_YANDEX_SEARCH_API_MAPPING_VERSION
        }))
      )
    ),
    ...([30, 50, 100] as const).flatMap((depth) =>
      (["DESKTOP", "MOBILE"] as const).map((device) => ({
        provider: "XMLSTOCK" as const,
        searchEngine: "GOOGLE" as const,
        source: "LIVE" as const,
        device,
        depth,
        mapping: XMLSTOCK_GOOGLE_LIVE_MAPPING_VERSION
      }))
    )
  ];

  assert.equal(cases.length, 28);
  for (const value of cases) {
    const execution = rankEstimateExecutionParameters(
      {
        ...configuration,
        searchEngine: value.searchEngine,
        countryCode: value.searchEngine === "YANDEX" ? "RU" : "US",
        regionCode: value.searchEngine === "YANDEX" ? "213" : "1023191",
        language: value.searchEngine === "YANDEX" ? "ru" : "en",
        device: value.device,
        depth: value.depth
      },
      value.provider,
      value.source
    );
    assert.ok(execution, JSON.stringify(value));
    assert.equal(execution.providerMappingVersion, value.mapping);
  }
});

test("seals competitor TOP-10 purpose and optional project position", () => {
  const google = rankEstimateExecutionParameters(
    configuration,
    "ARSENKIN",
    "LIVE",
    undefined,
    "COMPETITOR_SERP",
    false
  );
  assert.ok(google);
  assert.equal(google.purpose, "COMPETITOR_SERP");
  assert.equal(google.saveProjectPosition, false);
  assert.equal(
    google.providerMappingVersion,
    ARSENKIN_CHECK_TOP_GOOGLE_LIVE_MAPPING_VERSION
  );

  const yandex = rankEstimateExecutionParameters(
    {
      ...configuration,
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "213",
      language: "ru",
      depth: 30
    },
    "ARSENKIN",
    "SEARCH_API",
    undefined,
    "COMPETITOR_SERP",
    true
  );
  assert.ok(yandex);
  assert.equal(yandex.saveProjectPosition, true);
  assert.equal(
    yandex.providerMappingVersion,
    ARSENKIN_CHECK_TOP_YANDEX_XML_MAPPING_VERSION
  );
});

test("database request counts distinguish XMLStock Yandex Live from Search API", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260805090000_xmlstock_yandex_live_estimate_counts/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /xmlstock-yandex-search-api@2/u);
  assert.match(migration, /xmlstock-yandex-live@2/u);
  assert.match(
    migration,
    /minimum_get_request_count = provider_task_count \*/u
  );
});

test("seals XMLStock Yandex Live Turbo as a distinct mapping", async () => {
  const execution = rankEstimateExecutionParameters(
    {
      ...configuration,
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "213",
      language: "ru",
      depth: 100
    },
    "XMLSTOCK",
    "LIVE",
    "TURBO"
  );
  assert.ok(execution);
  assert.equal(
    execution.providerMappingVersion,
    XMLSTOCK_YANDEX_LIVE_TURBO_MAPPING_VERSION
  );
  assert.equal(
    rankEstimateExecutionParameters(
      configuration,
      "XMLSTOCK",
      "LIVE",
      "TURBO"
    ),
    undefined
  );
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260819130000_xmlstock_yandex_live_turbo/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /xmlstock-yandex-live@3/u);
  assert.match(migration, /\+ 49\) \/ 50/u);
});

test("keeps incompatible estimates viewable without executable data", () => {
  for (const incompatible of [
    { ...configuration, regionCode: "US-NY" },
    { ...configuration, searchEngine: "YANDEX" as const, depth: 50 as const },
    { ...configuration, searchEngine: "YANDEX" as const, depth: 100 as const },
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

import assert from "node:assert/strict";
import test from "node:test";
import {
  internalConfirmKeywordResearchRunInput,
  internalCreateKeywordResearchRunInput,
  keywordResearchRowsQuery
} from "./keyword-research-input.js";

const WORKSPACE_ID = "01900000-0000-7000-8000-000000000001";
const PROJECT_ID = "01900000-0000-7000-8000-000000000002";
const ACTOR_ID = "01900000-0000-7000-8000-000000000003";
const ROW_ID = "01900000-0000-7000-8000-000000000004";

test("parses a bounded cursor page for collected keywords", () => {
  assert.deepEqual(keywordResearchRowsQuery("500", "200"), {
    cursor: 500,
    limit: 200
  });
  assert.deepEqual(keywordResearchRowsQuery(undefined, undefined), {
    limit: 200
  });
  assert.throws(() => keywordResearchRowsQuery("500 OR 1=1", "200"));
  assert.throws(() => keywordResearchRowsQuery("500", "501"));
});

test("normalizes a trusted Keys.so research command", () => {
  assert.deepEqual(
    internalCreateKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      idempotencyKey: "keyword-research-001",
      correlationId: "request-001",
      jobCapacity: {
        planCode: "PRO",
        planVersion: 2,
        concurrentJobs: 10
      },
      source: "KEYS_SO",
      domain: "https://Example.RU/",
      database: "msk",
      maxKeywords: 100
    }),
    {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      idempotencyKey: "keyword-research-001",
      correlationId: "request-001",
      jobCapacity: {
        planCode: "PRO",
        planVersion: 2,
        concurrentJobs: 10
      },
      source: "KEYS_SO",
      domain: "example.ru",
      database: "msk",
      maxKeywords: 100
    }
  );
});

test("parses one bounded Arsenkin Wordstat expansion", () => {
  const result = internalCreateKeywordResearchRunInput({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    idempotencyKey: "wordstat-expansion-001",
    correlationId: "request-002",
    jobCapacity: { planCode: "PRO", planVersion: 2, concurrentJobs: 10 },
    source: "ARSENKIN_WORDSTAT",
    queries: ["  ремонт   холодильников "],
    regionCode: "213",
    device: "ALL",
    minusWords: [" бесплатно "],
    clearMinusPhrases: false,
    includeRightColumn: true,
    clearPlus: false,
    maxKeywords: 5000
  });
  assert.equal(result.source, "ARSENKIN_WORDSTAT");
  if (result.source !== "ARSENKIN_WORDSTAT") assert.fail();
  assert.deepEqual(result.queries, ["ремонт холодильников"]);
  assert.deepEqual(result.minusWords, ["бесплатно"]);
});

test("parses one bounded XMLStock Wordstat expansion", () => {
  const result = internalCreateKeywordResearchRunInput({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    idempotencyKey: "xmlstock-wordstat-expansion-001",
    correlationId: "request-003",
    jobCapacity: { planCode: "PRO", planVersion: 2, concurrentJobs: 10 },
    source: "XMLSTOCK_WORDSTAT",
    queries: ["морозильная камера"],
    regionCode: "225",
    device: "ALL",
    minusWords: [],
    clearMinusPhrases: false,
    includeRightColumn: true,
    clearPlus: false,
    maxKeywords: 2000
  });
  assert.equal(result.source, "XMLSTOCK_WORDSTAT");
  if (result.source !== "XMLSTOCK_WORDSTAT") assert.fail();
  assert.equal(result.regionCode, "225");
});

test("accepts only explicit selected rows and current entitlement", () => {
  assert.deepEqual(
    internalConfirmKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      version: 4,
      selectedRowIds: [ROW_ID],
      duplicatePolicy: "SKIP_EXISTING",
      entitlement: {
        planCode: "PRO",
        planVersion: 2,
        storedKeywords: 100_000,
        keywordsPerProject: 50_000,
        foldersPerProject: 500,
        trackedContextPairs: 10_000
      }
    }).selectedRowIds,
    [ROW_ID]
  );
});

test("accepts all collected rows with bounded exclusions", () => {
  const result = internalConfirmKeywordResearchRunInput({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    version: 4,
    selectionMode: "ALL",
    excludedRowIds: [ROW_ID],
    duplicatePolicy: "SKIP_EXISTING",
    entitlement: {
      planCode: "PRO",
      planVersion: 2,
      storedKeywords: 100_000,
      keywordsPerProject: 50_000,
      foldersPerProject: 500,
      trackedContextPairs: 10_000
    }
  });
  assert.equal(result.selectionMode, "ALL");
  assert.deepEqual(result.excludedRowIds, [ROW_ID]);
});

test("keeps one folder override for an imported Wordstat row", () => {
  const input = internalConfirmKeywordResearchRunInput({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    version: 4,
    selectionMode: "SELECTED",
    selectedRowIds: [ROW_ID],
    duplicatePolicy: "SKIP_EXISTING",
    targetGroupPath: "Wordstat / Все",
    distributionMode: "BY_SOURCE_QUERY",
    rowDestinations: [
      { rowId: ROW_ID, targetGroupPath: "Wordstat/Коммерческие" }
    ],
    entitlement: {
      planCode: "PRO",
      planVersion: 2,
      storedKeywords: 100_000,
      keywordsPerProject: 50_000,
      foldersPerProject: 500,
      trackedContextPairs: 10_000
    }
  });
  assert.deepEqual(input.rowDestinations, [
    { rowId: ROW_ID, targetGroupPath: "Wordstat / Коммерческие" }
  ]);
  assert.equal(input.distributionMode, "BY_SOURCE_QUERY");
});

test("rejects an URL path and duplicate row selection", () => {
  assert.throws(() =>
    internalCreateKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      idempotencyKey: "keyword-research-001",
      correlationId: "request-001",
      jobCapacity: {
        planCode: "PRO",
        planVersion: 2,
        concurrentJobs: 10
      },
      domain: "https://example.ru/catalog",
      database: "msk",
      maxKeywords: 100
    })
  );
  assert.throws(() =>
    internalConfirmKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      version: 4,
      selectedRowIds: [ROW_ID, ROW_ID],
      duplicatePolicy: "SKIP_EXISTING",
      entitlement: {
        planCode: "PRO",
        planVersion: 2,
        storedKeywords: 100_000,
        keywordsPerProject: 50_000,
        foldersPerProject: 500,
        trackedContextPairs: 10_000
      }
    })
  );
});

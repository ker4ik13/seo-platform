import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  keywordListQuery,
  keywordBodyListInput,
  keywordMultiSearchInput,
  keywordOperationScopeInput,
  keywordTagOptionsQuery,
  projectPositionHistoryQuery
} from "./keyword-query.js";

test("parses a bounded public operation scope page", () => {
  const groupId = "01900000-0000-7000-8000-000000000001";
  const cursor = "01900000-0000-7000-8000-000000000002";
  assert.deepEqual(
    keywordOperationScopeInput({ groupIds: [groupId], cursor }),
    { groupIds: [groupId], cursor }
  );
  assert.throws(
    () => keywordOperationScopeInput({ groupIds: [] }),
    DomainError
  );
  assert.throws(
    () => keywordOperationScopeInput({ cursor: 1 }),
    DomainError
  );
});

test("parses a bounded semantic keyword query", () => {
  const clusterId = "01900000-0000-7000-8000-000000000001";
  assert.deepEqual(
    keywordListQuery({ limit: "25", search: "  SEO аудит  " }),
    { limit: 25, search: "SEO аудит", sort: "CREATED_DESC" }
  );
  assert.deepEqual(keywordListQuery(undefined), {
    limit: 100,
    sort: "CREATED_DESC"
  });
  assert.equal(keywordListQuery({ includeNotes: "true" }).includeNotes, true);
  assert.equal(
    keywordBodyListInput({ query: { includeNotes: true } }).includeNotes,
    true
  );
  assert.throws(
    () => keywordListQuery({ includeNotes: "yes" }),
    DomainError
  );
  assert.throws(
    () => keywordListQuery({ includeNotes: "true", limit: "201" }),
    DomainError
  );
  assert.equal(keywordListQuery({ limit: "1000" }).limit, 1_000);
  assert.deepEqual(
    keywordListQuery({
      groupIds:
        "01900000-0000-7000-8000-000000000012,01900000-0000-7000-8000-000000000011"
    }).groupIds,
    [
      "01900000-0000-7000-8000-000000000011",
      "01900000-0000-7000-8000-000000000012"
    ]
  );
  assert.deepEqual(
    keywordListQuery({
      intent: "COMMERCIAL",
      tag: "  БРЕНД  ",
      clusterId,
      isFavorite: "false",
      isTracked: "true",
      priorityMin: "10",
      priorityMax: "40",
      sort: "PRIORITY_DESC"
    }),
    {
      limit: 100,
      intent: "COMMERCIAL",
      tag: "бренд",
      clusterId,
      isFavorite: false,
      isTracked: true,
      priorityMin: 10,
      priorityMax: 40,
      sort: "PRIORITY_DESC"
    }
  );
  assert.deepEqual(keywordTagOptionsQuery({ search: "  АкЦиЯ  " }), {
    search: "акция"
  });
});

test("accepts a large body-only folder union and advanced metric filters", () => {
  const groupIds = Array.from({ length: 250 }, (_, index) => `01900000-0000-7000-8000-${index.toString().padStart(12, "0")}`);
  const dimension = "GOOGLE|RU|1011969|ru|MOBILE";
  const result = keywordBodyListInput({ query: {
    limit: 100, groupIds, frequencyBaseMin: "1000", frequencyBaseMax: "5000",
    rankDimensionKey: dimension, rankState: "FOUND", rankPositionMin: 1, rankPositionMax: 10,
    rankCheckedFrom: "2026-09-01T00:00:00.000Z", rankCheckedBefore: "2026-09-09T00:00:00.000Z"
  } });
  assert.equal(result.groupIds?.length, 250);
  assert.equal(result.rankDimensionKey, dimension);
  assert.deepEqual(
    keywordListQuery({
      sort: "RANK_POSITION_ASC",
      rankSortDimensionKey: dimension
    }),
    { limit: 100, sort: "RANK_POSITION_ASC", rankSortDimensionKey: dimension }
  );
  assert.throws(
    () => keywordListQuery({ sort: "RANK_POSITION_ASC" }),
    DomainError
  );
  assert.throws(
    () => keywordListQuery({ sort: "TEXT_ASC", rankSortDimensionKey: dimension }),
    DomainError
  );
  assert.throws(() => keywordBodyListInput({ query: { groupIds: Array.from({ length: 2_001 }, (_, index) => `01900000-0000-7000-8000-${index.toString().padStart(12, "0")}`) } }), DomainError);
  assert.throws(() => keywordListQuery({ rankState: "FOUND" }), DomainError);
});

test("parses the project position history tracking scope", () => {
  assert.deepEqual(projectPositionHistoryQuery(undefined), {
    includeUntracked: false
  });
  assert.deepEqual(
    projectPositionHistoryQuery({
      includeUntracked: "true",
      rankDimensionKey: "GOOGLE|RU|1011969|ru|MOBILE"
    }),
    {
      includeUntracked: true,
      rankDimensionKey: "GOOGLE|RU|1011969|ru|MOBILE"
    }
  );
  assert.throws(
    () => projectPositionHistoryQuery({ includeUntracked: "yes" }),
    DomainError
  );
  assert.throws(
    () => projectPositionHistoryQuery({ extra: "true" }),
    DomainError
  );
});

test("accepts a multigroup union with more than fifty folders", () => {
  const groupIds = Array.from(
    { length: 70 },
    (_, index) =>
      `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`
  );

  assert.deepEqual(
    keywordListQuery({ groupIds: groupIds.join(",") }).groupIds,
    groupIds
  );
});

test("parses a bounded multiline keyword search", () => {
  assert.deepEqual(
    keywordMultiSearchInput({
      query: {
        limit: 500,
        groupIds: [
          "01900000-0000-7000-8000-000000000012",
          "01900000-0000-7000-8000-000000000011"
        ],
        sort: "TEXT_ASC"
      },
      search: {
        terms: ["  купить   холодильник ", "Ремонт холодильника"],
        mode: "ALL_WORDS"
      }
    }),
    {
      limit: 500,
      groupIds: [
        "01900000-0000-7000-8000-000000000011",
        "01900000-0000-7000-8000-000000000012"
      ],
      sort: "TEXT_ASC",
      multiSearch: {
        terms: ["купить холодильник", "Ремонт холодильника"],
        mode: "ALL_WORDS"
      }
    }
  );
});

test("rejects malformed multiline keyword searches", () => {
  assert.throws(
    () => keywordMultiSearchInput({
      query: {},
      search: { terms: ["SEO", "seo"], mode: "EXACT" }
    }),
    DomainError
  );
  assert.throws(
    () => keywordMultiSearchInput({
      query: {},
      search: { terms: ["seo"], mode: "REGEXP" }
    }),
    DomainError
  );
  assert.throws(
    () => keywordMultiSearchInput({
      query: {},
      search: { terms: ["seo"], mode: "EXACT", unsupported: true }
    }),
    DomainError
  );
});

test("rejects ambiguous and unbounded semantic keyword queries", () => {
  assert.throws(
    () => keywordListQuery({ limit: ["10", "20"] }),
    DomainError
  );
  assert.throws(() => keywordListQuery({ limit: "0" }), DomainError);
  assert.throws(() => keywordListQuery({ limit: "1001" }), DomainError);
  assert.throws(
    () => keywordListQuery({ cursor: "not a cursor" }),
    DomainError
  );
  assert.throws(
    () => keywordListQuery({ priorityMin: "20", priorityMax: "10" }),
    DomainError
  );
  assert.throws(() => keywordListQuery({ isTracked: "yes" }), DomainError);
  assert.throws(() => keywordListQuery({ sort: "DROP_TABLE" }), DomainError);
  assert.throws(() => keywordListQuery({ tag: "x".repeat(161) }), DomainError);
  assert.throws(
    () => keywordTagOptionsQuery({ search: "x".repeat(161) }),
    DomainError
  );
  assert.throws(() => keywordListQuery({ clusterId: "wrong" }), DomainError);
  assert.throws(
    () => keywordListQuery({
      groupId: "01900000-0000-7000-8000-000000000011",
      groupIds:
        "01900000-0000-7000-8000-000000000012,01900000-0000-7000-8000-000000000013"
    }),
    DomainError
  );
});

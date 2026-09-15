import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  keywordListQuery,
  keywordBodyListInput,
  keywordMultiSearchInput,
  keywordOperationScopeInput,
  keywordTagOptionsQuery,
  projectPositionHistoryQuery
} from "./keyword-query.js";

test("parses a bounded lightweight operation scope", () => {
  const first = "01900000-0000-7000-8000-000000000001";
  const second = "01900000-0000-7000-8000-000000000002";
  assert.deepEqual(keywordOperationScopeInput({}), {});
  assert.deepEqual(
    keywordOperationScopeInput({ groupIds: [first, second], cursor: first }),
    { groupIds: [first, second], cursor: first }
  );
  assert.throws(
    () => keywordOperationScopeInput({ groupIds: [first, first] }),
    BadRequestException
  );
  assert.throws(
    () => keywordOperationScopeInput({ groupIds: [1] }),
    BadRequestException
  );
  assert.throws(
    () => keywordOperationScopeInput({ unsupported: true }),
    BadRequestException
  );
});

test("parses bounded keyword list query", () => {
  const clusterId = "01900000-0000-7000-8000-000000000002";
  assert.deepEqual(
    keywordListQuery({ limit: "50", search: "  SEO  " }),
    { limit: 50, search: "SEO", sort: "CREATED_DESC" }
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
  assert.deepEqual(
    keywordBodyListInput({
      query: {
        metricProjection: ["BASE", "POSITIONS"],
        rankColumnKeys: ["rank:GOOGLE|RU|213|ru|MOBILE:url"]
      }
    }),
    {
      limit: 100,
      sort: "CREATED_DESC",
      metricProjection: ["BASE", "POSITIONS"],
      rankColumnKeys: ["rank:GOOGLE|RU|213|ru|MOBILE:url"]
    }
  );
  assert.throws(
    () => keywordListQuery({ includeNotes: "yes" }),
    BadRequestException
  );
  assert.throws(
    () => keywordListQuery({ includeNotes: "true", limit: "201" }),
    BadRequestException
  );
  assert.deepEqual(
    keywordListQuery({
      intent: "LOCAL",
      tag: "  СезОн  ",
      groupId: "01900000-0000-7000-8000-000000000001",
      clusterId,
      isFavorite: "true",
      priorityMin: "1",
      sort: "TEXT_ASC"
    }),
    {
      limit: 100,
      intent: "LOCAL",
      tag: "сезон",
      groupId: "01900000-0000-7000-8000-000000000001",
      clusterId,
      isFavorite: true,
      priorityMin: 1,
      sort: "TEXT_ASC"
    }
  );
  assert.equal(keywordListQuery({ sort: "UPDATED_ASC" }).sort, "UPDATED_ASC");
  assert.equal(keywordListQuery({ sort: "TEXT_DESC" }).sort, "TEXT_DESC");
  assert.equal(
    keywordListQuery({ sort: "PRIORITY_ASC" }).sort,
    "PRIORITY_ASC"
  );
  assert.equal(keywordListQuery({ sort: "SOURCE_DESC" }).sort, "SOURCE_DESC");
  assert.equal(keywordListQuery({ sort: "TAGS_ASC" }).sort, "TAGS_ASC");
  assert.deepEqual(keywordTagOptionsQuery({ search: "  БРЕНД  " }), {
    search: "бренд"
  });
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
});

test("trusted body list keeps a large group union and exact rank filter", () => {
  const groupIds = Array.from({ length: 250 }, (_, index) => `01900000-0000-7000-8000-${index.toString().padStart(12, "0")}`);
  const result = keywordBodyListInput({ query: { groupIds, rankDimensionKey: "YANDEX|RU|213|ru|DESKTOP", rankState: "NOT_FOUND", frequencyExactMax: "0" } });
  assert.equal(result.groupIds?.length, 250);
  assert.equal(result.rankState, "NOT_FOUND");
  assert.deepEqual(
    keywordListQuery({
      sort: "RANK_CHECKED_AT_DESC",
      rankSortDimensionKey: "YANDEX|RU|213|ru|DESKTOP"
    }),
    {
      limit: 100,
      sort: "RANK_CHECKED_AT_DESC",
      rankSortDimensionKey: "YANDEX|RU|213|ru|DESKTOP"
    }
  );
  assert.throws(
    () => keywordListQuery({ sort: "RANK_CHECKED_AT_DESC" }),
    BadRequestException
  );
  assert.throws(() => keywordListQuery({ rankDimensionKey: "YANDEX|RU|213|ru|DESKTOP", rankState: "NOT_FOUND", rankPositionMin: "1" }), BadRequestException);
});

test("parses the internal project position history tracking scope", () => {
  assert.deepEqual(projectPositionHistoryQuery({}), {
    includeUntracked: false
  });
  assert.deepEqual(
    projectPositionHistoryQuery({
      includeUntracked: "true",
      rankDimensionKey: "YANDEX|RU|213|ru|DESKTOP"
    }),
    {
      includeUntracked: true,
      rankDimensionKey: "YANDEX|RU|213|ru|DESKTOP"
    }
  );
  assert.throws(
    () => projectPositionHistoryQuery({ includeUntracked: ["true"] }),
    BadRequestException
  );
  assert.throws(
    () => projectPositionHistoryQuery({ unknown: "true" }),
    BadRequestException
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

test("parses and validates multiline keyword search bodies", () => {
  assert.deepEqual(
    keywordMultiSearchInput({
      query: { limit: 250, intent: "LOCAL" },
      search: {
        terms: ["  Москва   холодильник ", "купить морозильник"],
        mode: "CONTAINS"
      }
    }),
    {
      limit: 250,
      intent: "LOCAL",
      sort: "CREATED_DESC",
      multiSearch: {
        terms: ["Москва холодильник", "купить морозильник"],
        mode: "CONTAINS"
      }
    }
  );

  assert.throws(
    () => keywordMultiSearchInput({
      query: {},
      search: { terms: ["SEO", "seo"], mode: "EXACT" }
    }),
    BadRequestException
  );
  assert.throws(
    () => keywordMultiSearchInput({
      query: { unsupported: true },
      search: { terms: ["seo"], mode: "EXACT" }
    }),
    BadRequestException
  );
});

test("rejects oversized pages and malformed cursors", () => {
  assert.throws(() => keywordListQuery({ limit: "1001" }), BadRequestException);
  assert.throws(
    () => keywordListQuery({ cursor: "not a cursor" }),
    BadRequestException
  );
  assert.throws(
    () => keywordListQuery({ tag: "x".repeat(161) }),
    BadRequestException
  );
  assert.throws(
    () => keywordListQuery({ priorityMin: "90", priorityMax: "5" }),
    BadRequestException
  );
  assert.throws(
    () => keywordListQuery({ groupId: "wrong" }),
    BadRequestException
  );
  assert.throws(
    () => keywordListQuery({ clusterId: "wrong" }),
    BadRequestException
  );
  assert.throws(
    () => keywordListQuery({
      groupId: "01900000-0000-7000-8000-000000000011",
      groupIds:
        "01900000-0000-7000-8000-000000000012,01900000-0000-7000-8000-000000000013"
    }),
    BadRequestException
  );
});

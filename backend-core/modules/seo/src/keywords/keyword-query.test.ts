import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  keywordListQuery,
  keywordMultiSearchInput,
  keywordTagOptionsQuery,
  projectPositionHistoryQuery
} from "./keyword-query.js";

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

test("parses the internal project position history tracking scope", () => {
  assert.deepEqual(projectPositionHistoryQuery({}), {
    includeUntracked: false
  });
  assert.deepEqual(
    projectPositionHistoryQuery({ includeUntracked: "true" }),
    { includeUntracked: true }
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

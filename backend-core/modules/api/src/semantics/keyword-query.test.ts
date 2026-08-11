import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  keywordListQuery,
  keywordTagOptionsQuery
} from "./keyword-query.js";

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

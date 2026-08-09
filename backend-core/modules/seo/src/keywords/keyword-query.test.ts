import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { keywordListQuery } from "./keyword-query.js";

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
      groupId: "01900000-0000-7000-8000-000000000001",
      clusterId,
      isFavorite: "true",
      priorityMin: "1",
      sort: "TEXT_ASC"
    }),
    {
      limit: 100,
      intent: "LOCAL",
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

test("rejects oversized pages and malformed cursors", () => {
  assert.throws(() => keywordListQuery({ limit: "1001" }), BadRequestException);
  assert.throws(
    () => keywordListQuery({ cursor: "not a cursor" }),
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

import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { keywordListQuery } from "./keyword-query.js";

test("parses bounded keyword list query", () => {
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
      isFavorite: "true",
      priorityMin: "1",
      sort: "TEXT_ASC"
    }),
    {
      limit: 100,
      intent: "LOCAL",
      groupId: "01900000-0000-7000-8000-000000000001",
      isFavorite: true,
      priorityMin: 1,
      sort: "TEXT_ASC"
    }
  );
});

test("rejects oversized pages and malformed cursors", () => {
  assert.throws(() => keywordListQuery({ limit: "201" }), BadRequestException);
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
});

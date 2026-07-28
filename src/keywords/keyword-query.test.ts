import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { keywordListQuery } from "./keyword-query.js";

test("parses bounded keyword list query", () => {
  assert.deepEqual(
    keywordListQuery({ limit: "50", search: "  SEO  " }),
    { limit: 50, search: "SEO" }
  );
  assert.deepEqual(keywordListQuery(undefined), { limit: 100 });
});

test("rejects oversized pages and malformed cursors", () => {
  assert.throws(() => keywordListQuery({ limit: "201" }), BadRequestException);
  assert.throws(
    () => keywordListQuery({ cursor: "not a cursor" }),
    BadRequestException
  );
});

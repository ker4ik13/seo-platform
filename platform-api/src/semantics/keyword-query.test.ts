import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { keywordListQuery } from "./keyword-query.js";

test("parses a bounded semantic keyword query", () => {
  assert.deepEqual(
    keywordListQuery({ limit: "25", search: "  SEO аудит  " }),
    { limit: 25, search: "SEO аудит", sort: "CREATED_DESC" }
  );
  assert.deepEqual(keywordListQuery(undefined), {
    limit: 100,
    sort: "CREATED_DESC"
  });
  assert.deepEqual(
    keywordListQuery({
      intent: "COMMERCIAL",
      isFavorite: "false",
      isTracked: "true",
      priorityMin: "10",
      priorityMax: "40",
      sort: "PRIORITY_DESC"
    }),
    {
      limit: 100,
      intent: "COMMERCIAL",
      isFavorite: false,
      isTracked: true,
      priorityMin: 10,
      priorityMax: 40,
      sort: "PRIORITY_DESC"
    }
  );
});

test("rejects ambiguous and unbounded semantic keyword queries", () => {
  assert.throws(
    () => keywordListQuery({ limit: ["10", "20"] }),
    DomainError
  );
  assert.throws(() => keywordListQuery({ limit: "0" }), DomainError);
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
});

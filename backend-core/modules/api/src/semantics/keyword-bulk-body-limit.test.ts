import assert from "node:assert/strict";
import test from "node:test";
import {
  applyKeywordBulkBodyLimit,
  KEYWORD_BULK_BODY_LIMIT_BYTES
} from "./keyword-bulk-body-limit.js";

test("raises the body limit only for public keyword bulk create", () => {
  const bulk = {
    method: "POST",
    url: "/api/v1/projects/:projectId/keywords/bulk",
    bodyLimit: 1_048_576
  };
  const ordinary = {
    method: "POST",
    url: "/api/v1/projects/:projectId/keywords",
    bodyLimit: 1_048_576
  };

  applyKeywordBulkBodyLimit(bulk);
  applyKeywordBulkBodyLimit(ordinary);

  assert.equal(bulk.bodyLimit, KEYWORD_BULK_BODY_LIMIT_BYTES);
  assert.equal(ordinary.bodyLimit, 1_048_576);
});

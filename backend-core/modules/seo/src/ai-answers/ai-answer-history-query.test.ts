import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { aiAnswerHistoryQuery } from "./ai-answer-history-query.js";

test("parses a bounded AI position history page", () => {
  assert.deepEqual(aiAnswerHistoryQuery({ limit: "200", cursor: "abc_123-x" }), {
    limit: 200,
    cursor: "abc_123-x"
  });
});

test("rejects unknown, unbounded and malformed AI history query values", () => {
  for (const value of [
    {},
    { limit: "201" },
    { limit: "20", cursor: "not a cursor" },
    { limit: "20", workspaceId: "untrusted" }
  ]) {
    assert.throws(() => aiAnswerHistoryQuery(value), BadRequestException);
  }
});

test("accepts only an explicit competitor history flag", () => {
  assert.deepEqual(aiAnswerHistoryQuery({ limit: "200", includeCompetitors: "true" }), { limit: 200, includeCompetitors: true });
  assert.deepEqual(aiAnswerHistoryQuery({ limit: "200", includeCompetitors: "false" }), { limit: 200, includeCompetitors: false });
  assert.throws(() => aiAnswerHistoryQuery({ limit: "200", includeCompetitors: "yes" }), BadRequestException);
});

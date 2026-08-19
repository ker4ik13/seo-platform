import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { aiAnswerHistoryQuery } from "./ai-answer-history-query.js";

test("accepts the 200-row AI position history page", () => {
  assert.deepEqual(aiAnswerHistoryQuery({ limit: "200" }), { limit: 200 });
});

test("rejects untrusted or malformed AI history query fields", () => {
  for (const value of [
    {},
    { limit: "0" },
    { limit: "201" },
    { limit: "100", cursor: "contains spaces" },
    { limit: "100", workspaceId: "spoofed" }
  ]) {
    assert.throws(() => aiAnswerHistoryQuery(value), BadRequestException);
  }
});

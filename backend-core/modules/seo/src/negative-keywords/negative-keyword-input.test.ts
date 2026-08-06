import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { internalNegativeKeywordCommandInput } from "./negative-keyword-input.js";
import { negativeKeywordMatchingWords } from "./negative-keyword.service.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
};

test("trusted negative keyword input remains tenant and selection scoped", () => {
  const keywordId = "01900000-0000-7000-8000-000000000004";
  assert.deepEqual(
    internalNegativeKeywordCommandInput({
      ...context,
      rules: { words: ["Москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
      scope: { kind: "SELECTION", items: [{ id: keywordId, version: 3 }] }
    }).scope,
    { kind: "SELECTION", items: [{ id: keywordId, version: 3 }] }
  );
  assert.throws(
    () => internalNegativeKeywordCommandInput({
      ...context,
      rules: { words: ["Москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
      scope: { kind: "PROJECT", groupId: keywordId }
    }),
    BadRequestException
  );
});

test("whole-word matching respects boundaries while contains mode remains explicit", () => {
  assert.deepEqual(
    negativeKeywordMatchingWords("туры Москва недорого", {
      words: ["москва", "тур"],
      matchMode: "WHOLE_WORD",
      caseSensitive: false
    }),
    ["москва"]
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("туры Москва недорого", {
      words: ["москва", "тур"],
      matchMode: "CONTAINS",
      caseSensitive: false
    }),
    ["москва", "тур"]
  );
});

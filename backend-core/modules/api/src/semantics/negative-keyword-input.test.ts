import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  applyNegativeKeywordsInput,
  createNegativeKeywordPresetInput,
  negativeKeywordCommandInput
} from "./negative-keyword-input.js";

const groupId = "01900000-0000-7000-8000-000000000010";

test("normalizes a negative keyword preset and rejects duplicate words", () => {
  assert.deepEqual(
    createNegativeKeywordPresetInput({
      name: "  Города России  ",
      rules: {
        words: [" Москва ", "Санкт-  Петербург"],
        matchMode: "WHOLE_WORD",
        caseSensitive: false
      }
    }),
    {
      name: "Города России",
      rules: {
        words: ["Москва", "Санкт- Петербург"],
        matchMode: "WHOLE_WORD",
        caseSensitive: false,
        ignoreWordOrder: false,
        ignorePunctuation: false
      }
    }
  );
  assert.throws(
    () => createNegativeKeywordPresetInput({
      name: "Дубли",
      rules: {
        words: ["Москва", "москва"],
        matchMode: "CONTAINS",
        caseSensitive: false
      }
    }),
    DomainError
  );
});

test("requires an exact scope and preview hash before applying", () => {
  const excludedKeywordId = "01900000-0000-7000-8000-000000000011";
  const command = {
    rules: { words: ["москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
    scope: { kind: "GROUP", groupId }
  } as const;
  const preview = negativeKeywordCommandInput(command);
  assert.deepEqual(preview.scope, { kind: "GROUP", groupId });
  assert.equal(preview.page, 1);
  assert.equal(preview.pageSize, 100);
  assert.deepEqual(
    negativeKeywordCommandInput({ ...command, page: 2, pageSize: 200 }),
    { ...preview, page: 2, pageSize: 200 }
  );
  assert.throws(
    () => applyNegativeKeywordsInput({ ...command, previewHash: "stale" }),
    DomainError
  );
  assert.equal(
    applyNegativeKeywordsInput({ ...command, previewHash: "a".repeat(64) }).previewHash,
    "a".repeat(64)
  );
  assert.deepEqual(
    applyNegativeKeywordsInput({
      ...command,
      previewHash: "a".repeat(64),
      excludedKeywordIds: [excludedKeywordId]
    }).excludedKeywordIds,
    [excludedKeywordId]
  );
  assert.throws(
    () => applyNegativeKeywordsInput({
      ...command,
      previewHash: "a".repeat(64),
      excludedKeywordIds: [excludedKeywordId, excludedKeywordId]
    }),
    DomainError
  );
  assert.throws(
    () => negativeKeywordCommandInput({ ...command, page: 1, pageSize: 50 }),
    DomainError
  );
});

test("accepts Key Collector compatible phrase settings", () => {
  const input = createNegativeKeywordPresetInput({
    name: "Города",
    rules: {
      words: ["санкт-петербург"],
      matchMode: "WORD_FORM_PRECISE",
      caseSensitive: false,
      ignoreWordOrder: true,
      ignorePunctuation: true
    }
  });

  assert.equal(input.rules.matchMode, "WORD_FORM_PRECISE");
  assert.equal(input.rules.ignoreWordOrder, true);
  assert.equal(input.rules.ignorePunctuation, true);
});

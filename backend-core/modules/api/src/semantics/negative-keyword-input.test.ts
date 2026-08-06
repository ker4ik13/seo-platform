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
        caseSensitive: false
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
  const command = negativeKeywordCommandInput({
    rules: { words: ["москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
    scope: { kind: "GROUP", groupId }
  });
  assert.deepEqual(command.scope, { kind: "GROUP", groupId });
  assert.throws(
    () => applyNegativeKeywordsInput({ ...command, previewHash: "stale" }),
    DomainError
  );
  assert.equal(
    applyNegativeKeywordsInput({ ...command, previewHash: "a".repeat(64) }).previewHash,
    "a".repeat(64)
  );
});

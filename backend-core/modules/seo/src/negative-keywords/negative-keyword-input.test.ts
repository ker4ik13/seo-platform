import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { internalNegativeKeywordCommandInput } from "./negative-keyword-input.js";
import {
  negativeKeywordHighlightRanges,
  negativeKeywordMatchingWords
} from "./negative-keyword.service.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
};

const defaultRuleFlags = {
  ignoreWordOrder: false,
  ignorePunctuation: false
} as const;

test("trusted negative keyword input remains tenant and selection scoped", () => {
  const keywordId = "01900000-0000-7000-8000-000000000004";
  const input = internalNegativeKeywordCommandInput({
    ...context,
    rules: { words: ["Москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
    scope: { kind: "SELECTION", items: [{ id: keywordId, version: 3 }] }
  });
  assert.deepEqual(
    input.scope,
    { kind: "SELECTION", items: [{ id: keywordId, version: 3 }] }
  );
  assert.equal(input.page, 1);
  assert.equal(input.pageSize, 100);
  assert.equal(internalNegativeKeywordCommandInput({
    ...context,
    rules: { words: ["Москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
    scope: { kind: "PROJECT" },
    page: 2,
    pageSize: 200
  }).pageSize, 200);
  assert.throws(
    () => internalNegativeKeywordCommandInput({
      ...context,
      rules: { words: ["Москва"], matchMode: "WHOLE_WORD", caseSensitive: false },
      scope: { kind: "PROJECT", groupId: keywordId }
    }),
    BadRequestException
  );
});

test("highlight ranges point to the matched text inside the query", () => {
  assert.deepEqual(
    negativeKeywordHighlightRanges("туры Москва недорого", {
      words: ["москва"],
      matchMode: "WHOLE_WORD",
      caseSensitive: false,
      ...defaultRuleFlags
    }),
    [{ start: 5, end: 11 }]
  );
  assert.deepEqual(
    negativeKeywordHighlightRanges("туры Москва недорого", {
      words: ["тур"],
      matchMode: "CONTAINS",
      caseSensitive: false,
      ...defaultRuleFlags
    }),
    [{ start: 0, end: 3 }]
  );
});

test("whole-word matching respects boundaries while contains mode remains explicit", () => {
  assert.deepEqual(
    negativeKeywordMatchingWords("туры Москва недорого", {
      words: ["москва", "тур"],
      matchMode: "WHOLE_WORD",
      caseSensitive: false,
      ...defaultRuleFlags
    }),
    ["москва"]
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("туры Москва недорого", {
      words: ["москва", "тур"],
      matchMode: "CONTAINS",
      caseSensitive: false,
      ...defaultRuleFlags
    }),
    ["москва", "тур"]
  );
});

test("word-form modes distinguish inflections from literal matching", () => {
  const text = "доставка живых ёлок по Москве";
  assert.deepEqual(
    negativeKeywordMatchingWords(text, {
      words: ["живая ёлка", "москва"],
      matchMode: "WORD_FORM_FAST",
      caseSensitive: false,
      ...defaultRuleFlags
    }),
    ["живая ёлка", "москва"]
  );
  assert.deepEqual(
    negativeKeywordMatchingWords(text, {
      words: ["живая ёлка", "москва"],
      matchMode: "WHOLE_WORD",
      caseSensitive: false,
      ...defaultRuleFlags
    }),
    []
  );
});

test("stop phrases can ignore word order and punctuation independently", () => {
  const base = {
    words: ["купить ёлку"],
    matchMode: "WORD_FORM_PRECISE" as const,
    caseSensitive: false
  };
  assert.deepEqual(
    negativeKeywordMatchingWords("ёлку недорого купить", {
      ...base,
      ignoreWordOrder: true,
      ignorePunctuation: false
    }),
    ["купить ёлку"]
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("ёлку, недорого купить", {
      ...base,
      ignoreWordOrder: true,
      ignorePunctuation: false
    }),
    []
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("ёлку, недорого купить", {
      ...base,
      ignoreWordOrder: true,
      ignorePunctuation: true
    }),
    ["купить ёлку"]
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("купить, ёлку", {
      ...base,
      ignoreWordOrder: false,
      ignorePunctuation: false
    }),
    []
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("купить, ёлку", {
      ...base,
      ignoreWordOrder: false,
      ignorePunctuation: true
    }),
    ["купить ёлку"]
  );
});

test("exact phrase mode requires the whole query while respecting unordered matching", () => {
  const base = {
    words: ["купить ёлку"],
    matchMode: "EXACT_PHRASE" as const,
    caseSensitive: false,
    ignorePunctuation: true
  };
  assert.deepEqual(
    negativeKeywordMatchingWords("купить ёлку", { ...base, ignoreWordOrder: false }),
    ["купить ёлку"]
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("срочно купить ёлку", { ...base, ignoreWordOrder: false }),
    []
  );
  assert.deepEqual(
    negativeKeywordMatchingWords("ёлку купить", { ...base, ignoreWordOrder: true }),
    ["купить ёлку"]
  );
});

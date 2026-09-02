import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  aiAnswerCancelInput,
  aiAnswerIdempotencyKey,
  createAiAnswerCollectionInput
} from "./ai-answer-collection-input.js";

const keywordId = "01900000-0000-7000-8000-000000000001";

test("accepts a bounded AI answer collection command", () => {
  assert.deepEqual(
    createAiAnswerCollectionInput({
      items: [{ id: keywordId, version: 3 }],
      searchEngine: "YANDEX",
      regionCode: "213",
      device: "DESKTOP",
      host: "WWW.NT-G.RU",
      excludeSubdomains: false,
      brands: ["Новая Технология"]
    }),
    {
      items: [{ id: keywordId, version: 3 }],
      searchEngine: "YANDEX",
      regionCode: "213",
      device: "DESKTOP",
      host: "nt-g.ru",
      excludeSubdomains: false,
      brands: ["Новая Технология"]
    }
  );
  assert.equal(aiAnswerIdempotencyKey("ai-answer-command-1"), "ai-answer-command-1");
  assert.deepEqual(aiAnswerCancelInput({}), {});
});

test("canonicalizes an internationalized host and rejects ambiguous input", () => {
  assert.equal(
    createAiAnswerCollectionInput({
      items: [{ id: keywordId, version: 1 }],
      searchEngine: "GOOGLE",
      regionCode: "1011969",
      device: "MOBILE",
      host: "пример.рф",
      excludeSubdomains: true,
      brands: []
    }).host,
    "xn--e1afmkfd.xn--p1ai"
  );
  assert.throws(
    () => createAiAnswerCollectionInput({
      items: [{ id: keywordId, version: 1 }, { id: keywordId, version: 1 }],
      searchEngine: "YANDEX",
      regionCode: "213",
      device: "DESKTOP",
      host: "nt-g.ru",
      excludeSubdomains: false,
      brands: []
    }),
    DomainError
  );
  assert.throws(() => aiAnswerCancelInput({ force: true }), DomainError);
});

test("keeps AI competitor collection separate from project position tracking", () => {
  const command = createAiAnswerCollectionInput({
    items: [{ id: keywordId, version: 4 }],
    searchEngine: "GOOGLE",
    regionCode: "1011969",
    device: "DESKTOP",
    host: "example.com",
    excludeSubdomains: false,
    brands: [],
    purpose: "COMPETITOR_SERP",
    saveProjectPosition: false
  });
  assert.equal(command.purpose, "COMPETITOR_SERP");
  assert.equal(command.saveProjectPosition, false);
  assert.throws(
    () => createAiAnswerCollectionInput({
      ...command,
      purpose: "POSITION_TRACKING",
      saveProjectPosition: true
    }),
    DomainError
  );
});

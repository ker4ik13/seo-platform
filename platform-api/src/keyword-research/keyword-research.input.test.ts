import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmKeywordResearchRunInput,
  createKeywordResearchRunInput
} from "./keyword-research.input.js";

test("parses public competitor research input", () => {
  assert.deepEqual(
    createKeywordResearchRunInput({
      domain: "HTTPS://Example.RU/",
      database: "spb",
      maxKeywords: 250
    }),
    { domain: "example.ru", database: "spb", maxKeywords: 250 }
  );
});

test("rejects unknown fields and unsupported databases", () => {
  assert.throws(() =>
    createKeywordResearchRunInput({
      domain: "example.ru",
      database: "unknown",
      maxKeywords: 100
    })
  );
  assert.throws(() =>
    createKeywordResearchRunInput({
      domain: "example.ru",
      database: "msk",
      maxKeywords: 100,
      apiKey: "must-never-be-accepted"
    })
  );
});

test("requires unique explicit row ids for import confirmation", () => {
  const id = "01900000-0000-7000-8000-000000000001";
  assert.deepEqual(
    confirmKeywordResearchRunInput({
      selectedRowIds: [id],
      duplicatePolicy: "OVERWRITE_MAPPED"
    }),
    {
      selectedRowIds: [id],
      duplicatePolicy: "OVERWRITE_MAPPED"
    }
  );
  assert.throws(() =>
    confirmKeywordResearchRunInput({
      selectedRowIds: [id, id],
      duplicatePolicy: "OVERWRITE_MAPPED"
    })
  );
});

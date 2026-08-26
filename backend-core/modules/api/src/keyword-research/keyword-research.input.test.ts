import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmKeywordResearchRunInput,
  createKeywordResearchRunInput,
  keywordResearchRowsQuery
} from "./keyword-research.input.js";

test("parses a bounded public keyword result page", () => {
  assert.deepEqual(keywordResearchRowsQuery("500", "200"), {
    cursor: 500,
    limit: 200
  });
  assert.deepEqual(keywordResearchRowsQuery(undefined, undefined), {
    limit: 200
  });
  assert.throws(() => keywordResearchRowsQuery(["500"], "200"));
  assert.throws(() => keywordResearchRowsQuery("500", "501"));
});

test("parses public competitor research input", () => {
  assert.deepEqual(
    createKeywordResearchRunInput({
      domain: "HTTPS://Example.RU/",
      database: "spb",
      maxKeywords: 250
    }),
    { source: "KEYS_SO", domain: "example.ru", database: "spb", maxKeywords: 250 }
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
      selectionMode: "SELECTED",
      selectedRowIds: [id],
      duplicatePolicy: "OVERWRITE_MAPPED",
      distributionMode: "SINGLE_GROUP"
    }
  );
  assert.throws(() =>
    confirmKeywordResearchRunInput({
      selectedRowIds: [id, id],
      duplicatePolicy: "OVERWRITE_MAPPED"
    })
  );
});

test("keeps a server-side all-results selection with explicit exclusions", () => {
  const excluded = "01900000-0000-7000-8000-000000000001";
  assert.deepEqual(
    confirmKeywordResearchRunInput({
      selectionMode: "ALL",
      excludedRowIds: [excluded],
      duplicatePolicy: "SKIP_EXISTING"
    }),
    {
      selectionMode: "ALL",
      excludedRowIds: [excluded],
      duplicatePolicy: "SKIP_EXISTING",
      distributionMode: "SINGLE_GROUP"
    }
  );
  assert.throws(() =>
    confirmKeywordResearchRunInput({
      selectionMode: "SELECTED",
      selectedRowIds: [excluded],
      excludedRowIds: [excluded],
      duplicatePolicy: "SKIP_EXISTING"
    })
  );
});

test("parses per-row Wordstat folder destinations", () => {
  const first = "01900000-0000-7000-8000-000000000001";
  const second = "01900000-0000-7000-8000-000000000002";
  assert.deepEqual(
    confirmKeywordResearchRunInput({
      selectionMode: "SELECTED",
      selectedRowIds: [first, second],
      duplicatePolicy: "SKIP_EXISTING",
      targetGroupPath: "Wordstat / Все запросы",
      distributionMode: "BY_SOURCE_QUERY",
      rowDestinations: [
        { rowId: second, targetGroupPath: "Wordstat / Коммерческие" }
      ]
    }),
    {
      selectionMode: "SELECTED",
      selectedRowIds: [first, second],
      duplicatePolicy: "SKIP_EXISTING",
      targetGroupPath: "Wordstat / Все запросы",
      rowDestinations: [
        { rowId: second, targetGroupPath: "Wordstat / Коммерческие" }
      ],
      distributionMode: "BY_SOURCE_QUERY"
    }
  );
  assert.throws(() =>
    confirmKeywordResearchRunInput({
      selectionMode: "SELECTED",
      selectedRowIds: [first],
      duplicatePolicy: "SKIP_EXISTING",
      rowDestinations: [
        { rowId: second, targetGroupPath: "Wordstat / Лишняя" }
      ]
    })
  );
});

test("parses a public Arsenkin Wordstat expansion", () => {
  assert.deepEqual(
    createKeywordResearchRunInput({
      source: "ARSENKIN_WORDSTAT",
      queries: ["  купить   холодильник "],
      regionCode: "213",
      device: "DESKTOP",
      minusWords: [],
      clearMinusPhrases: false,
      includeRightColumn: true,
      clearPlus: false,
      maxKeywords: 1000
    }),
    {
      source: "ARSENKIN_WORDSTAT",
      queries: ["купить холодильник"],
      regionCode: "213",
      device: "DESKTOP",
      minusWords: [],
      clearMinusPhrases: false,
      includeRightColumn: true,
      clearPlus: false,
      maxKeywords: 1000
    }
  );
});

test("parses an XMLStock Wordstat expansion for Russia", () => {
  const result = createKeywordResearchRunInput({
    source: "XMLSTOCK_WORDSTAT",
    queries: ["холодильник"],
    regionCode: "225",
    device: "ALL",
    minusWords: [],
    clearMinusPhrases: false,
    includeRightColumn: true,
    clearPlus: false,
    maxKeywords: 2000
  });
  assert.equal(result.source, "XMLSTOCK_WORDSTAT");
  if (result.source !== "XMLSTOCK_WORDSTAT") assert.fail();
  assert.equal(result.regionCode, "225");
});

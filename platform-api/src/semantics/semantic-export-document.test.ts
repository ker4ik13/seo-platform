import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import type {
  SemanticExportDataset,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import { semanticExportDocument } from "./semantic-export-document.js";

const customColumnId = "01900000-0000-7000-8000-000000000050";

test("serializes localized CSV with round-trip-safe quoting", () => {
  const document = semanticExportDocument(
    dataset(),
    {
      format: "CSV",
      scope: "CURRENT_FILTER",
      locale: "ru",
      columns: ["query", "tags", `custom:${customColumnId}`],
      includeBom: true
    },
    new Date("2026-07-30T12:00:00.000Z")
  );

  assert.equal(document.filename, "semantic-core-2026-07-30.csv");
  assert.equal(document.rowCount, 1);
  assert.equal(
    Buffer.from(document.bytes).toString("utf8"),
    '\uFEFFЗапрос,Теги,Частотность\r\n"=SEO,""аудит""","[""важное"",""продажи""]",42\r\n'
  );
});

test("protects Google Sheets CSV and preserves typed JSON values", () => {
  const google = semanticExportDocument(dataset(), {
    format: "GOOGLE_CSV",
    scope: "FULL_CORE",
    locale: "en",
    columns: ["query"]
  });
  assert.match(
    Buffer.from(google.bytes).toString("utf8"),
    /Query\r\n"'=SEO,""аудит"""/u
  );

  const json = semanticExportDocument(dataset(), {
    format: "JSON",
    scope: "FULL_CORE",
    locale: "en",
    columns: ["tags", `custom:${customColumnId}`]
  });
  assert.deepEqual(JSON.parse(Buffer.from(json.bytes).toString("utf8")), [
    {
      tags: ["важное", "продажи"],
      [`custom:${customColumnId}`]: 42
    }
  ]);
});

test("exports current frequency, word count and search positions", () => {
  const document = semanticExportDocument(dataset(), {
    format: "JSON",
    scope: "FULL_CORE",
    locale: "ru",
    columns: [
      "frequency",
      "frequencyExact",
      "frequencyFixed",
      "wordCount",
      "yandexPosition",
      "yandexRelevantUrl",
      "googlePosition",
      "googleRelevantUrl",
      "visibility"
    ]
  });

  assert.deepEqual(JSON.parse(Buffer.from(document.bytes).toString("utf8")), [
    {
      frequency: "12890",
      frequencyExact: "5123",
      frequencyFixed: "5122",
      wordCount: 1,
      yandexPosition: 5,
      yandexRelevantUrl: "https://example.com/ranking-page",
      googlePosition: null,
      googleRelevantUrl: null,
      visibility: 96
    }
  ]);
});

function dataset(): SemanticExportDataset {
  return {
    items: [keyword()],
    customColumnNames: { [customColumnId]: "Частотность" }
  };
}

function keyword(): SemanticKeywordListItem {
  return {
    id: "01900000-0000-7000-8000-000000000010",
    textOriginal: '=SEO,"аудит"',
    textNormalized: '=seo,"аудит"',
    language: "ru",
    priority: 15,
    isFavorite: false,
    isTracked: true,
    tags: ["важное", "продажи"],
    tagsTruncated: false,
    customValues: [
      {
        columnId: customColumnId,
        value: 42,
        version: 1,
        updatedAt: "2026-07-30T10:00:00.000Z"
      }
    ],
    frequency: {
      value: "12890",
      regionCode: "213",
      device: "ALL",
      provider: "XMLSTOCK",
      observedAt: "2026-07-30T10:00:00.000Z"
    },
    frequencies: [
      {
        type: "BASE",
        value: "12890",
        regionCode: "213",
        device: "ALL",
        provider: "XMLSTOCK",
        observedAt: "2026-07-30T10:00:00.000Z"
      },
      {
        type: "EXACT",
        value: "5123",
        regionCode: "213",
        device: "ALL",
        provider: "ARSENKIN",
        observedAt: "2026-07-30T10:00:00.000Z"
      },
      {
        type: "FIXED",
        value: "5122",
        regionCode: "213",
        device: "ALL",
        provider: "ARSENKIN",
        observedAt: "2026-07-30T10:00:00.000Z"
      }
    ],
    positions: [
      {
        searchEngine: "YANDEX",
        found: true,
        position: 5,
        previousPosition: 7,
        rankingUrl: "https://example.com/ranking-page",
        observedAt: "2026-07-30T10:00:00.000Z"
      },
      {
        searchEngine: "GOOGLE",
        found: false,
        observedAt: "2026-07-30T10:00:00.000Z"
      }
    ],
    sourceMode: "IMPORT",
    createdAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
    version: 2
  };
}

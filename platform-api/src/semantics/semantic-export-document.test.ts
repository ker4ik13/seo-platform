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
    sourceMode: "IMPORT",
    createdAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
    version: 2
  };
}

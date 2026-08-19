import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticKeywordListItem,
  SemanticPositionHistoryExportRow
} from "@seo-platform/contracts";
import { unzipSync } from "fflate";
import {
  semanticExportFile,
  semanticPositionHistoryExportFile
} from "./semantic-export-encoder.js";

test("streams 2,002 rows into a valid XLSX workbook", async () => {
  const file = semanticExportFile(
    keywords(2_002),
    {
      format: "XLSX",
      scope: "FULL_CORE",
      locale: "ru",
      columns: ["query", "priority"]
    },
    {},
    new Date("2026-08-12T10:00:00.000Z")
  );

  assert.equal(file.filename, "semantic-core-2026-08-12.xlsx");
  assert.equal(
    file.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  const archive = unzipSync(await collect(file.bytes));
  const sheet = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
  assert.equal(sheet.match(/<row r=/gu)?.length, 2_003);
  assert.match(sheet, /<t xml:space="preserve">запрос 2002<\/t>/u);
  assert.ok(archive["xl/workbook.xml"]);
  assert.ok(archive["[Content_Types].xml"]);
});

test("writes frequencies and search positions as native XLSX numbers", async () => {
  const file = semanticExportFile(
    keywordWithMetrics(),
    {
      format: "XLSX",
      scope: "FULL_CORE",
      locale: "ru",
      columns: [
        "query",
        "frequency",
        "frequencyExact",
        "frequencyFixed",
        "yandexPosition",
        "googlePosition"
      ]
    },
    {}
  );

  const archive = unzipSync(await collect(file.bytes));
  const sheet = new TextDecoder().decode(
    archive["xl/worksheets/sheet1.xml"]
  );
  assert.match(
    sheet,
    /<c r="A2" t="inlineStr"><is><t xml:space="preserve">запрос с метриками<\/t><\/is><\/c>/u
  );
  assert.match(sheet, /<c r="B2"><v>12890<\/v><\/c>/u);
  assert.match(sheet, /<c r="C2"><v>730<\/v><\/c>/u);
  assert.match(sheet, /<c r="D2"><v>41<\/v><\/c>/u);
  assert.match(sheet, /<c r="E2"><v>7<\/v><\/c>/u);
  assert.match(sheet, /<c r="F2"><v>13<\/v><\/c>/u);
  assert.doesNotMatch(
    sheet,
    /<c r="(?:B|C|D|E|F)2" t="inlineStr">/u
  );
});

test("protects CSV and custom headers from spreadsheet formulas", async () => {
  const customId = "01900000-0000-7000-8000-000000000099";
  const file = semanticExportFile(
    oneKeyword("=2+2", customId),
    {
      format: "CSV",
      scope: "FULL_CORE",
      locale: "en",
      columns: ["query", `custom:${customId}`]
    },
    { [customId]: "+Formula header" }
  );

  const csvBytes = await collect(file.bytes);
  const csv = new TextDecoder().decode(csvBytes);
  assert.deepEqual(Array.from(csvBytes.slice(0, 3)), [81, 117, 101]);
  assert.match(csv, /^Query,'\+Formula header\r\n/u);
  assert.match(csv, /\r\n'=2\+2,'@unsafe\r\n$/u);
  assert.match(csv, /,'@unsafe\r\n$/u);
});

test("always adds a BOM for Google Sheets CSV", async () => {
  const file = semanticExportFile(
    keywords(1),
    {
      format: "GOOGLE_CSV",
      scope: "FULL_CORE",
      locale: "ru",
      columns: ["query"],
      includeBom: false
    },
    {}
  );

  const csvBytes = await collect(file.bytes);
  const csv = new TextDecoder().decode(csvBytes);
  assert.deepEqual(Array.from(csvBytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  assert.equal(csv.startsWith("Запрос\r\n"), true);
});

test("builds a position-history workbook with formulas and comparison colors", async () => {
  const file = semanticPositionHistoryExportFile(
    positionHistoryRows(),
    {
      format: "XLSX",
      scope: "FULL_CORE",
      locale: "ru",
      columns: ["query"],
      positionHistory: {
        observedFrom: "2026-08-01T00:00:00.000Z",
        observedBefore: "2026-08-20T00:00:00.000Z",
        searchEngines: ["YANDEX", "GOOGLE"]
      }
    },
    {
      rowCount: 4,
      dates: {
        YANDEX: ["2026-08-18", "2026-08-11", "2026-08-05"],
        GOOGLE: ["2026-08-18"]
      }
    },
    new Date("2026-08-19T10:00:00.000Z")
  );

  assert.equal(file.filename, "positions-history-2026-08-19.xlsx");
  const archive = unzipSync(await collect(file.bytes));
  const yandex = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
  const workbook = new TextDecoder().decode(archive["xl/workbook.xml"]);
  assert.match(workbook, /<sheet name="Яндекс"/u);
  assert.match(workbook, /<sheet name="Google"/u);
  assert.match(yandex, /<pane xSplit="1" ySplit="4"/u);
  assert.match(
    yandex,
    /<f>COUNTIFS\(D\$5:INDEX\(D:D,MAX\(5,COUNTA\(\$A:\$A\)\)\),&quot;&gt;=1&quot;,D\$5:INDEX\(D:D,MAX\(5,COUNTA\(\$A:\$A\)\)\),&quot;&lt;=5&quot;\)<\/f>/u
  );
  assert.match(yandex, /<c r="D5" s="7"><v>5<\/v><\/c>/u);
  assert.match(yandex, /<c r="E5" s="7"><v>7<\/v><\/c>/u);
  assert.match(yandex, /<c r="D6" s="8"><v>9<\/v><\/c>/u);
  assert.match(
    yandex,
    /<c r="D7" s="8" t="inlineStr"><is><t xml:space="preserve">—<\/t><\/is><\/c>/u
  );
  assert.match(
    yandex,
    /<c r="D8" s="9" t="inlineStr"><is><t xml:space="preserve">—<\/t><\/is><\/c>/u
  );
  assert.doesNotMatch(yandex, /<c r="D5"[^>]*t="inlineStr"/u);
});

async function* keywords(
  count: number
): AsyncGenerator<SemanticKeywordListItem> {
  for (let index = 1; index <= count; index += 1) {
    yield keyword(`запрос ${index}`);
  }
}

async function* oneKeyword(
  text: string,
  customId: string
): AsyncGenerator<SemanticKeywordListItem> {
  yield {
    ...keyword(text),
    customValues: [
      {
        columnId: customId,
        value: "@unsafe",
        version: 1,
        updatedAt: "2026-08-12T10:00:00.000Z"
      }
    ]
  };
}

async function* keywordWithMetrics(): AsyncGenerator<SemanticKeywordListItem> {
  yield {
    ...keyword("запрос с метриками"),
    frequency: {
      value: "12890",
      regionCode: "225",
      device: "ALL",
      provider: "XMLSTOCK",
      observedAt: "2026-08-12T10:00:00.000Z"
    },
    frequencies: [
      {
        type: "EXACT",
        value: "730",
        regionCode: "225",
        device: "ALL",
        provider: "XMLSTOCK",
        observedAt: "2026-08-12T10:00:00.000Z"
      },
      {
        type: "FIXED",
        value: "41",
        regionCode: "225",
        device: "ALL",
        provider: "XMLSTOCK",
        observedAt: "2026-08-12T10:00:00.000Z"
      }
    ],
    positions: [
      {
        searchEngine: "YANDEX",
        found: true,
        position: 7,
        observedAt: "2026-08-12T10:00:00.000Z"
      },
      {
        searchEngine: "GOOGLE",
        found: true,
        position: 13,
        observedAt: "2026-08-12T10:00:00.000Z"
      }
    ]
  };
}

async function* positionHistoryRows(): AsyncGenerator<SemanticPositionHistoryExportRow> {
  yield {
    keywordId: "01900000-0000-7000-8000-000000000011",
    text: "позиция выросла",
    createdAt: "2026-07-01T10:00:00.000Z",
    snapshots: [
      { searchEngine: "YANDEX", observedDate: "2026-08-18", found: true, position: 5 },
      { searchEngine: "YANDEX", observedDate: "2026-08-11", found: true, position: 7 },
      { searchEngine: "YANDEX", observedDate: "2026-08-05", found: false },
      { searchEngine: "GOOGLE", observedDate: "2026-08-18", found: true, position: 12 }
    ]
  };
  yield {
    keywordId: "01900000-0000-7000-8000-000000000012",
    text: "позиция упала",
    createdAt: "2026-07-01T10:00:00.000Z",
    snapshots: [
      { searchEngine: "YANDEX", observedDate: "2026-08-18", found: true, position: 9 },
      { searchEngine: "YANDEX", observedDate: "2026-08-11", found: true, position: 4 },
      { searchEngine: "YANDEX", observedDate: "2026-08-05", found: true, position: 6 }
    ]
  };
  yield {
    keywordId: "01900000-0000-7000-8000-000000000013",
    text: "позиция потеряна",
    createdAt: "2026-07-01T10:00:00.000Z",
    snapshots: [
      { searchEngine: "YANDEX", observedDate: "2026-08-18", found: false },
      { searchEngine: "YANDEX", observedDate: "2026-08-11", found: true, position: 3 }
    ]
  };
  yield {
    keywordId: "01900000-0000-7000-8000-000000000014",
    text: "в этот день не снимали",
    createdAt: "2026-07-01T10:00:00.000Z",
    snapshots: [
      { searchEngine: "YANDEX", observedDate: "2026-08-11", found: true, position: 2 }
    ]
  };
}

function keyword(text: string): SemanticKeywordListItem {
  return {
    id: "01900000-0000-7000-8000-000000000010",
    textOriginal: text,
    textNormalized: text.toLocaleLowerCase(),
    language: "ru",
    priority: 50,
    isFavorite: false,
    isTracked: false,
    tags: [],
    tagsTruncated: false,
    sourceMode: "MANUAL",
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    version: 1
  };
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

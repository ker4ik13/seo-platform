import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticKeywordListItem,
  SemanticPositionHistoryExportRow
} from "@seo-platform/contracts";
import { unzipSync } from "fflate";
import { importedPositionHistory } from "../imports/position-history-import.js";
import { parseXlsxRows } from "../imports/xlsx-parser.js";
import {
  semanticExportFile,
  semanticFolderMapExportFile,
  semanticPositionHistoryExportFile,
  type SemanticExportKeywordRow
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

test("builds a linked folder-map workbook with one data sheet per non-empty folder", async () => {
  const rootId = "01900000-0000-7000-8000-000000000020";
  const childId = "01900000-0000-7000-8000-000000000021";
  const emptyId = "01900000-0000-7000-8000-000000000022";
  const file = semanticFolderMapExportFile(
    (groupId) => folderKeywordRows(groupId, rootId, childId),
    {
      format: "XLSX",
      scope: "FOLDER_MAP",
      locale: "ru",
      columns: ["query", "frequency"],
      folderMap: {
        groupIds: [rootId],
        includeDescendants: true
      }
    },
    {
      groups: [
        {
          id: rootId,
          name: "Каталог/Морозильники",
          path: "Каталог/Морозильники",
          keywordCount: 1,
          depth: 0
        },
        {
          id: childId,
          parentId: rootId,
          name: "Каталог/Морозильники",
          path: "Каталог/Морозильники / Каталог/Морозильники",
          keywordCount: 1,
          depth: 1
        },
        {
          id: emptyId,
          parentId: rootId,
          name: "Пустая папка",
          path: "Каталог/Морозильники / Пустая папка",
          keywordCount: 0,
          depth: 1
        }
      ]
    },
    {},
    new Date("2026-08-25T10:00:00.000Z")
  );

  assert.equal(file.filename, "semantic-site-map-2026-08-25.xlsx");
  const archive = unzipSync(await collect(file.bytes));
  const workbook = new TextDecoder().decode(archive["xl/workbook.xml"]);
  const map = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
  const rootSheet = new TextDecoder().decode(archive["xl/worksheets/sheet2.xml"]);
  const childSheet = new TextDecoder().decode(archive["xl/worksheets/sheet3.xml"]);

  assert.match(workbook, /<sheet name="Карта"/u);
  assert.match(workbook, /<sheet name="Каталог Морозильники"/u);
  assert.match(workbook, /<sheet name="Каталог Морозильники \(2\)"/u);
  assert.equal(archive["xl/worksheets/sheet4.xml"], undefined);
  assert.match(map, /<t xml:space="preserve">Карта сайта<\/t>/u);
  assert.doesNotMatch(map, /<t xml:space="preserve">Запросов<\/t>/u);
  assert.match(map, /<hyperlink ref="A2" location="'Каталог Морозильники'!A1"\/>/u);
  assert.match(map, /<hyperlink ref="B3" location="'Каталог Морозильники \(2\)'!A1"\/>/u);
  assert.doesNotMatch(map, /<hyperlink ref="B4"/u);
  assert.match(rootSheet, /<hyperlink ref="A1" location="'Карта'!A2"\/>/u);
  assert.match(rootSheet, /<t xml:space="preserve">Запрос<\/t>/u);
  assert.match(rootSheet, /<t xml:space="preserve">=опасный запрос<\/t>/u);
  assert.match(childSheet, /<hyperlink ref="A1" location="'Карта'!B3"\/>/u);
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

test("exports regular and AI result URLs for Yandex and Google as separate columns", async () => {
  const file = semanticExportFile(
    keywordWithMetrics(),
    {
      format: "CSV",
      scope: "FULL_CORE",
      locale: "ru",
      columns: [
        "query",
        "targetUrl",
        "yandexRelevantUrl",
        "googleRelevantUrl",
        "yandexAiRelevantUrl",
        "googleAiRelevantUrl"
      ]
    },
    {}
  );

  const csv = new TextDecoder().decode(await collect(file.bytes));
  assert.equal(
    csv,
    "Запрос,Целевой URL,URL из съёма Яндекс,URL из съёма Google,URL ИИ-выдачи Яндекс,URL ИИ-выдачи Google\r\n" +
      "запрос с метриками,https://example.com/catalog,https://example.com/catalog/,https://example.com/other,https://example.com/catalog,https://example.com/ai-other\r\n"
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

test("writes competitor URLs and SERP data into ordinary keyword columns", async () => {
  const input = {
    format: "CSV",
    scope: "CURRENT_FILTER",
    locale: "ru",
    columns: [
      "query",
      "serpCompetitorUrls",
      "serpCompetitorSerp",
      "aiCompetitorUrls",
      "aiCompetitorSerp"
    ],
    includeBom: true
  } as const;
  const csvFile = semanticExportFile(
    keywordWithCompetitors(),
    input,
    {},
    new Date("2026-08-24T10:00:00.000Z")
  );

  assert.equal(csvFile.filename, "semantic-core-2026-08-24.csv");
  const csvBytes = await collect(csvFile.bytes);
  assert.deepEqual(Array.from(csvBytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(csvBytes);
  assert.equal(
    csv,
    "Запрос,Конкуренты,SERP конкурентов,ИИ-конкуренты,SERP ИИ-конкурентов\r\n" +
      "запрос с конкурентами,\"https://competitor.example/one\nhttps://competitor.example/two\",\"https://competitor.example/one\nTitle: Первый заголовок\nDescription: Первое описание\n\nhttps://competitor.example/two\nTitle: Второй заголовок\nDescription: Второе описание\",https://ai.example/source,\"https://ai.example/source\nTitle: ИИ заголовок\nDescription: ИИ описание\"\r\n"
  );

  const xlsxFile = semanticExportFile(
    keywordWithCompetitors(),
    { ...input, format: "XLSX" },
    {}
  );
  const archive = unzipSync(await collect(xlsxFile.bytes));
  const sheet = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
  const styles = new TextDecoder().decode(archive["xl/styles.xml"]);
  assert.match(sheet, /https:\/\/competitor\.example\/one\nhttps:\/\/competitor\.example\/two/u);
  assert.match(sheet, /Title: Первый заголовок\nDescription: Первое описание/u);
  assert.match(styles, /wrapText="1"/u);
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
        searchEngines: ["YANDEX"]
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
  const bytes = await collect(file.bytes);
  const archive = unzipSync(bytes);
  const yandex = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
  const workbook = new TextDecoder().decode(archive["xl/workbook.xml"]);
  assert.match(workbook, /<sheet name="Яндекс"/u);
  assert.doesNotMatch(workbook, /<sheet name="Google"/u);
  assert.match(yandex, /<pane xSplit="1" ySplit="4"/u);
  assert.match(
    yandex,
    /<f>COUNTIFS\(J\$5:INDEX\(J:J,MAX\(5,COUNTA\(\$A:\$A\)\)\),&quot;&gt;=1&quot;,J\$5:INDEX\(J:J,MAX\(5,COUNTA\(\$A:\$A\)\)\),&quot;&lt;=5&quot;\)<\/f>/u
  );
  assert.match(yandex, /<c r="J5" s="7"><v>5<\/v><\/c>/u);
  assert.match(yandex, /<c r="K5" s="7"><v>7<\/v><\/c>/u);
  assert.match(yandex, /<c r="J6" s="8"><v>9<\/v><\/c>/u);
  assert.match(
    yandex,
    /<c r="J7" s="8" t="inlineStr"><is><t xml:space="preserve">—<\/t><\/is><\/c>/u
  );
  assert.match(yandex, /<c r="J8" s="9"\/>/u);
  assert.doesNotMatch(yandex, /<c r="J5"[^>]*t="inlineStr"/u);

  const parsed: (readonly string[])[] = [];
  for await (const row of parseXlsxRows(oneChunk(bytes), BigInt(bytes.byteLength))) parsed.push(row);
  assert.equal(parsed[0]?.[8], "Язык запроса");
  assert.equal(parsed[4]?.[8], "ru");
  const defaults = {
    searchEngine: "YANDEX" as const,
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP" as const
  };
  const issues = new Set<string>();
  assert.deepEqual(
    importedPositionHistory(parsed[0]!, parsed[4]!, defaults, issues).map(({ observedAt, found, position }) => ({ observedAt, found, position })),
    [
      { observedAt: "2026-08-18T12:00:00.000Z", found: true, position: 5 },
      { observedAt: "2026-08-11T12:00:00.000Z", found: true, position: 7 },
      { observedAt: "2026-08-05T12:00:00.000Z", found: false, position: undefined }
    ]
  );
  assert.deepEqual([...issues], []);
  const sparse = importedPositionHistory(parsed[0]!, parsed[7]!, defaults, new Set());
  assert.deepEqual(sparse.map(({ observedAt, position }) => ({ observedAt, position })), [
    { observedAt: "2026-08-11T12:00:00.000Z", position: 2 }
  ]);
});

async function* keywords(
  count: number
): AsyncGenerator<SemanticKeywordListItem> {
  for (let index = 1; index <= count; index += 1) {
    yield keyword(`запрос ${index}`);
  }
}

async function* keywordWithCompetitors(): AsyncGenerator<SemanticExportKeywordRow> {
  yield {
    ...keyword("запрос с конкурентами"),
    exportCompetitors: [
      {
        source: "SERP",
        url: "https://competitor.example/one",
        normalizedUrl: "https://competitor.example/one",
        title: "Первый\nзаголовок",
        description: "Первое   описание"
      },
      {
        source: "SERP",
        url: "https://competitor.example/two",
        normalizedUrl: "https://competitor.example/two",
        title: "Второй заголовок",
        description: "Второе описание"
      },
      {
        source: "AI",
        url: "https://ai.example/source",
        normalizedUrl: "https://ai.example/source",
        title: "ИИ заголовок",
        description: "ИИ описание"
      }
    ]
  };
}

async function* folderKeywordRows(
  groupId: string,
  rootId: string,
  childId: string
): AsyncGenerator<SemanticExportKeywordRow> {
  if (groupId === rootId) {
    yield keyword("=опасный запрос");
  } else if (groupId === childId) {
    yield keyword("дочерний запрос");
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
    targetUrl: "https://example.com/catalog",
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
        rankingUrl: "https://example.com/catalog/",
        observedAt: "2026-08-12T10:00:00.000Z"
      },
      {
        searchEngine: "GOOGLE",
        found: true,
        position: 13,
        rankingUrl: "https://example.com/other",
        observedAt: "2026-08-12T10:00:00.000Z"
      }
    ],
    aiAnswers: [
      {
        searchEngine: "YANDEX",
        answerPresent: true,
        siteFound: true,
        position: 2,
        rankingUrl: "https://example.com/catalog",
        brandFound: true,
        observedAt: "2026-08-12T10:05:00.000Z"
      },
      {
        searchEngine: "GOOGLE",
        answerPresent: true,
        siteFound: true,
        position: 4,
        rankingUrl: "https://example.com/ai-other",
        brandFound: false,
        observedAt: "2026-08-12T10:06:00.000Z"
      }
    ]
  };
}

async function* positionHistoryRows(): AsyncGenerator<SemanticPositionHistoryExportRow> {
  const dimension = {
    key: "YANDEX|RU|213|ru|DESKTOP",
    searchEngine: "YANDEX" as const,
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP" as const
  };
  yield {
    keywordId: "01900000-0000-7000-8000-000000000011",
    text: "позиция выросла",
    keywordLanguage: "ru",
    createdAt: "2026-07-01T10:00:00.000Z",
    dimension,
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
    keywordLanguage: "ru",
    createdAt: "2026-07-01T10:00:00.000Z",
    dimension,
    snapshots: [
      { searchEngine: "YANDEX", observedDate: "2026-08-18", found: true, position: 9 },
      { searchEngine: "YANDEX", observedDate: "2026-08-11", found: true, position: 4 },
      { searchEngine: "YANDEX", observedDate: "2026-08-05", found: true, position: 6 }
    ]
  };
  yield {
    keywordId: "01900000-0000-7000-8000-000000000013",
    text: "позиция потеряна",
    keywordLanguage: "ru",
    createdAt: "2026-07-01T10:00:00.000Z",
    dimension,
    snapshots: [
      { searchEngine: "YANDEX", observedDate: "2026-08-18", found: false },
      { searchEngine: "YANDEX", observedDate: "2026-08-11", found: true, position: 3 }
    ]
  };
  yield {
    keywordId: "01900000-0000-7000-8000-000000000014",
    text: "в этот день не снимали",
    keywordLanguage: "ru",
    createdAt: "2026-07-01T10:00:00.000Z",
    dimension,
    snapshots: [
      { searchEngine: "YANDEX", observedDate: "2026-08-11", found: true, position: 2 }
    ]
  };
}

async function* oneChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
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
    showAiAnswerButton: false,
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

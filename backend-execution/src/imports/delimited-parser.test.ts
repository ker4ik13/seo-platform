import assert from "node:assert/strict";
import test from "node:test";
import {
  detectDelimiter,
  detectTextEncoding,
  importHeaders,
  parseDelimitedText,
  prepareDelimitedText,
  resolveHeaderMode,
  suggestColumnMapping
} from "./delimited-parser.js";

test("parses quoted fields, escaped quotes and newlines across chunks", async () => {
  const rows: readonly string[][] = [];
  const mutable = rows as string[][];
  for await (const row of parseDelimitedText(
    textChunks([
      "Фраза;Группа;Ком",
      "ментарий\r\n\"купить \"\"seo",
      "\"\"\";main;\"две\r\nстроки\"\r\n"
    ]),
    ";"
  )) {
    mutable.push([...row]);
  }

  assert.deepEqual(rows, [
    ["Фраза", "Группа", "Комментарий"],
    ["купить \"seo\"", "main", "две\r\nстроки"]
  ]);
});

test("detects UTF-8 or Windows-1251 without loading the file", async () => {
  const utf8 = Buffer.from("Фраза;Группа\nseo;main", "utf8");
  const prepared = await prepareDelimitedText(byteChunks(utf8), "AUTO");
  assert.equal(prepared.encoding, "UTF_8");
  let decoded = "";
  for await (const chunk of prepared.text) decoded += chunk;
  assert.equal(decoded, "Фраза;Группа\nseo;main");

  assert.equal(
    detectTextEncoding(Buffer.from([0xd4, 0xf0, 0xe0, 0xe7, 0xe0]), "AUTO"),
    "WINDOWS_1251"
  );
});

test("does not misclassify UTF-8 split at the detection boundary", async () => {
  const prefix = Buffer.alloc(64 * 1_024 - 1, 0x61);
  const value = Buffer.concat([prefix, Buffer.from("я", "utf8")]);
  const prepared = await prepareDelimitedText(
    byteChunksAt(value, 64 * 1_024),
    "AUTO"
  );
  assert.equal(prepared.encoding, "UTF_8");
  let decoded = "";
  for await (const chunk of prepared.text) decoded += chunk;
  assert.equal(decoded.at(-1), "я");
});

test("rejects invalid UTF-8 found after the detection sample", async () => {
  const value = Buffer.concat([
    Buffer.alloc(64 * 1_024, 0x61),
    Buffer.from([0xff])
  ]);
  const prepared = await prepareDelimitedText(
    byteChunksAt(value, 64 * 1_024),
    "AUTO"
  );
  await assert.rejects(
    async () => {
      for await (const _chunk of prepared.text) {
        // Consume the decoder stream.
      }
    },
    { code: "INVALID_TEXT_ENCODING" }
  );
});

test("detects a stable delimiter outside quoted values", () => {
  const sample =
    "Фраза;Частотность;Комментарий\nseo;12;\"a,b,c\"\nsite;4;ok\n";
  assert.equal(detectDelimiter(sample, "AUTO", "COMMA"), "SEMICOLON");
  assert.equal(detectDelimiter(sample, "TAB", "COMMA"), "TAB");
});

test("recognizes Key Collector headers and preserves unknown columns", () => {
  const headers = ["Фраза", "Группа", "Частотность", '"Частотность"', '"!Частотность"', "Позиция Яндекс", "Релевантная страница Google", "Комментарий"];
  assert.equal(resolveHeaderMode([headers, ["seo", "main", "20", "15", "10", "4", "https://example.com", "важно"]], "AUTO"), "PRESENT");
  assert.deepEqual(importHeaders(headers, "PRESENT"), headers);
  assert.deepEqual(
    suggestColumnMapping(headers).map(({ suggestedTarget }) => suggestedTarget),
    [
      "keyword.text",
      "group.path",
      "frequency.base",
      "frequency.exact",
      "frequency.fixed",
      "ranking.yandex.position",
      "page.target_url",
      "keyword.note"
    ]
  );
});

test("recognizes Key Collector XLSX headers with bracketed provider suffixes", () => {
  const headers = [
    "Фраза",
    "Позиция [Yandex]",
    "Рел. позиция [Yandex]",
    "URL позиции [Yandex]",
    '" " [YW]',
    "Родительская группа",
    "База [YW]",
    "Релевантный URL [Yandex]"
  ];

  assert.deepEqual(
    suggestColumnMapping(headers).map(({ suggestedTarget }) => suggestedTarget),
    [
      "keyword.text",
      "ranking.yandex.position",
      "ranking.yandex.change",
      "ranking.yandex.url",
      "frequency.exact",
      "group.path",
      "frequency.base",
      "page.target_url"
    ]
  );
});

test("keeps native Key Collector service columns as custom values", () => {
  const headers = [
    "Key Collector · Комментарий группы",
    "Key Collector · CustomMetric · Label",
    "Key Collector · YandexDirect_Forecast · Position"
  ];

  assert.deepEqual(
    suggestColumnMapping(headers).map(({ suggestedTarget }) => suggestedTarget),
    ["custom", "custom", "custom"]
  );
});

async function* textChunks(values: readonly string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

async function* byteChunks(value: Uint8Array): AsyncGenerator<Uint8Array> {
  const middle = Math.ceil(value.byteLength / 2);
  yield value.subarray(0, middle);
  yield value.subarray(middle);
}

async function* byteChunksAt(
  value: Uint8Array,
  offset: number
): AsyncGenerator<Uint8Array> {
  yield value.subarray(0, offset);
  yield value.subarray(offset);
}

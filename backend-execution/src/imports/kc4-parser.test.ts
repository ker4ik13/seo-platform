import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { zipSync } from "fflate";
import {
  KC4_GOOGLE_RELEVANT_PAGES_HEADER,
  KC4_POSITION_CONTEXTS_HEADER,
  KC4_POSITION_HISTORY_HEADER,
  KC4_SERP_RESULTS_HEADER,
  KC4_YANDEX_RELEVANT_PAGES_HEADER,
  parseKc4Rows
} from "./kc4-parser.js";

test("reads native KC4 groups and fields while excluding trash", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kc4-parser-test-"));
  try {
    const databasePath = path.join(directory, "main.tkc4");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE KeywordGroups (
        Id INTEGER PRIMARY KEY,
        ParentId INTEGER,
        Header TEXT NOT NULL,
        OrderNumber INTEGER,
        IsTrashBin INTEGER NOT NULL DEFAULT 0,
        IsRemoved INTEGER NOT NULL DEFAULT 0,
        HeaderBackground TEXT,
        Comment TEXT
      );
      CREATE TABLE KeywordSources (Id INTEGER PRIMARY KEY, SourceName TEXT);
      CREATE TABLE Tasks (TaskName TEXT PRIMARY KEY, StateData TEXT);
      CREATE TABLE Scheduler_Parameters (Id INTEGER PRIMARY KEY, Name TEXT);
      CREATE TABLE Scheduler_LastParametersUpdates (
        KeywordId INTEGER,
        ParameterId INTEGER,
        UpdatedOn TEXT
      );
      CREATE TABLE Keywords (
        Id INTEGER PRIMARY KEY,
        IsChecked INTEGER NOT NULL,
        IsLocked INTEGER NOT NULL,
        KeyText TEXT NOT NULL,
        AddedOn TEXT,
        GroupId INTEGER,
        SourceId INTEGER,
        "Order" INTEGER
      );
      CREATE TABLE Module_YandexWordstat (
        KeywordId INTEGER PRIMARY KEY,
        BaseFrequency INTEGER,
        QuoteFrequency INTEGER,
        QuotePointFrequency INTEGER,
        CustomMaskFrequency INTEGER,
        IsSeason INTEGER,
        MedianFrequency INTEGER,
        AverageFrequency INTEGER
      );
      CREATE TABLE Module_SERP_Position_Yandex (
        KeywordId INTEGER PRIMARY KEY,
        Position INTEGER,
        RelativePositionChange INTEGER,
        URL TEXT
      );
      CREATE TABLE Module_SERP_SearchEngines (
        Id INTEGER PRIMARY KEY,
        SEName TEXT NOT NULL
      );
      CREATE TABLE Module_SERP_Position_History (
        Id INTEGER PRIMARY KEY,
        KeywordId INTEGER NOT NULL,
        SEId INTEGER NOT NULL,
        ScannedOn TEXT,
        Position INTEGER,
        URL TEXT
      );
      CREATE TABLE Module_SERP_Data (
        Id INTEGER PRIMARY KEY,
        KeywordId INTEGER NOT NULL,
        SEId INTEGER NOT NULL,
        URL BLOB,
        Title BLOB,
        Snippet BLOB
      );
      CREATE TABLE Module_SERP_Data_History (
        Id INTEGER PRIMARY KEY,
        KeywordId INTEGER NOT NULL,
        ScannedOn TEXT NOT NULL,
        SEId INTEGER NOT NULL,
        Position INTEGER NOT NULL,
        URLId INTEGER NOT NULL,
        TitleId INTEGER,
        SnippetId INTEGER
      );
      CREATE TABLE Module_SERP_URL (Id INTEGER PRIMARY KEY, URL BLOB NOT NULL);
      CREATE TABLE Module_SERP_Titles (Id INTEGER PRIMARY KEY, Title BLOB NOT NULL);
      CREATE TABLE Module_SERP_Snippets (Id INTEGER PRIMARY KEY, Snippet BLOB NOT NULL);
      CREATE TABLE Module_SERP_RelevantPages (
        Id INTEGER PRIMARY KEY,
        KeywordId INTEGER NOT NULL,
        SEId INTEGER NOT NULL,
        URL TEXT
      );
      CREATE TABLE Module_Comments (
        KeywordId INTEGER PRIMARY KEY,
        Comment1 TEXT,
        Comment2 TEXT
      );
      CREATE TABLE Module_CustomMetric (
        KeywordId INTEGER PRIMARY KEY,
        Score INTEGER,
        Label TEXT,
        Opaque BLOB
      );
      CREATE TABLE KeywordGroupMetaTags (
        Id INTEGER PRIMARY KEY,
        GroupId INTEGER,
        Tag TEXT,
        Exact INTEGER,
        Weight INTEGER
      );
      INSERT INTO KeywordGroups VALUES
        (1, NULL, 'Главная', 0, 0, 0, 'Transparent', NULL),
        (2, 1, 'Под/группа', 0, 0, 0, '#FF6633FF', 'Комментарий'),
        (3, 1, 'Trash bin', 1, 1, 0, NULL, NULL),
        (4, 1, 'Пустая папка', 2, 0, 0, NULL, NULL);
      INSERT INTO KeywordSources VALUES (2, 'ManuallyAdded');
      INSERT INTO Tasks VALUES
        ('SERPPositionParsingTask_Yandex', '<Root><DefaultProjectSettings><LRParameter>0</LRParameter><Platform>Desktop</Platform></DefaultProjectSettings><Items><Item key="1"><LRParameter>213</LRParameter><Platform>Desktop</Platform></Item></Items></Root>'),
        ('SERPPositionParsingTask_Google', '<Root><DefaultProjectSettings><LocationCanonicalName>Moscow,Moscow,Russia</LocationCanonicalName><Platform>Desktop</Platform></DefaultProjectSettings></Root>');
      INSERT INTO Scheduler_Parameters VALUES
        (5, 'Module_SERP_Position_Yandex.Position');
      INSERT INTO Scheduler_LastParametersUpdates VALUES
        (1, 5, '2026-08-01 12:34:56');
      INSERT INTO Keywords VALUES
        (1, 1, 0, 'рабочий запрос', '2026-08-01 12:00:00', 2, 2, 134255631267066588),
        (2, 0, 0, 'удалённый запрос', '2026-08-01 12:01:00', 3, 2, 2);
      INSERT INTO Module_YandexWordstat VALUES (1, 100, 40, 10, NULL, 0, NULL, NULL);
      INSERT INTO Module_SERP_Position_Yandex VALUES
        (1, 25, -2, 'https://example.com/yandex-result');
      INSERT INTO Module_SERP_SearchEngines VALUES
        (1, 'Yandex'),
        (2, 'Google');
      INSERT INTO Module_SERP_Position_History VALUES
        (1, 1, 1, '2026-08-01 12:00:00', 25, 'https://example.com/history'),
        (2, 1, 2, 'invalid-date', 4, 'https://example.com/ignored-history');
      INSERT INTO Module_SERP_URL VALUES (1, 'https://example.com/historical-serp');
      INSERT INTO Module_SERP_Titles VALUES (1, 'Исторический результат');
      INSERT INTO Module_SERP_Snippets VALUES (1, 'Историческое описание');
      INSERT INTO Module_SERP_Data_History VALUES
        (1, 1, '2026-08-01 12:00:00', 1, 1, 1, 1, 1);
      INSERT INTO Module_SERP_RelevantPages VALUES
        (1, 1, 1, 'https://example.com/yandex-relevant'),
        (2, 1, 2, 'https://example.com/google-relevant');
      INSERT INTO Module_Comments VALUES
        (1, 'Заметка к запросу', NULL);
      INSERT INTO Module_CustomMetric VALUES
        (1, 77, 'Свой показатель', X'010203');
      INSERT INTO KeywordGroupMetaTags VALUES
        (1, 2, 'метатег папки', 1, 9);
    `);
    const insertSerp = database.prepare(`
      INSERT INTO Module_SERP_Data
        (Id, KeywordId, SEId, URL, Title, Snippet)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertSerp.run(
      1,
      1,
      1,
      gzipSync("https://example.com/first"),
      gzipSync("Первый результат"),
      gzipSync("Описание первого результата")
    );
    insertSerp.run(
      2,
      1,
      1,
      Buffer.from([0x1f, 0x8b, 0x00]),
      gzipSync("Повреждённая необязательная строка"),
      null
    );
    insertSerp.run(
      3,
      1,
      1,
      gzipSync("https://example.com/third"),
      gzipSync("Третий результат"),
      null
    );
    database.close();
    const archive = zipSync({
      "main.tkc4": new Uint8Array(await readFile(databasePath)),
      UID: new TextEncoder().encode("01900000-0000-7000-8000-000000000001")
    });
    const rows: (readonly string[])[] = [];
    const progressStages: string[] = [];
    let groupPaths: readonly (readonly string[])[] = [];
    let groupMetadata: readonly Readonly<{ path: readonly string[]; color?: string }>[] = [];
    for await (const row of parseKc4Rows(
      chunks(archive),
      BigInt(archive.length),
      (metadata) => {
        groupPaths = metadata.groupPaths;
        groupMetadata = metadata.groups;
      },
      (progress) => {
        progressStages.push(progress.stage);
      }
    )) {
      rows.push(row);
    }

    assert.equal(rows.length, 2);
    assert.deepEqual(progressStages, [
      "downloading_kc4",
      "extracting_kc4",
      "checking_kc4_database",
      "reading_kc4_schema"
    ]);
    const headers = rows[0]!;
    const values = rows[1]!;
    assert.equal(values[headers.indexOf("Фраза")], "рабочий запрос");
    assert.equal(
      values[headers.indexOf("Группа")],
      JSON.stringify(["Главная", "Под/группа"])
    );
    assert.equal(values[headers.indexOf("Частотность")], "100");
    assert.equal(values[headers.indexOf('"Частотность"')], "40");
    assert.equal(values[headers.indexOf('"!Частотность"')], "10");
    assert.equal(values[headers.indexOf("Яндекс · Позиция")], "25");
    assert.equal(
      values[headers.indexOf("Яндекс · Изменение позиции")],
      "-2"
    );
    assert.equal(
      values[headers.indexOf("Яндекс · URL выдачи")],
      "https://example.com/yandex-result"
    );
    assert.equal(
      values[headers.indexOf("Key Collector · Цвет группы")],
      "#6633ff"
    );
    assert.equal(
      values[headers.indexOf("Key Collector · Комментарий 1")],
      "Заметка к запросу"
    );
    assert.equal(
      values[headers.indexOf("Key Collector · CustomMetric · Score")],
      "77"
    );
    assert.equal(
      values[headers.indexOf("Key Collector · CustomMetric · Label")],
      "Свой показатель"
    );
    assert.equal(
      headers.includes("Key Collector · CustomMetric · Opaque"),
      false
    );
    assert.deepEqual(
      JSON.parse(
        values[headers.indexOf("Key Collector · Метатеги группы")] ?? "[]"
      ),
      [{ tag: "метатег папки", exact: true, weight: 9 }]
    );
    assert.deepEqual(
      JSON.parse(values[headers.indexOf(KC4_POSITION_CONTEXTS_HEADER)] ?? "[]"),
      [
        {
          source: "KEY_COLLECTOR",
          searchEngine: "YANDEX",
          countryCode: "RU",
          regionCode: "213",
          regionLabel: "Москва",
          language: "ru",
          device: "DESKTOP",
          observedAt: "2026-08-01T12:00:00.000Z"
        },
        {
          source: "KEY_COLLECTOR",
          searchEngine: "GOOGLE",
          countryCode: "RU",
          regionCode: "1011969",
          regionLabel: "Москва",
          language: "ru",
          device: "DESKTOP"
        }
      ]
    );
    assert.deepEqual(
      JSON.parse(values[headers.indexOf(KC4_POSITION_HISTORY_HEADER)] ?? "[]"),
      [{
        source: "KEY_COLLECTOR",
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP",
        observedAt: "2026-08-01T12:00:00.000Z",
        found: true,
        position: 25,
        rankingUrl: "https://example.com/history",
        serpResults: [{
          position: 1,
          rankingUrl: "https://example.com/historical-serp",
          title: "Исторический результат",
          snippet: "Историческое описание"
        }]
      }]
    );
    assert.deepEqual(
      JSON.parse(values[headers.indexOf(KC4_SERP_RESULTS_HEADER)] ?? "[]"),
      [{
        searchEngine: "YANDEX",
        results: [
          {
            position: 1,
            rankingUrl: "https://example.com/first",
            title: "Первый результат",
            snippet: "Описание первого результата"
          },
          {
            position: 3,
            rankingUrl: "https://example.com/third",
            title: "Третий результат"
          }
        ]
      }]
    );
    assert.deepEqual(
      JSON.parse(values[headers.indexOf(KC4_YANDEX_RELEVANT_PAGES_HEADER)] ?? "[]"),
      ["https://example.com/yandex-relevant"]
    );
    assert.deepEqual(
      JSON.parse(values[headers.indexOf(KC4_GOOGLE_RELEVANT_PAGES_HEADER)] ?? "[]"),
      ["https://example.com/google-relevant"]
    );
    assert.deepEqual(groupPaths, [
      ["Главная"],
      ["Главная", "Под/группа"],
      ["Главная", "Пустая папка"]
    ]);
    assert.deepEqual(groupMetadata, [
      { path: ["Главная"] },
      { path: ["Главная", "Под/группа"], color: "#6633ff" },
      { path: ["Главная", "Пустая папка"] }
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves deeply nested KC4 group paths", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kc4-deep-tree-test-"));
  try {
    const databasePath = path.join(directory, "main.tkc4");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE KeywordGroups (
        Id INTEGER PRIMARY KEY,
        ParentId INTEGER,
        Header TEXT NOT NULL,
        OrderNumber INTEGER
      );
      CREATE TABLE Keywords (
        Id INTEGER PRIMARY KEY,
        IsChecked INTEGER NOT NULL,
        IsLocked INTEGER NOT NULL,
        KeyText TEXT NOT NULL,
        AddedOn TEXT,
        GroupId INTEGER,
        SourceId INTEGER,
        "Order" INTEGER
      );
    `);
    const insertGroup = database.prepare(
      "INSERT INTO KeywordGroups (Id, ParentId, Header, OrderNumber) VALUES (?, ?, ?, ?)"
    );
    const expectedPath: string[] = [];
    for (let id = 1; id <= 20; id += 1) {
      const header = `Уровень ${id}`;
      expectedPath.push(header);
      insertGroup.run(id, id === 1 ? null : id - 1, header, 0);
    }
    database.prepare(`
      INSERT INTO Keywords
        (Id, IsChecked, IsLocked, KeyText, AddedOn, GroupId, SourceId, "Order")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 1, 0, "глубокий запрос", null, 20, null, 0);
    database.close();

    const archive = zipSync({
      "main.tkc4": new Uint8Array(await readFile(databasePath))
    });
    const rows: (readonly string[])[] = [];
    let groupPaths: readonly (readonly string[])[] = [];
    for await (const row of parseKc4Rows(
      chunks(archive),
      BigInt(archive.length),
      (metadata) => {
        groupPaths = metadata.groupPaths;
      }
    )) {
      rows.push(row);
    }

    assert.equal(rows.length, 2);
    assert.deepEqual(groupPaths.at(-1), expectedPath);
    assert.equal(
      rows[1]?.[rows[0]!.indexOf("Группа")],
      expectedPath.join("/")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("decodes Windows-1251 text stored by older KC4 projects", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kc4-parser-cp1251-"));
  try {
    const databasePath = path.join(directory, "main.tkc4");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE KeywordGroups (
        Id INTEGER PRIMARY KEY,
        ParentId INTEGER,
        Header TEXT NOT NULL,
        OrderNumber INTEGER
      );
      CREATE TABLE Keywords (
        Id INTEGER PRIMARY KEY,
        IsChecked INTEGER NOT NULL,
        IsLocked INTEGER NOT NULL,
        KeyText TEXT NOT NULL,
        AddedOn TEXT,
        GroupId INTEGER,
        SourceId INTEGER,
        "Order" INTEGER
      );
    `);
    database.prepare(
      "INSERT INTO KeywordGroups (Id, ParentId, Header, OrderNumber) VALUES (?, ?, ?, ?)"
    ).run(1, null, Buffer.from("cfe0efeae0", "hex"), 0);
    database.prepare(`
      INSERT INTO Keywords
        (Id, IsChecked, IsLocked, KeyText, AddedOn, GroupId, SourceId, "Order")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      1,
      0,
      Buffer.from("e3e5f0e1e8f6e8e420e3f0e5e9e4e5f020eaf3efe8f2fc", "hex"),
      null,
      1,
      null,
      0
    );
    database.close();

    const archive = zipSync({
      "main.tkc4": new Uint8Array(await readFile(databasePath))
    });
    const rows: (readonly string[])[] = [];
    for await (const row of parseKc4Rows(chunks(archive), BigInt(archive.length))) {
      rows.push(row);
    }

    assert.equal(rows[1]?.[0], "гербицид грейдер купить");
    assert.equal(rows[1]?.[1], "Папка");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function* chunks(value: Uint8Array): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < value.length; offset += 97) {
    yield value.subarray(offset, offset + 97);
  }
}

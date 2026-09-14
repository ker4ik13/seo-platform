import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { zipSync } from "fflate";
import { parseKc4Rows } from "./kc4-parser.js";

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
      INSERT INTO KeywordGroups VALUES
        (1, NULL, 'Главная', 0, 0, 0, 'Transparent', NULL),
        (2, 1, 'Подгруппа', 0, 0, 0, '#6633FF', 'Комментарий'),
        (3, 1, 'Trash bin', 1, 1, 0, NULL, NULL),
        (4, 1, 'Пустая папка', 2, 0, 0, NULL, NULL);
      INSERT INTO KeywordSources VALUES (2, 'ManuallyAdded');
      INSERT INTO Keywords VALUES
        (1, 1, 0, 'рабочий запрос', '2026-08-01 12:00:00', 2, 2, 134255631267066588),
        (2, 0, 0, 'удалённый запрос', '2026-08-01 12:01:00', 3, 2, 2);
      INSERT INTO Module_YandexWordstat VALUES (1, 100, 40, 10, NULL, 0, NULL, NULL);
      INSERT INTO Module_SERP_Position_Yandex VALUES
        (1, 25, -2, 'https://example.com/yandex-result');
    `);
    database.close();
    const archive = zipSync({
      "main.tkc4": new Uint8Array(await readFile(databasePath)),
      UID: new TextEncoder().encode("01900000-0000-7000-8000-000000000001")
    });
    const rows: (readonly string[])[] = [];
    let groupPaths: readonly (readonly string[])[] = [];
    let groupMetadata: readonly Readonly<{ path: readonly string[]; color?: string }>[] = [];
    for await (const row of parseKc4Rows(
      chunks(archive),
      BigInt(archive.length),
      (metadata) => {
        groupPaths = metadata.groupPaths;
        groupMetadata = metadata.groups;
      }
    )) {
      rows.push(row);
    }

    assert.equal(rows.length, 2);
    const headers = rows[0]!;
    const values = rows[1]!;
    assert.equal(values[headers.indexOf("Фраза")], "рабочий запрос");
    assert.equal(values[headers.indexOf("Группа")], "Главная/Подгруппа");
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
      "#6633FF"
    );
    assert.deepEqual(groupPaths, [
      ["Главная"],
      ["Главная", "Подгруппа"],
      ["Главная", "Пустая папка"]
    ]);
    assert.deepEqual(groupMetadata, [
      { path: ["Главная"] },
      { path: ["Главная", "Подгруппа"], color: "#6633ff" },
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

async function* chunks(value: Uint8Array): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < value.length; offset += 97) {
    yield value.subarray(offset, offset + 97);
  }
}

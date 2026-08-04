import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DatabaseSync,
  type SQLOutputValue
} from "node:sqlite";
import {
  Open,
  type CentralDirectory,
  type File as ZipEntry
} from "unzipper-esm";
import { semanticImportMaxGroupDepth } from "@seo-platform/contracts";
import { DelimitedParseError } from "./delimited-parser.js";

export const MAX_KC4_BYTES = 1 * 1_024 * 1_024 * 1_024;

const MAX_ARCHIVE_ENTRIES = 32;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 4 * 1_024 * 1_024 * 1_024;
const MAX_COMPRESSION_RATIO = 500;
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const REQUIRED_KEYWORD_COLUMNS = new Set([
  "Id",
  "IsChecked",
  "IsLocked",
  "KeyText",
  "AddedOn",
  "GroupId",
  "SourceId",
  "Order"
]);
const REQUIRED_GROUP_COLUMNS = new Set([
  "Id",
  "ParentId",
  "Header",
  "OrderNumber"
]);

interface Kc4Group {
  readonly id: number;
  readonly parentId?: number;
  readonly header: string;
  readonly order: number;
  readonly trash: boolean;
  readonly removed: boolean;
  readonly color?: string;
  readonly comment?: string;
}

export interface Kc4ParseMetadata {
  readonly groupPaths: readonly (readonly string[])[];
}

interface ScalarColumn {
  readonly table: string;
  readonly field: string;
  readonly header: string;
}

interface SelectedColumn extends ScalarColumn {
  readonly alias: string;
}

const SCALAR_COLUMNS: readonly ScalarColumn[] = [
  { table: "Module_YandexWordstat", field: "BaseFrequency", header: "Частотность" },
  { table: "Module_YandexWordstat", field: "QuoteFrequency", header: '"Частотность"' },
  { table: "Module_YandexWordstat", field: "QuotePointFrequency", header: '"!Частотность"' },
  { table: "Module_YandexWordstat", field: "CustomMaskFrequency", header: "Key Collector · Wordstat · Пользовательская маска" },
  { table: "Module_YandexWordstat", field: "IsSeason", header: "Key Collector · Wordstat · Сезонность" },
  { table: "Module_YandexWordstat", field: "MedianFrequency", header: "Key Collector · Wordstat · Медиана" },
  { table: "Module_YandexWordstat", field: "AverageFrequency", header: "Key Collector · Wordstat · Среднее" },
  { table: "Module_SERP_Position_Yandex", field: "Position", header: "Яндекс · Позиция" },
  { table: "Module_SERP_Position_Yandex", field: "RelativePositionChange", header: "Яндекс · Изменение позиции" },
  { table: "Module_SERP_Position_Yandex", field: "URL", header: "Яндекс · URL выдачи" },
  { table: "Module_SERP_Position_Google", field: "Position", header: "Google · Позиция" },
  { table: "Module_SERP_Position_Google", field: "RelativePositionChange", header: "Google · Изменение позиции" },
  { table: "Module_SERP_Position_Google", field: "URL", header: "Google · URL выдачи" },
  { table: "Module_SERP_RelevantPages_Yandex", field: "URL", header: "Яндекс · Релевантная страница KC" },
  { table: "Module_SERP_RelevantPages_Google", field: "URL", header: "Google · Релевантная страница KC" },
  { table: "Module_Comments", field: "Comment1", header: "Key Collector · Комментарий 1" },
  { table: "Module_Comments", field: "Comment2", header: "Key Collector · Комментарий 2" },
  { table: "Module_KEI_1", field: "Value", header: "KEI 1" },
  { table: "Module_KEI_2", field: "Value", header: "KEI 2" },
  { table: "Module_KEI_3", field: "Value", header: "KEI 3" },
  { table: "Module_KEI_4", field: "Value", header: "KEI 4" },
  ...moduleColumns("Module_GoogleAds", ["SearchVolumeMin", "SearchVolumeMax", "SearchVolumeAvg", "Competition", "CPCMin", "CPCMax", "CPCAvg", "Clicks", "Cost", "CTR"]),
  ...moduleColumns("Module_GoogleAnalytics", ["Traffic", "Refuses", "PageUrl"]),
  ...moduleColumns("Module_GoogleSearchConsole", ["Clicks", "Impressions", "CTR", "Position", "PageUrl"]),
  ...moduleColumns("Module_KeysSo", ["WS", "WSK", "Docs", "Pr0amn", "Pr0ctr", "KEI", "Position", "URL", "Cnt"]),
  ...moduleColumns("Module_LiveInternet", ["Traffic"]),
  ...moduleColumns("Module_Mutagen", ["Competition", "Volume"]),
  ...moduleColumns("Module_PixelTools", ["Overall", "Exact", "FoundDocs", "Geo", "Reoptimization"]),
  ...moduleColumns("Module_Rookee", ["Budget", "Traffic", "CPC", "Geo", "Commerce", "BestKeyword"]),
  ...moduleColumns("Module_SERPStat", ["Cost", "Concurrency", "Difficulty", "FoundResults", "RegionQueriesCount", "WideQueriesCount", "RightSpelling"]),
  ...moduleColumns("Module_SERP_Geo_Google", ["GeoCoeff"]),
  ...moduleColumns("Module_SERP_Geo_Yandex", ["GeoCoeff"]),
  ...moduleColumns("Module_SERP_Google", ["DocsCount", "MainPagesCount", "TitlesWithKeywordFoundCount"]),
  ...moduleColumns("Module_SERP_Yandex", ["DocsCount", "MainPagesCount", "TitlesWithKeywordFoundCount"]),
  ...moduleColumns("Module_SpyWords", ["Volume", "AdvTot", "AvgCPC", "Pos", "RealURL", "Snippet"]),
  ...moduleColumns("Module_YandexAds", ["AdsCount"]),
  ...moduleColumns("Module_YandexMetrika", ["Traffic", "Refuses"]),
  ...moduleColumns("Module_YandexWebmaster", ["TotalShows", "TotalClicks", "AvgShowPosition", "AvgClickPosition"])
];

/**
 * Reads a native Key Collector project without executing project SQL or
 * extracting arbitrary archive paths. Deleted/trash rows are intentionally
 * excluded; active group paths and populated scalar keyword fields are emitted
 * through the same staging/mapping pipeline as CSV and XLSX.
 */
export async function* parseKc4Rows(
  source: AsyncIterable<Uint8Array>,
  declaredSizeBytes: bigint,
  onMetadata?: (metadata: Kc4ParseMetadata) => void
): AsyncGenerator<readonly string[]> {
  if (declaredSizeBytes < 1n || declaredSizeBytes > BigInt(MAX_KC4_BYTES)) {
    throw new DelimitedParseError("KC4_TOO_LARGE");
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "seo-platform-kc4-")
  );
  const archivePath = path.join(temporaryDirectory, "project.kc4");
  const databasePath = path.join(temporaryDirectory, "main.tkc4");
  try {
    await pipeline(
      Readable.from(boundedSource(source)),
      createWriteStream(archivePath, { flags: "wx", mode: 0o600 })
    );
    const archive = await Open.file(archivePath);
    const mainEntry = safeMainEntry(archive, declaredSizeBytes);
    await pipeline(
      mainEntry.stream(),
      createWriteStream(databasePath, { flags: "wx", mode: 0o600 })
    );
    const extracted = await stat(databasePath);
    if (extracted.size !== mainEntry.uncompressedSize) invalidKc4();
    await assertSqliteHeader(databasePath);
    yield* readKc4Database(databasePath, onMetadata);
  } catch (error) {
    if (error instanceof DelimitedParseError) throw error;
    throw new DelimitedParseError("INVALID_KC4");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function* boundedSource(
  source: AsyncIterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.byteLength;
    if (bytes > MAX_KC4_BYTES) {
      throw new DelimitedParseError("KC4_TOO_LARGE");
    }
    yield chunk;
  }
}

function safeMainEntry(
  archive: CentralDirectory,
  compressedSizeBytes: bigint
): ZipEntry {
  if (
    archive.files.length < 1 ||
    archive.files.length > MAX_ARCHIVE_ENTRIES
  ) {
    invalidKc4();
  }
  let uncompressedBytes = 0;
  for (const entry of archive.files) {
    if (
      (entry.flags & 1) !== 0 ||
      entry.type !== "File" ||
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0 ||
      entry.path.includes("\\") ||
      path.posix.normalize(entry.path) !== entry.path ||
      entry.path.startsWith("/") ||
      entry.path.split("/").includes("..")
    ) {
      invalidKc4();
    }
    uncompressedBytes += entry.uncompressedSize;
    if (uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new DelimitedParseError("KC4_ARCHIVE_TOO_LARGE");
    }
  }
  const compressed = Number(compressedSizeBytes);
  if (
    compressed > 0 &&
    uncompressedBytes / compressed > MAX_COMPRESSION_RATIO
  ) {
    throw new DelimitedParseError("KC4_ARCHIVE_TOO_LARGE");
  }
  const matches = archive.files.filter(({ path }) => path === "main.tkc4");
  if (matches.length !== 1 || matches[0]!.uncompressedSize < SQLITE_HEADER.length) {
    invalidKc4();
  }
  return matches[0]!;
}

async function assertSqliteHeader(databasePath: string): Promise<void> {
  const handle = await open(databasePath, "r");
  try {
    const value = Buffer.alloc(SQLITE_HEADER.length);
    const result = await handle.read(value, 0, value.length, 0);
    if (result.bytesRead !== value.length || !value.equals(SQLITE_HEADER)) {
      invalidKc4();
    }
  } finally {
    await handle.close();
  }
}

export function* readKc4Database(
  databasePath: string,
  onMetadata?: (metadata: Kc4ParseMetadata) => void
): Generator<readonly string[]> {
  const database = new DatabaseSync(databasePath, {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: false,
    readBigInts: true,
    timeout: 5_000
  });
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;");
    const integrity = database.prepare("PRAGMA quick_check(1)").get();
    if (!integrity || Object.values(integrity)[0] !== "ok") invalidKc4();
    const tables = databaseTables(database);
    if (!tables.has("Keywords") || !tables.has("KeywordGroups")) invalidKc4();
    assertColumns(database, "Keywords", REQUIRED_KEYWORD_COLUMNS);
    assertColumns(database, "KeywordGroups", REQUIRED_GROUP_COLUMNS);

    const groups = readGroups(database);
    const activeGroups = orderedActiveGroups(groups);
    const groupPaths = groupPathMap(activeGroups, groups);
    onMetadata?.({
      groupPaths: activeGroups.map((group) => {
        const value = groupPaths.get(group.id);
        if (!value) invalidKc4();
        return value;
      })
    });
    const selectedColumns = populatedScalarColumns(database, tables);
    const includeGroupColor = activeGroups.some(
      ({ color }) => color && color.toLowerCase() !== "transparent"
    );
    const includeGroupComment = activeGroups.some(({ comment }) => comment);
    const headers = [
      "Фраза",
      "Группа",
      "Key Collector · Добавлено",
      "Key Collector · Источник",
      "Key Collector · Проверен",
      "Key Collector · Заблокирован",
      "Key Collector · Порядок",
      ...(includeGroupColor ? ["Key Collector · Цвет группы"] : []),
      ...(includeGroupComment ? ["Key Collector · Комментарий группы"] : []),
      ...selectedColumns.map(({ header }) => header)
    ];
    yield headers;

    const joins = unique(selectedColumns.map(({ table }) => table)).map(
      (table, index) =>
        `LEFT JOIN ${identifier(table)} AS m${index} ON m${index}.KeywordId = k.Id`
    );
    const tableAlias = new Map(
      unique(selectedColumns.map(({ table }) => table)).map((table, index) => [table, `m${index}`])
    );
    const selectValues = selectedColumns.map(
      ({ table, field, alias }) => `${tableAlias.get(table)}.${identifier(field)} AS ${identifier(alias)}`
    );
    const sourceJoin =
      tables.has("KeywordSources") &&
      hasColumns(database, "KeywordSources", new Set(["Id", "SourceName"]))
        ? "LEFT JOIN KeywordSources AS s ON s.Id = k.SourceId"
        : "";
    const sourceValue = sourceJoin ? "s.SourceName" : "k.SourceId";
    const statement = database.prepare(`
      SELECT
        k.KeyText AS keyText,
        k.AddedOn AS addedOn,
        ${sourceValue} AS sourceName,
        k.IsChecked AS isChecked,
        k.IsLocked AS isLocked,
        k."Order" AS keyOrder
        ${selectValues.length > 0 ? `, ${selectValues.join(", ")}` : ""}
      FROM Keywords AS k
      ${sourceJoin}
      ${joins.join("\n")}
      WHERE k.GroupId = ?
      ORDER BY k."Order" ASC, k.Id ASC
    `);
    for (const group of activeGroups) {
      const groupPath = groupPaths.get(group.id);
      if (!groupPath) invalidKc4();
      for (const row of statement.iterate(group.id)) {
        const keyText = cell(row.keyText).normalize("NFC").trim();
        if (!keyText) continue;
        yield [
          keyText,
          groupPath.join("/"),
          cell(row.addedOn),
          cell(row.sourceName),
          booleanCell(row.isChecked),
          booleanCell(row.isLocked),
          cell(row.keyOrder),
          ...(includeGroupColor ? [group.color ?? ""] : []),
          ...(includeGroupComment ? [group.comment ?? ""] : []),
          ...selectedColumns.map(({ alias }) => cell(row[alias]))
        ];
      }
    }
  } finally {
    database.close();
  }
}

function readGroups(database: DatabaseSync): readonly Kc4Group[] {
  const columns = tableColumns(database, "KeywordGroups");
  const optional = (name: string, fallback: string): string =>
    columns.has(name) ? identifier(name) : fallback;
  return database
    .prepare(`
      SELECT
        Id AS id,
        ParentId AS parentId,
        Header AS header,
        COALESCE(OrderNumber, 0) AS orderNumber,
        ${optional("IsTrashBin", "0")} AS isTrashBin,
        ${optional("IsRemoved", "0")} AS isRemoved,
        ${optional("HeaderBackground", "NULL")} AS color,
        ${optional("Comment", "NULL")} AS comment
      FROM KeywordGroups
    `)
    .all()
    .map((row) => {
      const id = integer(row.id);
      const parentId = nullableInteger(row.parentId);
      const header = cell(row.header).normalize("NFC").trim();
      if (!header || header.includes("/")) invalidKc4();
      return {
        id,
        ...(parentId === undefined ? {} : { parentId }),
        header,
        order: integer(row.orderNumber),
        trash:
          truthy(row.isTrashBin) ||
          (parentId === undefined && isTrashHeader(header)),
        removed: truthy(row.isRemoved),
        ...(nonEmpty(row.color) ? { color: cell(row.color) } : {}),
        ...(nonEmpty(row.comment) ? { comment: cell(row.comment) } : {})
      };
    });
}

function orderedActiveGroups(
  groups: readonly Kc4Group[]
): readonly Kc4Group[] {
  if (new Set(groups.map(({ id }) => id)).size !== groups.length) invalidKc4();
  const byId = new Map(groups.map((group) => [group.id, group]));
  const excluded = new Set(
    groups.filter(({ trash, removed }) => trash || removed).map(({ id }) => id)
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (
        !excluded.has(group.id) &&
        group.parentId !== undefined &&
        excluded.has(group.parentId)
      ) {
        excluded.add(group.id);
        changed = true;
      }
    }
  }
  const children = new Map<number | undefined, Kc4Group[]>();
  for (const group of groups) {
    if (excluded.has(group.id)) continue;
    if (group.parentId !== undefined && !byId.has(group.parentId)) invalidKc4();
    const values = children.get(group.parentId) ?? [];
    values.push(group);
    children.set(group.parentId, values);
  }
  for (const values of children.values()) {
    values.sort((left, right) => left.order - right.order || left.id - right.id);
  }
  const result: Kc4Group[] = [];
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (group: Kc4Group, depth: number): void => {
    if (depth > semanticImportMaxGroupDepth || visiting.has(group.id)) {
      invalidKc4();
    }
    if (visited.has(group.id)) return;
    visiting.add(group.id);
    visited.add(group.id);
    result.push(group);
    for (const child of children.get(group.id) ?? []) visit(child, depth + 1);
    visiting.delete(group.id);
  };
  for (const root of children.get(undefined) ?? []) visit(root, 1);
  if (result.length !== groups.length - excluded.size) invalidKc4();
  return result;
}

function groupPathMap(
  activeGroups: readonly Kc4Group[],
  allGroups: readonly Kc4Group[]
): ReadonlyMap<number, readonly string[]> {
  const byId = new Map(allGroups.map((group) => [group.id, group]));
  const activeIds = new Set(activeGroups.map(({ id }) => id));
  const result = new Map<number, readonly string[]>();
  for (const group of activeGroups) {
    const path: string[] = [];
    let current: Kc4Group | undefined = group;
    const seen = new Set<number>();
    while (current) {
      if (
        seen.has(current.id) ||
        path.length >= semanticImportMaxGroupDepth
      ) {
        invalidKc4();
      }
      seen.add(current.id);
      path.unshift(current.header);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    if (!path.length || !activeIds.has(group.id)) invalidKc4();
    result.set(group.id, path);
  }
  return result;
}

function populatedScalarColumns(
  database: DatabaseSync,
  tables: ReadonlySet<string>
): readonly SelectedColumn[] {
  const nonEmpty = new Map<string, boolean>();
  return SCALAR_COLUMNS.flatMap((column, index) => {
    if (!tables.has(column.table)) return [];
    if (!hasColumns(database, column.table, new Set(["KeywordId", column.field]))) return [];
    let populated = nonEmpty.get(column.table);
    if (populated === undefined) {
      const row = database.prepare(
        `SELECT EXISTS(SELECT 1 FROM ${identifier(column.table)} LIMIT 1) AS present`
      ).get();
      populated = truthy(row?.present);
      nonEmpty.set(column.table, populated);
    }
    return populated ? [{ ...column, alias: `value${index}` }] : [];
  });
}

function databaseTables(database: DatabaseSync): ReadonlySet<string> {
  return new Set(
    database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all()
      .map((row) => cell(row.name))
  );
}

function assertColumns(
  database: DatabaseSync,
  table: string,
  required: ReadonlySet<string>
): void {
  if (!hasColumns(database, table, required)) invalidKc4();
}

function hasColumns(
  database: DatabaseSync,
  table: string,
  required: ReadonlySet<string>
): boolean {
  const columns = tableColumns(database, table);
  return [...required].every((column) => columns.has(column));
}

function tableColumns(database: DatabaseSync, table: string): ReadonlySet<string> {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${identifier(table)})`)
      .all()
      .map((row) => cell(row.name))
  );
}

function moduleColumns(
  table: string,
  fields: readonly string[]
): readonly ScalarColumn[] {
  const shortName = table.replace(/^Module_/u, "");
  return fields.map((field) => ({
    table,
    field,
    header: `Key Collector · ${shortName} · ${field}`
  }));
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function isTrashHeader(value: string): boolean {
  return ["корзина", "trash", "trash bin"].includes(value.toLowerCase());
}

function cell(value: SQLOutputValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

function nonEmpty(value: SQLOutputValue | undefined): boolean {
  return cell(value).trim() !== "";
}

function integer(value: SQLOutputValue | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) invalidKc4();
  return parsed;
}

function nullableInteger(value: SQLOutputValue | undefined): number | undefined {
  return value === null || value === undefined ? undefined : integer(value);
}

function truthy(value: unknown): boolean {
  return value === 1 || value === 1n || value === true || value === "1";
}

function booleanCell(value: SQLOutputValue | undefined): string {
  return truthy(value) ? "Да" : "Нет";
}

function invalidKc4(): never {
  throw new DelimitedParseError("INVALID_KC4");
}

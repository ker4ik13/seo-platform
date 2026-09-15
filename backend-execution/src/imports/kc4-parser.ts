import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import {
  DatabaseSync,
  type SQLOutputValue
} from "node:sqlite";
import {
  Open,
  type CentralDirectory,
  type File as ZipEntry
} from "unzipper-esm";
import {
  semanticImportMaxGroupDepth,
  semanticImportMaxGroupManifestEntries,
  type SemanticImportRankHistoryValue,
  type SemanticImportSerpResultValue
} from "@seo-platform/contracts";
import { resolveSeoRegionLabel } from "@seo-platform/contracts/seo-regions";
import { DelimitedParseError } from "./delimited-parser.js";
import { kc4GoogleRussiaCanonicalRegions } from "./kc4-google-regions.generated.js";

export const MAX_KC4_BYTES = 1 * 1_024 * 1_024 * 1_024;

const MAX_ARCHIVE_ENTRIES = 32;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 4 * 1_024 * 1_024 * 1_024;
const MAX_COMPRESSION_RATIO = 500;
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const MAX_KC4_DECOMPRESSED_TEXT_BYTES = 1_000_000;
const MAX_KC4_SERP_RESULTS = 100;
const MAX_KC4_GROUP_META_TAGS = 200_000;
export const KC4_POSITION_HISTORY_HEADER = "Key Collector · История позиций (авто)";
export const KC4_SERP_RESULTS_HEADER = "Key Collector · SERP (авто)";
export const KC4_POSITION_CONTEXTS_HEADER = "Key Collector · Контексты позиций (авто)";
export const KC4_YANDEX_RELEVANT_PAGES_HEADER = "Key Collector · Яндекс · Релевантные страницы";
export const KC4_GOOGLE_RELEVANT_PAGES_HEADER = "Key Collector · Google · Релевантные страницы";
export const KC4_NATIVE_INTERNAL_HEADERS = new Set([
  KC4_POSITION_HISTORY_HEADER,
  KC4_SERP_RESULTS_HEADER,
  KC4_POSITION_CONTEXTS_HEADER
]);
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
  readonly hidden: boolean;
  readonly inheritMetaTags: boolean;
}

interface Kc4GroupMetaTag {
  readonly tag: string;
  readonly exact: boolean;
  readonly weight?: number;
}

export interface Kc4ParseMetadata {
  readonly groupPaths: readonly (readonly string[])[];
  readonly groups: readonly Readonly<{
    path: readonly string[];
    color?: string;
  }>[];
}

export interface Kc4ParseProgress {
  readonly stage:
    | "downloading_kc4"
    | "extracting_kc4"
    | "checking_kc4_database"
    | "reading_kc4_schema";
  readonly compressedBytes?: bigint;
}

interface ScalarColumn {
  readonly table: string;
  readonly field: string;
  readonly header: string;
}

interface SelectedColumn extends ScalarColumn {
  readonly alias: string;
}

interface Kc4HistoryPoint extends SemanticImportRankHistoryValue {}

interface Kc4RankContext {
  readonly source: "KEY_COLLECTOR";
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly countryCode: "RU";
  readonly regionCode: string;
  readonly regionLabel: string;
  readonly language: "ru";
  readonly device: "DESKTOP" | "MOBILE";
}

interface Kc4RankContextSettings {
  readonly defaults: ReadonlyMap<"YANDEX" | "GOOGLE", Kc4RankContext>;
  readonly byGroup: ReadonlyMap<string, Kc4RankContext>;
  readonly parents: ReadonlyMap<number, number | undefined>;
}

interface Kc4PositionUpdate {
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly observedAt: string;
}

interface Kc4SerpSnapshot {
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly results: readonly SemanticImportSerpResultValue[];
}

interface Kc4HistoricalSerpSnapshot extends Kc4RankContext {
  readonly observedAt: string;
  readonly results: readonly SemanticImportSerpResultValue[];
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
  onMetadata?: (metadata: Kc4ParseMetadata) => void,
  onProgress?: (progress: Kc4ParseProgress) => void | Promise<void>
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
    await onProgress?.({ stage: "downloading_kc4", compressedBytes: 0n });
    await pipeline(
      Readable.from(boundedSource(source, onProgress)),
      createWriteStream(archivePath, { flags: "wx", mode: 0o600 })
    );
    await onProgress?.({
      stage: "extracting_kc4",
      compressedBytes: declaredSizeBytes
    });
    const archive = await Open.file(archivePath);
    const mainEntry = safeMainEntry(archive, declaredSizeBytes);
    await pipeline(
      mainEntry.stream(),
      createWriteStream(databasePath, { flags: "wx", mode: 0o600 })
    );
    const extracted = await stat(databasePath);
    if (extracted.size !== mainEntry.uncompressedSize) invalidKc4();
    await assertSqliteHeader(databasePath);
    await onProgress?.({
      stage: "checking_kc4_database",
      compressedBytes: declaredSizeBytes
    });
    yield* readKc4Database(databasePath, onMetadata, onProgress);
  } catch (error) {
    if (error instanceof DelimitedParseError) throw error;
    throw new DelimitedParseError("INVALID_KC4");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function* boundedSource(
  source: AsyncIterable<Uint8Array>,
  onProgress?: (progress: Kc4ParseProgress) => void | Promise<void>
): AsyncGenerator<Uint8Array> {
  let bytes = 0;
  let lastReportedBytes = 0;
  for await (const chunk of source) {
    bytes += chunk.byteLength;
    if (bytes > MAX_KC4_BYTES) {
      throw new DelimitedParseError("KC4_TOO_LARGE");
    }
    if (bytes - lastReportedBytes >= 16 * 1_024 * 1_024) {
      await onProgress?.({
        stage: "downloading_kc4",
        compressedBytes: BigInt(bytes)
      });
      lastReportedBytes = bytes;
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

export async function* readKc4Database(
  databasePath: string,
  onMetadata?: (metadata: Kc4ParseMetadata) => void,
  onProgress?: (progress: Kc4ParseProgress) => void | Promise<void>
): AsyncGenerator<readonly string[]> {
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
    await onProgress?.({ stage: "reading_kc4_schema" });
    const tables = databaseTables(database);
    if (!tables.has("Keywords") || !tables.has("KeywordGroups")) invalidKc4();
    assertColumns(database, "Keywords", REQUIRED_KEYWORD_COLUMNS);
    assertColumns(database, "KeywordGroups", REQUIRED_GROUP_COLUMNS);

    const groups = readGroups(database);
    const activeGroups = orderedActiveGroups(groups);
    if (activeGroups.length > semanticImportMaxGroupManifestEntries) {
      throw new DelimitedParseError("KC4_TOO_MANY_GROUPS");
    }
    const groupPaths = groupPathMap(activeGroups, groups);
    const metadataGroups = activeGroups.map((group) => {
      const value = groupPaths.get(group.id);
      if (!value) invalidKc4();
      const color = kc4GroupColor(group.color);
      return {
        path: value,
        ...(color ? { color } : {})
      };
    });
    onMetadata?.({
      groupPaths: metadataGroups.map(({ path }) => path),
      groups: metadataGroups
    });
    const selectedColumns = populatedScalarColumns(database, tables);
    const groupMetaTags = readGroupMetaTags(database, tables);
    const rankContexts = readKc4RankContexts(database, tables, groups);
    const positionUpdates = kc4PositionUpdates(database, tables);
    const historyRows = kc4HistoryRows(database, tables, rankContexts);
    const historicalSerpRows = kc4HistoricalSerpRows(
      database,
      tables,
      rankContexts
    );
    const serpRows = kc4SerpRows(database, tables);
    const relevantPageRows = kc4RelevantPageRows(database, tables);
    const includeGroupColor = activeGroups.some(
      ({ color }) => color && color.toLowerCase() !== "transparent"
    );
    const includeGroupComment = activeGroups.some(({ comment }) => comment);
    const includeGroupHidden = activeGroups.some(({ hidden }) => hidden);
    const includeGroupMetaTags = groupMetaTags.size > 0;
    const includeGroupMetaTagInheritance = activeGroups.some(
      ({ inheritMetaTags }) => inheritMetaTags
    );
    const includePositionContexts =
      rankContexts.defaults.size > 0 || rankContexts.byGroup.size > 0;
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
      ...(includeGroupHidden ? ["Key Collector · Скрытая группа"] : []),
      ...(includeGroupMetaTagInheritance
        ? ["Key Collector · Наследование метатегов группы"]
        : []),
      ...(includeGroupMetaTags ? ["Key Collector · Метатеги группы"] : []),
      ...selectedColumns.map(({ header }) => header),
      ...(includePositionContexts ? [KC4_POSITION_CONTEXTS_HEADER] : []),
      ...(historyRows || historicalSerpRows ? [KC4_POSITION_HISTORY_HEADER] : []),
      ...(serpRows ? [KC4_SERP_RESULTS_HEADER] : []),
      ...(relevantPageRows
        ? [KC4_YANDEX_RELEVANT_PAGES_HEADER, KC4_GOOGLE_RELEVANT_PAGES_HEADER]
        : [])
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
      ({ table, field, alias }) =>
        `CAST(${tableAlias.get(table)}.${identifier(field)} AS BLOB) AS ${identifier(alias)}`
    );
    const sourceJoin =
      tables.has("KeywordSources") &&
      hasColumns(database, "KeywordSources", new Set(["Id", "SourceName"]))
        ? "LEFT JOIN KeywordSources AS s ON s.Id = k.SourceId"
        : "";
    const sourceValue = sourceJoin
      ? "CAST(s.SourceName AS BLOB)"
      : "CAST(k.SourceId AS BLOB)";
    const statement = database.prepare(`
      SELECT
        k.Id AS keywordId,
        k.GroupId AS groupId,
        CAST(k.KeyText AS BLOB) AS keyText,
        CAST(k.AddedOn AS BLOB) AS addedOn,
        ${sourceValue} AS sourceName,
        k.IsChecked AS isChecked,
        k.IsLocked AS isLocked,
        k."Order" AS keyOrder
        ${selectValues.length > 0 ? `, ${selectValues.join(", ")}` : ""}
      FROM Keywords AS k
      ${sourceJoin}
      ${joins.join("\n")}
      ORDER BY k.Id ASC
    `);
    const activeGroupById = new Map(activeGroups.map((group) => [group.id, group]));
    for (const row of statement.iterate()) {
      const keywordId = integer(row.keywordId);
      const history = mergeKc4HistoricalSerp(
        historyRows?.take(keywordId) ?? [],
        historicalSerpRows?.take(keywordId) ?? []
      );
      const updates = positionUpdates?.take(keywordId) ?? [];
      const serp = serpRows?.take(keywordId) ?? [];
      const relevantPages = relevantPageRows?.take(keywordId) ?? [];
      const group = activeGroupById.get(integer(row.groupId));
      if (!group) continue;
      const groupPath = groupPaths.get(group.id);
      if (!groupPath) invalidKc4();
      const keyText = decodeKc4Text(row.keyText, 2_000)?.trim() ?? "";
      const relevantByEngine = kc4RelevantPagesByEngine(relevantPages);
      const positionContexts = kc4PositionContextsForGroup(
        rankContexts,
        group.id,
        updates,
        history
      );
      yield [
        keyText,
        kc4GroupPathCell(groupPath),
        cell(row.addedOn),
        cell(row.sourceName),
        booleanCell(row.isChecked),
        booleanCell(row.isLocked),
        cell(row.keyOrder),
        ...(includeGroupColor ? [kc4GroupColor(group.color) ?? ""] : []),
        ...(includeGroupComment ? [group.comment ?? ""] : []),
        ...(includeGroupHidden ? [booleanText(group.hidden)] : []),
        ...(includeGroupMetaTagInheritance
          ? [booleanText(group.inheritMetaTags)]
          : []),
        ...(includeGroupMetaTags
          ? [
              groupMetaTags.has(group.id)
                ? JSON.stringify(groupMetaTags.get(group.id))
                : ""
            ]
          : []),
        ...selectedColumns.map(({ alias }) => cell(row[alias])),
        ...(includePositionContexts
          ? [positionContexts.length > 0 ? JSON.stringify(positionContexts) : ""]
          : []),
        ...(historyRows || historicalSerpRows
          ? [history.length > 0 ? JSON.stringify(history) : ""]
          : []),
        ...(serpRows ? [serp.length > 0 ? JSON.stringify(serp) : ""] : []),
        ...(relevantPageRows
          ? [
              relevantByEngine.YANDEX.length > 0
                ? JSON.stringify(relevantByEngine.YANDEX)
                : "",
              relevantByEngine.GOOGLE.length > 0
                ? JSON.stringify(relevantByEngine.GOOGLE)
                : ""
            ]
          : [])
      ];
    }
  } finally {
    database.close();
  }
}

interface Kc4GroupedRows<Value> {
  take(keywordId: number): readonly Value[];
}

interface Kc4RelevantPage {
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly url: string;
}

function groupedKc4Rows<Value>(
  values: Iterable<Record<string, SQLOutputValue>>,
  project: (row: Readonly<Record<string, SQLOutputValue>>) => Value | undefined
): Kc4GroupedRows<Value> {
  const iterator = values[Symbol.iterator]();
  let cursor = iterator.next();
  return {
    take(keywordId) {
      const result: Value[] = [];
      while (!cursor.done) {
        const rowKeywordId = safeInteger(cursor.value.keywordId);
        if (rowKeywordId === undefined || rowKeywordId < keywordId) {
          cursor = iterator.next();
          continue;
        }
        if (rowKeywordId > keywordId) break;
        const value = project(cursor.value);
        if (value !== undefined) result.push(value);
        cursor = iterator.next();
      }
      return result;
    }
  };
}

function kc4HistoryRows(
  database: DatabaseSync,
  tables: ReadonlySet<string>,
  contexts: Kc4RankContextSettings
): Kc4GroupedRows<Kc4HistoryPoint> | undefined {
  const table = "Module_SERP_Position_History";
  if (
    !tables.has(table) ||
    !hasColumns(database, table, new Set([
      "Id", "KeywordId", "SEId", "ScannedOn", "Position", "URL"
    ])) ||
    !tableHasRows(database, table)
  ) return undefined;
  const engines = kc4SearchEngines(database, tables);
  return groupedKc4Rows(
    database.prepare(`
      SELECT KeywordId AS keywordId, SEId AS seId, ScannedOn AS scannedOn,
        Position AS position, URL AS rankingUrl, keyword.GroupId AS groupId
      FROM Module_SERP_Position_History AS history
      JOIN Keywords AS keyword ON keyword.Id = history.KeywordId
      ORDER BY history.KeywordId ASC, history.SEId ASC, history.ScannedOn ASC, history.Id ASC
    `).iterate(),
    (row) => {
      const searchEngineId = safeInteger(row.seId);
      const searchEngine = searchEngineId === undefined
        ? undefined
        : engines.get(searchEngineId);
      const observedAt = kc4ObservedAt(row.scannedOn);
      const groupId = safeInteger(row.groupId);
      const context = searchEngine && groupId !== undefined
        ? kc4RankContextForGroup(contexts, searchEngine, groupId)
        : undefined;
      if (!searchEngine || !observedAt || !context) return undefined;
      const position = safeInteger(row.position);
      const found = position !== undefined && position > 0 && position <= 100;
      const rankingUrl = kc4Url(row.rankingUrl);
      return {
        ...context,
        observedAt,
        found,
        ...(found ? { position } : {}),
        ...(rankingUrl ? { rankingUrl } : {})
      };
    }
  );
}

function kc4HistoricalSerpRows(
  database: DatabaseSync,
  tables: ReadonlySet<string>,
  contexts: Kc4RankContextSettings
): Kc4GroupedRows<Kc4HistoricalSerpSnapshot> | undefined {
  const table = "Module_SERP_Data_History";
  const urlTable = "Module_SERP_URL";
  if (
    !tables.has(table) ||
    !tables.has(urlTable) ||
    !hasColumns(database, table, new Set([
      "Id", "KeywordId", "ScannedOn", "SEId", "Position", "URLId"
    ])) ||
    !hasColumns(database, urlTable, new Set(["Id", "URL"])) ||
    !tableHasRows(database, table)
  ) return undefined;
  const columns = tableColumns(database, table);
  const hasTitles = columns.has("TitleId") &&
    tables.has("Module_SERP_Titles") &&
    hasColumns(database, "Module_SERP_Titles", new Set(["Id", "Title"]));
  const hasSnippets = columns.has("SnippetId") &&
    tables.has("Module_SERP_Snippets") &&
    hasColumns(database, "Module_SERP_Snippets", new Set(["Id", "Snippet"]));
  const engines = kc4SearchEngines(database, tables);
  const raw = groupedKc4Rows(
    database.prepare(`
      SELECT history.KeywordId AS keywordId, history.SEId AS seId,
        history.ScannedOn AS scannedOn, history.Position AS serpPosition,
        CAST(urlValue.URL AS BLOB) AS rankingUrl,
        ${hasTitles ? "CAST(titleValue.Title AS BLOB)" : "NULL"} AS title,
        ${hasSnippets ? "CAST(snippetValue.Snippet AS BLOB)" : "NULL"} AS snippet,
        keyword.GroupId AS groupId
      FROM Module_SERP_Data_History AS history
      JOIN Keywords AS keyword ON keyword.Id = history.KeywordId
      JOIN Module_SERP_URL AS urlValue ON urlValue.Id = history.URLId
      ${hasTitles ? "LEFT JOIN Module_SERP_Titles AS titleValue ON titleValue.Id = history.TitleId" : ""}
      ${hasSnippets ? "LEFT JOIN Module_SERP_Snippets AS snippetValue ON snippetValue.Id = history.SnippetId" : ""}
      ORDER BY history.KeywordId ASC, history.SEId ASC,
        history.ScannedOn ASC, history.Position ASC, history.Id ASC
    `).iterate(),
    (row) => {
      const searchEngineId = safeInteger(row.seId);
      const searchEngine = searchEngineId === undefined
        ? undefined
        : engines.get(searchEngineId);
      const observedAt = kc4ObservedAt(row.scannedOn);
      const groupId = safeInteger(row.groupId);
      const context = searchEngine && groupId !== undefined
        ? kc4RankContextForGroup(contexts, searchEngine, groupId)
        : undefined;
      const position = safeInteger(row.serpPosition);
      const rankingUrl = kc4Url(row.rankingUrl);
      if (
        !context ||
        !observedAt ||
        position === undefined ||
        position < 1 ||
        position > MAX_KC4_SERP_RESULTS ||
        !rankingUrl
      ) return undefined;
      const title = kc4SerpText(row.title, 2_048);
      const snippet = kc4SerpText(row.snippet, 8_192);
      return {
        context,
        observedAt,
        result: {
          position,
          rankingUrl,
          ...(title ? { title } : {}),
          ...(snippet ? { snippet } : {})
        }
      };
    }
  );
  return {
    take(keywordId) {
      const byMeasurement = new Map<string, {
        readonly context: Kc4RankContext;
        readonly observedAt: string;
        readonly results: Map<number, SemanticImportSerpResultValue>;
      }>();
      for (const row of raw.take(keywordId)) {
        const key = `${row.context.searchEngine}:${row.context.regionCode}:${row.context.device}:${row.observedAt}`;
        const snapshot = byMeasurement.get(key) ?? {
          context: row.context,
          observedAt: row.observedAt,
          results: new Map<number, SemanticImportSerpResultValue>()
        };
        if (!snapshot.results.has(row.result.position)) {
          snapshot.results.set(row.result.position, row.result);
        }
        byMeasurement.set(key, snapshot);
      }
      return [...byMeasurement.values()]
        .slice(-1_100)
        .map(({ context, observedAt, results }) => ({
          ...context,
          observedAt,
          results: [...results.values()].sort(
            (left, right) => left.position - right.position
          )
        }));
    }
  };
}

function mergeKc4HistoricalSerp(
  history: readonly Kc4HistoryPoint[],
  serp: readonly Kc4HistoricalSerpSnapshot[]
): readonly Kc4HistoryPoint[] {
  const byMeasurement = new Map(
    history.map((point) => [kc4HistoryMeasurementKey(point), point])
  );
  for (const snapshot of serp) {
    const key = kc4HistoryMeasurementKey(snapshot);
    const current = byMeasurement.get(key);
    byMeasurement.set(key, {
      ...(current ?? {
        ...snapshot,
        found: false
      }),
      serpResults: snapshot.results
    });
  }
  return [...byMeasurement.values()].sort(
    (left, right) => left.observedAt.localeCompare(right.observedAt) ||
      left.searchEngine.localeCompare(right.searchEngine)
  );
}

function kc4HistoryMeasurementKey(
  value: Pick<Kc4HistoryPoint, "searchEngine" | "countryCode" | "regionCode" | "language" | "device" | "observedAt">
): string {
  return `${value.searchEngine}:${value.countryCode}:${value.regionCode}:${value.language}:${value.device}:${value.observedAt}`;
}

function readKc4RankContexts(
  database: DatabaseSync,
  tables: ReadonlySet<string>,
  groups: readonly Kc4Group[]
): Kc4RankContextSettings {
  const defaults = new Map<"YANDEX" | "GOOGLE", Kc4RankContext>();
  const byGroup = new Map<string, Kc4RankContext>();
  const parents = new Map(groups.map((group) => [group.id, group.parentId]));
  if (
    !tables.has("Tasks") ||
    !hasColumns(database, "Tasks", new Set(["TaskName", "StateData"]))
  ) {
    return {
      defaults: kc4RankContextDefaults(defaults),
      byGroup,
      parents
    };
  }
  for (const [searchEngine, taskName] of [
    ["YANDEX", "SERPPositionParsingTask_Yandex"],
    ["GOOGLE", "SERPPositionParsingTask_Google"]
  ] as const) {
    const row = database.prepare(
      "SELECT CAST(StateData AS BLOB) AS stateData FROM Tasks WHERE TaskName = ? LIMIT 1"
    ).get(taskName);
    const stateData = decodeKc4Text(row?.stateData, 16_000_000);
    if (!stateData) continue;
    const defaultFragment = /<DefaultProjectSettings(?:\s[^>]*)?>([\s\S]*?)<\/DefaultProjectSettings>/iu.exec(stateData)?.[1];
    const defaultContext = defaultFragment
      ? kc4RankContextFromXml(searchEngine, defaultFragment)
      : undefined;
    if (defaultContext) defaults.set(searchEngine, defaultContext);
    const itemPattern = /<Item\s+[^>]*key=(?:"([0-9]+)"|'([0-9]+)')[^>]*>([\s\S]*?)<\/Item>/giu;
    for (const match of stateData.matchAll(itemPattern)) {
      const groupId = Number(match[1] ?? match[2]);
      if (
        !Number.isSafeInteger(groupId) ||
        groupId < 1 ||
        byGroup.size >= semanticImportMaxGroupManifestEntries * 2
      ) {
        invalidKc4();
      }
      const context = kc4RankContextFromXml(searchEngine, match[3] ?? "");
      if (context) byGroup.set(`${searchEngine}:${groupId}`, context);
    }
  }
  return {
    defaults: kc4RankContextDefaults(defaults),
    byGroup,
    parents
  };
}

function kc4RankContextDefaults(
  parsed: ReadonlyMap<"YANDEX" | "GOOGLE", Kc4RankContext>
): ReadonlyMap<"YANDEX" | "GOOGLE", Kc4RankContext> {
  const result = new Map(parsed);
  for (const searchEngine of ["YANDEX", "GOOGLE"] as const) {
    if (result.has(searchEngine)) continue;
    result.set(searchEngine, {
      source: "KEY_COLLECTOR",
      searchEngine,
      countryCode: "RU",
      regionCode: "kc4-import",
      regionLabel: "Импорт Key Collector",
      language: "ru",
      device: "DESKTOP"
    });
  }
  return result;
}

function kc4RankContextFromXml(
  searchEngine: "YANDEX" | "GOOGLE",
  fragment: string
): Kc4RankContext | undefined {
  const platform = xmlTagValue(fragment, "Platform");
  const device = /mobile|phone|tablet/iu.test(platform ?? "")
    ? "MOBILE" as const
    : "DESKTOP" as const;
  if (searchEngine === "YANDEX") {
    const regionCode = xmlTagValue(fragment, "LRParameter");
    if (!regionCode || !/^(?:0|[1-9][0-9]{0,9})$/u.test(regionCode)) return undefined;
    return {
      source: "KEY_COLLECTOR",
      searchEngine,
      countryCode: "RU",
      regionCode,
      regionLabel:
        resolveSeoRegionLabel("YANDEX_RANK", regionCode) ??
        `Регион Key Collector (${regionCode})`,
      language: "ru",
      device
    };
  }
  const canonical = xmlTagValue(fragment, "LocationCanonicalName");
  if (!canonical) return undefined;
  const regionCode = KC4_GOOGLE_CANONICAL_REGION_CODES.get(canonical);
  if (!regionCode) return undefined;
  return {
    source: "KEY_COLLECTOR",
    searchEngine,
    countryCode: "RU",
    regionCode,
    regionLabel:
      resolveSeoRegionLabel("GOOGLE_RANK", regionCode) ?? canonical.split(",")[0]!,
    language: "ru",
    device
  };
}

const KC4_GOOGLE_CANONICAL_REGION_CODES = new Map<string, string>(
  kc4GoogleRussiaCanonicalRegions
);

function xmlTagValue(fragment: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = new RegExp(`<${escaped}(?:\\s[^>]*)?>([^<]*)</${escaped}>`, "iu")
    .exec(fragment)?.[1]
    ?.replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .normalize("NFC")
    .trim();
  return value || undefined;
}

function kc4RankContextForGroup(
  contexts: Kc4RankContextSettings,
  searchEngine: "YANDEX" | "GOOGLE",
  groupId: number
): Kc4RankContext | undefined {
  let current: number | undefined = groupId;
  const seen = new Set<number>();
  while (current !== undefined) {
    if (seen.has(current) || seen.size >= semanticImportMaxGroupDepth) invalidKc4();
    seen.add(current);
    const context = contexts.byGroup.get(`${searchEngine}:${current}`);
    if (context) return context;
    current = contexts.parents.get(current);
  }
  return contexts.defaults.get(searchEngine);
}

function kc4PositionContextsForGroup(
  contexts: Kc4RankContextSettings,
  groupId: number,
  updates: readonly Kc4PositionUpdate[],
  history: readonly Kc4HistoryPoint[]
): readonly Readonly<Kc4RankContext & { readonly observedAt?: string }>[] {
  const updateByEngine = new Map(updates.map((update) => {
    const matchingHistory = [...history]
      .reverse()
      .find((point) =>
        point.searchEngine === update.searchEngine &&
        point.observedAt.slice(0, 10) === update.observedAt.slice(0, 10)
      );
    return [
      update.searchEngine,
      matchingHistory?.observedAt ?? update.observedAt
    ] as const;
  }));
  return (["YANDEX", "GOOGLE"] as const).flatMap((searchEngine) => {
    const context = kc4RankContextForGroup(
      contexts,
      searchEngine,
      groupId
    );
    return context
      ? [{
          ...context,
          ...(updateByEngine.get(searchEngine)
            ? { observedAt: updateByEngine.get(searchEngine)! }
            : {})
        }]
      : [];
  });
}

function kc4PositionUpdates(
  database: DatabaseSync,
  tables: ReadonlySet<string>
): Kc4GroupedRows<Kc4PositionUpdate> | undefined {
  if (
    !tables.has("Scheduler_LastParametersUpdates") ||
    !tables.has("Scheduler_Parameters") ||
    !hasColumns(database, "Scheduler_LastParametersUpdates", new Set([
      "KeywordId", "ParameterId", "UpdatedOn"
    ])) ||
    !hasColumns(database, "Scheduler_Parameters", new Set(["Id", "Name"]))
  ) return undefined;
  return groupedKc4Rows(
    database.prepare(`
      SELECT updateRow.KeywordId AS keywordId, parameter.Name AS parameterName,
        updateRow.UpdatedOn AS updatedOn
      FROM Scheduler_LastParametersUpdates AS updateRow
      JOIN Scheduler_Parameters AS parameter ON parameter.Id = updateRow.ParameterId
      WHERE parameter.Name IN (
        'Module_SERP_Position_Yandex.Position',
        'Module_SERP_Position_Google.Position'
      )
      ORDER BY updateRow.KeywordId ASC, parameter.Id ASC
    `).iterate(),
    (row) => {
      const observedAt = kc4ObservedAt(row.updatedOn);
      const parameter = cell(row.parameterName);
      const searchEngine = parameter.endsWith("_Yandex.Position")
        ? "YANDEX" as const
        : parameter.endsWith("_Google.Position")
          ? "GOOGLE" as const
          : undefined;
      return observedAt && searchEngine ? { searchEngine, observedAt } : undefined;
    }
  );
}

function kc4SerpRows(
  database: DatabaseSync,
  tables: ReadonlySet<string>
): Kc4GroupedRows<Kc4SerpSnapshot> | undefined {
  const table = "Module_SERP_Data";
  if (
    !tables.has(table) ||
    !hasColumns(database, table, new Set(["Id", "KeywordId", "SEId", "URL"])) ||
    !tableHasRows(database, table)
  ) return undefined;
  const columns = tableColumns(database, table);
  const engines = kc4SearchEngines(database, tables);
  const raw = groupedKc4Rows(
    database.prepare(`
      SELECT KeywordId AS keywordId, SEId AS seId,
        ROW_NUMBER() OVER (
          PARTITION BY KeywordId, SEId ORDER BY Id ASC
        ) AS serpPosition,
        URL AS rankingUrl,
        ${columns.has("Title") ? "Title" : "NULL"} AS title,
        ${columns.has("Snippet") ? "Snippet" : "NULL"} AS snippet
      FROM Module_SERP_Data
      ORDER BY KeywordId ASC, SEId ASC, Id ASC
    `).iterate(),
    (row) => {
      const searchEngineId = safeInteger(row.seId);
      const searchEngine = searchEngineId === undefined
        ? undefined
        : engines.get(searchEngineId);
      const position = safeInteger(row.serpPosition);
      const rankingUrl = kc4Url(row.rankingUrl);
      if (!searchEngine || !rankingUrl || position === undefined || position < 1 || position > MAX_KC4_SERP_RESULTS) {
        return undefined;
      }
      const title = kc4SerpText(row.title, 2_048);
      const snippet = kc4SerpText(row.snippet, 8_192);
      return {
        searchEngine,
        result: {
          position,
          rankingUrl,
          ...(title ? { title } : {}),
          ...(snippet ? { snippet } : {})
        }
      };
    }
  );
  return {
    take(keywordId) {
      const byEngine = new Map<"YANDEX" | "GOOGLE", SemanticImportSerpResultValue[]>();
      for (const row of raw.take(keywordId)) {
        const results = byEngine.get(row.searchEngine) ?? [];
        results.push(row.result);
        byEngine.set(row.searchEngine, results);
      }
      return [...byEngine].map(([searchEngine, results]) => ({ searchEngine, results }));
    }
  };
}

function kc4RelevantPageRows(
  database: DatabaseSync,
  tables: ReadonlySet<string>
): Kc4GroupedRows<Kc4RelevantPage> | undefined {
  const table = "Module_SERP_RelevantPages";
  if (
    !tables.has(table) ||
    !hasColumns(database, table, new Set(["Id", "KeywordId", "SEId", "URL"])) ||
    !tableHasRows(database, table)
  ) return undefined;
  const engines = kc4SearchEngines(database, tables);
  return groupedKc4Rows(
    database.prepare(`
      SELECT KeywordId AS keywordId, SEId AS seId, URL AS rankingUrl
      FROM Module_SERP_RelevantPages
      ORDER BY KeywordId ASC, SEId ASC, Id ASC
    `).iterate(),
    (row) => {
      const searchEngineId = safeInteger(row.seId);
      const searchEngine = searchEngineId === undefined
        ? undefined
        : engines.get(searchEngineId);
      const url = kc4Url(row.rankingUrl);
      return searchEngine && url ? { searchEngine, url } : undefined;
    }
  );
}

function kc4RelevantPagesByEngine(
  rows: readonly Kc4RelevantPage[]
): Readonly<Record<"YANDEX" | "GOOGLE", readonly string[]>> {
  const result = {
    YANDEX: [] as string[],
    GOOGLE: [] as string[]
  };
  for (const row of rows) {
    if (!result[row.searchEngine].includes(row.url)) {
      result[row.searchEngine].push(row.url);
    }
  }
  return result;
}

function kc4SearchEngines(
  database: DatabaseSync,
  tables: ReadonlySet<string>
): ReadonlyMap<number, "YANDEX" | "GOOGLE"> {
  const table = "Module_SERP_SearchEngines";
  if (!tables.has(table) || !hasColumns(database, table, new Set(["Id", "SEName"]))) {
    return new Map([[1, "YANDEX"], [2, "GOOGLE"]]);
  }
  const result = new Map<number, "YANDEX" | "GOOGLE">();
  for (const row of database.prepare(
    "SELECT Id AS id, SEName AS name FROM Module_SERP_SearchEngines"
  ).all()) {
    const name = cell(row.name).normalize("NFKC").trim().toLowerCase();
    if (name.includes("yandex") || name.includes("яндекс")) {
      const id = safeInteger(row.id);
      if (id !== undefined) result.set(id, "YANDEX");
    } else if (name.includes("google") || name.includes("гугл")) {
      const id = safeInteger(row.id);
      if (id !== undefined) result.set(id, "GOOGLE");
    }
  }
  return result.size > 0 ? result : new Map([[1, "YANDEX"], [2, "GOOGLE"]]);
}

function kc4ObservedAt(value: SQLOutputValue | undefined): string | undefined {
  const raw = cell(value).normalize("NFKC").trim();
  if (!raw) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/u.test(raw)
    ? `${raw}T00:00:00.000Z`
    : `${raw.replace(" ", "T")}${/[zZ]|[+-]\d{2}:?\d{2}$/u.test(raw) ? "" : "Z"}`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2200) return undefined;
  return date.toISOString();
}

function kc4Url(value: SQLOutputValue | undefined): string | undefined {
  const decoded = decodeKc4Text(value, 2_048)?.trim();
  if (!decoded) return undefined;
  try {
    const url = new URL(decoded);
    return ["http:", "https:"].includes(url.protocol) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function kc4SerpText(
  value: SQLOutputValue | undefined,
  maximumLength: number
): string | undefined {
  const decoded = decodeKc4Text(value, maximumLength)
    ?.replace(/<[^>]{1,256}>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return decoded || undefined;
}

function decodeKc4Text(
  value: SQLOutputValue | undefined,
  maximumLength: number
): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const normalized = value.normalize("NFC");
    return normalized.length <= maximumLength && !normalized.includes("\uFFFD")
      ? normalized
      : undefined;
  }
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_KC4_DECOMPRESSED_TEXT_BYTES) {
    return undefined;
  }
  try {
    const source = Buffer.from(value);
    const decoded = source[0] === 0x1f && source[1] === 0x8b
      ? gunzipSync(source, { maxOutputLength: MAX_KC4_DECOMPRESSED_TEXT_BYTES })
      : source;
    const text = decodeKc4Bytes(decoded);
    if (text === undefined) return undefined;
    return text.length <= maximumLength ? text : undefined;
  } catch {
    return undefined;
  }
}

function decodeKc4Bytes(value: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    text = new TextDecoder("windows-1251").decode(value);
  }
  const normalized = text.normalize("NFC");
  if (
    normalized.includes("\uFFFD") ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 8 || code === 11 || code === 12 ||
        (code >= 14 && code <= 31) || code === 127;
    })
  ) {
    return undefined;
  }
  return normalized;
}

function kc4GroupPathCell(path: readonly string[]): string {
  return path.some((segment) => segment.includes("/"))
    ? JSON.stringify(path)
    : path.join("/");
}

function tableHasRows(database: DatabaseSync, table: string): boolean {
  return truthy(database.prepare(
    `SELECT EXISTS(SELECT 1 FROM ${identifier(table)} LIMIT 1) AS present`
  ).get()?.present);
}

function kc4GroupColor(value: string | undefined): string | undefined {
  const normalized = value?.normalize("NFKC").trim();
  if (!normalized || normalized.toLowerCase() === "transparent") return undefined;
  if (/^#[0-9a-f]{6}$/iu.test(normalized)) return normalized.toLowerCase();
  if (/^#[0-9a-f]{8}$/iu.test(normalized)) return `#${normalized.slice(3).toLowerCase()}`;
  return undefined;
}

function readGroupMetaTags(
  database: DatabaseSync,
  tables: ReadonlySet<string>
): ReadonlyMap<number, readonly Kc4GroupMetaTag[]> {
  const table = "KeywordGroupMetaTags";
  if (
    !tables.has(table) ||
    !hasColumns(database, table, new Set(["GroupId", "Tag"])) ||
    !tableHasRows(database, table)
  ) return new Map();
  const columns = tableColumns(database, table);
  const result = new Map<number, Kc4GroupMetaTag[]>();
  const rows = database.prepare(`
    SELECT GroupId AS groupId, CAST(Tag AS BLOB) AS tag,
      ${columns.has("Exact") ? "Exact" : "0"} AS exact,
      ${columns.has("Weight") ? "Weight" : "NULL"} AS weight
    FROM KeywordGroupMetaTags
    ORDER BY GroupId ASC${columns.has("Id") ? ", Id ASC" : ""}
    LIMIT ${MAX_KC4_GROUP_META_TAGS}
  `).iterate();
  for (const row of rows) {
    const tag = cell(row.tag).normalize("NFC").trim();
    if (!tag || tag.length > 256) continue;
    const groupId = safeInteger(row.groupId);
    if (groupId === undefined) continue;
    const current = result.get(groupId) ?? [];
    if (current.length >= 1_000) continue;
    const weight = safeInteger(row.weight);
    current.push({
      tag,
      exact: truthy(row.exact),
      ...(weight === undefined ? {} : { weight })
    });
    result.set(groupId, current);
  }
  return result;
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
        CAST(Header AS BLOB) AS header,
        COALESCE(OrderNumber, 0) AS orderNumber,
        ${optional("IsTrashBin", "0")} AS isTrashBin,
        ${optional("IsRemoved", "0")} AS isRemoved,
        CAST(${optional("HeaderBackground", "NULL")} AS BLOB) AS color,
        CAST(${optional("Comment", "NULL")} AS BLOB) AS comment,
        ${optional("IsHidden", "0")} AS isHidden,
        ${optional("InheritMetaTags", "0")} AS inheritMetaTags
      FROM KeywordGroups
    `)
    .all()
    .map((row) => {
      const id = integer(row.id);
      const parentId = nullableInteger(row.parentId);
      const header = cell(row.header).normalize("NFC").trim();
      if (!header) invalidKc4();
      return {
        id,
        ...(parentId === undefined ? {} : { parentId }),
        header,
        order: integer(row.orderNumber),
        trash:
          truthy(row.isTrashBin) ||
          (parentId === undefined && isTrashHeader(header)),
        removed: truthy(row.isRemoved),
        hidden: truthy(row.isHidden),
        inheritMetaTags: truthy(row.inheritMetaTags),
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
  const known = new Set(
    SCALAR_COLUMNS.map(({ table, field }) => `${table}\u0000${field}`)
  );
  const discovered = [...tables]
    .filter((table) => table.startsWith("Module_") && tableHasRows(database, table))
    .sort((left, right) => left.localeCompare(right, "en"))
    .flatMap((table) => {
      const columns = tableColumnDefinitions(database, table);
      const primary = columns.filter(({ primaryKeyOrder }) => primaryKeyOrder > 0);
      if (primary.length !== 1 || primary[0]?.name !== "KeywordId") return [];
      return columns.flatMap(({ name, type }) => {
        if (
          name === "KeywordId" ||
          known.has(`${table}\u0000${name}`) ||
          /BLOB/iu.test(type) ||
          !/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(name)
        ) return [];
        const header = `Key Collector · ${table.replace(/^Module_/u, "")} · ${name}`;
        return header.length <= 160 ? [{ table, field: name, header }] : [];
      });
    });
  const candidates = [...SCALAR_COLUMNS, ...discovered].slice(0, 470);
  return candidates.flatMap((column, index) => {
    if (!tables.has(column.table)) return [];
    if (!hasColumns(database, column.table, new Set(["KeywordId", column.field]))) return [];
    const row = database.prepare(
      `SELECT EXISTS(
        SELECT 1 FROM ${identifier(column.table)}
        WHERE ${identifier(column.field)} IS NOT NULL
          AND length(CAST(${identifier(column.field)} AS BLOB)) > 0
        LIMIT 1
      ) AS present`
    ).get();
    const populated = truthy(row?.present);
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

function tableColumnDefinitions(
  database: DatabaseSync,
  table: string
): readonly Readonly<{
  name: string;
  type: string;
  primaryKeyOrder: number;
}>[] {
  return database
    .prepare(`PRAGMA table_info(${identifier(table)})`)
    .all()
    .map((row) => ({
      name: cell(row.name),
      type: cell(row.type),
      primaryKeyOrder: integer(row.pk)
    }));
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
  if (value instanceof Uint8Array) return decodeKc4Bytes(value) ?? "";
  const normalized = String(value).normalize("NFC");
  return normalized.includes("\uFFFD") ? "" : normalized;
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

function safeInteger(value: SQLOutputValue | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function truthy(value: unknown): boolean {
  return value === 1 || value === 1n || value === true || value === "1";
}

function booleanCell(value: SQLOutputValue | undefined): string {
  return truthy(value) ? "Да" : "Нет";
}

function booleanText(value: boolean): string {
  return value ? "Да" : "Нет";
}

function invalidKc4(): never {
  throw new DelimitedParseError("INVALID_KC4");
}

import { Zip, ZipDeflate } from "fflate";
import type {
  CreateSemanticExportInput,
  SemanticKeywordListItem,
  SemanticPositionHistoryExportRow,
  SemanticPositionHistorySearchEngine,
  SemanticSavedViewColumnKey
} from "@seo-platform/contracts";

const encoder = new TextEncoder();
const XLSX_MAX_DATA_ROWS_PER_SHEET = 1_048_575;
const XLSX_NUMERIC_COLUMNS = new Set<SemanticSavedViewColumnKey>([
  "frequency",
  "frequencyExact",
  "frequencyFixed",
  "wordCount",
  "yandexPosition",
  "googlePosition",
  "yandexAiPosition",
  "googleAiPosition",
  "visibility",
  "priority"
]);

const HEADERS: Readonly<
  Record<
    Exclude<SemanticSavedViewColumnKey, `custom:${string}`>,
    Readonly<Record<"en" | "ru", string>>
  >
> = {
  query: { en: "Query", ru: "Запрос" },
  frequency: { en: "Frequency", ru: "Частотность" },
  frequencyExact: { en: '"Frequency"', ru: '"Частотность"' },
  frequencyFixed: { en: '"!Frequency"', ru: '"!Частотность"' },
  wordCount: { en: "Word count", ru: "Слов" },
  yandexPosition: { en: "Yandex position", ru: "Позиция Яндекс" },
  googlePosition: { en: "Google position", ru: "Позиция Google" },
  yandexAiPosition: { en: "Yandex AI position", ru: "ИИ позиция Яндекс" },
  googleAiPosition: { en: "Google AI position", ru: "ИИ позиция Google" },
  yandexRelevantUrl: { en: "Yandex relevant URL", ru: "Релевантный URL Яндекс" },
  googleRelevantUrl: { en: "Google relevant URL", ru: "Релевантный URL Google" },
  yandexCheckedAt: { en: "Yandex checked at", ru: "Дата съёма Яндекс" },
  googleCheckedAt: { en: "Google checked at", ru: "Дата съёма Google" },
  yandexAiCheckedAt: { en: "Yandex AI checked at", ru: "Дата съёма ИИ Яндекс" },
  googleAiCheckedAt: { en: "Google AI checked at", ru: "Дата съёма ИИ Google" },
  visibility: { en: "Visibility", ru: "Видимость" },
  group: { en: "Group", ru: "Группа" },
  cluster: { en: "Cluster", ru: "Кластер" },
  targetUrl: { en: "Target URL", ru: "Целевая URL" },
  tags: { en: "Tags", ru: "Теги" },
  intent: { en: "Intent", ru: "Интент" },
  priority: { en: "Priority", ru: "Приоритет" },
  source: { en: "Source", ru: "Источник" },
  updatedAt: { en: "Updated at", ru: "Обновлён" }
};

export interface SemanticExportFile {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: AsyncIterable<Uint8Array>;
}

export interface SemanticPositionHistoryWorkbookPlan {
  readonly rowCount: number;
  readonly dates: Readonly<
    Record<SemanticPositionHistorySearchEngine, readonly string[]>
  >;
}

export function semanticExportFile(
  rows: AsyncIterable<SemanticKeywordListItem>,
  input: CreateSemanticExportInput,
  customColumnNames: Readonly<Record<string, string>>,
  now = new Date()
): SemanticExportFile {
  assertCustomColumns(input.columns, customColumnNames);
  const date = now.toISOString().slice(0, 10);
  const extension = exportExtension(input.format);
  return {
    filename: `semantic-core-${date}.${extension}`,
    contentType: exportContentType(input.format),
    bytes:
      input.format === "XLSX"
        ? xlsxDocument(rows, input, customColumnNames)
        : textDocument(rows, input, customColumnNames)
  };
}

export function semanticPositionHistoryExportFile(
  rows: AsyncIterable<SemanticPositionHistoryExportRow>,
  input: CreateSemanticExportInput,
  plan: SemanticPositionHistoryWorkbookPlan,
  now = new Date()
): SemanticExportFile {
  if (!input.positionHistory || input.format !== "XLSX") {
    throw new TypeError("Position history export requires XLSX report options");
  }
  const date = now.toISOString().slice(0, 10);
  return {
    filename: `positions-history-${date}.xlsx`,
    contentType: exportContentType("XLSX"),
    bytes: positionHistoryXlsxDocument(rows, input, plan)
  };
}

async function* textDocument(
  rows: AsyncIterable<SemanticKeywordListItem>,
  input: CreateSemanticExportInput,
  customColumnNames: Readonly<Record<string, string>>
): AsyncGenerator<Uint8Array> {
  if (input.format === "JSON") {
    yield encoder.encode("[\n");
    let first = true;
    for await (const item of rows) {
      const record = exportRecord(item, input.columns);
      yield encoder.encode(`${first ? "" : ",\n"}${JSON.stringify(record)}`);
      first = false;
    }
    yield encoder.encode("\n]\n");
    return;
  }
  if (input.format === "NDJSON") {
    for await (const item of rows) {
      yield encoder.encode(`${JSON.stringify(exportRecord(item, input.columns))}\n`);
    }
    return;
  }

  const delimiter = input.format === "TSV" ? "\t" : ",";
  // CSV and TSV are routinely opened by spreadsheet applications, so every
  // delimited format needs the same formula-injection protection.
  const protectSpreadsheet = true;
  const bom = input.format === "GOOGLE_CSV" || input.includeBom === true
    ? "\uFEFF"
    : "";
  const headers = input.columns.map((column) =>
    delimitedCell(
      columnHeader(column, input.locale, customColumnNames),
      delimiter,
      protectSpreadsheet
    )
  );
  yield encoder.encode(`${bom}${headers.join(delimiter)}\r\n`);
  for await (const item of rows) {
    const record = exportRecord(item, input.columns);
    yield encoder.encode(
      `${input.columns.map((column) =>
        delimitedCell(tabularValue(record[column]), delimiter, protectSpreadsheet)
      ).join(delimiter)}\r\n`
    );
  }
}

async function* xlsxDocument(
  rows: AsyncIterable<SemanticKeywordListItem>,
  input: CreateSemanticExportInput,
  customColumnNames: Readonly<Record<string, string>>
): AsyncGenerator<Uint8Array> {
  const output: Uint8Array[] = [];
  let zipError: Error | undefined;
  const zip = new Zip((error, data) => {
    if (error) zipError = error;
    if (data.byteLength > 0) output.push(data);
  });
  const drain = function* (): Generator<Uint8Array> {
    if (zipError) throw zipError;
    while (output.length > 0) yield output.shift()!;
  };
  const addText = (name: string, value: string): void => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(encoder.encode(value), true);
  };
  const headers = input.columns.map((column) =>
    columnHeader(column, input.locale, customColumnNames)
  );
  let sheetNumber = 0;
  let sheetRow = 0;
  let sheet: ZipDeflate | undefined;
  const startSheet = (): void => {
    sheetNumber += 1;
    sheetRow = 1;
    sheet = new ZipDeflate(`xl/worksheets/sheet${sheetNumber}.xml`, { level: 6 });
    zip.add(sheet);
    sheet.push(encoder.encode(worksheetStart()));
    sheet.push(encoder.encode(xlsxRow(sheetRow, headers)));
  };
  const finishSheet = (): void => {
    if (!sheet) return;
    sheet.push(encoder.encode("</sheetData></worksheet>"), true);
    sheet = undefined;
  };

  startSheet();
  yield* drain();
  for await (const item of rows) {
    if (sheetRow > XLSX_MAX_DATA_ROWS_PER_SHEET) {
      finishSheet();
      yield* drain();
      startSheet();
    }
    sheetRow += 1;
    const record = exportRecord(item, input.columns);
    sheet!.push(
      encoder.encode(
        xlsxRow(
          sheetRow,
          input.columns.map((column) => record[column]),
          input.columns
        )
      )
    );
    yield* drain();
  }
  finishSheet();
  yield* drain();

  addText("xl/workbook.xml", workbookXml(sheetNumber));
  addText("xl/_rels/workbook.xml.rels", workbookRelationships(sheetNumber));
  addText("xl/styles.xml", stylesXml());
  addText("_rels/.rels", rootRelationships());
  addText("[Content_Types].xml", contentTypes(sheetNumber));
  yield* drain();
  zip.end();
  yield* drain();
}

async function* positionHistoryXlsxDocument(
  rows: AsyncIterable<SemanticPositionHistoryExportRow>,
  input: CreateSemanticExportInput,
  plan: SemanticPositionHistoryWorkbookPlan
): AsyncGenerator<Uint8Array> {
  const options = input.positionHistory;
  if (!options) throw new TypeError("Position history report options are missing");
  if (!Number.isSafeInteger(plan.rowCount) || plan.rowCount < 0) {
    throw new TypeError("Position history report row count is invalid");
  }
  const sheets = options.searchEngines.map((searchEngine, index) => ({
    searchEngine,
    name: searchEngine === "YANDEX" ? "Яндекс" : "Google",
    dates: validatedHistoryDates(plan.dates[searchEngine], options),
    index: index + 1
  }));
  const output: Uint8Array[] = [];
  let zipError: Error | undefined;
  const zip = new Zip((error, data) => {
    if (error) zipError = error;
    if (data.byteLength > 0) output.push(data);
  });
  const drain = function* (): Generator<Uint8Array> {
    if (zipError) throw zipError;
    while (output.length > 0) yield output.shift()!;
  };
  const addText = (name: string, value: string): void => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(encoder.encode(value), true);
  };
  const streams = sheets.map((sheet) => {
    const stream = new ZipDeflate(
      `xl/worksheets/sheet${sheet.index}.xml`,
      { level: 6 }
    );
    zip.add(stream);
    const lastColumn = excelColumn(3 + sheet.dates.length);
    stream.push(
      encoder.encode(
        positionHistoryWorksheetStart(lastColumn) +
          positionHistoryHeaderRows(sheet)
      )
    );
    return { ...sheet, stream, lastColumn };
  });
  yield* drain();

  let rowCount = 0;
  for await (const row of rows) {
    rowCount += 1;
    for (const sheet of streams) {
      sheet.stream.push(
        encoder.encode(
          positionHistoryDataRow(4 + rowCount, row, sheet.searchEngine, sheet.dates)
        )
      );
    }
    yield* drain();
  }
  for (const sheet of streams) {
    sheet.stream.push(
      encoder.encode(
        `</sheetData><autoFilter ref="A1:${sheet.lastColumn}${Math.max(5, 4 + rowCount)}"/><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`
      ),
      true
    );
  }
  yield* drain();

  addText("xl/workbook.xml", workbookXmlWithNames(sheets.map(({ name }) => name)));
  addText("xl/_rels/workbook.xml.rels", workbookRelationships(sheets.length));
  addText("xl/styles.xml", positionHistoryStylesXml());
  addText("_rels/.rels", rootRelationships());
  addText("[Content_Types].xml", contentTypes(sheets.length));
  yield* drain();
  zip.end();
  yield* drain();
}

function validatedHistoryDates(
  dates: readonly string[],
  options: NonNullable<CreateSemanticExportInput["positionHistory"]>
): readonly string[] {
  if (dates.length > 1_100 || new Set(dates).size !== dates.length) {
    throw new TypeError("Position history report dates are invalid");
  }
  let previous = "9999-99-99";
  for (const date of dates) {
    const instant = `${date}T00:00:00.000Z`;
    const nextDay = new Date(Date.parse(instant) + 24 * 60 * 60 * 1_000).toISOString();
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      new Date(instant).toISOString().slice(0, 10) !== date ||
      nextDay <= options.observedFrom ||
      instant >= options.observedBefore ||
      date >= previous
    ) {
      throw new TypeError("Position history report dates are invalid");
    }
    previous = date;
  }
  return dates;
}

function positionHistoryWorksheetStart(lastColumn: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="4" topLeftCell="B5" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B5" sqref="B5"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="52" customWidth="1"/><col min="2" max="2" width="13" customWidth="1"/><col min="3" max="3" width="13" customWidth="1"/><col min="4" max="${Math.max(4, excelColumnNumber(lastColumn))}" width="11" customWidth="1"/></cols><sheetData>`;
}

function positionHistoryHeaderRows(
  sheet: Readonly<{
    searchEngine: SemanticPositionHistorySearchEngine;
    dates: readonly string[];
  }>
): string {
  const header = ["Фраза", "Добавлен", "Поисковик", ...sheet.dates.map(displayDate)];
  const headerRow = `<row r="1" ht="25" customHeight="1">${header.map((value, index) =>
    styledInlineCell(1, index + 1, value, 1)
  ).join("")}</row>`;
  const summaries = [5, 10, 30].map((threshold, offset) => {
    const row = offset + 2;
    const values = [
      styledInlineCell(row, 1, `ТОП-${threshold}`, 2),
      emptyStyledCell(row, 2, 2),
      styledInlineCell(
        row,
        3,
        sheet.searchEngine === "YANDEX" ? "Яндекс" : "Google",
        2
      ),
      ...sheet.dates.map((_, dateIndex) => {
        const column = excelColumn(dateIndex + 4);
        return formulaCell(
          row,
          dateIndex + 4,
          `COUNTIFS(${column}$5:INDEX(${column}:${column},MAX(5,COUNTA($A:$A))),">=1",${column}$5:INDEX(${column}:${column},MAX(5,COUNTA($A:$A))),"<=${threshold}")`,
          3
        );
      })
    ];
    return `<row r="${row}" ht="20" customHeight="1">${values.join("")}</row>`;
  }).join("");
  return headerRow + summaries;
}

function positionHistoryDataRow(
  rowIndex: number,
  row: SemanticPositionHistoryExportRow,
  searchEngine: SemanticPositionHistorySearchEngine,
  dates: readonly string[]
): string {
  if (
    !row.text ||
    row.text.length > 2_000 ||
    Number.isNaN(Date.parse(row.createdAt)) ||
    row.snapshots.length > 2_200
  ) {
    throw new TypeError("Position history report row is invalid");
  }
  const snapshots = new Map(
    row.snapshots
      .filter((snapshot) => snapshot.searchEngine === searchEngine)
      .map((snapshot) => [snapshot.observedDate, snapshot] as const)
  );
  const olderByDate = new Map<
    string,
    SemanticPositionHistoryExportRow["snapshots"][number] | undefined
  >();
  let older: SemanticPositionHistoryExportRow["snapshots"][number] | undefined;
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const date = dates[index]!;
    olderByDate.set(date, older);
    const current = snapshots.get(date);
    if (current) older = current;
  }
  const cells = [
    styledInlineCell(rowIndex, 1, row.text, 4),
    styledInlineCell(rowIndex, 2, displayDate(row.createdAt.slice(0, 10)), 5),
    styledInlineCell(rowIndex, 3, searchEngine === "YANDEX" ? "Яндекс" : "Google", 5),
    ...dates.map((date, index) => {
      const current = snapshots.get(date);
      const style = positionHistoryCellStyle(current, olderByDate.get(date));
      if (!current?.found) {
        return styledInlineCell(rowIndex, index + 4, "—", style);
      }
      if (!Number.isSafeInteger(current.position) || current.position === undefined) {
        throw new TypeError("Position history report position is invalid");
      }
      return styledNumberCell(rowIndex, index + 4, current.position, style);
    })
  ];
  return `<row r="${rowIndex}" ht="21" customHeight="1">${cells.join("")}</row>`;
}

function positionHistoryCellStyle(
  current: SemanticPositionHistoryExportRow["snapshots"][number] | undefined,
  older: SemanticPositionHistoryExportRow["snapshots"][number] | undefined
): number {
  if (!current) return 9;
  if (!older) return current.found ? 6 : 9;
  if (!current.found) return older.found ? 8 : 9;
  if (!older.found) return 7;
  if (current.position === undefined || older.position === undefined) {
    throw new TypeError("Position history comparison is invalid");
  }
  if (current.position < older.position) return 7;
  if (current.position > older.position) return 8;
  return 6;
}

function styledInlineCell(
  row: number,
  column: number,
  value: string,
  style: number
): string {
  const reference = `${excelColumn(column)}${row}`;
  const text = value.slice(0, 32_767);
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function styledNumberCell(
  row: number,
  column: number,
  value: number,
  style: number
): string {
  return `<c r="${excelColumn(column)}${row}" s="${style}"><v>${value}</v></c>`;
}

function emptyStyledCell(row: number, column: number, style: number): string {
  return `<c r="${excelColumn(column)}${row}" s="${style}"/>`;
}

function formulaCell(
  row: number,
  column: number,
  formula: string,
  style: number
): string {
  return `<c r="${excelColumn(column)}${row}" s="${style}"><f>${xml(formula)}</f></c>`;
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function excelColumnNumber(value: string): number {
  let result = 0;
  for (const character of value) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function exportRecord(
  item: SemanticKeywordListItem,
  columns: readonly SemanticSavedViewColumnKey[]
): Readonly<Record<string, unknown>> {
  const customValues = new Map(
    (item.customValues ?? []).map(({ columnId, value }) => [columnId, value])
  );
  return Object.fromEntries(columns.map((column) => {
    const customId = customColumnId(column);
    return [
      column,
      customId
        ? (customValues.get(customId) ?? null)
        : systemColumnValue(item, column as Exclude<SemanticSavedViewColumnKey, `custom:${string}`>)
    ];
  }));
}

function systemColumnValue(
  item: SemanticKeywordListItem,
  column: Exclude<SemanticSavedViewColumnKey, `custom:${string}`>
): unknown {
  switch (column) {
    case "query": return item.textOriginal;
    case "frequency": return item.frequency?.value ?? null;
    case "frequencyExact": return item.frequencies?.find(({ type }) => type === "EXACT")?.value ?? null;
    case "frequencyFixed": return item.frequencies?.find(({ type }) => type === "FIXED")?.value ?? null;
    case "wordCount": return item.textOriginal.trim() ? item.textOriginal.trim().split(/\s+/u).length : 0;
    case "yandexPosition": return searchPosition(item, "YANDEX");
    case "googlePosition": return searchPosition(item, "GOOGLE");
    case "yandexAiPosition": return aiAnswerPosition(item, "YANDEX");
    case "googleAiPosition": return aiAnswerPosition(item, "GOOGLE");
    case "yandexRelevantUrl": return searchValue(item, "YANDEX", "rankingUrl");
    case "googleRelevantUrl": return searchValue(item, "GOOGLE", "rankingUrl");
    case "yandexCheckedAt": return searchValue(item, "YANDEX", "observedAt");
    case "googleCheckedAt": return searchValue(item, "GOOGLE", "observedAt");
    case "yandexAiCheckedAt": return aiAnswerCheckedAt(item, "YANDEX");
    case "googleAiCheckedAt": return aiAnswerCheckedAt(item, "GOOGLE");
    case "visibility": return searchVisibility(item);
    case "group": return item.groupPath ?? null;
    case "cluster": return item.clusterName ?? null;
    case "targetUrl": return item.targetUrl ?? null;
    case "tags": return item.tags;
    case "intent": return item.intent ?? null;
    case "priority": return item.priority;
    case "source": return item.sourceMode;
    case "updatedAt": return item.updatedAt;
  }
}

function aiAnswerPosition(
  item: SemanticKeywordListItem,
  engine: "GOOGLE" | "YANDEX"
): number | null {
  const value = item.aiAnswers?.find(({ searchEngine }) => searchEngine === engine);
  return value?.siteFound === true ? (value.position ?? null) : null;
}

function aiAnswerCheckedAt(
  item: SemanticKeywordListItem,
  engine: "GOOGLE" | "YANDEX"
): string | null {
  return item.aiAnswers?.find(({ searchEngine }) => searchEngine === engine)?.observedAt ?? null;
}

function searchPosition(item: SemanticKeywordListItem, engine: "GOOGLE" | "YANDEX"): number | null {
  const value = item.positions?.find(({ searchEngine }) => searchEngine === engine);
  return value?.found === true ? (value.position ?? null) : null;
}

function searchValue(
  item: SemanticKeywordListItem,
  engine: "GOOGLE" | "YANDEX",
  field: "rankingUrl" | "observedAt"
): string | null {
  return item.positions?.find(({ searchEngine }) => searchEngine === engine)?.[field] ?? null;
}

function searchVisibility(item: SemanticKeywordListItem): number {
  const positions = item.positions?.filter(({ found, position }) => found && position !== undefined) ?? [];
  return positions.length === 0
    ? 0
    : positions.reduce((sum, { position = 100 }) => sum + Math.max(0, 101 - position), 0) / positions.length;
}

function columnHeader(
  column: SemanticSavedViewColumnKey,
  locale: "en" | "ru",
  customColumnNames: Readonly<Record<string, string>>
): string {
  const id = customColumnId(column);
  return id ? customColumnNames[id]! : HEADERS[column as keyof typeof HEADERS][locale];
}

function assertCustomColumns(
  columns: readonly SemanticSavedViewColumnKey[],
  names: Readonly<Record<string, string>>
): void {
  for (const column of columns) {
    const id = customColumnId(column);
    if (id && names[id] === undefined) throw new TypeError("Semantic export references an unavailable custom column");
  }
}

function customColumnId(column: SemanticSavedViewColumnKey): string | undefined {
  return column.startsWith("custom:") ? column.slice(7) : undefined;
}

function tabularValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  throw new TypeError("Semantic export contains an unsupported value");
}

function delimitedCell(value: string, delimiter: string, protectSpreadsheet: boolean): string {
  const safe = protectSpreadsheet && /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return safe.includes(delimiter) || safe.includes('"') || safe.includes("\r") || safe.includes("\n")
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

function exportExtension(format: CreateSemanticExportInput["format"]): string {
  if (format === "TSV") return "tsv";
  if (format === "JSON") return "json";
  if (format === "NDJSON") return "ndjson";
  if (format === "XLSX") return "xlsx";
  return "csv";
}

function exportContentType(format: CreateSemanticExportInput["format"]): string {
  if (format === "JSON") return "application/json; charset=utf-8";
  if (format === "NDJSON") return "application/x-ndjson; charset=utf-8";
  if (format === "TSV") return "text/tab-separated-values; charset=utf-8";
  if (format === "XLSX") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "text/csv; charset=utf-8";
}

function worksheetStart(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
}

function xlsxRow(
  index: number,
  values: readonly unknown[],
  columns?: readonly SemanticSavedViewColumnKey[]
): string {
  return `<row r="${index}">${values.map((value, column) =>
    xlsxCell(
      index,
      column + 1,
      value,
      columns?.[column] !== undefined &&
        XLSX_NUMERIC_COLUMNS.has(columns[column]!)
    )
  ).join("")}</row>`;
}

function xlsxCell(
  row: number,
  column: number,
  value: unknown,
  numeric = false
): string {
  const reference = `${excelColumn(column)}${row}`;
  if (value === null || value === undefined) return `<c r="${reference}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
  if (numeric && typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (numeric) {
    throw new TypeError("Semantic export contains an invalid numeric XLSX value");
  }
  if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = (Array.isArray(value) ? value.map(String).join(", ") : String(value))
    .slice(0, 32_767);
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function excelColumn(value: number): string {
  let current = value;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + current % 26) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function xml(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint === 9 || codePoint === 10 || codePoint === 13 || codePoint > 31;
    })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function workbookXml(sheetCount: number): string {
  return workbookXmlWithNames(
    Array.from({ length: sheetCount }, (_, index) =>
      sheetCount === 1 ? "Семантика" : `Семантика ${index + 1}`
    )
  );
}

function workbookXmlWithNames(names: readonly string[]): string {
  const sheets = names.map((name, index) =>
    `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
}

function workbookRelationships(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function rootRelationships(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
}

function contentTypes(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`;
}

function stylesXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>';
}

function positionHistoryStylesXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="5">' +
      '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><color rgb="FF16803A"/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><color rgb="FFDC2626"/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><color rgb="FF6F778A"/><sz val="10"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF5B3DF5"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF0EEFF"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2"><border/><border><left style="thin"><color rgb="FFE2E4EC"/></left><right style="thin"><color rgb="FFE2E4EC"/></right><top style="thin"><color rgb="FFE2E4EC"/></top><bottom style="thin"><color rgb="FFE2E4EC"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="0"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs>' +
    '</styleSheet>';
}

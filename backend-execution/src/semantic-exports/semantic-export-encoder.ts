import { Zip, ZipDeflate } from "fflate";
import type {
  CreateSemanticExportInput,
  SemanticKeywordListItem,
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
  yandexRelevantUrl: { en: "Yandex relevant URL", ru: "Релевантный URL Яндекс" },
  googleRelevantUrl: { en: "Google relevant URL", ru: "Релевантный URL Google" },
  yandexCheckedAt: { en: "Yandex checked at", ru: "Дата съёма Яндекс" },
  googleCheckedAt: { en: "Google checked at", ru: "Дата съёма Google" },
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
    case "yandexRelevantUrl": return searchValue(item, "YANDEX", "rankingUrl");
    case "googleRelevantUrl": return searchValue(item, "GOOGLE", "rankingUrl");
    case "yandexCheckedAt": return searchValue(item, "YANDEX", "observedAt");
    case "googleCheckedAt": return searchValue(item, "GOOGLE", "observedAt");
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
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<sheet name="${sheetCount === 1 ? "Семантика" : `Семантика ${index + 1}`}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
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

import { Buffer } from "node:buffer";
import type {
  CreateSemanticExportInput,
  SemanticExportDataset,
  SemanticExportDocument,
  SemanticKeywordListItem,
  SemanticSavedViewColumnKey
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const MAX_SYNCHRONOUS_EXPORT_BYTES = 32 * 1_024 * 1_024;

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

export function semanticExportDocument(
  dataset: SemanticExportDataset,
  input: CreateSemanticExportInput,
  now = new Date()
): SemanticExportDocument {
  assertCustomColumns(dataset, input.columns);
  const records = dataset.items.map((item) =>
    exportRecord(item, input.columns)
  );
  const date = now.toISOString().slice(0, 10);
  const extension = exportExtension(input.format);
  const filename = `semantic-core-${date}.${extension}`;
  const body =
    input.format === "JSON"
      ? `${JSON.stringify(records, undefined, 2)}\n`
      : input.format === "NDJSON"
        ? records.map((record) => JSON.stringify(record)).join("\n") +
          (records.length > 0 ? "\n" : "")
        : delimitedDocument(dataset, input, records);
  const bytes = Buffer.from(body, "utf8");
  if (bytes.byteLength > MAX_SYNCHRONOUS_EXPORT_BYTES) {
    throw tooLarge(
      "The generated export is larger than the synchronous download limit"
    );
  }
  return {
    format: input.format,
    filename,
    contentType: exportContentType(input.format),
    bytes,
    rowCount: records.length
  };
}

function delimitedDocument(
  dataset: SemanticExportDataset,
  input: CreateSemanticExportInput,
  records: readonly Readonly<Record<string, unknown>>[]
): string {
  const delimiter = input.format === "TSV" ? "\t" : ",";
  const protectSpreadsheet =
    input.format === "GOOGLE_CSV";
  const header = input.columns
    .map((column) =>
      delimitedCell(
        customColumnId(column)
          ? dataset.customColumnNames[customColumnId(column)!]!
          : HEADERS[column as keyof typeof HEADERS][input.locale],
        delimiter,
        false
      )
    )
    .join(delimiter);
  const lines = records.map((record) =>
    input.columns
      .map((column) =>
        delimitedCell(
          tabularValue(record[column]),
          delimiter,
          protectSpreadsheet
        )
      )
      .join(delimiter)
  );
  const bom =
    input.includeBom === true || input.format === "GOOGLE_CSV"
      ? "\uFEFF"
      : "";
  return `${bom}${[header, ...lines].join("\r\n")}\r\n`;
}

function exportRecord(
  item: SemanticKeywordListItem,
  columns: readonly SemanticSavedViewColumnKey[]
): Readonly<Record<string, unknown>> {
  const customValues = new Map(
    (item.customValues ?? []).map(({ columnId, value }) => [columnId, value])
  );
  return Object.fromEntries(
    columns.map((column) => {
      const customId = customColumnId(column);
      return [
        column,
        customId
          ? (customValues.get(customId) ?? null)
          : systemColumnValue(
              item,
              column as Exclude<
                SemanticSavedViewColumnKey,
                `custom:${string}`
              >
            )
      ] as const;
    })
  );
}

function systemColumnValue(
  item: SemanticKeywordListItem,
  column: Exclude<SemanticSavedViewColumnKey, `custom:${string}`>
): unknown {
  switch (column) {
    case "query":
      return item.textOriginal;
    case "frequency":
      return item.frequency?.value ?? null;
    case "frequencyExact":
      return item.frequencies?.find(({ type }) => type === "EXACT")?.value ?? null;
    case "frequencyFixed":
      return item.frequencies?.find(({ type }) => type === "FIXED")?.value ?? null;
    case "wordCount":
      return wordCount(item.textOriginal);
    case "yandexPosition":
      return searchPosition(item, "YANDEX");
    case "googlePosition":
      return searchPosition(item, "GOOGLE");
    case "yandexRelevantUrl":
      return searchRelevantUrl(item, "YANDEX");
    case "googleRelevantUrl":
      return searchRelevantUrl(item, "GOOGLE");
    case "yandexCheckedAt":
      return searchCheckedAt(item, "YANDEX");
    case "googleCheckedAt":
      return searchCheckedAt(item, "GOOGLE");
    case "visibility":
      return searchVisibility(item);
    case "group":
      return item.groupPath ?? null;
    case "cluster":
      return item.clusterName ?? null;
    case "targetUrl":
      return item.targetUrl ?? null;
    case "tags":
      return item.tags;
    case "intent":
      return item.intent ?? null;
    case "priority":
      return item.priority;
    case "source":
      return item.sourceMode;
    case "updatedAt":
      return item.updatedAt;
  }
}

function searchCheckedAt(
  item: SemanticKeywordListItem,
  searchEngine: "GOOGLE" | "YANDEX"
): string | null {
  return item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  )?.observedAt ?? null;
}

function searchRelevantUrl(
  item: SemanticKeywordListItem,
  searchEngine: "GOOGLE" | "YANDEX"
): string | null {
  return item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  )?.rankingUrl ?? null;
}

function searchVisibility(item: SemanticKeywordListItem): number {
  const positions = item.positions?.filter(
    ({ found, position }) => found && position !== undefined
  ) ?? [];
  if (positions.length === 0) return 0;
  return positions.reduce(
    (sum, { position = 100 }) => sum + Math.max(0, 101 - position),
    0
  ) / positions.length;
}

function wordCount(value: string): number {
  const normalized = value.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length;
}

function searchPosition(
  item: SemanticKeywordListItem,
  searchEngine: "GOOGLE" | "YANDEX"
): number | null {
  const position = item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  return position?.found === true ? (position.position ?? null) : null;
}

function tabularValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Semantic export contains an unsupported value"
  });
}

function delimitedCell(
  value: string,
  delimiter: string,
  protectSpreadsheet: boolean
): string {
  const safe =
    protectSpreadsheet && /^[=+\-@\t\r]/u.test(value)
      ? `'${value}`
      : value;
  if (
    safe.includes(delimiter) ||
    safe.includes('"') ||
    safe.includes("\r") ||
    safe.includes("\n")
  ) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

function assertCustomColumns(
  dataset: SemanticExportDataset,
  columns: readonly SemanticSavedViewColumnKey[]
): void {
  for (const column of columns) {
    const id = customColumnId(column);
    if (id && dataset.customColumnNames[id] === undefined) {
      throw new DomainError({
        statusCode: 422,
        code: "VALIDATION_FAILED",
        message: "Semantic export references an unavailable custom column",
        fieldErrors: [
          {
            path: "columns",
            code: "CUSTOM_COLUMN_UNAVAILABLE",
            message: `Custom column ${id} is unavailable`
          }
        ]
      });
    }
  }
}

function customColumnId(
  column: SemanticSavedViewColumnKey
): string | undefined {
  return column.startsWith("custom:") ? column.slice(7) : undefined;
}

function exportExtension(
  format: CreateSemanticExportInput["format"]
): string {
  if (format === "TSV") return "tsv";
  if (format === "JSON") return "json";
  if (format === "NDJSON") return "ndjson";
  return "csv";
}

function exportContentType(
  format: CreateSemanticExportInput["format"]
): string {
  if (format === "JSON") return "application/json; charset=utf-8";
  if (format === "NDJSON") {
    return "application/x-ndjson; charset=utf-8";
  }
  if (format === "TSV") {
    return "text/tab-separated-values; charset=utf-8";
  }
  return "text/csv; charset=utf-8";
}

function tooLarge(message: string): DomainError {
  return new DomainError({
    statusCode: 413,
    code: "FILE_TOO_LARGE",
    message,
    details: {
      limitBytes: MAX_SYNCHRONOUS_EXPORT_BYTES,
      asynchronousExportRequired: true
    }
  });
}

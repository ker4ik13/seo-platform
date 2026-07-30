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
  group: { en: "Group", ru: "Группа" },
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
    case "group":
      return item.groupPath ?? null;
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

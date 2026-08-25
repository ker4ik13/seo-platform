import type {
  SemanticExportFormat,
  SemanticExportJobStatus,
  SemanticExportJobSummary,
  SemanticExportScope
} from "@seo-platform/contracts";
import type { Job } from "../generated/prisma/client.js";

export function semanticExportSummary(job: Job): SemanticExportJobSummary {
  const input = record(job.inputSnapshot);
  const result = record(job.resultSummary);
  const format = exportFormat(input?.format);
  const scope = exportScope(input?.scope);
  const status = exportStatus(job.status);
  const processedRows = count(job.progressCurrent);
  const totalRows = job.progressTotal === null ? undefined : count(job.progressTotal);
  const rowCount = optionalCount(result?.rowCount);
  const filename = optionalString(result?.filename, 255);
  const contentType = optionalString(result?.contentType, 160);
  const sizeBytes = optionalDecimal(result?.sizeBytes);
  const failureCode = errorCode(job.errorSummary);
  if (!job.projectId || !format || !scope || !status) invalid();
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    format,
    scope,
    status,
    ...(job.stage ? { stage: job.stage } : {}),
    processedRows,
    ...(totalRows === undefined ? {} : { totalRows }),
    ...(rowCount === undefined ? {} : { rowCount }),
    ...(filename ? { filename } : {}),
    ...(contentType ? { contentType } : {}),
    ...(sizeBytes ? { sizeBytes } : {}),
    ...(failureCode ? { failureCode } : {}),
    version: job.version,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {})
  };
}

export function semanticExportResult(job: Job): {
  readonly objectKey: string;
  readonly filename: string;
  readonly contentType: string;
  readonly rowCount: number;
  readonly sizeBytes: string;
} | undefined {
  const result = record(job.resultSummary);
  if (!result) return undefined;
  const objectKey = optionalString(result.objectKey, 1_024);
  const filename = optionalString(result.filename, 255);
  const contentType = optionalString(result.contentType, 160);
  const rowCount = optionalCount(result.rowCount);
  const sizeBytes = optionalDecimal(result.sizeBytes);
  const input = record(job.inputSnapshot);
  const format = exportFormat(input?.format);
  const artifact = format ? artifactMetadata(format) : undefined;
  const expectedObjectKey = job.projectId && artifact && Number.isSafeInteger(job.attempt) && job.attempt >= 1
    ? `${job.workspaceId}/${job.projectId}/semantic-exports/${job.id}/attempt-${job.attempt}.${artifact.extension}`
    : undefined;
  if (
    !objectKey ||
    objectKey !== expectedObjectKey ||
    !filename ||
    !artifact ||
    !filename.endsWith(`.${artifact.extension}`) ||
    contentType !== artifact.contentType ||
    rowCount === undefined ||
    rowCount !== count(job.progressCurrent) ||
    !sizeBytes
  ) {
    return undefined;
  }
  return { objectKey, filename, contentType, rowCount, sizeBytes };
}

function artifactMetadata(format: SemanticExportFormat): {
  readonly extension: string;
  readonly contentType: string;
} {
  switch (format) {
    case "CSV":
    case "GOOGLE_CSV":
      return { extension: "csv", contentType: "text/csv; charset=utf-8" };
    case "TSV":
      return { extension: "tsv", contentType: "text/tab-separated-values; charset=utf-8" };
    case "JSON":
      return { extension: "json", contentType: "application/json; charset=utf-8" };
    case "NDJSON":
      return { extension: "ndjson", contentType: "application/x-ndjson; charset=utf-8" };
    case "XLSX":
      return {
        extension: "xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      };
  }
}

function exportFormat(value: unknown): SemanticExportFormat | undefined {
  return value === "CSV" || value === "TSV" || value === "JSON" ||
    value === "NDJSON" || value === "GOOGLE_CSV" || value === "XLSX"
    ? value
    : undefined;
}

function exportScope(value: unknown): SemanticExportScope | undefined {
  return value === "SELECTED" || value === "CURRENT_PAGE" ||
    value === "CURRENT_FILTER" || value === "GROUP_SUBTREE" ||
    value === "FOLDER_MAP" || value === "FULL_CORE"
    ? value
    : undefined;
}

function exportStatus(value: string): SemanticExportJobStatus | undefined {
  return value === "QUEUED" || value === "RUNNING" ||
    value === "CANCEL_REQUESTED" || value === "CANCELLED" ||
    value === "RETRY_SCHEDULED" || value === "COMPLETED" ||
    value === "FAILED_RETRYABLE" || value === "FAILED_FINAL"
    ? value
    : undefined;
}

function errorCode(value: unknown): string | undefined {
  const code = record(value)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
    ? code
    : undefined;
}

function count(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) invalid();
  return number;
}

function optionalCount(value: unknown): number | undefined {
  const number = typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
    ? Number(value)
    : value;
  return Number.isSafeInteger(number) && Number(number) >= 0 ? Number(number) : undefined;
}

function optionalDecimal(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
    ? value
    : undefined;
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function invalid(): never {
  throw new Error("Invalid stored semantic export");
}

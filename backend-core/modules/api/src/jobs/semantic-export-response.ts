import {
  semanticExportFormats,
  semanticExportJobStatuses,
  semanticExportScopes,
  type SemanticExportCollection,
  type SemanticExportDownload,
  type SemanticExportJobSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

export function scopedSemanticExportSummary(
  value: unknown,
  workspaceId: string,
  projectId: string,
  exportId?: string
): SemanticExportJobSummary {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "projectId",
    "format",
    "scope",
    "status",
    "stage",
    "processedRows",
    "totalRows",
    "rowCount",
    "filename",
    "contentType",
    "sizeBytes",
    "failureCode",
    "version",
    "createdAt",
    "updatedAt",
    "startedAt",
    "finishedAt"
  ]);
  if (
    !uuid(input.id) ||
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (exportId !== undefined && input.id !== exportId) ||
    !semanticExportFormats.includes(
      input.format as (typeof semanticExportFormats)[number]
    ) ||
    !semanticExportScopes.includes(
      input.scope as (typeof semanticExportScopes)[number]
    ) ||
    !semanticExportJobStatuses.includes(
      input.status as (typeof semanticExportJobStatuses)[number]
    ) ||
    !nonNegativeInteger(input.processedRows) ||
    (input.totalRows !== undefined && !nonNegativeInteger(input.totalRows)) ||
    (input.rowCount !== undefined && !nonNegativeInteger(input.rowCount)) ||
    !positiveInteger(input.version) ||
    !timestamp(input.createdAt) ||
    !timestamp(input.updatedAt) ||
    (input.startedAt !== undefined && !timestamp(input.startedAt)) ||
    (input.finishedAt !== undefined && !timestamp(input.finishedAt)) ||
    (input.stage !== undefined && !boundedString(input.stage, 64)) ||
    (input.filename !== undefined && !filename(input.filename)) ||
    (input.contentType !== undefined && !boundedString(input.contentType, 160)) ||
    (input.sizeBytes !== undefined && !decimal(input.sizeBytes)) ||
    (input.failureCode !== undefined &&
      (typeof input.failureCode !== "string" ||
        !FAILURE_CODE_PATTERN.test(input.failureCode)))
  ) {
    throw invalidResponse();
  }
  return input as unknown as SemanticExportJobSummary;
}

export function scopedSemanticExportCollection(
  value: unknown,
  workspaceId: string,
  projectId: string
): SemanticExportCollection {
  const input = exactRecord(value, ["exports"]);
  if (!Array.isArray(input.exports) || input.exports.length > 50) {
    throw invalidResponse();
  }
  return {
    exports: input.exports.map((item) =>
      scopedSemanticExportSummary(item, workspaceId, projectId)
    )
  };
}

export function semanticExportDownload(
  value: unknown
): SemanticExportDownload {
  const input = exactRecord(value, [
    "url",
    "filename",
    "contentType",
    "rowCount",
    "sizeBytes"
  ]);
  if (
    !downloadUrl(input.url) ||
    !filename(input.filename) ||
    !boundedString(input.contentType, 160) ||
    !nonNegativeInteger(input.rowCount) ||
    !decimal(input.sizeBytes)
  ) {
    throw invalidResponse();
  }
  return input as unknown as SemanticExportDownload;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    throw invalidResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function filename(value: unknown): value is string {
  return (
    boundedString(value, 255) &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint > 31 &&
        codePoint !== 127 &&
        character !== "/" &&
        character !== "\\"
      );
    })
  );
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value);
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function downloadUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid semantic export response",
    retryable: true
  });
}

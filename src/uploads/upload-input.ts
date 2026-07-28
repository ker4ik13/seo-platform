import { BadRequestException } from "@nestjs/common";
import {
  supportedImportMediaTypes,
  type CompleteUploadInput,
  type CreateUploadPartUrlsInput,
  type InternalCreateUploadInput
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/iu;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const ETAG_PATTERN = /^"?[A-Fa-f0-9]{32}(?:-\d+)?"?$/u;
const SUPPORTED_MEDIA_TYPES = new Set<string>(supportedImportMediaTypes);

export function internalCreateUploadInput(
  value: unknown,
  maxSizeBytes: number
): InternalCreateUploadInput {
  const input = record(value);
  const sizeValue = string(input, "sizeBytes");
  if (!/^[1-9]\d*$/u.test(sizeValue)) invalid("sizeBytes");
  const sizeBytes = BigInt(sizeValue);
  if (sizeBytes > BigInt(maxSizeBytes)) invalid("sizeBytes");

  const fileName = string(input, "fileName").normalize("NFC");
  if (
    fileName.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/u.test(fileName)
  ) {
    invalid("fileName");
  }
  const mediaType = string(input, "mediaType");
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) invalid("mediaType");
  const checksumValue = input.checksumSha256;
  const checksumSha256 =
    checksumValue === undefined
      ? undefined
      : string(input, "checksumSha256").toLowerCase();
  if (checksumSha256 && !CHECKSUM_PATTERN.test(checksumSha256)) {
    invalid("checksumSha256");
  }
  const idempotencyKey = string(input, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) invalid("idempotencyKey");

  return {
    workspaceId: uuid(input, "workspaceId"),
    projectId: uuid(input, "projectId"),
    actorId: uuid(input, "actorId"),
    idempotencyKey,
    fileName,
    mediaType: mediaType as InternalCreateUploadInput["mediaType"],
    sizeBytes: sizeBytes.toString(),
    ...(checksumSha256 ? { checksumSha256 } : {})
  };
}

export function createUploadPartUrlsInput(
  value: unknown
): CreateUploadPartUrlsInput {
  const input = record(value);
  const partNumbers = input.partNumbers;
  if (
    !Array.isArray(partNumbers) ||
    partNumbers.length < 1 ||
    partNumbers.length > 100 ||
    partNumbers.some(
      (part) => !Number.isInteger(part) || Number(part) < 1
    )
  ) {
    invalid("partNumbers");
  }
  const normalized = [...new Set(partNumbers as number[])];
  if (normalized.length !== partNumbers.length) invalid("partNumbers");
  return { partNumbers: normalized };
}

export function completeUploadInput(value: unknown): CompleteUploadInput {
  const input = record(value);
  if (!Array.isArray(input.parts) || input.parts.length < 1) {
    invalid("parts");
  }
  const parts = input.parts.map((value, index) => {
    const part = record(value);
    const partNumber = part.partNumber;
    const etag = part.etag;
    if (!Number.isInteger(partNumber) || Number(partNumber) < 1) {
      invalid(`parts.${index}.partNumber`);
    }
    if (typeof etag !== "string" || !ETAG_PATTERN.test(etag)) {
      invalid(`parts.${index}.etag`);
    }
    return {
      partNumber: Number(partNumber),
      etag
    };
  });
  if (new Set(parts.map(({ partNumber }) => partNumber)).size !== parts.length) {
    invalid("parts");
  }
  return { parts };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("A JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function uuid(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  const value = string(input, field);
  if (!UUID_PATTERN.test(value)) invalid(field);
  return value;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid field: ${field}`);
}

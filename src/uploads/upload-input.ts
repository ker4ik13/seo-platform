import {
  importExtensionByMediaType,
  supportedImportMediaTypes,
  type CompleteUploadInput,
  type CreateUploadInput,
  type CreateUploadPartUrlsInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { inputObject, stringField } from "../common/input.js";

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/iu;
const ETAG_PATTERN = /^"?[A-Fa-f0-9]{32}(?:-\d+)?"?$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const SUPPORTED_MEDIA_TYPES = new Set<string>(supportedImportMediaTypes);

export function createUploadInput(value: unknown): CreateUploadInput {
  const input = inputObject(value);
  const fileName = stringField(input, "fileName", {
    min: 1,
    max: 255
  }).normalize("NFC");
  if (/[\\/\u0000-\u001f\u007f]/u.test(fileName)) invalid("fileName");
  const mediaType = stringField(input, "mediaType", { min: 1, max: 255 });
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) invalid("mediaType");
  if (
    !fileName.toLowerCase().endsWith(
      importExtensionByMediaType[
        mediaType as CreateUploadInput["mediaType"]
      ]
    )
  ) {
    invalid("fileName");
  }
  const sizeBytes = stringField(input, "sizeBytes", { min: 1, max: 20 });
  if (!/^[1-9]\d*$/u.test(sizeBytes)) invalid("sizeBytes");
  const checksumSha256 =
    input.checksumSha256 === undefined
      ? undefined
      : stringField(input, "checksumSha256", {
          min: 64,
          max: 64
        }).toLowerCase();
  if (checksumSha256 && !CHECKSUM_PATTERN.test(checksumSha256)) {
    invalid("checksumSha256");
  }
  return {
    fileName,
    mediaType: mediaType as CreateUploadInput["mediaType"],
    sizeBytes: BigInt(sizeBytes).toString(),
    ...(checksumSha256 ? { checksumSha256 } : {})
  };
}

export function createUploadPartUrlsInput(
  value: unknown
): CreateUploadPartUrlsInput {
  const input = inputObject(value);
  if (
    !Array.isArray(input.partNumbers) ||
    input.partNumbers.length < 1 ||
    input.partNumbers.length > 100 ||
    input.partNumbers.some(
      (part) => !Number.isInteger(part) || Number(part) < 1
    )
  ) {
    invalid("partNumbers");
  }
  const partNumbers = input.partNumbers as number[];
  if (new Set(partNumbers).size !== partNumbers.length) invalid("partNumbers");
  return { partNumbers };
}

export function completeUploadInput(value: unknown): CompleteUploadInput {
  const input = inputObject(value);
  if (!Array.isArray(input.parts) || input.parts.length < 1) invalid("parts");
  const parts = input.parts.map((value, index) => {
    const part = inputObject(value);
    if (
      !Number.isInteger(part.partNumber) ||
      Number(part.partNumber) < 1
    ) {
      invalid(`parts.${index}.partNumber`);
    }
    if (typeof part.etag !== "string" || !ETAG_PATTERN.test(part.etag)) {
      invalid(`parts.${index}.etag`);
    }
    return {
      partNumber: Number(part.partNumber),
      etag: part.etag
    };
  });
  if (new Set(parts.map(({ partNumber }) => partNumber)).size !== parts.length) {
    invalid("parts");
  }
  return { parts };
}

export function idempotencyKey(value: string | undefined): string {
  if (!value || !IDEMPOTENCY_PATTERN.test(value)) {
    throw validationError(
      "Idempotency-Key",
      "INVALID_IDEMPOTENCY_KEY",
      "A stable idempotency key is required"
    );
  }
  return value;
}

function invalid(path: string): never {
  throw validationError(path, "INVALID_VALUE", "Invalid upload value");
}

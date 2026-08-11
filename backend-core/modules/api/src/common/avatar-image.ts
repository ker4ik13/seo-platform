import { validationError } from "./domain-error.js";
import { inputObject, stringField } from "./input.js";

export const AVATAR_IMAGE_MAX_BYTES = 512 * 1_024;
export const avatarImageContentTypes = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const;

export type AvatarImageContentType =
  (typeof avatarImageContentTypes)[number];

export interface AvatarImageInput {
  readonly contentType: AvatarImageContentType;
  readonly data: Buffer;
}

export function avatarImageInput(value: unknown): AvatarImageInput {
  const input = inputObject(value);
  const contentType = stringField(input, "contentType", {
    min: 9,
    max: 32
  });
  if (!isAvatarImageContentType(contentType)) {
    throw validationError(
      "contentType",
      "UNSUPPORTED_IMAGE_TYPE",
      "Use a PNG, JPEG or WebP image"
    );
  }
  const encoded = stringField(input, "data", { min: 4, max: 700_000 });
  if (!canonicalBase64(encoded)) {
    throw validationError(
      "data",
      "INVALID_BASE64",
      "Use canonical base64 image data"
    );
  }
  const data = Buffer.from(encoded, "base64");
  if (data.byteLength > AVATAR_IMAGE_MAX_BYTES) {
    throw validationError(
      "data",
      "FILE_TOO_LARGE",
      "Avatar must not exceed 512 KiB"
    );
  }
  if (data.byteLength < 32 || !matchesImageSignature(contentType, data)) {
    throw validationError(
      "data",
      "INVALID_IMAGE",
      "Image contents do not match its content type"
    );
  }
  return { contentType, data };
}

function isAvatarImageContentType(
  value: string
): value is AvatarImageContentType {
  return avatarImageContentTypes.some(
    (contentType) => contentType === value
  );
}

function canonicalBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value
    ) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

function matchesImageSignature(
  contentType: AvatarImageContentType,
  data: Buffer
): boolean {
  if (contentType === "image/png") {
    return data
      .subarray(0, 8)
      .equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
  }
  if (contentType === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  return (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

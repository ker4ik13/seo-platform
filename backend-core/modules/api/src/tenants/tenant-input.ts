import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  UpdateProjectInput,
  UpdateWorkspaceInput
} from "@seo-platform/contracts";
import {
  inputObject,
  optionalBooleanField,
  optionalStringField,
  stringField
} from "../common/input.js";
import { validationError } from "../common/domain-error.js";

const WORKSPACE_AVATAR_MAX_BYTES = 512 * 1_024;
const WORKSPACE_AVATAR_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const;
type WorkspaceAvatarContentType = (typeof WORKSPACE_AVATAR_CONTENT_TYPES)[number];

export interface WorkspaceAvatarInput {
  readonly contentType: WorkspaceAvatarContentType;
  readonly data: Buffer;
}

export function createWorkspaceInput(value: unknown): CreateWorkspaceInput {
  const input = inputObject(value);
  const slug = optionalStringField(input, "slug", { min: 2, max: 100 });
  const country = optionalStringField(input, "country", { min: 2, max: 2 });
  const locale = optionalStringField(input, "locale", { min: 2, max: 16 });
  const timezone = optionalStringField(input, "timezone", {
    min: 1,
    max: 64
  });
  const billingCurrency = stringField(input, "billingCurrency", {
    min: 3,
    max: 3
  }).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(billingCurrency)) {
    throw validationError(
      "billingCurrency",
      "INVALID_CURRENCY",
      "Use a three-letter ISO 4217 currency code"
    );
  }

  return {
    name: stringField(input, "name", { min: 1, max: 160 }),
    ...(slug ? { slug } : {}),
    ...(country ? { country } : {}),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    billingCurrency
  };
}

export function updateWorkspaceInput(value: unknown): UpdateWorkspaceInput {
  const input = inputObject(value);
  const name = optionalStringField(input, "name", { min: 1, max: 160 });
  const locale = optionalStringField(input, "locale", { min: 2, max: 16 });
  const timezone = optionalStringField(input, "timezone", {
    min: 1,
    max: 64
  });
  const countryValue = input.country;
  const country =
    countryValue === null
      ? null
      : optionalStringField(input, "country", { min: 2, max: 2 });

  if (
    name === undefined &&
    locale === undefined &&
    timezone === undefined &&
    country === undefined
  ) {
    throw validationError(
      "$",
      "EMPTY_UPDATE",
      "At least one field is required"
    );
  }

  return {
    ...(name ? { name } : {}),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    ...(country !== undefined ? { country } : {})
  };
}

export function updateWorkspaceAvatarInput(value: unknown): WorkspaceAvatarInput {
  const input = inputObject(value);
  const contentType = stringField(input, "contentType", { min: 9, max: 32 });
  if (!isWorkspaceAvatarContentType(contentType)) {
    throw validationError(
      "contentType",
      "UNSUPPORTED_IMAGE_TYPE",
      "Use a PNG, JPEG or WebP image"
    );
  }
  const encoded = stringField(input, "data", { min: 4, max: 700_000 });
  if (!canonicalBase64(encoded)) {
    throw validationError("data", "INVALID_BASE64", "Use canonical base64 image data");
  }
  const data = Buffer.from(encoded, "base64");
  if (data.byteLength > WORKSPACE_AVATAR_MAX_BYTES) {
    throw validationError("data", "FILE_TOO_LARGE", "Avatar must not exceed 512 KiB");
  }
  if (data.byteLength < 32 || !matchesImageSignature(contentType, data)) {
    throw validationError("data", "INVALID_IMAGE", "Image contents do not match its content type");
  }
  return {
    contentType,
    data
  };
}

function isWorkspaceAvatarContentType(
  value: string
): value is WorkspaceAvatarContentType {
  return WORKSPACE_AVATAR_CONTENT_TYPES.some((contentType) => contentType === value);
}

function canonicalBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

function matchesImageSignature(contentType: string, data: Buffer): boolean {
  if (contentType === "image/png") {
    return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  return data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP";
}

export function createProjectInput(value: unknown): CreateProjectInput {
  const input = inputObject(value);
  const slug = optionalStringField(input, "slug", { min: 2, max: 100 });
  const locale = optionalStringField(input, "locale", { min: 2, max: 16 });
  const timezone = optionalStringField(input, "timezone", {
    min: 1,
    max: 64
  });
  const confirmDuplicateDomain = optionalBooleanField(
    input,
    "confirmDuplicateDomain"
  );

  return {
    name: stringField(input, "name", { min: 1, max: 160 }),
    ...(slug ? { slug } : {}),
    domain: stringField(input, "domain", { min: 3, max: 255 }),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    ...(confirmDuplicateDomain === undefined
      ? {}
      : { confirmDuplicateDomain })
  };
}

export function updateProjectInput(value: unknown): UpdateProjectInput {
  const input = inputObject(value);
  const name = optionalStringField(input, "name", { min: 1, max: 160 });
  const domain = optionalStringField(input, "domain", { min: 3, max: 255 });
  const locale = optionalStringField(input, "locale", { min: 2, max: 16 });
  const timezone = optionalStringField(input, "timezone", {
    min: 1,
    max: 64
  });
  const confirmDuplicateDomain = optionalBooleanField(
    input,
    "confirmDuplicateDomain"
  );

  if (!name && !domain && !locale && !timezone) {
    throw validationError(
      "$",
      "EMPTY_UPDATE",
      "At least one field is required"
    );
  }
  return {
    ...(name ? { name } : {}),
    ...(domain ? { domain } : {}),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    ...(confirmDuplicateDomain === undefined
      ? {}
      : { confirmDuplicateDomain })
  };
}

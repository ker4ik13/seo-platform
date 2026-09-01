import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  DeleteProjectInput,
  ProjectLogoContentType,
  ProjectSearchCity,
  ReorderProjectsInput,
  UpdateProjectInput,
  UpdateWorkspaceInput
} from "@seo-platform/contracts";
import { projectLogoContentTypes } from "@seo-platform/contracts";
import {
  inputObject,
  optionalBooleanField,
  optionalStringField,
  stringField
} from "../common/input.js";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import {
  avatarImageInput,
  type AvatarImageInput
} from "../common/avatar-image.js";
import {
  detectedProjectLogoContentType,
  PROJECT_LOGO_MAX_BYTES
} from "./project-logo-image.js";

export type WorkspaceAvatarInput = AvatarImageInput;

export interface ProjectLogoInput {
  readonly contentType: ProjectLogoContentType;
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
  return avatarImageInput(value);
}

export function updateProjectLogoInput(value: unknown): ProjectLogoInput {
  const input = inputObject(value);
  const contentType = stringField(input, "contentType", { min: 9, max: 32 });
  if (!isProjectLogoContentType(contentType)) {
    throw validationError(
      "contentType",
      "UNSUPPORTED_IMAGE_TYPE",
      "Use an SVG, PNG, JPEG, WebP, ICO, GIF or AVIF image"
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
  if (data.byteLength > PROJECT_LOGO_MAX_BYTES) {
    throw validationError(
      "data",
      "FILE_TOO_LARGE",
      "Project logo must not exceed 512 KiB"
    );
  }
  if (
    data.byteLength < 32 ||
    detectedProjectLogoContentType(data) !== contentType
  ) {
    throw validationError(
      "data",
      "INVALID_IMAGE",
      "Image contents do not match its content type or are unsafe"
    );
  }
  return { contentType, data };
}

function isProjectLogoContentType(
  value: string
): value is ProjectLogoContentType {
  return projectLogoContentTypes.some((contentType) => contentType === value);
}

function canonicalBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
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
  const searchCity = optionalProjectSearchCity(input.searchCity);

  return {
    name: stringField(input, "name", { min: 1, max: 160 }),
    ...(slug ? { slug } : {}),
    domain: stringField(input, "domain", { min: 3, max: 255 }),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    ...(searchCity ? { searchCity } : {}),
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
  const searchCity = input.searchCity === undefined
    ? undefined
    : input.searchCity === null
      ? null
      : projectSearchCity(input.searchCity);

  if (!name && !domain && !locale && !timezone && searchCity === undefined) {
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
    ...(searchCity !== undefined ? { searchCity } : {}),
    ...(confirmDuplicateDomain === undefined
      ? {}
      : { confirmDuplicateDomain })
  };
}

function optionalProjectSearchCity(value: unknown): ProjectSearchCity | undefined {
  return value === undefined || value === null
    ? undefined
    : projectSearchCity(value);
}

function projectSearchCity(value: unknown): ProjectSearchCity {
  const input = inputObject(value);
  const yandexRegionCode = stringField(input, "yandexRegionCode", {
    min: 1,
    max: 16
  });
  const googleRegionCode = stringField(input, "googleRegionCode", {
    min: 1,
    max: 16
  });
  if (!/^\d{1,10}$/u.test(yandexRegionCode)) {
    throw validationError(
      "searchCity.yandexRegionCode",
      "INVALID_REGION_CODE",
      "Use a numeric Yandex region code"
    );
  }
  if (!/^\d{1,10}$/u.test(googleRegionCode)) {
    throw validationError(
      "searchCity.googleRegionCode",
      "INVALID_REGION_CODE",
      "Use a numeric Google region code"
    );
  }
  return {
    name: stringField(input, "name", { min: 1, max: 160 }),
    yandexRegionCode,
    googleRegionCode
  };
}

export function deleteProjectInput(value: unknown): DeleteProjectInput {
  const input = inputObject(value);
  return {
    confirmation: stringField(input, "confirmation", { min: 1, max: 160 })
  };
}

export function reorderProjectsInput(value: unknown): ReorderProjectsInput {
  const input = inputObject(value);
  if (
    Object.keys(input).length !== 2 ||
    !("expectedProjectIds" in input) ||
    !("projectIds" in input)
  ) {
    throw validationError(
      "$",
      "INVALID_FIELDS",
      "Only expectedProjectIds and projectIds are allowed"
    );
  }
  return {
    expectedProjectIds: projectIdList(
      input.expectedProjectIds,
      "expectedProjectIds"
    ),
    projectIds: projectIdList(input.projectIds, "projectIds")
  };
}

function projectIdList(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw validationError(path, "ARRAY_REQUIRED", "An array is required");
  }
  const ids = value.map((projectId, index) =>
    assertUuid(projectId, `${path}.${index}`)
  );
  if (new Set(ids).size !== ids.length) {
    throw validationError(
      path,
      "DUPLICATE_PROJECT",
      "Project IDs must be unique"
    );
  }
  return ids;
}

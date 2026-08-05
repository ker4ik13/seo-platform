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

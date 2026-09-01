import {
  apiTokenScopes,
  type ApiTokenScope,
  type CreateApiTokenInput,
  type UpdateApiTokenInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

export function createApiTokenInput(value: unknown): CreateApiTokenInput {
  return apiTokenInput(value);
}

export function updateApiTokenInput(value: unknown): UpdateApiTokenInput {
  return apiTokenInput(value);
}

export function assertEmptyApiTokenActionInput(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    invalid("body");
  }
}

function apiTokenInput(value: unknown): CreateApiTokenInput {
  const input = exactRecord(value, [
    "name",
    "scopes",
    "allProjects",
    "projectIds",
    "expiresAt"
  ]);
  const name = text(input.name, "name").normalize("NFC");
  if (
    name.length > 100 ||
    // oxlint-disable-next-line no-control-regex -- API token names are displayed in security UI.
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    invalid("name");
  }
  const scopes = scopeList(input.scopes);
  const allProjects = boolean(input.allProjects, "allProjects");
  const projectIds = uuidList(input.projectIds, "projectIds");
  if (
    (allProjects && projectIds.length !== 0) ||
    (!allProjects && projectIds.length === 0)
  ) {
    invalid("projectIds");
  }
  const expiresAt = nullableIso(input.expiresAt, "expiresAt");
  return { name, scopes, allProjects, projectIds, expiresAt };
}

function scopeList(value: unknown): readonly ApiTokenScope[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > apiTokenScopes.length ||
    value.some(
      (scope) =>
        typeof scope !== "string" ||
        !(apiTokenScopes as readonly string[]).includes(scope)
    ) ||
    new Set(value).size !== value.length
  ) {
    invalid("scopes");
  }
  const set = new Set(value);
  return apiTokenScopes.filter((scope) => set.has(scope));
}

function uuidList(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) invalid(path);
  const result = value.map((item, index) =>
    assertUuid(item, `${path}.${index}`)
  );
  if (new Set(result).size !== result.length) invalid(path);
  return result;
}

function nullableIso(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    invalid(path);
  }
  return new Date(value).toISOString();
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !(field in input)) ||
    Object.keys(input).some((field) => !fields.includes(field))
  ) {
    invalid("body");
  }
  return input;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path);
  return value.trim();
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function invalid(path: string): never {
  throw validationError(path, "INVALID_FIELD", `Invalid field: ${path}`);
}

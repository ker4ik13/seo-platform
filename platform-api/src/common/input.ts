import { validationError } from "./domain-error.js";

export type InputObject = Readonly<Record<string, unknown>>;

export function inputObject(value: unknown): InputObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError("$", "OBJECT_REQUIRED", "A JSON object is required");
  }

  return value as InputObject;
}

export function stringField(
  input: InputObject,
  field: string,
  options: { readonly min: number; readonly max: number }
): string {
  const value = input[field];
  if (typeof value !== "string") {
    throw validationError(field, "STRING_REQUIRED", "A string is required");
  }

  const normalized = value.trim();
  if (normalized.length < options.min) {
    throw validationError(
      field,
      "TOO_SHORT",
      `Must contain at least ${options.min} characters`
    );
  }
  if (normalized.length > options.max) {
    throw validationError(
      field,
      "TOO_LONG",
      `Must contain at most ${options.max} characters`
    );
  }

  return normalized;
}

export function optionalStringField(
  input: InputObject,
  field: string,
  options: { readonly min: number; readonly max: number }
): string | undefined {
  const value = input[field];
  if (value === undefined || value === null || value === "") return undefined;
  return stringField(input, field, options);
}

export function booleanField(input: InputObject, field: string): boolean {
  const value = input[field];
  if (typeof value !== "boolean") {
    throw validationError(field, "BOOLEAN_REQUIRED", "A boolean is required");
  }
  return value;
}

export function optionalBooleanField(
  input: InputObject,
  field: string
): boolean | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  return booleanField(input, field);
}

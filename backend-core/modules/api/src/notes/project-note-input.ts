import {
  projectNoteVisibilities,
  type CreateProjectNoteInput,
  type ProjectNoteVisibility,
  type UpdateProjectNoteInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const VISIBILITIES = new Set<string>(projectNoteVisibilities);

export function createProjectNoteInput(
  value: unknown
): CreateProjectNoteInput {
  const input = record(value, ["title", "markdown", "visibility"]);
  return {
    title: text(input.title, "title", 160, false),
    markdown: text(input.markdown, "markdown", 100_000, true),
    visibility: visibility(input.visibility)
  };
}

export function updateProjectNoteInput(
  value: unknown
): UpdateProjectNoteInput {
  const input = record(value, ["title", "markdown", "visibility"]);
  const title = optionalText(input.title, "title", 160, false);
  const markdown = optionalText(input.markdown, "markdown", 100_000, true);
  const nextVisibility =
    input.visibility === undefined ? undefined : visibility(input.visibility);
  if (
    title === undefined &&
    markdown === undefined &&
    nextVisibility === undefined
  ) {
    invalid("body");
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(markdown === undefined ? {} : { markdown }),
    ...(nextVisibility === undefined
      ? {}
      : { visibility: nextVisibility })
  };
}

export function projectNoteToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{40,64}$/u.test(value)) invalid("token");
  return value;
}

function record(
  value: unknown,
  allowed: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid("body");
  return input;
}

function visibility(value: unknown): ProjectNoteVisibility {
  if (typeof value !== "string" || !VISIBILITIES.has(value)) {
    invalid("visibility");
  }
  return value as ProjectNoteVisibility;
}

function text(
  value: unknown,
  field: string,
  max: number,
  allowEmpty: boolean
): string {
  if (typeof value !== "string" || value.length > max) invalid(field);
  const normalized = value.normalize("NFKC").trim();
  if (!allowEmpty && !normalized) invalid(field);
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  max: number,
  allowEmpty: boolean
): string | undefined {
  return value === undefined ? undefined : text(value, field, max, allowEmpty);
}

function invalid(field: string): never {
  throw validationError(field, "INVALID_PROJECT_NOTE", "Invalid project note input");
}

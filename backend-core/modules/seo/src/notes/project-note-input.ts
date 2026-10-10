import { BadRequestException } from "@nestjs/common";
import {
  projectNoteVisibilities,
  projectNoteFormat,
  projectNoteDelimiter,
  type InternalCreateProjectNoteInput,
  type InternalDeleteProjectNoteInput,
  type InternalUpdateProjectNoteInput,
  type ProjectNoteVisibility
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const VISIBILITIES = new Set<string>(projectNoteVisibilities);

export function internalCreateProjectNoteInput(
  value: unknown
): InternalCreateProjectNoteInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "title",
    "markdown",
    "visibility",
    "format",
    "delimiter"
  ]);
  return {
    ...scope(input),
    title: text(input.title, "title", 160, false),
    markdown: text(input.markdown, "markdown", undefined, true),
    visibility: visibility(input.visibility),
    format: noteFormat(input.format),
    ...delimiterInput(input.delimiter, noteFormat(input.format))
  };
}

export function internalUpdateProjectNoteInput(
  value: unknown
): InternalUpdateProjectNoteInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version",
    "title",
    "markdown",
    "visibility",
    "format",
    "delimiter"
  ]);
  const title = optionalText(input.title, "title", 160, false);
  const markdown = optionalText(input.markdown, "markdown", undefined, true);
  const nextVisibility =
    input.visibility === undefined ? undefined : visibility(input.visibility);
  if (
    title === undefined &&
    markdown === undefined &&
    nextVisibility === undefined &&
    input.format === undefined &&
    input.delimiter === undefined
  ) {
    invalid("body");
  }
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    ...(input.format === undefined ? {} : { format: noteFormat(input.format) }),
    ...delimiterInput(input.delimiter, input.format === undefined ? undefined : noteFormat(input.format)),
    ...(title === undefined ? {} : { title }),
    ...(markdown === undefined ? {} : { markdown }),
    ...(nextVisibility === undefined
      ? {}
      : { visibility: nextVisibility })
  };
}

export function internalDeleteProjectNoteInput(
  value: unknown
): InternalDeleteProjectNoteInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
  };
}

export function publicNoteToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{40,64}$/u.test(value)) invalid("token");
  return value;
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: internalUuid(
      requiredString(input.workspaceId, "workspaceId"),
      "workspaceId"
    ),
    projectId: internalUuid(
      requiredString(input.projectId, "projectId"),
      "projectId"
    ),
    actorId: internalUuid(
      requiredString(input.actorId, "actorId"),
      "actorId"
    )
  };
}

function visibility(value: unknown): ProjectNoteVisibility {
  if (typeof value !== "string" || !VISIBILITIES.has(value)) {
    invalid("visibility");
  }
  return value as ProjectNoteVisibility;
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function text(
  value: unknown,
  field: string,
  max: number | undefined,
  allowEmpty: boolean
): string {
  if (
    typeof value !== "string" ||
    (max !== undefined && value.length > max)
  ) invalid(field);
  const normalized = allowEmpty ? value : value.normalize("NFKC").trim();
  if (!allowEmpty && !normalized) invalid(field);
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  max: number | undefined,
  allowEmpty: boolean
): string | undefined {
  return value === undefined ? undefined : text(value, field, max, allowEmpty);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid project note field: ${field}`);
}

function noteFormat(value: unknown) {
  try { return projectNoteFormat(value); } catch { return invalid("format"); }
}

function delimiterInput(value: unknown, format?: string) {
  if (value === undefined) return {};
  try {
    const delimiter = projectNoteDelimiter(value);
    if (delimiter !== undefined && format !== undefined && format !== "CSV") return invalid("delimiter");
    return { delimiter: delimiter ?? null };
  } catch { return invalid("delimiter"); }
}

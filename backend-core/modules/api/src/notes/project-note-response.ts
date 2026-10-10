import { projectNoteFormat, projectNoteDelimiter } from "@seo-platform/contracts";
import type {
  ProjectNoteCollection,
  ProjectNoteSummary,
  ProjectNoteVisibility,
  PublicProjectNote
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

export function projectNoteCollection(value: unknown): ProjectNoteCollection {
  const input = object(value);
  if (!input || !Array.isArray(input.notes)) invalid();
  return { notes: input.notes.map((note) => projectNote(note)) };
}

export function projectNote(
  value: unknown,
  scope?: Readonly<{ workspaceId: string; projectId: string; noteId?: string }>
): ProjectNoteSummary {
  const input = object(value);
  if (
    !input ||
    !nonEmptyString(input.id) ||
    !nonEmptyString(input.workspaceId) ||
    !nonEmptyString(input.projectId) ||
    !nonEmptyString(input.title) ||
    typeof input.markdown !== "string" ||
    !["PROJECT_MEMBERS", "PUBLIC"].includes(String(input.visibility)) ||
    (input.publicToken !== undefined && !nonEmptyString(input.publicToken)) ||
    !nonEmptyString(input.createdBy) ||
    !nonEmptyString(input.updatedBy) ||
    !Number.isSafeInteger(input.version) ||
    Number(input.version) < 1 ||
    !dateString(input.createdAt) ||
    !dateString(input.updatedAt) ||
    (scope &&
      (input.workspaceId !== scope.workspaceId ||
        input.projectId !== scope.projectId ||
        (scope.noteId !== undefined && input.id !== scope.noteId)))
  ) {
    invalid();
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    title: input.title,
    format: noteFormat(input.format),
    ...delimiterResponse(input.delimiter, noteFormat(input.format)),
    markdown: input.markdown,
    visibility: input.visibility as ProjectNoteVisibility,
    ...(typeof input.publicToken === "string"
      ? { publicToken: input.publicToken }
      : {}),
    createdBy: input.createdBy,
    updatedBy: input.updatedBy,
    version: Number(input.version),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function publicProjectNote(value: unknown): PublicProjectNote {
  const input = object(value);
  if (
    !input ||
    !nonEmptyString(input.title) ||
    typeof input.markdown !== "string" ||
    !dateString(input.updatedAt)
  ) {
    invalid();
  }
  return {
    title: input.title,
    format: noteFormat(input.format),
    ...delimiterResponse(input.delimiter, noteFormat(input.format)),
    markdown: input.markdown,
    updatedAt: input.updatedAt
  };
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function dateString(value: unknown): value is string {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data service returned an invalid project note response",
    retryable: true
  });
}

function noteFormat(value: unknown) {
  try { return projectNoteFormat(value); } catch { return invalid(); }
}

function delimiterResponse(value: unknown, format: string) {
  try {
    const delimiter = projectNoteDelimiter(value);
    if (delimiter !== undefined && format !== "CSV") return invalid();
    return delimiter === undefined ? {} : { delimiter };
  } catch { return invalid(); }
}

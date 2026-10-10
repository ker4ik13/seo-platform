export const projectNoteFormats = ["MARKDOWN", "TEXT", "CSV", "TSV", "JSON"] as const;
export type ProjectNoteFormat = (typeof projectNoteFormats)[number];

export function projectNoteFormat(value: unknown): ProjectNoteFormat {
  if (value === undefined) return "MARKDOWN";
  if (typeof value !== "string" || !projectNoteFormats.includes(value as ProjectNoteFormat)) throw new TypeError("Invalid project note format");
  return value as ProjectNoteFormat;
}

/** Один Unicode-символ; кавычки, управляющие символы и surrogate запрещены. */
export function projectNoteDelimiter(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || [...value].length !== 1 || /["\p{Cc}\p{Cs}]/u.test(value)) throw new TypeError("Invalid CSV delimiter");
  return value;
}

export const projectNoteVisibilities = [
  "PROJECT_MEMBERS",
  "PUBLIC"
] as const;

export type ProjectNoteVisibility =
  (typeof projectNoteVisibilities)[number];

export interface ProjectNoteSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly title: string;
  readonly markdown: string;
  readonly format: ProjectNoteFormat;
  readonly delimiter?: string;
  readonly visibility: ProjectNoteVisibility;
  /** Opaque bearer token. It is returned only to authorized project members. */
  readonly publicToken?: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectNoteCollection {
  readonly notes: readonly ProjectNoteSummary[];
}

export interface CreateProjectNoteInput {
  readonly title: string;
  readonly format?: ProjectNoteFormat;
  readonly delimiter?: string | null;
  readonly markdown: string;
  readonly visibility: ProjectNoteVisibility;
}

export interface UpdateProjectNoteInput {
  readonly title?: string;
  readonly format?: ProjectNoteFormat;
  readonly delimiter?: string | null;
  readonly markdown?: string;
  readonly visibility?: ProjectNoteVisibility;
}

export interface InternalCreateProjectNoteInput
  extends CreateProjectNoteInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalUpdateProjectNoteInput
  extends UpdateProjectNoteInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteProjectNoteInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface PublicProjectNote {
  readonly title: string;
  readonly format: ProjectNoteFormat;
  readonly delimiter?: string;
  readonly markdown: string;
  readonly updatedAt: string;
}

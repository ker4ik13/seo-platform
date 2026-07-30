import {
  assignableWorkspaceRoleCodes,
  projectAccessLevels,
  type AcceptWorkspaceInviteInput,
  type AssignableWorkspaceRoleCode,
  type CreateWorkspaceInviteInput,
  type ProjectAccessAssignment,
  type ProjectAccessLevel,
  type UpdateWorkspaceMemberInput,
  type WorkspaceInviteListQuery,
  workspaceInviteListStatuses,
  type WorkspaceInviteListStatus,
  type WorkspaceTeamListQuery
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";
import {
  booleanField,
  inputObject,
  optionalStringField,
  stringField,
  type InputObject
} from "../common/input.js";
import { validationError } from "../common/domain-error.js";

const MAX_PROJECT_OVERRIDES = 2_000;
const DEFAULT_TEAM_LIST_LIMIT = 50;
const MAX_TEAM_LIST_LIMIT = 100;
const TEAM_CURSOR_PATTERN = /^[A-Za-z0-9_-]{40,1024}$/u;

export function workspaceMemberListQuery(
  value: unknown
): WorkspaceTeamListQuery {
  return teamListQuery(value, false);
}

export function workspaceInviteListQuery(
  value: unknown
): WorkspaceInviteListQuery {
  const query = teamListQuery(value, true);
  const record = value as Readonly<Record<string, unknown>>;
  const rawStatus = optionalSingleQueryString(record.status, "status");
  const status = rawStatus ?? "ALL";
  if (
    !workspaceInviteListStatuses.includes(
      status as WorkspaceInviteListStatus
    )
  ) {
    throw validationError(
      "status",
      "INVALID_FILTER",
      "Invitation status must be PENDING or ALL"
    );
  }
  return {
    ...query,
    status: status as WorkspaceInviteListStatus
  };
}

export function createWorkspaceInviteInput(
  value: unknown
): CreateWorkspaceInviteInput {
  const input = inputObject(value);
  const message = optionalStringField(input, "message", {
    min: 1,
    max: 2_000
  });
  const expiresInDays = optionalInteger(input, "expiresInDays", 1, 30);

  return {
    email: stringField(input, "email", { min: 3, max: 320 }),
    roleCode: assignableRole(input),
    allProjects: booleanField(input, "allProjects"),
    projectAccesses: projectAccessAssignments(input),
    ...(message ? { message } : {}),
    ...(expiresInDays ? { expiresInDays } : {})
  };
}

export function updateWorkspaceMemberInput(
  value: unknown
): UpdateWorkspaceMemberInput {
  const input = inputObject(value);
  return {
    roleCode: assignableRole(input),
    allProjects: booleanField(input, "allProjects"),
    projectAccesses: projectAccessAssignments(input)
  };
}

export function acceptWorkspaceInviteInput(
  value: unknown
): AcceptWorkspaceInviteInput {
  const input = inputObject(value);
  return {
    token: stringField(input, "token", { min: 40, max: 4_096 })
  };
}

function assignableRole(input: InputObject): AssignableWorkspaceRoleCode {
  const roleCode = stringField(input, "roleCode", { min: 2, max: 64 });
  if (
    !assignableWorkspaceRoleCodes.includes(
      roleCode as AssignableWorkspaceRoleCode
    )
  ) {
    throw validationError(
      "roleCode",
      "INVALID_ROLE",
      "Use an assignable workspace role"
    );
  }
  return roleCode as AssignableWorkspaceRoleCode;
}

function projectAccessAssignments(
  input: InputObject
): readonly ProjectAccessAssignment[] {
  const value = input.projectAccesses;
  if (!Array.isArray(value)) {
    throw validationError(
      "projectAccesses",
      "ARRAY_REQUIRED",
      "An array is required"
    );
  }
  if (value.length > MAX_PROJECT_OVERRIDES) {
    throw validationError(
      "projectAccesses",
      "TOO_MANY_ITEMS",
      `At most ${MAX_PROJECT_OVERRIDES} project overrides are allowed`
    );
  }

  const seen = new Set<string>();
  const assignments = value.map((item, index) => {
    const assignment = inputObject(item);
    const projectId = stringField(assignment, "projectId", {
      min: 36,
      max: 36
    });
    assertUuid(projectId, `projectAccesses.${index}.projectId`);
    if (seen.has(projectId)) {
      throw validationError(
        `projectAccesses.${index}.projectId`,
        "DUPLICATE",
        "A project can only appear once"
      );
    }
    seen.add(projectId);

    const rawLevel = stringField(assignment, "level", {
      min: 4,
      max: 16
    });
    if (
      !projectAccessLevels.includes(rawLevel as ProjectAccessLevel)
    ) {
      throw validationError(
        `projectAccesses.${index}.level`,
        "INVALID_PROJECT_ACCESS_LEVEL",
        "Use NONE, VIEWER, MEMBER or MANAGER"
      );
    }
    return {
      projectId,
      level: rawLevel as ProjectAccessLevel
    };
  });

  const allProjects = booleanField(input, "allProjects");
  if (
    !allProjects &&
    !assignments.some(({ level }) => level !== "NONE")
  ) {
    throw validationError(
      "projectAccesses",
      "PROJECT_ACCESS_REQUIRED",
      "Select at least one accessible project"
    );
  }

  return assignments;
}

function optionalInteger(
  input: InputObject,
  field: string,
  min: number,
  max: number
): number | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw validationError(
      field,
      "INTEGER_OUT_OF_RANGE",
      `Use an integer from ${min} to ${max}`
    );
  }
  return value as number;
}

function teamListQuery(
  value: unknown,
  allowStatus: boolean
): WorkspaceTeamListQuery {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw validationError(
      "query",
      "OBJECT_REQUIRED",
      "Team list query must be an object"
    );
  }
  const query = value as Readonly<Record<string, unknown>>;
  const unsupported = Object.keys(query).find(
    (key) =>
      key !== "limit" &&
      key !== "cursor" &&
      !(allowStatus && key === "status")
  );
  if (unsupported) {
    throw validationError(
      unsupported,
      "UNKNOWN_QUERY_PARAMETER",
      "Unknown team list query parameter"
    );
  }

  const rawLimit = optionalSingleQueryString(query.limit, "limit");
  const cursor = optionalSingleQueryString(query.cursor, "cursor");
  const limit =
    rawLimit === undefined ? DEFAULT_TEAM_LIST_LIMIT : Number(rawLimit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_TEAM_LIST_LIMIT
  ) {
    throw validationError(
      "limit",
      "OUT_OF_RANGE",
      `Team list limit must be an integer between 1 and ${MAX_TEAM_LIST_LIMIT}`
    );
  }
  if (cursor !== undefined && !TEAM_CURSOR_PATTERN.test(cursor)) {
    throw validationError(
      "cursor",
      "INVALID_CURSOR",
      "Team list cursor is invalid"
    );
  }
  return {
    limit,
    ...(cursor === undefined ? {} : { cursor })
  };
}

function optionalSingleQueryString(
  value: unknown,
  path: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(
      path,
      "SINGLE_VALUE_REQUIRED",
      "Query parameter must be a single non-empty string"
    );
  }
  return value.trim();
}

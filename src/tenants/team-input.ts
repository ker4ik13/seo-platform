import {
  assignableWorkspaceRoleCodes,
  projectAccessLevels,
  type AcceptWorkspaceInviteInput,
  type AssignableWorkspaceRoleCode,
  type CreateWorkspaceInviteInput,
  type ProjectAccessAssignment,
  type ProjectAccessLevel,
  type UpdateWorkspaceMemberInput
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

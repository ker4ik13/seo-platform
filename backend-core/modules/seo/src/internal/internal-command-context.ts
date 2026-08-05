import { BadRequestException } from "@nestjs/common";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface InternalCommandContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export function internalCommandContext(
  headers: Readonly<Record<string, string | string[] | undefined>>
): InternalCommandContext {
  return {
    workspaceId: internalUuid(
      internalHeader(headers, "x-workspace-id"),
      "workspaceId"
    ),
    projectId: internalUuid(
      internalHeader(headers, "x-project-id"),
      "projectId"
    ),
    actorId: internalUuid(
      internalHeader(headers, "x-actor-id"),
      "actorId"
    )
  };
}

export function assertInternalContext(
  expected: InternalCommandContext,
  actual: InternalCommandContext
): void {
  if (
    expected.workspaceId !== actual.workspaceId ||
    expected.projectId !== actual.projectId ||
    expected.actorId !== actual.actorId
  ) {
    throw new BadRequestException(
      "Trusted internal context does not match the command"
    );
  }
}

export function internalUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(
      `Invalid trusted internal identifier: ${field}`
    );
  }
  return value.toLowerCase();
}

function internalHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string
): string {
  const value = headers[name];
  if (typeof value !== "string") {
    throw new BadRequestException(`Missing trusted internal header: ${name}`);
  }
  return value;
}

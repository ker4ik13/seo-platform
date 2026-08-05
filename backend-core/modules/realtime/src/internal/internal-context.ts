import { BadRequestException } from "@nestjs/common";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

export interface InternalActorContext {
  readonly actorId: string;
}

export interface InternalWebPushContext extends InternalActorContext {
  readonly sessionFamilyId: string;
}

export interface InternalProjectContext extends InternalActorContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
}

export function internalActorContext(
  headers: InternalHeaders
): InternalActorContext {
  return {
    actorId: internalUuid(
      internalHeader(headers, "x-actor-id"),
      "actorId"
    )
  };
}

export function internalProjectContext(
  headers: InternalHeaders
): InternalProjectContext {
  return {
    ...internalActorContext(headers),
    workspaceId: internalUuid(
      internalHeader(headers, "x-workspace-id"),
      "workspaceId"
    ),
    projectId: internalUuid(
      internalHeader(headers, "x-project-id"),
      "projectId"
    ),
    membershipId: internalUuid(
      internalHeader(headers, "x-membership-id"),
      "membershipId"
    ),
    membershipVersion: internalPositiveInteger(
      internalHeader(headers, "x-membership-version"),
      "membershipVersion"
    )
  };
}

export function internalWebPushContext(
  headers: InternalHeaders
): InternalWebPushContext {
  return {
    ...internalActorContext(headers),
    sessionFamilyId: internalUuid(
      internalHeader(headers, "x-session-family-id"),
      "sessionFamilyId"
    )
  };
}

export function internalUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(
      `Invalid trusted internal identifier: ${field}`
    );
  }
  return value;
}

function internalPositiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException(
      `Invalid trusted internal integer: ${field}`
    );
  }
  return parsed;
}

function internalHeader(headers: InternalHeaders, name: string): string {
  const value = headers[name];
  if (typeof value !== "string") {
    throw new BadRequestException(
      `Missing trusted internal header: ${name}`
    );
  }
  return value;
}

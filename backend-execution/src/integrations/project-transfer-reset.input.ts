import { BadRequestException } from "@nestjs/common";
import type { InternalProjectWorkspaceTransferInput } from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const FIELDS = [
  "workspaceId",
  "projectId",
  "actorId",
  "destinationWorkspaceId"
] as const;

export function internalProjectTransferResetInput(
  value: unknown
): InternalProjectWorkspaceTransferInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Project transfer reset body must be an object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== FIELDS.length ||
    FIELDS.some((field) => !Object.hasOwn(input, field))
  ) {
    throw new BadRequestException("Project transfer reset body has invalid fields");
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    destinationWorkspaceId: uuid(
      input.destinationWorkspaceId,
      "destinationWorkspaceId"
    )
  };
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new BadRequestException(`Invalid trusted internal identifier: ${field}`);
  }
  return internalUuid(value, field);
}

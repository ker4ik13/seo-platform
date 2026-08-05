import { BadRequestException } from "@nestjs/common";
import type { InternalRankEstimateScopeQuery } from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const INPUT_FIELDS = [
  "workspaceId",
  "projectId",
  "actorId",
  "trackingContextId"
] as const;

export function internalRankEstimateScopeInput(
  value: unknown
): InternalRankEstimateScopeQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidBody();
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).length !== INPUT_FIELDS.length ||
    Object.keys(input).some(
      (field) => !INPUT_FIELDS.includes(field as (typeof INPUT_FIELDS)[number])
    )
  ) {
    invalidBody();
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    trackingContextId: uuid(
      input.trackingContextId,
      "trackingContextId"
    )
  };
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new BadRequestException(`Invalid internal rank scope ${field}`);
  }
  return internalUuid(value, field);
}

function invalidBody(): never {
  throw new BadRequestException("Invalid internal rank estimate scope body");
}

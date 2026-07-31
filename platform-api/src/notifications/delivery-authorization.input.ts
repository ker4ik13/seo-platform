import { BadRequestException } from "@nestjs/common";
import type { InternalAuthorizeProjectNotificationDeliveryInput } from "@seo-platform/contracts";
import { projectNotificationEventTypes } from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";

const INPUT_KEYS = [
  "userId",
  "workspaceId",
  "projectId",
  "membershipId",
  "membershipVersion",
  "eventType",
  "permission"
] as const;

export function deliveryAuthorizationInput(
  value: unknown
): InternalAuthorizeProjectNotificationDeliveryInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== INPUT_KEYS.length ||
    Object.keys(value).some((key) => !INPUT_KEYS.includes(
      key as (typeof INPUT_KEYS)[number]
    ))
  ) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    !Number.isSafeInteger(input.membershipVersion) ||
    Number(input.membershipVersion) < 1 ||
    !projectNotificationEventTypes.includes(
      input.eventType as (typeof projectNotificationEventTypes)[number]
    ) ||
    input.permission !== deliveryPermission(String(input.eventType))
  ) {
    invalid();
  }
  return {
    userId: uuid(input.userId, "userId"),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    membershipId: uuid(input.membershipId, "membershipId"),
    membershipVersion: Number(input.membershipVersion),
    eventType:
      input.eventType as InternalAuthorizeProjectNotificationDeliveryInput["eventType"],
    permission:
      input.permission as InternalAuthorizeProjectNotificationDeliveryInput["permission"]
  };
}

function deliveryPermission(
  eventType: string
): InternalAuthorizeProjectNotificationDeliveryInput["permission"] {
  return eventType === "CRAWL_RADAR" ? "page.view" : "project.view";
}

function uuid(value: unknown, field: string): string {
  try {
    return assertUuid(String(value), field);
  } catch {
    return invalid();
  }
}

function invalid(): never {
  throw new BadRequestException(
    "Invalid project notification delivery authorization request"
  );
}

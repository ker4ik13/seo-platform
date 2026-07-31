import { BadRequestException } from "@nestjs/common";
import type { InternalDeliverCrawlNotificationInput } from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";

const KEY_PATTERN = /^crawl-notification:[0-9a-f-]{36}$/u;

export function crawlNotificationInput(
  value: unknown
): InternalDeliverCrawlNotificationInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "crawlId",
    "status",
    "processedUrls",
    "issueCount",
    "idempotencyKey"
  ]);
  const crawlId = uuid(input.crawlId, "crawlId");
  const idempotencyKey = String(input.idempotencyKey);
  if (
    !["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "FAILED"].includes(
      String(input.status)
    ) ||
    !nonNegativeInteger(input.processedUrls, 1_000) ||
    !nonNegativeInteger(input.issueCount, 5_000) ||
    !KEY_PATTERN.test(idempotencyKey) ||
    idempotencyKey !== `crawl-notification:${crawlId}`
  ) {
    invalid();
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    crawlId,
    status: input.status as InternalDeliverCrawlNotificationInput["status"],
    processedUrls: Number(input.processedUrls),
    issueCount: Number(input.issueCount),
    idempotencyKey
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown, field: string): string {
  try {
    return assertUuid(String(value), field);
  } catch {
    return invalid();
  }
}

function nonNegativeInteger(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 &&
    Number(value) <= maximum;
}

function invalid(): never {
  throw new BadRequestException("Invalid crawl notification request");
}

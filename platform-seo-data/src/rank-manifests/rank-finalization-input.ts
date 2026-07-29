import { BadRequestException } from "@nestjs/common";
import {
  rankCheckFinalStatuses,
  type InternalFinalizeRankCheckInput,
  type RankCheckFinalStatus
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const FINAL_STATUSES = new Set<RankCheckFinalStatus>(
  rankCheckFinalStatuses
);

export function internalFinalizeRankCheckInput(
  value: unknown
): InternalFinalizeRankCheckInput {
  const input = strictRecord(value, [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "manifestId",
    "status"
  ]);
  if (input.schemaVersion !== "rank-finalize@1") {
    invalid("schemaVersion");
  }
  if (
    typeof input.status !== "string" ||
    !FINAL_STATUSES.has(input.status as RankCheckFinalStatus)
  ) {
    invalid("status");
  }
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    jobId: uuid(input.jobId, "jobId"),
    manifestId: uuid(input.manifestId, "manifestId"),
    status: input.status as RankCheckFinalStatus
  };
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== allowedKeys.length ||
    Object.keys(record).some((key) => !allowedKeys.includes(key))
  ) {
    invalid("body");
  }
  return record;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function invalid(field: string): never {
  throw new BadRequestException(
    `Invalid rank finalization field: ${field}`
  );
}

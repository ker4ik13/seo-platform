import { BadRequestException } from "@nestjs/common";
import {
  terminalJobNotificationStatuses,
  type InternalDeliverJobNotificationInput
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";

const JOB_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,99}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const MAX_PROGRESS = 20_000_000;

export function jobNotificationInput(
  value: unknown
): InternalDeliverJobNotificationInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "jobType",
    "status",
    "progressCurrent",
    "progressTotal",
    "errorCode",
    "idempotencyKey"
  ]);
  const jobId = uuid(input.jobId, "jobId");
  const status = String(input.status);
  const progressCurrent = boundedInteger(input.progressCurrent);
  const progressTotal = input.progressTotal === null
    ? null
    : boundedInteger(input.progressTotal);
  const errorCode = input.errorCode === null ? null : String(input.errorCode);
  if (
    !terminalJobNotificationStatuses.includes(
      status as (typeof terminalJobNotificationStatuses)[number]
    ) ||
    !JOB_TYPE_PATTERN.test(String(input.jobType)) ||
    (progressTotal !== null && progressCurrent > progressTotal) ||
    (errorCode !== null && !ERROR_CODE_PATTERN.test(errorCode)) ||
    input.idempotencyKey !== `job-notification:${jobId}:${status}`
  ) {
    invalid();
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    jobId,
    jobType: String(input.jobType),
    status: status as InternalDeliverJobNotificationInput["status"],
    progressCurrent,
    progressTotal,
    errorCode,
    idempotencyKey: String(input.idempotencyKey)
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

function boundedInteger(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > MAX_PROGRESS
  ) {
    invalid();
  }
  return Number(value);
}

function invalid(): never {
  throw new BadRequestException("Invalid job notification request");
}

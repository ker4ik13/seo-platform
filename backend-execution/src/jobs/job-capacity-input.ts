import { BadRequestException } from "@nestjs/common";
import type { JobCapacityEntitlement } from "@seo-platform/contracts";

const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/u;

export function jobCapacityInput(
  value: unknown,
  path = "jobCapacity"
): JobCapacityEntitlement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path);
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input);
  if (
    keys.length !== 3 ||
    !keys.includes("planCode") ||
    !keys.includes("planVersion") ||
    !keys.includes("concurrentJobs") ||
    typeof input.planCode !== "string" ||
    !PLAN_CODE_PATTERN.test(input.planCode) ||
    !Number.isSafeInteger(input.planVersion) ||
    Number(input.planVersion) < 1 ||
    !Number.isSafeInteger(input.concurrentJobs) ||
    Number(input.concurrentJobs) < 1
  ) {
    invalid(path);
  }
  return {
    planCode: input.planCode,
    planVersion: Number(input.planVersion),
    concurrentJobs: Number(input.concurrentJobs)
  };
}

function invalid(path: string): never {
  throw new BadRequestException(`Invalid ${path}`);
}

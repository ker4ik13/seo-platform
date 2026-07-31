import {
  BadRequestException,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type { StorageCapacityEntitlement } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/u;

export function storageCapacityEntitlement(
  value: unknown,
  path = "entitlement"
): StorageCapacityEntitlement {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path);
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some(
      (key) =>
        !["planCode", "planVersion", "storageBytes"].includes(key)
    )
  ) {
    invalid(path);
  }
  if (
    typeof input.planCode !== "string" ||
    !PLAN_CODE_PATTERN.test(input.planCode)
  ) {
    invalid(`${path}.planCode`);
  }
  return {
    planCode: input.planCode,
    planVersion: positiveSafeInteger(
      input.planVersion,
      `${path}.planVersion`
    ),
    storageBytes: positiveSafeInteger(
      input.storageBytes,
      `${path}.storageBytes`
    )
  };
}

export async function lockStorageCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`billing-capacity:storage-bytes:${workspaceId}`}, 0)
    )
  `;
}

export function assertStorageCapacity(
  current: bigint,
  additional: bigint,
  entitlement: StorageCapacityEntitlement
): void {
  const limit = BigInt(entitlement.storageBytes);
  if (current + additional <= limit) return;
  throw new HttpException(
    {
      error: {
        code: "QUOTA_EXCEEDED",
        message: "The storageBytes limit for the current plan would be exceeded",
        details: {
          resource: "storageBytes",
          current: current.toString(),
          additional: additional.toString(),
          limit: limit.toString(),
          planCode: entitlement.planCode,
          planVersion: entitlement.planVersion
        }
      }
    },
    HttpStatus.CONFLICT
  );
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(path);
  return Number(value);
}

function invalid(path: string): never {
  throw new BadRequestException(`Invalid field: ${path}`);
}

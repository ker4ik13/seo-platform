import { BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import type { SemanticCapacityEntitlement } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/u;

export function semanticCapacityEntitlement(
  value: unknown,
  path = "entitlement"
): SemanticCapacityEntitlement {
  const input = exactRecord(value, path, [
    "planCode",
    "planVersion",
    "storedKeywords",
    "keywordsPerProject",
    "foldersPerProject",
    "trackedContextPairs"
  ]);
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
    storedKeywords: positiveSafeInteger(
      input.storedKeywords,
      `${path}.storedKeywords`
    ),
    keywordsPerProject: positiveSafeInteger(
      input.keywordsPerProject,
      `${path}.keywordsPerProject`
    ),
    foldersPerProject: nonNegativeSafeInteger(
      input.foldersPerProject,
      `${path}.foldersPerProject`
    ),
    trackedContextPairs: positiveSafeInteger(
      input.trackedContextPairs,
      `${path}.trackedContextPairs`
    )
  };
}

export async function lockStoredKeywordCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`billing-capacity:stored-keywords:${workspaceId}`}, 0)
    )
  `;
}

export async function lockTrackedContextPairCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`billing-capacity:tracked-context-pairs:${workspaceId}`}, 0)
    )
  `;
}

export async function assertStoredKeywordCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  additional: bigint,
  entitlement: SemanticCapacityEntitlement
): Promise<void> {
  const [
    workspaceKeywords,
    projectKeywords,
    workspaceReservations,
    projectReservations
  ] = await Promise.all([
    transaction.keyword.count({
      where: { workspaceId, status: "ACTIVE" }
    }),
    transaction.keyword.count({
      where: { workspaceId, projectId, status: "ACTIVE" }
    }),
    transaction.semanticImportReceipt.aggregate({
      where: { workspaceId, status: "RECEIVING" },
      _sum: { reservedKeywords: true }
    }),
    transaction.semanticImportReceipt.aggregate({
      where: { workspaceId, projectId, status: "RECEIVING" },
      _sum: { reservedKeywords: true }
    })
  ]);
  assertSemanticCapacity(
    "storedKeywords",
    BigInt(workspaceKeywords) +
      (workspaceReservations._sum.reservedKeywords ?? 0n),
    additional,
    entitlement.storedKeywords,
    entitlement
  );
  assertSemanticCapacity(
    "keywordsPerProject",
    BigInt(projectKeywords) +
      (projectReservations._sum.reservedKeywords ?? 0n),
    additional,
    entitlement.keywordsPerProject,
    entitlement
  );
}

export function assertSemanticCapacity(
  resource: "storedKeywords" | "keywordsPerProject" | "trackedContextPairs",
  current: bigint,
  additional: bigint,
  limit: number,
  entitlement: SemanticCapacityEntitlement
): void {
  const bigintLimit = BigInt(limit);
  if (current + additional <= bigintLimit) return;
  throw new HttpException(
    {
      error: {
        code: "QUOTA_EXCEEDED",
        message: `The ${resource} limit for the current plan would be exceeded`,
        details: {
          resource,
          current: current.toString(),
          additional: additional.toString(),
          limit: bigintLimit.toString(),
          planCode: entitlement.planCode,
          planVersion: entitlement.planVersion
        }
      }
    },
    HttpStatus.CONFLICT
  );
}

function exactRecord(
  value: unknown,
  path: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path);
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) {
    invalid(path);
  }
  return input;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(path);
  return Number(value);
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path);
  return Number(value);
}

function invalid(path: string): never {
  throw new BadRequestException(`Invalid field: ${path}`);
}

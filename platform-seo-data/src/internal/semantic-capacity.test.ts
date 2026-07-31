import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, HttpException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import {
  assertSemanticCapacity,
  assertStoredKeywordCapacity,
  semanticCapacityEntitlement
} from "./semantic-capacity.js";

const entitlement = {
  planCode: "TEAM",
  planVersion: 3,
  storedKeywords: 10,
  keywordsPerProject: 6,
  trackedContextPairs: 5
} as const;

test("parses only an exact positive semantic capacity snapshot", () => {
  assert.deepEqual(
    semanticCapacityEntitlement(entitlement),
    entitlement
  );
  assert.throws(
    () =>
      semanticCapacityEntitlement({
        ...entitlement,
        storedKeywords: 0
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      semanticCapacityEntitlement({
        ...entitlement,
        providerSecret: "must-not-cross-boundary"
      }),
    BadRequestException
  );
});

test("counts active rows and pending import reservations before a write", async () => {
  const transaction = {
    keyword: {
      count: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) => (Object.hasOwn(where, "projectId") ? 4 : 7)
    },
    semanticImportReceipt: {
      aggregate: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) => ({
        _sum: {
          reservedKeywords: Object.hasOwn(where, "projectId")
            ? 1n
            : 2n
        }
      })
    }
  } as unknown as Prisma.TransactionClient;

  await assertStoredKeywordCapacity(
    transaction,
    "01900000-0000-7000-8000-000000000001",
    "01900000-0000-7000-8000-000000000002",
    1n,
    entitlement
  );
  await assert.rejects(
    assertStoredKeywordCapacity(
      transaction,
      "01900000-0000-7000-8000-000000000001",
      "01900000-0000-7000-8000-000000000002",
      2n,
      entitlement
    ),
    quotaExceeded("storedKeywords")
  );
});

test("tracked pairs reject the first row beyond the plan limit", () => {
  assert.throws(
    () =>
      assertSemanticCapacity(
        "trackedContextPairs",
        5n,
        1n,
        entitlement.trackedContextPairs,
        entitlement
      ),
    quotaExceeded("trackedContextPairs")
  );
});

function quotaExceeded(
  resource: string
): (error: unknown) => boolean {
  return (error) => {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse() as {
      readonly error?: {
        readonly code?: string;
        readonly details?: { readonly resource?: string };
      };
    };
    return (
      error.getStatus() === 409 &&
      response.error?.code === "QUOTA_EXCEEDED" &&
      response.error.details?.resource === resource
    );
  };
}

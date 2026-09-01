import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthCryptoService } from "./auth-crypto.service.js";
import type { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { ApiTokenAuthenticationService } from "./api-token-authentication.service.js";

const token = `seo_pat_${"a".repeat(43)}`;
const tokenId = "01900000-0000-7000-8000-000000000001";
const workspaceId = "01900000-0000-7000-8000-000000000002";
const userId = "01900000-0000-7000-8000-000000000003";
const projectId = "01900000-0000-7000-8000-000000000004";

test("authenticates only a live hashed token and throttles last-used writes", async () => {
  let lookedUpHash: string | undefined;
  let rateSubject: readonly string[] | undefined;
  let lastUsedWrites = 0;
  const service = new ApiTokenAuthenticationService(
    {
      apiToken: {
        findFirst: async (input: {
          where: { OR: readonly [{ tokenHash: string }] };
        }) => {
          lookedUpHash = input.where.OR[0].tokenHash;
          return record();
        },
        updateMany: async () => {
          lastUsedWrites += 1;
          return { count: 1 };
        }
      }
    } as unknown as PrismaService,
    {
      hashOpaqueToken: (value: string) => `hash:${value}`
    } as AuthCryptoService,
    {
      consume: async (_action: string, subjects: readonly string[]) => {
        rateSubject = subjects;
      }
    } as AuthRateLimitService
  );

  const authenticated = await service.authenticate(`Bearer ${token}`);

  assert.equal(lookedUpHash, `hash:${token}`);
  assert.deepEqual(rateSubject, [tokenId]);
  assert.equal(lastUsedWrites, 1);
  assert.equal(authenticated.principal.userId, userId);
  assert.deepEqual(authenticated.authorization.projectIds, [projectId]);
  assert.deepEqual(authenticated.authorization.scopes, [
    "projects:read",
    "positions:run"
  ]);
});

test("does not rate-limit or update a revoked token after lookup", async () => {
  let touched = false;
  const service = new ApiTokenAuthenticationService(
    {
      apiToken: {
        findFirst: async () => ({
          ...record(),
          revokedAt: new Date("2026-09-01T10:00:00.000Z")
        }),
        updateMany: async () => {
          touched = true;
          return { count: 1 };
        }
      }
    } as unknown as PrismaService,
    { hashOpaqueToken: () => "hash" } as unknown as AuthCryptoService,
    {
      consume: async () => {
        touched = true;
      }
    } as unknown as AuthRateLimitService
  );

  await assert.rejects(
    service.authenticate(`Bearer ${token}`),
    (error: unknown) =>
      error instanceof DomainError && error.code === "UNAUTHENTICATED"
  );
  assert.equal(touched, false);
});

function record() {
  return {
    id: tokenId,
    workspaceId,
    createdBy: userId,
    name: "Agent",
    prefix: "seo_pat_aaaa",
    tokenHash: "hash",
    previousTokenHash: null,
    previousTokenValidUntil: null,
    scopes: ["projects:read", "positions:run"],
    allProjects: false,
    expiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: null,
    revokedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    creator: { status: "ACTIVE" },
    projectAccesses: [{ projectId }]
  };
}

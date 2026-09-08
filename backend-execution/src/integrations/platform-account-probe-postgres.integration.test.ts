import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { SystemConnectorBootstrapService } from "./system-connector-bootstrap.service.js";

const databaseUrl = process.env.JOBS_PAID_OPERATION_TEST_DATABASE_URL;
test("PostgreSQL account probes expose only a leased encrypted envelope and fence observed balances", { skip: !databaseUrl, timeout: 20_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432");
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl }));
  const role = `probe_test_${randomBytes(5).toString("hex")}`;
  try {
    const accountId = randomUUID();
    const credential = await prisma.integrationCredential.create({ data: { workspaceId: randomUUID(), provider: "XMLSTOCK", mode: "PLATFORM_PAID", label: "Probe fixture", status: "ACTIVE", verifiedAt: new Date(), ciphertext: randomBytes(64), nonce: randomBytes(12), authTag: randomBytes(16), encryptedDataKey: randomBytes(32), dataKeyNonce: randomBytes(12), dataKeyAuthTag: randomBytes(16), keyVersion: 1, fingerprintKeyVersion: 1, requestFingerprint: randomBytes(32), idempotencyKey: randomUUID(), capabilities: ["SERP_RANK_TRACKING", "WORDSTAT"], providerMeta: { platformAccountIds: [accountId] } } });
    await prisma.platformProviderAccount.create({ data: { id: accountId, provider: "XMLSTOCK", slot: 1, credentialId: credential.id } });
    await prisma.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION public.claim_platform_provider_account_probe(text), public.finish_platform_provider_account_probe(uuid,text,uuid,text,text) TO ${role}`);
    await assert.rejects(() => prisma.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`); await tx.$queryRaw`SELECT * FROM platform_provider_accounts`; }));
    const claim = async (owner: string) => prisma.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`); const [row] = await tx.$queryRaw<{ claim: Record<string, unknown> | null }[]>`SELECT public.claim_platform_provider_account_probe(${owner}::text) AS claim`; return row?.claim; });
    const results = await Promise.all([claim("probe-owner-a"), claim("probe-owner-b")]);
    assert.equal(results.filter(Boolean).length, 1);
    const winner = results[0] ?? results[1]; assert.ok(winner);
    const owner = results[0] ? "probe-owner-a" : "probe-owner-b";
    assert.equal(winner.id, accountId); assert.equal(winner.credentialId, credential.id);
    assert.equal(winner.apiKey, undefined); assert.equal(winner.secret, undefined); assert.equal(typeof winner.ciphertext, "string");
    const complete = async (token: string) => prisma.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`); const [row] = await tx.$queryRaw<{ done: boolean }[]>`SELECT public.finish_platform_provider_account_probe(${accountId}::uuid, ${owner}::text, ${token}::uuid, '499.99'::text, NULL::text) AS done`; return row?.done; });
    assert.equal(await complete(randomUUID()), false);
    assert.equal(await complete(String(winner.token)), true);
    assert.equal(await complete(String(winner.token)), false);
    const stored = await prisma.platformProviderAccount.findUniqueOrThrow({ where: { id: accountId } });
    assert.equal(stored.remaining?.toString(), "499.99"); assert.ok(stored.checkedAt); assert.equal(stored.leaseToken, null);
    const projectId = randomUUID(), actorId = randomUUID();
    const bootstrap = new SystemConnectorBootstrapService(prisma, { enablePlatform: () => { throw new Error("An existing credential must be reused"); } } as never, {} as never, { resolve: async () => undefined } as never, { platformProviderCredentials: { XMLSTOCK: [{ apiKey: "fixture-not-a-real-key" }] } } as never);
    await Promise.all(Array.from({ length: 4 }, () => bootstrap.prepare(credential.workspaceId, projectId, actorId, "bootstrap-race")));
    assert.equal(await prisma.workspaceConnectorBinding.count({ where: { workspaceId: credential.workspaceId } }), 2);
    assert.equal(await prisma.workspaceConnectorRoute.count({ where: { workspaceId: credential.workspaceId } }), 2);
    const binding = await prisma.workspaceConnectorBinding.findFirstOrThrow({ where: { workspaceId: credential.workspaceId, capability: "WORDSTAT" } });
    await prisma.workspaceConnectorBinding.update({ where: { id: binding.id }, data: { enabled: false, version: { increment: 1 } } });
    await bootstrap.prepare(credential.workspaceId, projectId, actorId, "bootstrap-preserve-disabled");
    assert.equal((await prisma.workspaceConnectorBinding.findUniqueOrThrow({ where: { id: binding.id } })).enabled, false);
  } finally {
    await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    await prisma.$disconnect();
  }
});

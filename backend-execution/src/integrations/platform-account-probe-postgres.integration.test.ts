import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { SystemConnectorBootstrapService } from "./system-connector-bootstrap.service.js";

const databaseUrl = process.env.JOBS_PAID_OPERATION_TEST_DATABASE_URL;
test("PostgreSQL exposes only enabled platform account IDs to connector role", { skip: !databaseUrl, timeout: 20_000 }, async () => {
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
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION public.list_enabled_platform_provider_account_ids(text,uuid[]) TO ${role}`);
    await assert.rejects(() => prisma.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`); await tx.$queryRaw`SELECT * FROM platform_provider_accounts`; }));
    const visible = async () => prisma.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`); return tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.list_enabled_platform_provider_account_ids('XMLSTOCK'::text, ${[accountId]}::uuid[])`; });
    assert.deepEqual(await visible(), [{ id: accountId }]);
    await prisma.platformProviderAccount.update({ where: { id: accountId }, data: { enabled: false } });
    assert.deepEqual(await visible(), []);
    await prisma.platformProviderAccount.update({ where: { id: accountId }, data: { enabled: true } });
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

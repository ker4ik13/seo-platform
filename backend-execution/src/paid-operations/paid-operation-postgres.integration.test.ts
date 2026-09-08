import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { PaidOperationController } from "./paid-operation.controller.js";
import { PaidOperationRuntimeService, PaidOperationReviewError, PaidOperationUnavailableError, type PaidOperationClaimScope } from "./paid-operation-runtime.service.js";

const databaseUrl = process.env.JOBS_PAID_OPERATION_TEST_DATABASE_URL;
test("PostgreSQL paid tickets fence Core approval and cancellation, replay checkpoints and quarantine unknown outcomes", { skip: !databaseUrl, timeout: 30_000 }, async (t) => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432");
  const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, INTEGRATION_CREDENTIAL_ROLE: "EXECUTION", INTEGRATION_CREDENTIAL_KEYS: `1:${randomBytes(32).toString("base64url")}`, INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1", JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN: "s".repeat(40), PLATFORM_API_INTERNAL_URL: "http://core.example.test:4000" }, "CONNECTOR_WORKER");
  const prisma = new PrismaService(config);
  const billing = new PaidOperationRuntimeService(prisma, config);
  const controller = new PaidOperationController(prisma, {} as never);
  const originalFetch = globalThis.fetch;
  let allow = true; let authorizations = 0; let paidCalls = 0;
  const fixture = async () => {
    const workspaceId = randomUUID(); const projectId = randomUUID(); const actorId = randomUUID();
    const job = await prisma.job.create({ data: { workspaceId, projectId, actorId, type: "FREQUENCY_COLLECTION", status: "RUNNING", stage: "collecting", credentialMode: "PLATFORM_PAID", provider: "XMLSTOCK", idempotencyScope: "paid-operation-test", idempotencyKey: randomUUID(), requestHash: randomBytes(32), correlationId: `test-${randomUUID()}`, inputSnapshot: { types: ["BASE", "EXACT", "FIXED"], regionCode: "213", device: "ALL" }, scopeSnapshot: {}, progressTotal: 1n, billingQuoteId: randomUUID(), billingCommandHash: randomBytes(32), billingMaximumUnitsMilli: 3000n, leaseOwner: `paid-test-${randomUUID()}`, leaseExpiresAt: new Date(Date.now() + 120_000), startedAt: new Date() } });
    const item = await prisma.jobItem.create({ data: { jobId: job.id, workspaceId, projectId, sequence: 0, status: "RUNNING", inputReference: { keywordId: randomUUID(), keywordVersion: 1 }, attempt: 1 } });
    const scope: PaidOperationClaimScope = { jobId: job.id, workspaceId, projectId, leaseOwner: job.leaseOwner!, jobVersion: job.version };
    const request = { id: `test-${randomUUID()}`, headers: { "x-workspace-id": workspaceId, "x-project-id": projectId, "x-actor-id": actorId, "x-request-id": "paid-test-request" } };
    return { job, item, scope, request };
  };
  globalThis.fetch = (async (_input: unknown, init: RequestInit): Promise<Response> => {
    authorizations++;
    if (!allow) return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    const input = JSON.parse(String(init.body)) as { ticketId: string; ticketToken: string };
    const ticket = await prisma.providerUsageTicket.findUniqueOrThrow({ where: { id: input.ticketId } });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: ticket.jobId } });
    const request = { id: "paid-test-auth", headers: { "x-workspace-id": job.workspaceId, "x-project-id": job.projectId, "x-actor-id": job.actorId, "x-request-id": "paid-test-auth" } };
    try {
      const result = await controller.authorize({ ...input, quoteId: job.billingQuoteId, jobId: job.id, commandHash: Buffer.from(job.billingCommandHash!).toString("hex") }, request as never);
      return Response.json(result);
    } catch { return Response.json({ error: { code: "FORBIDDEN" } }, { status: 409 }); }
  }) as typeof fetch;
  try {
    const first = await fixture();
    const network = async () => { paidCalls++; await new Promise(resolve => setTimeout(resolve, 10)); return { ok: true as const, value: "123" }; };
    allow = false;
    await assert.rejects(() => billing.execute(first.scope, "BASE", [first.item.id], network), PaidOperationUnavailableError);
    assert.equal(paidCalls, 0, "A denied Core authorization must happen before provider I/O");
    const prepared = await prisma.providerUsageTicket.findFirstOrThrow({ where: { jobId: first.job.id } });
    const [denied] = await prisma.$queryRaw<{ started: boolean }[]>`SELECT public.start_provider_usage_ticket(${prepared.id}::uuid, ${prepared.ticketToken}::uuid) AS started`;
    assert.equal(denied?.started, false, "Knowing a worker ticket token is insufficient without Core's persisted approval");
    allow = true;
    const racing = await Promise.allSettled([billing.execute(first.scope, "BASE", [first.item.id], network), billing.execute(first.scope, "BASE", [first.item.id], network)]);
    assert.ok(racing.some(result => result.status === "fulfilled"));
    assert.equal(paidCalls, 1);
    assert.deepEqual(await billing.execute(first.scope, "BASE", [first.item.id], network), { ok: true, value: "123" });
    assert.equal(paidCalls, 1, "A durable XMLStock checkpoint prevents a second paid request on replay");
    assert.ok(authorizations >= 2);
    await assert.rejects(() => billing.execute({ ...first.scope, workspaceId: randomUUID() }, "BASE", [first.item.id], network));
    assert.equal(paidCalls, 1);

    await billing.execute(first.scope, "EXACT", [first.item.id], async () => {
      paidCalls++;
      await prisma.job.update({ where: { id: first.job.id }, data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, version: { increment: 1 } } });
      return { ok: true, value: "25" };
    });
    assert.equal(await prisma.providerUsageTicket.count({ where: { jobId: first.job.id, state: "ACCEPTED" } }), 2, "Cancellation during I/O must preserve the accepted cost evidence");
    const usage = await controller.usage({ quoteId: first.job.billingQuoteId, jobId: first.job.id, commandHash: Buffer.from(first.job.billingCommandHash!).toString("hex") }, first.request as never);
    assert.equal(usage.data.terminal, true);
    assert.equal(usage.data.acceptedProviderUnitsMilli, "2000");
    await assert.rejects(() => billing.execute(first.scope, "FIXED", [first.item.id], network));
    assert.equal(paidCalls, 2);

    const unknown = await fixture();
    await assert.rejects(() => billing.execute(unknown.scope, "BASE", [unknown.item.id], async () => { paidCalls++; return { ok: false, code: "PROVIDER_UNAVAILABLE", retryable: true }; }), PaidOperationReviewError);
    await assert.rejects(() => billing.execute(unknown.scope, "BASE", [unknown.item.id], network), PaidOperationReviewError);
    assert.equal(paidCalls, 3, "A network timeout must never automatically spend the same unit again");
    const uncertain = await prisma.providerUsageTicket.findFirstOrThrow({ where: { jobId: unknown.job.id } });
    assert.equal(uncertain.state, "UNKNOWN");
    await assert.rejects(() => prisma.providerUsageTicket.delete({ where: { id: uncertain.id } }));

    const rejection = await fixture();
    const quota = await billing.execute(rejection.scope, "BASE", [rejection.item.id], async () => ({ ok: false as const, code: "PROVIDER_RATE_LIMITED", retryable: true }));
    assert.equal(quota.ok, false);
    await billing.execute(rejection.scope, "BASE", [rejection.item.id], network);
    assert.equal(paidCalls, 4, "An explicit non-chargeable rejection can safely be retried");

    const unknownScope = { quoteId: unknown.job.billingQuoteId, jobId: unknown.job.id, commandHash: Buffer.from(unknown.job.billingCommandHash!).toString("hex") };
    const decision = { ...unknownScope, ticketId: uncertain.id, resolution: "RELEASE", reason: "Provider acceptance could not be verified", decidedBy: randomUUID(), resolutionKey: `review-${randomUUID()}` };
    await assert.rejects(() => controller.resolveReview(decision, unknown.request as never), "An active operation cannot be manually settled");
    await prisma.job.update({ where: { id: unknown.job.id }, data: { status: "FAILED_FINAL", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, version: { increment: 1 } } });
    await assert.rejects(() => controller.resolveReview(decision, unknown.request as never), "The grace interval protects late network outcomes");
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10 * 60_000 });
    const resolved = await controller.resolveReview(decision, unknown.request as never);
    assert.equal(resolved.data.resolution, "RELEASE");
    assert.deepEqual(await controller.resolveReview(decision, unknown.request as never), resolved);
    await assert.rejects(() => controller.resolveReview({ ...decision, resolution: "CHARGE", providerReference: "provider-reference" }, unknown.request as never));
    const reviewedUsage = await controller.usage(unknownScope, unknown.request as never);
    assert.equal(reviewedUsage.data.acceptedProviderUnitsMilli, "0");
    assert.equal(reviewedUsage.data.unresolvedProviderUnitsMilli, "0");
    await assert.rejects(() => prisma.providerUsageTicket.update({ where: { id: uncertain.id }, data: { state: "ACCEPTED", result: { ok: true }, finishedAt: new Date() } }), "Review cannot manufacture a provider result later");
    assert.equal(paidCalls, 4, "Financial review must never send a new provider request");
    t.mock.timers.reset();
    const chargedUnknown = await fixture();
    await assert.rejects(() => billing.execute(chargedUnknown.scope, "BASE", [chargedUnknown.item.id], async () => { paidCalls++; return { ok: false, code: "PROVIDER_UNAVAILABLE", retryable: true }; }), PaidOperationReviewError);
    const chargeTicket = await prisma.providerUsageTicket.findFirstOrThrow({ where: { jobId: chargedUnknown.job.id } });
    const chargeScope = { quoteId: chargedUnknown.job.billingQuoteId, jobId: chargedUnknown.job.id, commandHash: Buffer.from(chargedUnknown.job.billingCommandHash!).toString("hex") };
    const chargeDecision = { ...chargeScope, ticketId: chargeTicket.id, resolution: "CHARGE", providerReference: "verified-provider-operation", reason: "Acceptance verified in provider history", decidedBy: randomUUID(), resolutionKey: `review-${randomUUID()}` };
    await prisma.job.update({ where: { id: chargedUnknown.job.id }, data: { status: "FAILED_FINAL", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, version: { increment: 1 } } });
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10 * 60_000 });
    await assert.rejects(() => controller.resolveReview(chargeDecision, unknown.request as never), "Another workspace cannot approve this charge");
    await assert.rejects(() => controller.resolveReview({ ...chargeDecision, providerReference: undefined }, chargedUnknown.request as never));
    const chargedReview = await controller.resolveReview(chargeDecision, chargedUnknown.request as never);
    assert.equal(chargedReview.data.resolution, "CHARGE");
    assert.deepEqual(await controller.resolveReview(chargeDecision, chargedUnknown.request as never), chargedReview);
    const chargedUsage = await controller.usage(chargeScope, chargedUnknown.request as never);
    assert.equal(chargedUsage.data.acceptedProviderUnitsMilli, "1000");
    assert.equal(chargedUsage.data.unresolvedProviderUnitsMilli, "0");
    assert.equal((await prisma.providerUsageTicket.findUniqueOrThrow({ where: { id: chargeTicket.id } })).state, "UNKNOWN", "Charging confirmed usage never invents a successful SEO result");
    assert.equal(paidCalls, 5);
    t.mock.timers.reset();
  } finally { globalThis.fetch = originalFetch; await prisma.$disconnect(); }
});

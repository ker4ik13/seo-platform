import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { request } from "playwright";
import { loadAppConfig } from "../../backend-core/modules/api/dist/config/app-config.js";
import { PrismaService as PlatformPrisma } from "../../backend-core/modules/api/dist/database/prisma.service.js";
import { AuthCryptoService } from "../../backend-core/modules/api/dist/identity/auth-crypto.service.js";
import { SessionService } from "../../backend-core/modules/api/dist/identity/session.service.js";
import { AuditService } from "../../backend-core/modules/api/dist/audit/audit.service.js";
import { OutboxService } from "../../backend-core/modules/api/dist/outbox/outbox.service.js";
import { PrismaService as JobsPrisma } from "../../backend-execution/dist/database/prisma.service.js";
import { XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION } from "../../backend-execution/dist/rank-runs/rank-execution-evidence.js";
import { WorkerNodeService } from "../../backend-execution/dist/worker-nodes/worker-node.service.js";

assert.equal(process.env.SEO_PLATFORM_RANK500_CONFIRM, "PAID_XMLSTOCK_UP_TO_20_RUB");
const keywordCount = Number(process.env.SEO_PLATFORM_RANK_TEST_KEYWORDS ?? "500");
assert.ok(Number.isSafeInteger(keywordCount) && keywordCount >= 1 && keywordCount <= 500);
const recoveryMode = process.env.SEO_PLATFORM_RANK_TEST_GRANT_RECOVERY === "true";
if (recoveryMode) assert.equal(keywordCount, 1, "grant recovery smoke uses exactly one keyword");
const diagnosticHoldMs = Number(process.env.SEO_PLATFORM_RANK_TEST_HOLD_MS ?? "0");
assert.ok(Number.isSafeInteger(diagnosticHoldMs) && diagnosticHoldMs >= 0 && diagnosticHoldMs <= 300_000);
const timeoutMs = Number(process.env.SEO_PLATFORM_RANK_TEST_TIMEOUT_MS ?? String(15 * 60_000));
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 60_000 && timeoutMs <= 15 * 60_000);
const workspaceId = process.env.SEO_PLATFORM_RANK500_WORKSPACE_ID;
const credentialId = process.env.SEO_PLATFORM_RANK500_CREDENTIAL_ID;
const reuseProjectId = process.env.SEO_PLATFORM_RANK_TEST_PROJECT_ID;
assert.match(workspaceId ?? "", /^[0-9a-f-]{36}$/u);
assert.match(credentialId ?? "", /^[0-9a-f-]{36}$/u);
if (reuseProjectId) assert.match(reuseProjectId, /^[0-9a-f-]{36}$/u);
const runtimeFile = process.env.SEO_PLATFORM_RUNTIME_ENV_FILE ??
  `${process.env.XDG_DATA_HOME ?? `${homedir()}/.local/share`}/seo-platform-runtime/runtime.env`;
const runtime = parseEnv(await readFile(runtimeFile, "utf8"));
assert.equal(runtime.REMOTE_WORK_ENABLED, "true");
assert.equal(runtime.WORKER_GATEWAY_ENABLED, "true");
const base = runtime.SEO_PLATFORM_PUBLIC_URL;
assert.ok(base?.startsWith("https://"));
const config = loadAppConfig({ ...runtime, NODE_ENV: "test", AUTH_ACCESS_TOKEN_TTL_MINUTES: "120",
  WEB_PUBLIC_URL: base, DATABASE_URL: `postgresql://platform_owner:${encodeURIComponent(runtime.PLATFORM_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/platform_db` });
const platform = new PlatformPrisma(config);
const jobs = new JobsPrisma({ databaseUrl: `postgresql://jobs_owner:${encodeURIComponent(runtime.JOBS_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/jobs_db`, databasePoolMax: 2, processRole: "HTTP" });
const connector = recoveryMode
  ? new JobsPrisma({ databaseUrl: `postgresql://jobs_connector:${encodeURIComponent(runtime.JOBS_CONNECTOR_DATABASE_PASSWORD)}@127.0.0.1:5432/jobs_db`, databasePoolMax: 1, processRole: "CONNECTOR_WORKER" })
  : undefined;
const nodes = new WorkerNodeService(jobs);
let memberId, userId, nodeId, agent, client, operationId, projectId, command;
let agentLog = "";
let lastProgress = 0;
let completed = false;
let operationStartedAt;
let stopRequested = false;
process.once("SIGINT", () => { stopRequested = true; });
process.once("SIGTERM", () => { stopRequested = true; });

function report(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

try {
  const credential = await jobs.integrationCredential.findFirst({ where: { id: credentialId, workspaceId, provider: "XMLSTOCK", status: "ACTIVE", deletedAt: null }, select: { id: true } });
  assert.ok(credential, "the selected local XMLStock credential must be active in this workspace");
  const sessions = new SessionService(platform, new AuthCryptoService(config), new AuditService(platform), new OutboxService(), config);
  const session = await platform.$transaction(async tx => {
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { ownerUserId: true, status: true } });
    assert.equal(workspace.status, "ACTIVE");
    const email = `e2e-rank500-${randomUUID()}@example.invalid`;
    const user = await tx.user.create({ data: { emailNormalized: email, emailDisplay: email,
      emailVerifiedAt: new Date(), displayName: "[E2E] Rank 500", status: "ACTIVE", locale: "ru" } });
    userId = user.id;
    const member = await tx.workspaceMember.create({ data: { workspaceId, userId: user.id,
      roleCode: "ADMIN", allProjects: true, status: "ACTIVE", invitedBy: workspace.ownerUserId,
      joinedAt: new Date() } });
    memberId = member.id;
    const issued = await sessions.issue(tx, user, { requestId: `rank500-${randomUUID()}`, userAgent: "Local rank 500 E2E" }, undefined,
      { expiresAt: new Date(Date.now() + 2 * 3_600_000), authenticatedAt: new Date() });
    return issued.credentials;
  });
  const cookies = [
    [config.auth.accessCookieName, session.accessToken, true],
    [config.auth.sessionCookieName, session.refreshToken, true],
    [config.auth.csrfCookieName, session.csrfToken, false]
  ].map(([name, value, httpOnly]) => ({ name, value, httpOnly, domain: new URL(base).hostname,
    path: "/", secure: true, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 7_200 }));
  client = await request.newContext({ baseURL: base, storageState: { origins: [], cookies } });
  command = async (method, endpoint, data, extraHeaders = {}) => {
    const key = randomUUID();
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await client.fetch(`/app/api/${endpoint}`, { method,
        headers: { Origin: base, "Idempotency-Key": key, "X-CSRF-Token": session.csrfToken, ...extraHeaders },
        ...(data === undefined ? {} : { data }) });
      const body = await response.json();
      if (response.ok()) return body.data;
      if (endpoint.endsWith("/keywords/bulk") && response.status() === 503 && attempt < 3) {
        await delay(500 * (attempt + 1));
        continue;
      }
      throw new Error(`${method} ${endpoint.split("/").at(-1)}: ${response.status()} ${body.error?.code ?? "UNKNOWN"}`);
    }
  };
  const project = reuseProjectId
    ? await command("GET", `projects/${reuseProjectId}`)
    : await command("POST", `workspaces/${workspaceId}/projects`, {
      name: `[E2E] Rank ${keywordCount} ${new Date().toISOString()}`, domain: `rank500-${randomUUID().slice(0, 8)}.example.com`, locale: "ru", timezone: "Europe/Berlin"
    });
  assert.equal(project.workspaceId, workspaceId);
  projectId = project.id;
  report(reuseProjectId ? "project_reused" : "project_created", { projectId });
  const alreadyPresent = new Set((await command("GET", `projects/${projectId}/keywords?limit=1000`)).map(keyword => keyword.textOriginal));
  const missingTexts = Array.from({ length: keywordCount }, (_, index) =>
    `проверка позиции тест ${String(index + 1).padStart(4, "0")}`).filter(text => !alreadyPresent.has(text));
  for (let start = 0; start < missingTexts.length; start += 10) {
    if (stopRequested) throw new Error("Rank smoke interrupted during setup");
    const items = missingTexts.slice(start, start + 10).map(text => ({ text,
      language: "ru", priority: 0, isFavorite: false, isTracked: true, tagNames: [] }));
    await command("POST", `projects/${projectId}/keywords/bulk`, { items, duplicatePolicy: "SKIP_EXISTING" });
  }
  const context = await command("POST", `projects/${projectId}/tracking-contexts`, {
    name: "[E2E] Яндекс Live Москва ПК Топ-10",
    configuration: { searchEngine: "YANDEX", countryCode: "RU", regionCode: "213", regionLabel: "Москва",
      language: "ru", device: "DESKTOP", depth: 10, domainMatchRule: { mode: "EXACT_HOST" }, safeSearch: false },
    launchProfile: { searchSource: "LIVE", includeUntracked: false, scope: { mode: "ALL", groupIds: [] } }
  });
  const keywords = await command("GET", `projects/${projectId}/keywords?limit=1000`);
  assert.equal(keywords.length, keywordCount, "all test keywords must be visible through the public API");
  const assignment = await command("PUT", `projects/${projectId}/tracking-contexts/${context.id}/keywords`,
    { keywordIds: keywords.map(keyword => keyword.id) }, { "If-Match": `"v${context.version}"` });
  assert.equal(assignment.assignedKeywordCount, keywordCount);
  const estimate = await command("POST", `projects/${projectId}/rank-estimates`, {
    trackingContextId: context.id, provider: "XMLSTOCK", credentialId, searchSource: "LIVE", xmlStockDepthMode: "STRICT_DEPTH"
  });
  const maximumCostMicro = BigInt(estimate.providerUsage?.estimatedCostMicro?.maximum ?? "999999999999");
  report("quote", { status: estimate.status, keywords: estimate.scope?.keywordCount,
    requests: estimate.providerUsage?.estimatedRequestCount, maximumCostRub: Number(maximumCostMicro) / 1_000_000,
    blockers: estimate.blockers?.map(value => value.code) });
  assert.equal(estimate.status, "READY");
  assert.equal(estimate.scope.keywordCount, String(keywordCount));
  assert.equal(estimate.providerUsage.product, "YANDEX_LIVE");
  assert.equal(estimate.providerUsage.estimatedRequestCount.maximum, String(keywordCount));
  assert.ok(maximumCostMicro <= 20_000_000n, "paid test must stay within 20 RUB maximum");

  if (!recoveryMode) {
    const created = await nodes.create({ name: `[E2E] Local rank worker ${randomUUID().slice(0, 8)}`,
      capabilities: ["RANK"], maxHttpSlots: 20, maxCpuSlots: 1, useEnvCapacity: true });
    nodeId = created.node.id;
    await nodes.setEnabled(nodeId, true);
    agent = spawn(process.execPath, [new URL("../../backend-execution/dist/remote-worker.main.js", import.meta.url).pathname], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, NODE_ENV: "test", WORKER_CONTROL_URL: base,
        WORKER_NODE_ID: nodeId, WORKER_NODE_TOKEN: created.token, WORKER_HTTP_SLOTS: "20",
        WORKER_RANK_SLOTS: "20", WORKER_CPU_SLOTS: "1", WORKER_WORDSTAT_SLOTS: "0",
        WORKER_RESEARCH_SLOTS: "0", WORKER_AI_ANSWER_SLOTS: "0", WORKER_CLUSTERING_SLOTS: "0",
        WORKER_CRAWL_SLOTS: "0", WORKER_IMPORT_SLOTS: "0", WORKER_EXPORT_SLOTS: "0",
        WORKER_INSPECTION_SLOTS: "0", WORKER_HEARTBEAT_MS: "3000", WORKER_LOG_QUERIES: "false" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const observe = chunk => { agentLog = (agentLog + chunk.toString()).slice(-1_000_000); };
    agent.stdout.on("data", observe);
    agent.stderr.on("data", observe);
    for (let attempt = 0; attempt < 50; attempt++) {
      const node = await nodes.get(nodeId);
      if (node.online && (node.reportedRankSlots ?? 0) >= 20) break;
      assert.equal(agent.exitCode, null, "local worker exited before heartbeat");
      await delay(500);
      if (attempt === 49) throw new Error("local worker did not connect through HTTPS");
    }
    report("worker_online", { nodeId });
  }

  const createdRun = await command("POST", `projects/${projectId}/rank-runs`, {
    estimateId: estimate.id, confirmedPlatformChargeMicro: estimate.platformChargeMicro
  });
  operationId = createdRun.id;
  operationStartedAt = Date.now();
  report("operation_started", { operationId, projectId });
  if (recoveryMode && diagnosticHoldMs > 0) {
    report("diagnostic_hold", { durationMs: diagnosticHoldMs });
    await delay(diagnosticHoldMs);
  }
  const deadline = Date.now() + timeoutMs;
  if (recoveryMode) {
    let recovered = false;
    let claimVerified = false;
    while (Date.now() < deadline) {
      if (stopRequested) throw new Error("Rank recovery smoke interrupted");
      const attempts = await jobs.rankConnectorExecution.findMany({ where: { jobId: operationId },
        orderBy: { executionAttempt: "asc" },
        select: { executionAttempt: true, authorizationExpiresAt: true, createdAt: true,
          submitAttemptCount: true, submitBytesStartedAt: true, providerTaskId: true } });
      assert.ok(attempts.every(attempt => attempt.submitAttemptCount === 0 &&
        attempt.submitBytesStartedAt === null && attempt.providerTaskId === null),
      "grant recovery smoke must not send a paid provider request");
      if (!claimVerified && attempts.length > 0 && connector) {
        const candidates = await connector.$queryRawUnsafe(
          'SELECT "executionId"::text AS "executionId", "jobId"::text AS "jobId" FROM public.list_rank_connector_submit_candidates($1::text,25,30,ARRAY[]::uuid[])',
          XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
        );
        const candidate = candidates.find(row => row.jobId === operationId);
        if (candidate) {
          const start = Date.now();
          let claimed = 0;
          let claimSqlMs = 0;
          try {
            await connector.$transaction(async tx => {
              const claimStart = Date.now();
              const rows = await tx.$queryRawUnsafe(
                'SELECT count(*)::int AS n FROM public.claim_rank_connector_submit_targeted($1::text,25,$2::text,$3::uuid)',
                `rank-e2e-${randomUUID()}`, XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION, candidate.executionId
              );
              claimSqlMs = Date.now() - claimStart;
              claimed = rows[0]?.n ?? 0;
              if (claimed === 1) throw new Error("RANK_E2E_ROLLBACK");
            }, { timeout: 5_000 });
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "RANK_E2E_ROLLBACK") throw error;
          }
          const elapsedMs = Date.now() - start;
          report("submit_claim_verified", { claimed, claimSqlMs, elapsedMs });
          assert.equal(claimed, 1, "one real XMLStock execution must pass the full fenced claim");
          assert.ok(claimSqlMs < 1_000, "targeted SQL claim must not take seconds");
          claimVerified = true;
        }
      }
      if (attempts.length >= 2 && claimVerified) {
        const delayAfterExpiryMs = attempts[1].createdAt.getTime() - attempts[0].authorizationExpiresAt.getTime();
        report("recovery_verified", { attempts: attempts.length, delayAfterExpiryMs });
        assert.ok(delayAfterExpiryMs >= 0 && delayAfterExpiryMs <= 15_000,
          "unused grant must be retried promptly after expiry");
        recovered = true;
        break;
      }
      await delay(1_000);
    }
    assert.ok(recovered, "unused grant was not retried before the deadline");
  } else {
    while (Date.now() < deadline) {
      if (stopRequested) throw new Error("Rank smoke interrupted");
      const job = await command("GET", `projects/${projectId}/jobs/${operationId}`);
      const current = Number(job.progress.current);
      if (current !== lastProgress) {
        lastProgress = current;
        report("progress", { current, total: Number(job.progress.total), elapsedSeconds: Math.round((Date.now() - operationStartedAt) / 1000) });
      }
      if (["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "ACTION_REQUIRED", "CANCELLED"].includes(job.status)) {
        const batches = [...agentLog.matchAll(/получена пачка[^\n]*?страницы позиций (\d+)/gu)].map(match => Number(match[1]));
        report("finished", { status: job.status, current, elapsedSeconds: Math.round((Date.now() - operationStartedAt) / 1000),
          workerBatches: batches.length, maximumRankBatch: Math.max(0, ...batches), claimedRankPages: batches.reduce((sum, count) => sum + count, 0) });
        assert.equal(job.status, "COMPLETED");
        assert.equal(current, keywordCount);
        assert.ok(Date.now() - operationStartedAt < timeoutMs, "rank collection must not take one keyword per minute");
        assert.ok(batches.some(count => count > 1), "worker must receive actual rank batches");
        completed = true;
        break;
      }
      await delay(2_000);
    }
    assert.equal(lastProgress, keywordCount, "rank operation did not finish before the deadline");
  }
} finally {
  const cleanupFailures = [];
  const cleanup = async (target, action) => {
    try { await action(); }
    catch { cleanupFailures.push(target); }
  };
  if (operationId && projectId && !completed && command) {
    try {
      await command("POST", `projects/${projectId}/jobs/${operationId}/cancel`, {});
      report("test_operation_cancel_requested", { operationId });
    } catch (error) {
      report("test_operation_cancel_failed", { error: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN" });
    }
  }
  if (nodeId) await cleanup("disable_worker", () => nodes.setEnabled(nodeId, false));
  if (agent && agent.exitCode === null) {
    agent.kill("SIGTERM");
    for (let attempt = 0; attempt < 100 && agent.exitCode === null; attempt++) await delay(100);
    if (agent.exitCode === null) agent.kill("SIGKILL");
  }
  if (nodeId) await cleanup("remove_worker", () => nodes.remove(nodeId));
  if (memberId) await cleanup("suspend_member", () => platform.workspaceMember.update({ where: { id: memberId }, data: { status: "SUSPENDED" } }));
  if (userId) await cleanup("suspend_user", () => platform.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } }));
  await client?.dispose();
  await Promise.all([platform.$disconnect(), jobs.$disconnect(), connector?.$disconnect()]);
  report("cleanup", { operationId: operationId ?? null, projectId: projectId ?? null, failures: cleanupFailures });
  if (cleanupFailures.length > 0) process.exitCode = 1;
}

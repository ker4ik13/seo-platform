import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import test from "node:test";
import { request } from "playwright";
import { parseWorkerNodeView, workerEffectiveCapabilitySlots } from "../../packages/contracts/dist/index.js";
import { PrismaService } from "../../backend-execution/dist/database/prisma.service.js";
import { WorkerNodeService } from "../../backend-execution/dist/worker-nodes/worker-node.service.js";

test("Caddy authenticates a rotated worker token; env defaults and admin overrides apply", {
  skip: process.env.SEO_PLATFORM_E2E_CONFIRM !== "CREATE_TEST_DATA", timeout: 60_000
}, async () => {
  const env = parseEnv(await readFile("/home/dev/.local/share/seo-platform-runtime/runtime.env", "utf8"));
  assert.ok(env.SEO_PLATFORM_PUBLIC_URL?.startsWith("https://"));
  const prisma = new PrismaService({ databaseUrl: `postgresql://jobs_owner:${encodeURIComponent(env.JOBS_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/jobs_db`, databasePoolMax: 2, processRole: "HTTP" });
  const nodes = new WorkerNodeService(prisma);
  const client = await request.newContext({ baseURL: env.SEO_PLATFORM_PUBLIC_URL });
  let nodeId;
  try {
    const created = await nodes.create({ name: "[E2E] Worker rotation", capabilities: ["RANK", "WORDSTAT"], maxHttpSlots: 16, maxCpuSlots: 2, useEnvCapacity: true });
    nodeId = created.node.id;
    await nodes.setEnabled(nodeId, true);
    const ping = (token, httpSlots = 32, rankSlots = 20) => client.post("/worker/v1/heartbeat", {
      headers: { Authorization: `Bearer ${token}`, "X-Worker-Id": nodeId },
      data: { protocolVersion: 1, httpSlots, rankSlots, cpuSlots: 2, memoryBytes: String(2 * 1024 ** 3), activeWorkItems: 0, capabilitySlots: { RANK: rankSlots, WORDSTAT: 10 } }
    });
    const first = await ping(created.token);
    assert.equal(first.status(), 201);
    const inherited = parseWorkerNodeView((await first.json()).data);
    assert.equal(inherited.maxHttpSlots, 32);
    assert.equal(inherited.reportedHttpSlots, 32);
    assert.equal(inherited.useEnvCapacity, undefined, "heartbeat response must remain compatible with old agents");
    assert.equal((await nodes.list()).find(node => node.id === nodeId)?.useEnvCapacity, true);
    assert.equal((await nodes.list()).find(node => node.id === nodeId)?.tokenFingerprint,
      createHash("sha256").update(created.token).digest("hex").slice(0, 16));

    await nodes.configure(nodeId, { name: "[E2E] Worker rotation", capabilities: ["RANK", "WORDSTAT"],
      maxHttpSlots: 128, maxCpuSlots: 4, capabilityLimits: { RANK: 128, WORDSTAT: 128 }, useEnvCapacity: false });
    const manual = await ping(created.token);
    assert.equal(manual.status(), 201);
    const manualView = parseWorkerNodeView((await manual.json()).data);
    assert.equal(manualView.maxHttpSlots, 128);
    assert.equal(manualView.reportedHttpSlots, 32);
    const listed = (await nodes.list()).find(node => node.id === nodeId);
    assert.ok(listed);
    assert.equal(listed.useEnvCapacity, false);
    assert.equal(workerEffectiveCapabilitySlots(listed, "RANK"), 128);
    assert.equal(workerEffectiveCapabilitySlots(listed, "WORDSTAT"), 128);
    const sqlCapacity = await prisma.$queryRaw`SELECT public.remote_worker_capability_capacity(n, 'RANK') AS slots FROM public.execution_worker_nodes n WHERE n.id = ${nodeId}::uuid`;
    assert.equal(sqlCapacity[0]?.slots, 128);

    const rotated = await nodes.rotate(nodeId);
    assert.equal((await ping(created.token)).status(), 401);
    const rejectedAgent = spawn(process.execPath, [new URL("../../backend-execution/dist/remote-worker.main.js", import.meta.url).pathname], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_ENV: "test", WORKER_CONTROL_URL: env.SEO_PLATFORM_PUBLIC_URL,
        WORKER_NODE_ID: nodeId, WORKER_NODE_TOKEN: created.token,
        WORKER_HTTP_SLOTS: "8", WORKER_RANK_SLOTS: "0", WORKER_CPU_SLOTS: "1", WORKER_HEARTBEAT_MS: "3000" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let diagnostic = "";
    rejectedAgent.stderr.on("data", chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-1000); });
    try {
      for (let attempt = 0; attempt < 30 && !diagnostic.includes("authentication rejected"); attempt++) await delay(100);
      assert.match(diagnostic, /authentication rejected/u);
      await delay(500);
      assert.equal(rejectedAgent.exitCode, null, "a rejected token must not restart the container");
    } finally {
      rejectedAgent.kill("SIGTERM");
    }
    const accepted = await ping(rotated.token);
    assert.equal(accepted.status(), 201);
    assert.equal(parseWorkerNodeView((await accepted.json()).data).id, nodeId);
    await nodes.configure(nodeId, { name: "[E2E] Worker rotation", capabilities: ["RANK", "WORDSTAT"],
      maxHttpSlots: 128, maxCpuSlots: 4, useEnvCapacity: true });
    const reset = await ping(rotated.token);
    assert.equal(reset.status(), 201);
    assert.equal(parseWorkerNodeView((await reset.json()).data).maxHttpSlots, 32);
  } finally {
    if (nodeId) await nodes.remove(nodeId);
    await client.dispose();
    await prisma.$disconnect();
  }
});

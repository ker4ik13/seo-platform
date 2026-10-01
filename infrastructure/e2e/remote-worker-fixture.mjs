import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { PrismaService } from "../../backend-execution/dist/database/prisma.service.js";
import { WorkerNodeService } from "../../backend-execution/dist/worker-nodes/worker-node.service.js";

/** Local fixture only: the agent receives no central service/DB/storage credentials. */
export async function remoteWorkerFixture(t) {
  assert.equal(process.env.SEO_PLATFORM_E2E_CONFIRM, "CREATE_TEST_DATA");
  const runtime = parseEnv(await readFile("/home/dev/.local/share/seo-platform-runtime/runtime.env", "utf8"));
  assert.equal(runtime.REMOTE_WORK_ENABLED, "true");
  const prisma = new PrismaService({ databaseUrl: `postgresql://jobs_owner:${encodeURIComponent(runtime.JOBS_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/jobs_db`, databasePoolMax: 2, processRole: "HTTP" });
  const nodes = new WorkerNodeService(prisma);
  const created = await nodes.create({ name: `[E2E] Gateway ${randomUUID().slice(0, 8)}`, capabilities: ["IMPORT", "EXPORT", "INSPECTION", "CRAWL"], maxHttpSlots: 4, maxCpuSlots: 2 });
  await nodes.setEnabled(created.node.id, true);
  const agent = spawn(process.execPath, [new URL("../../backend-execution/dist/remote-worker.main.js", import.meta.url).pathname], {
    cwd: process.env.SEO_PLATFORM_E2E_OUTPUT_DIR,
    env: { PATH: process.env.PATH, NODE_ENV: "test", WORKER_CONTROL_URL: runtime.SEO_PLATFORM_PUBLIC_URL, WORKER_NODE_ID: created.node.id, WORKER_NODE_TOKEN: created.token, WORKER_HTTP_SLOTS: "4", WORKER_RANK_SLOTS: "0", WORKER_CPU_SLOTS: "2", WORKER_WORDSTAT_SLOTS: "0", WORKER_RESEARCH_SLOTS: "0", WORKER_AI_ANSWER_SLOTS: "0", WORKER_CLUSTERING_SLOTS: "0", WORKER_CRAWL_SLOTS: "4", WORKER_IMPORT_SLOTS: "2", WORKER_EXPORT_SLOTS: "2", WORKER_INSPECTION_SLOTS: "1", WORKER_MALWARE_SCANNER_HOST: "127.0.0.1", WORKER_MALWARE_SCANNER_PORT: "3310", WORKER_HEARTBEAT_MS: "3000" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  const observe = (chunk) => { logs = (logs + chunk.toString()).slice(-8000); };
  agent.stdout.on("data", observe); agent.stderr.on("data", observe);
  t.after(async () => {
    await nodes.setEnabled(created.node.id, false);
    await nodes.rotate(created.node.id);
    agent.kill("SIGTERM");
    for (let i = 0; i < 30 && agent.exitCode === null && agent.signalCode === null; i++) await delay(100);
    if (agent.exitCode === null && agent.signalCode === null) agent.kill("SIGKILL");
    assert.ok(!logs.includes(created.token), "node token must never enter agent logs");
    await prisma.$disconnect();
  });
  for (let i = 0; i < 40; i++) {
    const node = await nodes.get(created.node.id);
    if (node.online && node.reportedCapabilitySlots?.INSPECTION === 1) return { prisma, nodeId: created.node.id };
    assert.equal(agent.exitCode, null, "fixture agent exited before heartbeat");
    await delay(500);
  }
  assert.fail("Fixture agent did not connect through HTTPS");
}

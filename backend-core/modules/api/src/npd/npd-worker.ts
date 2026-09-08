import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { InternalNpdIssueMaterial } from "@seo-platform/contracts";
import { NpdClient, npdIncomeRequest } from "./npd-client.js";

export async function startNpdWorker(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NPD_RECEIPTS_ENABLED !== "true") throw new Error("NPD worker must be explicitly enabled");
  const token = required(env, "NPD_PROCESSOR_API_TOKEN");
  const client = new NpdClient({ inn: required(env, "NPD_INN"), password: required(env, "NPD_PASSWORD"), deviceId: required(env, "NPD_DEVICE_ID") });
  const port = Number(env.PLATFORM_PORT ?? "4000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Core port");
  const origin = `http://127.0.0.1:${port}/internal/v1/billing/npd-processing`;
  const readyPath = env.NPD_WORKER_READY_FILE ?? "/tmp/seo-platform-npd-worker.ready";
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  async function command<T>(action: string, body: unknown): Promise<T> {
    const response = await fetch(`${origin}/${action}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-request-id": `npd-${randomUUID()}` }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("NPD control request failed"); }
    const data = await response.json() as { data: T };
    return data.data;
  }
  await unlink(readyPath).catch(() => {});
  let failureCount = 0;
  try {
    while (!stopping) {
      let material: InternalNpdIssueMaterial | null = null;
      let started = false;
      try {
        material = await command<InternalNpdIssueMaterial | null>("claim", {});
        await writeFile(readyPath, "ready\n", { mode: 0o600 });
        if (material) {
          // Validate and authenticate before the irreversible-send marker.
          npdIncomeRequest(material);
          await client.prepare();
          if (stopping) break;
          await command("start", { receiptId: material.receiptId, leaseToken: material.leaseToken });
          started = true;
          const issued = await client.issue(material);
          // Retry completion only; never retry income POST. Preserve a received
          // receipt reference across short Core outages before requiring review.
          let completed = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            try { await command("complete", { receiptId: material.receiptId, leaseToken: material.leaseToken, ...issued }); completed = true; break; }
            catch { await delay(1000 * (attempt + 1)); }
          }
          if (!completed) throw new Error("NPD completion requires reconciliation");
        }
        failureCount = 0;
      } catch {
        failureCount++;
        await unlink(readyPath).catch(() => {});
        if (material) await command("fail", { receiptId: material.receiptId, leaseToken: material.leaseToken, started }).catch(() => {});
        // No fiscal payload, URL, INN, recipient, auth material or stack.
        process.stderr.write("NPD worker error: operation requires review or dependency recovery\n");
      }
      // A broken password or unavailable authority must not trigger a login
      // attempt for every pending receipt at the ordinary polling frequency.
      if (!stopping) await delay(failureCount ? Math.min(300_000, 60_000 * failureCount) : 5000);
    }
  } finally {
    await unlink(readyPath).catch(() => {});
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
  }
}
function required(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }

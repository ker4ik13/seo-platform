import "dotenv/config";
import { totalmem } from "node:os";
import {
  parseWorkerNodeView,
  type RemoteRankClaimV1,
  type RemoteRankPollTaskV1
} from "@seo-platform/contracts";
import { loadRemoteWorkerConfig, type RemoteWorkerConfig } from "./worker-nodes/remote-worker-config.js";
import { rankProviderRequestIntent } from "./rank-runs/rank-provider-request-intent.js";
import {
  XmlStockRankConnector,
  xmlStockRankPageProgress
} from "./rank-runs/xmlstock-rank.connector.js";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TASK_BYTES = 16 * 1024 * 1024;
const CLAIM_INTERVAL_MS = 5_000;
const MAX_TASKS_PER_POLL = 32;

async function main(): Promise<void> {
  const config = await loadRemoteWorkerConfig();
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  let activeWorkItems = 0;
  const heartbeatTask = heartbeatLoop(
    config, controller, () => activeWorkItems
  );
  await Promise.all([
    heartbeatTask,
    rankScheduler(config, controller, (delta) => {
      activeWorkItems += delta;
    })
  ]);
}

async function heartbeatLoop(
  config: RemoteWorkerConfig,
  controller: AbortController,
  activeWorkItems: () => number
): Promise<void> {
  let lastState = "";
  while (!controller.signal.aborted) {
    try {
      const state = await heartbeat(config, controller.signal, activeWorkItems());
      const label = state.enabled
        ? (state.draining ? "draining" : "online")
        : "disabled";
      if (label !== lastState) {
        process.stdout.write(`worker ${config.nodeId} ${label}\n`);
        lastState = label;
      }
    } catch (error) {
      if (controller.signal.aborted) break;
      // Never log the URL, request headers, token, provider material or response body.
      const label = error instanceof WorkerAuthenticationError
        ? "authentication rejected"
        : "control plane unavailable";
      if (label !== lastState) {
        process.stderr.write(`worker ${config.nodeId} ${label}\n`);
        lastState = label;
      }
      if (error instanceof WorkerAuthenticationError) {
        controller.abort();
        break;
      }
    }
    await wait(config.heartbeatMs, controller.signal);
  }
}

async function heartbeat(
  config: RemoteWorkerConfig,
  signal: AbortSignal,
  activeWorkItems: number
) {
  const timeout = AbortSignal.timeout(5_000);
  const response = await fetch(new URL("/worker/v1/heartbeat", config.controlUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      "X-Worker-Id": config.nodeId
    },
    body: JSON.stringify({
      protocolVersion: 1,
      httpSlots: config.httpSlots,
      rankSlots: config.rankSlots,
      cpuSlots: config.cpuSlots,
      memoryBytes: String(totalmem()),
      activeWorkItems
    }),
    redirect: "error",
    signal: AbortSignal.any([signal, timeout])
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new WorkerAuthenticationError();
  }
  if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    await response.body?.cancel();
    throw new Error("Control plane unavailable");
  }
  const bytes = await boundedBody(response, MAX_RESPONSE_BYTES);
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Invalid control plane response");
  }
  const data = (payload as Record<string, unknown>).data;
  const node = parseWorkerNodeView(data);
  if (node.id !== config.nodeId || node.protocolVersion !== 1) {
    throw new Error("Worker identity mismatch");
  }
  return node;
}

async function rankScheduler(
  config: RemoteWorkerConfig,
  controller: AbortController,
  active: (delta: number) => void
): Promise<void> {
  const signal = controller.signal;
  const running = new Set<Promise<void>>();
  let lastPollAt = 0;
  while (!signal.aborted && config.rankSlots > 0) {
    if (running.size >= config.rankSlots) {
      await Promise.race(running);
      continue;
    }
    await wait(Math.max(0, lastPollAt + CLAIM_INTERVAL_MS - Date.now()), signal);
    if (signal.aborted) break;
    try {
      lastPollAt = Date.now();
      const tasks = await claimRank(config, config.rankSlots - running.size, signal);
      if (signal.aborted) break;
      for (const task of tasks) {
        active(1);
        const work = executeRankTask(config, task)
          .catch((error: unknown) => {
            if (error instanceof WorkerAuthenticationError) {
              process.stderr.write(`worker ${config.nodeId} authentication rejected\n`);
              controller.abort();
            }
            // Provider URL, keyword, credential, ticket and response stay out of logs.
          })
          .finally(() => {
            active(-1);
            running.delete(work);
          });
        running.add(work);
      }
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof WorkerAuthenticationError) {
        process.stderr.write(`worker ${config.nodeId} authentication rejected\n`);
        controller.abort();
        break;
      }
      await wait(error instanceof WorkerPausedError ? 10_000 : 2_000, signal);
    }
  }
  // Stop claiming, but let already paid responses reach the central receipt.
  await Promise.allSettled(running);
}

async function executeRankTask(
  config: RemoteWorkerConfig,
  task: RemoteRankPollTaskV1
): Promise<void> {
  const request = rankProviderRequestIntent(task.requestSnapshot);
  const connector = new XmlStockRankConnector(fetch, task.softId);
  const outcome = await connector.fetchResult(
    task.providerTaskId,
    task.secret,
    task.timeoutMs,
    request,
    task.providerProgress
  );
  await completeRank(config, task.ticket, task.requestSnapshot, outcome);
}

async function claimRank(
  config: RemoteWorkerConfig,
  availableSlots: number,
  signal: AbortSignal
): Promise<readonly RemoteRankPollTaskV1[]> {
  const body: RemoteRankClaimV1 = { availableSlots };
  const response = await workerPost(config, "rank/claim", body, signal, 30_000);
  if (response.status === 403) {
    await response.body?.cancel();
    throw new WorkerPausedError();
  }
  const data = await workerData(response, MAX_TASK_BYTES);
  if (!Array.isArray(data) || data.length > MAX_TASKS_PER_POLL) {
    throw new Error("Invalid rank claim batch");
  }
  return data.map(rankTask);
}

async function completeRank(
  config: RemoteWorkerConfig,
  ticket: string,
  requestSnapshot: unknown,
  outcome: unknown
): Promise<void> {
  const signal = AbortSignal.timeout(30_000);
  const body = {
    schemaVersion: "worker-rank-poll-result@1",
    ticket,
    requestSnapshot,
    outcome
  };
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt += 1) {
    try {
      const response = await workerPost(
        config, "rank/complete", body, signal, 8_000
      );
      await workerData(response, MAX_RESPONSE_BYTES);
      return;
    } catch (error) {
      if (error instanceof WorkerAuthenticationError) throw error;
      if (attempt === 2) throw error;
      await wait(500 * (attempt + 1), signal);
    }
  }
}

async function workerPost(
  config: RemoteWorkerConfig,
  route: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number
): Promise<Response> {
  return fetch(new URL(`/worker/v1/${route}`, config.controlUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      "X-Worker-Id": config.nodeId
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  });
}

async function workerData(response: Response, maxBytes: number): Promise<unknown> {
  if (response.status === 401) {
    await response.body?.cancel();
    throw new WorkerAuthenticationError();
  }
  if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    await response.body?.cancel();
    throw new Error("Worker control plane unavailable");
  }
  const payload = JSON.parse(new TextDecoder().decode(await boundedBody(response, maxBytes))) as unknown;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Invalid worker response");
  }
  const envelope = payload as Record<string, unknown>;
  if (!Object.hasOwn(envelope, "data") || !Object.hasOwn(envelope, "meta") ||
    Object.keys(envelope).length !== 2) {
    throw new Error("Invalid worker envelope");
  }
  return envelope.data;
}

function rankTask(value: unknown): RemoteRankPollTaskV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid rank task");
  }
  const input = value as Record<string, unknown>;
  const fields = [
    "schemaVersion", "ticket", "provider", "providerTaskId",
    "requestSnapshot", "secret", "timeoutMs",
    ...(Object.hasOwn(input, "providerProgress") ? ["providerProgress"] : []),
    ...(Object.hasOwn(input, "softId") ? ["softId"] : [])
  ];
  const secret = input.secret;
  const secretRecord = typeof secret === "object" && secret !== null && !Array.isArray(secret)
    ? secret as Record<string, unknown>
    : undefined;
  const secretFields = secretRecord
    ? ["apiKey", ...(Object.hasOwn(secretRecord, "accountIdentifier") ? ["accountIdentifier"] : [])]
    : [];
  if (Object.keys(input).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(input, field)) ||
    input.schemaVersion !== "worker-rank-poll-task@1" ||
    input.provider !== "XMLSTOCK" ||
    typeof input.ticket !== "string" || input.ticket.length > 4096 ||
    !/^wrt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(input.ticket) ||
    typeof input.providerTaskId !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/u.test(input.providerTaskId) ||
    typeof input.timeoutMs !== "number" || !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1_000 || input.timeoutMs > 10_000 ||
    (input.softId !== undefined &&
      (typeof input.softId !== "string" || !/^[a-f0-9]{32}$/iu.test(input.softId))) ||
    !secretRecord || Object.keys(secretRecord).length !== secretFields.length ||
    typeof secretRecord.apiKey !== "string" ||
    secretRecord.apiKey.length < 1 || secretRecord.apiKey.length > 512 ||
    (secretRecord.accountIdentifier !== undefined &&
      (typeof secretRecord.accountIdentifier !== "string" ||
        secretRecord.accountIdentifier.length < 1 ||
        secretRecord.accountIdentifier.length > 512))
  ) throw new Error("Invalid rank task");
  rankProviderRequestIntent(input.requestSnapshot);
  if (input.providerProgress !== undefined) {
    xmlStockRankPageProgress(input.providerProgress);
  }
  return input as unknown as RemoteRankPollTaskV1;
}

async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty control plane response");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > maximum) throw new Error("Oversized control plane response");
      parts.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class WorkerAuthenticationError extends Error {}
class WorkerPausedError extends Error {}

void main().catch(() => {
  process.stderr.write("Worker cannot start; inspect its local configuration\n");
  process.exitCode = 1;
});

import { lstat, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { WorkerCapability } from "@seo-platform/contracts";
import type { MalwareScannerConfig } from "../config/app-config.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKEN_PATTERN = /^wn_[A-Za-z0-9_-]{43}$/u;

export class RemoteWorkerConfigurationError extends Error {
  public constructor(key: string, min: number, max: number) {
    super(`${key} must be an integer from ${min} to ${max}`);
    this.name = "RemoteWorkerConfigurationError";
  }
}

export interface RemoteWorkerConfig {
  readonly controlUrl: URL;
  readonly nodeId: string;
  readonly token: string;
  readonly httpSlots: number;
  readonly cpuSlots: number;
  readonly rankSlots: number;
  readonly heartbeatMs: number;
  readonly logQueries: boolean;
  readonly capabilitySlots:Readonly<Partial<Record<WorkerCapability,number>>>;
  readonly cpuTaskMemoryMb:number;
  readonly malware?:MalwareScannerConfig;
}

export async function loadRemoteWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<RemoteWorkerConfig> {
  const rawUrl = env.WORKER_CONTROL_URL;
  const rawId = env.WORKER_NODE_ID;
  const envToken = env.WORKER_NODE_TOKEN;
  const tokenPath = env.WORKER_NODE_TOKEN_FILE;
  if (!rawUrl || !rawId) {
    throw new Error("Worker control URL and node ID are required");
  }
  if ((envToken === undefined) === (tokenPath === undefined)) {
    throw new Error("Provide exactly one worker node token source");
  }
  let controlUrl: URL;
  try {
    controlUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid worker control URL");
  }
  if (
    controlUrl.protocol !== "https:" ||
    controlUrl.username || controlUrl.password ||
    controlUrl.search || controlUrl.hash ||
    controlUrl.pathname !== "/" ||
    !controlUrl.hostname ||
    (isIP(controlUrl.hostname) === 0 && !/^[A-Za-z0-9.-]+$/u.test(controlUrl.hostname))
  ) {
    throw new Error("Worker control URL must be an HTTPS origin without credentials");
  }
  if (!UUID_PATTERN.test(rawId)) throw new Error("Invalid worker node ID");
  let token = envToken;
  if (tokenPath !== undefined) {
    if (!tokenPath.startsWith("/")) {
      throw new Error("Worker node token file path must be absolute");
    }
    const file = await lstat(tokenPath);
    if (!file.isFile() || (file.mode & 0o077) !== 0) {
      throw new Error("Worker node token must be a private regular file");
    }
    token = (await readFile(tokenPath, "utf8")).trim();
  }
  if (token === undefined || !TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid worker node token");
  }
  const httpSlots = bounded(env.WORKER_HTTP_SLOTS, 16, 1, 512, "WORKER_HTTP_SLOTS");
  const rankSlots = Math.min(httpSlots, bounded(env.WORKER_RANK_SLOTS, 0, 0, 512, "WORKER_RANK_SLOTS"));
  const cpuSlots=bounded(env.WORKER_CPU_SLOTS,2,1,128,"WORKER_CPU_SLOTS");
  const scannerHost=env.WORKER_MALWARE_SCANNER_HOST;
  if(scannerHost && !/^[A-Za-z0-9.-]{1,253}$/u.test(scannerHost)) throw new Error("Invalid worker scanner host");
  // A capability is a requested ceiling. The parent HTTP/CPU pool remains the
  // hard limit, so a larger value cannot prevent an otherwise valid node from
  // starting or make the agent oversubscribe its resources.
  const capacity=(key:string,fallback:number,maximum:number)=>
    Math.min(maximum,bounded(env[key] || undefined,fallback,0,512,key));
  const capabilitySlots={RANK:rankSlots,
    WORDSTAT:capacity("WORKER_WORDSTAT_SLOTS",Math.min(httpSlots,10),httpSlots),
    RESEARCH:capacity("WORKER_RESEARCH_SLOTS",Math.min(httpSlots,10),httpSlots),
    AI_ANSWER:capacity("WORKER_AI_ANSWER_SLOTS",Math.min(httpSlots,5),httpSlots),
    CLUSTERING:capacity("WORKER_CLUSTERING_SLOTS",Math.min(httpSlots,2),httpSlots),
    CRAWL:capacity("WORKER_CRAWL_SLOTS",httpSlots,httpSlots),
    IMPORT:capacity("WORKER_IMPORT_SLOTS",cpuSlots,cpuSlots),
    EXPORT:capacity("WORKER_EXPORT_SLOTS",cpuSlots,cpuSlots),
    INSPECTION:capacity("WORKER_INSPECTION_SLOTS",scannerHost ? 1 : 0,cpuSlots)};
  return {
    controlUrl,
    nodeId: rawId.toLowerCase(),
    token,
    httpSlots,
    cpuSlots,
    rankSlots,
    heartbeatMs: bounded(env.WORKER_HEARTBEAT_MS, 10_000, 3_000, 30_000, "WORKER_HEARTBEAT_MS"),
    logQueries: env.WORKER_LOG_QUERIES === "true",
    capabilitySlots,
    cpuTaskMemoryMb:bounded(env.WORKER_CPU_TASK_MEMORY_MB,1024,128,16_384,"WORKER_CPU_TASK_MEMORY_MB"),
    ...(scannerHost ? {malware:{enabled:true,host:scannerHost,port:bounded(env.WORKER_MALWARE_SCANNER_PORT,3310,1,65535,"WORKER_MALWARE_SCANNER_PORT"),connectTimeoutMs:3_000,scanTimeoutMs:900_000}} : {})
  };
}

function bounded(value: string | undefined, fallback: number, min: number, max: number, key: string): number {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]{0,5})$/u.test(value)) throw new RemoteWorkerConfigurationError(key,min,max);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RemoteWorkerConfigurationError(key,min,max);
  }
  return parsed;
}

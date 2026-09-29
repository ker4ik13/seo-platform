import { lstat, readFile } from "node:fs/promises";
import { isIP } from "node:net";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKEN_PATTERN = /^wn_[A-Za-z0-9_-]{43}$/u;

export interface RemoteWorkerConfig {
  readonly controlUrl: URL;
  readonly nodeId: string;
  readonly token: string;
  readonly httpSlots: number;
  readonly cpuSlots: number;
  readonly rankSlots: number;
  readonly heartbeatMs: number;
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
  const httpSlots = bounded(env.WORKER_HTTP_SLOTS, 16, 1, 512);
  const rankSlots = bounded(env.WORKER_RANK_SLOTS, 0, 0, httpSlots);
  return {
    controlUrl,
    nodeId: rawId.toLowerCase(),
    token,
    httpSlots,
    cpuSlots: bounded(env.WORKER_CPU_SLOTS, 2, 1, 128),
    rankSlots,
    heartbeatMs: bounded(env.WORKER_HEARTBEAT_MS, 10_000, 3_000, 30_000)
  };
}

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]{0,5})$/u.test(value)) throw new Error("Invalid worker capacity");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error("Invalid worker capacity");
  }
  return parsed;
}

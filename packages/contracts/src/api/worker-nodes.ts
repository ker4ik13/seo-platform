export const workerCapabilities = [
  "RANK", "WORDSTAT", "RESEARCH", "AI_ANSWER", "CLUSTERING",
  "CRAWL", "IMPORT", "EXPORT", "INSPECTION"
] as const;

export type WorkerCapability = typeof workerCapabilities[number];

export interface WorkerNodeConfiguration {
  readonly name: string;
  readonly capabilities: readonly WorkerCapability[];
  readonly maxHttpSlots: number;
  readonly maxCpuSlots: number;
}

export interface WorkerNodeHeartbeat {
  readonly protocolVersion: 1;
  readonly httpSlots: number;
  readonly rankSlots: number;
  readonly cpuSlots: number;
  readonly memoryBytes: string;
  readonly activeWorkItems: number;
}

export interface WorkerNodeView {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly draining: boolean;
  readonly capabilities: readonly WorkerCapability[];
  readonly maxHttpSlots: number;
  readonly maxCpuSlots: number;
  readonly reportedHttpSlots: number;
  readonly reportedRankSlots: number;
  readonly reportedCpuSlots: number;
  readonly reportedMemoryBytes: string;
  readonly activeWorkItems: number;
  readonly online: boolean;
  readonly lastHeartbeatAt: string | null;
  readonly protocolVersion: number | null;
  readonly activeAssignments?: readonly {
    readonly jobId: string;
    readonly capability: "RANK";
    readonly searchEngine: "YANDEX" | "GOOGLE" | null;
    readonly activeTasks: number;
  }[];
}

export interface CreatedWorkerNode {
  readonly node: WorkerNodeView;
  /** Display once to an operations administrator; never log or persist plaintext. */
  readonly token: string;
}

export function parseWorkerNodeConfiguration(value: unknown): WorkerNodeConfiguration {
  const input = exact(value, ["name", "capabilities", "maxHttpSlots", "maxCpuSlots"]);
  if (
    typeof input.name !== "string" ||
    input.name.trim().length < 1 ||
    input.name.length > 100 ||
    !Array.isArray(input.capabilities) ||
    input.capabilities.length < 1 ||
    input.capabilities.length > workerCapabilities.length ||
    input.capabilities.some((item) => typeof item !== "string" || !capabilitySet.has(item)) ||
    new Set(input.capabilities).size !== input.capabilities.length ||
    !bounded(input.maxHttpSlots, 1, 512) ||
    !bounded(input.maxCpuSlots, 1, 128)
  ) invalid();
  return {
    name: input.name.trim(),
    capabilities: input.capabilities as WorkerCapability[],
    maxHttpSlots: input.maxHttpSlots,
    maxCpuSlots: input.maxCpuSlots
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKEN_PATTERN = /^wn_[A-Za-z0-9_-]{43}$/u;
const capabilitySet = new Set<string>(workerCapabilities);

export function parseWorkerNodeView(value: unknown): WorkerNodeView {
  const input = exact(value, [
    "id", "name", "enabled", "draining", "capabilities",
    "maxHttpSlots", "maxCpuSlots", "reportedHttpSlots", "reportedCpuSlots",
    "reportedRankSlots",
    "reportedMemoryBytes", "activeWorkItems", "online", "lastHeartbeatAt",
    "protocolVersion",
    ...(typeof value === "object" && value !== null &&
      Object.hasOwn(value, "activeAssignments") ? ["activeAssignments"] : [])
  ]);
  if (
    typeof input.id !== "string" || !UUID_PATTERN.test(input.id) ||
    typeof input.name !== "string" || input.name.length < 1 || input.name.length > 100 ||
    typeof input.enabled !== "boolean" || typeof input.draining !== "boolean" ||
    !Array.isArray(input.capabilities) ||
    input.capabilities.some((item) => typeof item !== "string" || !capabilitySet.has(item)) ||
    new Set(input.capabilities).size !== input.capabilities.length ||
    !bounded(input.maxHttpSlots, 1, 512) ||
    !bounded(input.maxCpuSlots, 1, 128) ||
    !bounded(input.reportedHttpSlots, 0, 512) ||
    !bounded(input.reportedRankSlots, 0, 512) ||
    !bounded(input.reportedCpuSlots, 0, 128) ||
    typeof input.reportedMemoryBytes !== "string" ||
    !/^(?:0|[1-9][0-9]{0,15})$/u.test(input.reportedMemoryBytes) ||
    !bounded(input.activeWorkItems, 0, 4096) ||
    typeof input.online !== "boolean" ||
    (input.lastHeartbeatAt !== null &&
      (typeof input.lastHeartbeatAt !== "string" ||
        Number.isNaN(Date.parse(input.lastHeartbeatAt)))) ||
    (input.protocolVersion !== null && !bounded(input.protocolVersion, 1, 100))
  ) invalid();
  if (input.activeAssignments !== undefined) {
    if (!Array.isArray(input.activeAssignments) || input.activeAssignments.length > 1000) invalid();
    for (const assignment of input.activeAssignments) {
      const row = exact(assignment, ["jobId", "capability", "searchEngine", "activeTasks"]);
      if (typeof row.jobId !== "string" || !UUID_PATTERN.test(row.jobId) ||
        row.capability !== "RANK" ||
        (row.searchEngine !== null && row.searchEngine !== "YANDEX" && row.searchEngine !== "GOOGLE") ||
        !bounded(row.activeTasks, 1, 512)) invalid();
    }
  }
  return input as unknown as WorkerNodeView;
}

export function parseCreatedWorkerNode(value: unknown): CreatedWorkerNode {
  const input = exact(value, ["node", "token"]);
  if (typeof input.token !== "string" || !TOKEN_PATTERN.test(input.token)) invalid();
  return { node: parseWorkerNodeView(input.node), token: input.token };
}

function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(input, field))) invalid();
  return input;
}

function bounded(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= minimum && value <= maximum;
}

function invalid(): never {
  throw new TypeError("Invalid worker node response");
}

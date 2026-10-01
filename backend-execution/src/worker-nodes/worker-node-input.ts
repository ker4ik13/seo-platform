import { BadRequestException } from "@nestjs/common";
import {
  parseWorkerNodeConfiguration,
  parseWorkerCapabilitySlots,
  type WorkerCapability,
  type WorkerNodeConfiguration
} from "@seo-platform/contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface WorkerNodeHeartbeat {
  readonly protocolVersion: 1;
  readonly httpSlots: number;
  readonly rankSlots: number;
  readonly cpuSlots: number;
  readonly memoryBytes: bigint;
  readonly activeWorkItems: number;
  readonly capabilitySlots?: Readonly<Partial<Record<WorkerCapability, number>>>;
  readonly buildHash?: string;
}

export function workerNodeId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

export function workerNodeConfiguration(value: unknown): WorkerNodeConfiguration {
  try {
    return parseWorkerNodeConfiguration(value);
  } catch {
    invalid();
  }
}

export function workerNodeHeartbeat(value: unknown): WorkerNodeHeartbeat {
  const input = exact(value, [
    "protocolVersion", "httpSlots", "rankSlots", "cpuSlots", "memoryBytes", "activeWorkItems",
    ...(value && typeof value === "object" && Object.hasOwn(value,"capabilitySlots") ? ["capabilitySlots"] : []),
    ...(value && typeof value === "object" && Object.hasOwn(value,"buildHash") ? ["buildHash"] : [])
  ]);
  if (
    input.protocolVersion !== 1 ||
    !boundedInteger(input.httpSlots, 0, 512) ||
    !boundedInteger(input.rankSlots, 0, 512) ||
    Number(input.rankSlots) > Number(input.httpSlots) ||
    !boundedInteger(input.cpuSlots, 0, 128) ||
    !boundedInteger(input.activeWorkItems, 0, 4096) ||
    typeof input.memoryBytes !== "string" ||
    !/^(?:0|[1-9][0-9]{0,15})$/u.test(input.memoryBytes) ||
    (input.buildHash !== undefined &&
      (typeof input.buildHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.buildHash)))
  ) invalid();
  return {
    protocolVersion: 1,
    httpSlots: input.httpSlots,
    rankSlots: input.rankSlots,
    cpuSlots: input.cpuSlots,
    memoryBytes: BigInt(input.memoryBytes),
    activeWorkItems: input.activeWorkItems,
    capabilitySlots: input.capabilitySlots === undefined ? { RANK: input.rankSlots } : parseWorkerCapabilitySlots(input.capabilitySlots),
    ...(input.buildHash === undefined ? {} : { buildHash: input.buildHash as string })
  };
}

export function workerNodeEnabled(value: unknown): boolean {
  const input = exact(value, ["enabled"]);
  if (typeof input.enabled !== "boolean") invalid();
  return input.enabled;
}

export function workerNodeDraining(value: unknown): boolean {
  const input = exact(value, ["draining"]);
  if (typeof input.draining !== "boolean") invalid();
  return input.draining;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= minimum && value <= maximum;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) invalid();
  return input;
}

function invalid(): never {
  throw new BadRequestException("Invalid worker node request");
}

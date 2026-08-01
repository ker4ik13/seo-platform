import type {
  FrequencyCollectionStatus,
  FrequencyCollectionSummary,
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import type { Job, JobItem } from "../generated/prisma/client.js";

export type FrequencyJob = Job & { readonly items: readonly JobItem[] };

export function frequencyCollectionSummary(
  job: FrequencyJob
): FrequencyCollectionSummary {
  const input = inputSnapshot(job.inputSnapshot);
  const completedKeywords = job.items.filter(
    ({ status }) => status === "COMPLETED"
  ).length;
  const failedKeywords = job.items.filter(
    ({ status }) => status === "FAILED_FINAL"
  ).length;
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    projectId: required(job.projectId),
    provider: "XMLSTOCK",
    status: status(job.status),
    ...(job.stage ? { stage: job.stage } : {}),
    selectedKeywords: job.items.length,
    completedKeywords,
    failedKeywords,
    types: input.types,
    regionCode: input.regionCode,
    device: input.device,
    ...(job.retryAt ? { retryAt: job.retryAt.toISOString() } : {}),
    ...failureCode(job.errorSummary),
    version: job.version,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {})
  };
}

function inputSnapshot(value: unknown): {
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
} {
  const input = record(value);
  const types = Array.isArray(input?.types)
    ? input.types.filter(
        (value): value is SemanticFrequencyType =>
          value === "BASE" || value === "EXACT" || value === "FIXED"
      )
    : [];
  if (
    types.length < 1 ||
    typeof input?.regionCode !== "string" ||
    !device(input.device)
  ) invalid();
  return { types, regionCode: input.regionCode, device: input.device };
}

function status(value: string): FrequencyCollectionStatus {
  switch (value) {
    case "QUEUED":
    case "RUNNING":
    case "WAITING_RATE_LIMIT":
    case "RETRY_SCHEDULED":
    case "ACTION_REQUIRED":
    case "CANCEL_REQUESTED":
    case "CANCELLED":
    case "PARTIALLY_COMPLETED":
    case "COMPLETED":
    case "FAILED_RETRYABLE":
    case "FAILED_FINAL":
      return value;
    default:
      invalid();
  }
}

function failureCode(value: unknown): { readonly failureCode?: string } {
  const code = record(value)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
    ? { failureCode: code }
    : {};
}

function device(value: unknown): value is SemanticFrequencyDevice {
  return (
    value === "ALL" ||
    value === "DESKTOP" ||
    value === "MOBILE" ||
    value === "PHONE_ONLY" ||
    value === "TABLET_ONLY"
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function required(value: string | null): string {
  if (!value) invalid();
  return value;
}

function invalid(): never {
  throw new Error("Invalid frequency collection record");
}

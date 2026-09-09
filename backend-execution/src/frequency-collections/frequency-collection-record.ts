import type {
  FrequencyCollectionStatus,
  FrequencyCollectionProvider,
  FrequencyCollectionSummary,
  FrequencyCollectionMode,
  FrequencySeasonalityRequest,
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope,
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import { frequencyCollectionKeywordLimit } from "@seo-platform/contracts";
import { parseFrequencySeasonalityRequest } from "@seo-platform/contracts";
import type { Job } from "../generated/prisma/client.js";

export type FrequencyJob = Job;

export function frequencyCollectionSummary(
  job: FrequencyJob
): FrequencyCollectionSummary {
  const input = inputSnapshot(job.inputSnapshot);
  const currentStatus = status(job.status);
  const currentFailure = failureCode(job.errorSummary);
  const route = routeSnapshot(
    job.scopeSnapshot,
    currentStatus,
    currentFailure.failureCode
  );
  if (job.progressTotal === null) invalid();
  const selectedKeywords = boundedCount(job.progressTotal);
  const completedKeywords = boundedCount(job.progressCurrent);
  const failedKeywords = failedCount(job.resultSummary, job.errorSummary);
  if (
    completedKeywords > selectedKeywords ||
    failedKeywords > selectedKeywords ||
    completedKeywords + failedKeywords > selectedKeywords
  ) invalid();
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    projectId: required(job.projectId),
    ...(job.actorId ? { actorId: job.actorId } : {}),
    provider: provider(job.provider),
    ...(["BYOK_API_KEY", "PLATFORM_PAID"].includes(job.credentialMode) ? { credentialMode: job.credentialMode as "BYOK_API_KEY" | "PLATFORM_PAID" } : {}),
    ...(route.routingScope ? { routingScope: route.routingScope } : {}),
    ...(route.connectorAttempts.length > 0
      ? { connectorAttempts: route.connectorAttempts }
      : {}),
    status: currentStatus,
    ...(job.stage ? { stage: job.stage } : {}),
    selectedKeywords,
    completedKeywords,
    failedKeywords,
    mode: input.mode,
    types: input.types,
    regionCode: input.regionCode,
    device: input.device,
    ...(input.seasonality ? { seasonality: input.seasonality } : {}),
    ...(job.retryAt ? { retryAt: job.retryAt.toISOString() } : {}),
    ...currentFailure,
    version: job.version,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {})
  };
}

function routeSnapshot(
  value: unknown,
  collectionStatus: FrequencyCollectionStatus,
  failureCode?: string
): {
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts: readonly ConnectorOperationAttemptSummary[];
} {
  const input = record(value);
  const hasRoutingScope = input?.routingScope !== undefined;
  const hasConnectorAttempts = input?.connectorAttempts !== undefined;
  if (hasRoutingScope !== hasConnectorAttempts) invalid();
  if (!hasRoutingScope) return { connectorAttempts: [] };
  const routingScope = connectorRoutingScope(input?.routingScope);
  if (
    !routingScope ||
    !Array.isArray(input?.connectorAttempts) ||
    input.connectorAttempts.length < 1 ||
    input.connectorAttempts.length > 8
  ) invalid();
  const storedAttempts = input.connectorAttempts;
  const terminalSuccess =
    collectionStatus === "COMPLETED" ||
    collectionStatus === "PARTIALLY_COMPLETED";
  const terminalFailure =
    collectionStatus === "FAILED_FINAL" ||
    collectionStatus === "ACTION_REQUIRED";
  const connectorAttempts = storedAttempts.map((candidate, index) => {
    const attempt = connectorAttempt(candidate, index + 1);
    if (index !== storedAttempts.length - 1 || attempt.outcome !== "SELECTED") {
      return attempt;
    }
    if (terminalSuccess) return { ...attempt, outcome: "SUCCEEDED" as const };
    if (terminalFailure) {
      return {
        ...attempt,
        outcome: "FAILED" as const,
        ...(attempt.reasonCode || !failureCode ? {} : { reasonCode: failureCode })
      };
    }
    return attempt;
  });
  return {
    ...(routingScope ? { routingScope } : {}),
    connectorAttempts
  };
}

function connectorAttempt(
  value: unknown,
  expectedSequence: number
): ConnectorOperationAttemptSummary {
  const input = record(value);
  if (!input) invalid();
  const sequence = Number(input.sequence);
  const providerValue = input.provider;
  const routingScope = connectorRoutingScope(input.routingScope);
  const outcome = input.outcome;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence !== expectedSequence ||
    (providerValue !== "XMLSTOCK" && providerValue !== "ARSENKIN" && providerValue !== "KEYS_SO") ||
    !routingScope ||
    (outcome !== "SELECTED" && outcome !== "SUCCEEDED" && outcome !== "FALLBACK" && outcome !== "FAILED") ||
    typeof input.occurredAt !== "string" ||
    !Number.isFinite(new Date(input.occurredAt).getTime()) ||
    (input.reasonCode !== undefined &&
      (typeof input.reasonCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.reasonCode)))
  ) invalid();
  return {
    sequence,
    provider: providerValue,
    routingScope,
    outcome,
    ...(typeof input.reasonCode === "string" ? { reasonCode: input.reasonCode } : {}),
    occurredAt: input.occurredAt
  };
}

function connectorRoutingScope(value: unknown): ConnectorRoutingScope | undefined {
  return value === "WORKSPACE_DEFAULT" || value === "PROJECT_OVERRIDE" || value === "WORKSPACE_FALLBACK"
    ? value
    : undefined;
}

function boundedCount(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > frequencyCollectionKeywordLimit) {
    invalid();
  }
  return result;
}

function failedCount(resultSummary: unknown, errorSummary: unknown): number {
  const value = record(resultSummary)?.failed ?? record(errorSummary)?.failed ?? 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > frequencyCollectionKeywordLimit) {
    invalid();
  }
  return Number(value);
}

function inputSnapshot(value: unknown): {
  readonly mode: FrequencyCollectionMode;
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly seasonality?: FrequencySeasonalityRequest;
} {
  const input = record(value);
  if (!Array.isArray(input?.types) || input.types.length < 1 || input.types.length > 3) {
    invalid();
  }
  const types = input.types.map((value): SemanticFrequencyType => {
    if (value !== "BASE" && value !== "EXACT" && value !== "FIXED") invalid();
    return value;
  });
  const mode = input?.mode === undefined ? "FREQUENCY" : input.mode;
  if (
    new Set(types).size !== types.length ||
    (mode !== "FREQUENCY" && mode !== "SEASONALITY") ||
    typeof input?.regionCode !== "string" ||
    !device(input.device)
  ) invalid();
  let seasonality;
  if (mode === "SEASONALITY") {
    // Historical XMLStock jobs may contain several types admitted before the
    // current create boundary was narrowed to the provider's reliable BASE series.
    try {
      seasonality = parseFrequencySeasonalityRequest(input?.seasonality);
    } catch {
      invalid();
    }
  } else if (input?.seasonality !== undefined) {
    invalid();
  }
  return {
    mode,
    types,
    regionCode: input.regionCode,
    device: input.device,
    ...(seasonality ? { seasonality } : {})
  };
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

function provider(value: string | null): FrequencyCollectionProvider {
  if (value !== "XMLSTOCK" && value !== "ARSENKIN") invalid();
  return value;
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

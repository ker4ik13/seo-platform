import type {
  AiAnswerCollectionStatus,
  AiAnswerCollectionSummary,
  AiAnswerDevice,
  AiAnswerSearchEngine,
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope
} from "@seo-platform/contracts";
import type { Job } from "../generated/prisma/client.js";

export function aiAnswerCollectionSummary(job: Job): AiAnswerCollectionSummary {
  const input = object(job.inputSnapshot);
  const scope = object(job.scopeSnapshot);
  if (!job.projectId || job.progressTotal === null) invalid();
  const selectedKeywords = count(job.progressTotal);
  const completedKeywords = count(job.progressCurrent);
  const failedKeywords = summaryCount(job.resultSummary, job.errorSummary);
  const searchEngine = engine(input.searchEngine);
  const deviceValue = device(input.device);
  if (
    typeof input.regionCode !== "string" ||
    typeof input.host !== "string" ||
    !searchEngine ||
    !deviceValue
  ) invalid();
  const routingScope = connectorRoutingScope(scope.routingScope);
  const attempts = connectorAttempts(scope.connectorAttempts);
  const storedFailureCode = failureCode(job.errorSummary);
  if ((routingScope === undefined) !== (attempts.length === 0)) invalid();
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    provider: "ARSENKIN",
    ...(routingScope ? { routingScope } : {}),
    ...(attempts.length ? { connectorAttempts: attempts } : {}),
    status: status(job.status),
    ...(job.stage ? { stage: job.stage } : {}),
    selectedKeywords,
    completedKeywords,
    failedKeywords,
    searchEngine,
    regionCode: input.regionCode,
    device: deviceValue,
    host: input.host,
    ...(job.retryAt ? { retryAt: job.retryAt.toISOString() } : {}),
    ...(storedFailureCode ? { failureCode: storedFailureCode } : {}),
    version: job.version,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {})
  };
}

function connectorAttempts(value: unknown): readonly ConnectorOperationAttemptSummary[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  return value.map((candidate, index) => {
    const input = object(candidate);
    const routingScope = connectorRoutingScope(input.routingScope);
    if (
      input.sequence !== index + 1 ||
      input.provider !== "ARSENKIN" ||
      !routingScope ||
      !["SELECTED", "SUCCEEDED", "FALLBACK", "FAILED"].includes(String(input.outcome)) ||
      typeof input.occurredAt !== "string" ||
      !Number.isFinite(new Date(input.occurredAt).getTime())
    ) invalid();
    return {
      sequence: index + 1,
      provider: "ARSENKIN",
      routingScope,
      outcome: input.outcome as ConnectorOperationAttemptSummary["outcome"],
      ...(typeof input.reasonCode === "string" ? { reasonCode: input.reasonCode } : {}),
      occurredAt: input.occurredAt
    };
  });
}

function connectorRoutingScope(value: unknown): ConnectorRoutingScope | undefined {
  return value === "WORKSPACE_DEFAULT" || value === "PROJECT_OVERRIDE" || value === "WORKSPACE_FALLBACK"
    ? value
    : undefined;
}

function engine(value: unknown): AiAnswerSearchEngine | undefined {
  return value === "YANDEX" || value === "GOOGLE" ? value : undefined;
}

function device(value: unknown): AiAnswerDevice | undefined {
  return value === "DESKTOP" || value === "MOBILE" ? value : undefined;
}

function status(value: string): AiAnswerCollectionStatus {
  if ([
    "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED",
    "ACTION_REQUIRED", "CANCELLED", "PARTIALLY_COMPLETED", "COMPLETED",
    "FAILED_RETRYABLE", "FAILED_FINAL"
  ].includes(value)) return value as AiAnswerCollectionStatus;
  invalid();
}

function count(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 10_000) invalid();
  return result;
}

function summaryCount(result: unknown, error: unknown): number {
  const value = objectOrUndefined(result)?.failed ?? objectOrUndefined(error)?.failed ?? 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) invalid();
  return Number(value);
}

function failureCode(value: unknown): string | undefined {
  const code = objectOrUndefined(value)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : undefined;
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  const result = objectOrUndefined(value);
  if (!result) invalid();
  return result;
}

function objectOrUndefined(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function invalid(): never {
  throw new Error("Invalid AI answer collection record");
}

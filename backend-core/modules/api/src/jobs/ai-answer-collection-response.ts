import {
  aiAnswerCollectionStatuses,
  aiAnswerDevices,
  aiAnswerSearchEngines,
  arsenkinAiAnswerKeywordLimit,
  connectorRoutingScopes,
  type AiAnswerCollectionSummary,
  type ConnectorOperationAttemptSummary,
  type InternalAiAnswerOperationScope,
  type InternalAiAnswerOperationScopeItem
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

export function scopedAiAnswerCollection(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedId?: string
): AiAnswerCollectionSummary {
  const input = record(value);
  const id = uuid(input.id);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (expectedId && id !== expectedId) ||
    input.provider !== "ARSENKIN"
  ) invalid();
  const hasScope = input.routingScope !== undefined;
  const hasAttempts = input.connectorAttempts !== undefined;
  if (hasScope !== hasAttempts) invalid();
  return {
    id,
    workspaceId,
    projectId,
    provider: "ARSENKIN",
    ...(hasScope ? { routingScope: member(input.routingScope, connectorRoutingScopes) } : {}),
    ...(hasAttempts ? { connectorAttempts: attempts(input.connectorAttempts) } : {}),
    status: member(input.status, aiAnswerCollectionStatuses),
    ...(typeof input.stage === "string" ? { stage: bounded(input.stage, 64) } : {}),
    selectedKeywords: integer(input.selectedKeywords, 1, arsenkinAiAnswerKeywordLimit),
    completedKeywords: integer(input.completedKeywords, 0, arsenkinAiAnswerKeywordLimit),
    failedKeywords: integer(input.failedKeywords, 0, arsenkinAiAnswerKeywordLimit),
    searchEngine: member(input.searchEngine, aiAnswerSearchEngines),
    regionCode: bounded(input.regionCode, 100),
    device: member(input.device, aiAnswerDevices),
    host: bounded(input.host, 253),
    ...(input.retryAt === undefined ? {} : { retryAt: timestamp(input.retryAt) }),
    ...(typeof input.failureCode === "string" ? { failureCode: bounded(input.failureCode, 64) } : {}),
    version: integer(input.version, 1, Number.MAX_SAFE_INTEGER),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
    ...(input.startedAt === undefined ? {} : { startedAt: timestamp(input.startedAt) }),
    ...(input.finishedAt === undefined ? {} : { finishedAt: timestamp(input.finishedAt) })
  };
}

export function scopedAiAnswerOperationScope(
  value: unknown,
  workspaceId: string,
  projectId: string,
  jobId: string,
  limit: number,
  cursor?: string
): InternalAiAnswerOperationScope {
  const input = record(value);
  const page = record(input.page);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    uuid(input.jobId) !== jobId ||
    !Array.isArray(input.items) ||
    input.items.length > limit ||
    typeof page.hasNext !== "boolean" ||
    (page.hasNext &&
      (typeof page.nextCursor !== "string" || input.items.length !== limit)) ||
    (!page.hasNext && page.nextCursor !== undefined) ||
    Object.keys(page).some(
      (key) => key !== "hasNext" && key !== "nextCursor"
    )
  ) invalid();
  const keywordIds = new Set<string>();
  const sequences = new Set<number>();
  const items = input.items.map((value): InternalAiAnswerOperationScopeItem => {
    const item = record(value);
    const keywordId = uuid(item.keywordId);
    const sequence = integer(item.sequence, 0, arsenkinAiAnswerKeywordLimit - 1);
    if (
      keywordIds.has(keywordId) ||
      sequences.has(sequence) ||
      typeof item.status !== "string" ||
      ![
        "PENDING",
        "QUEUED",
        "RUNNING",
        "COMPLETED",
        "FAILED_RETRYABLE",
        "FAILED_FINAL",
        "CANCELLED"
      ].includes(item.status) ||
      !Number.isSafeInteger(item.attempt) ||
      Number(item.attempt) < 0 ||
      typeof item.providerSubmitted !== "boolean" ||
      (item.errorCode !== undefined &&
        (typeof item.errorCode !== "string" ||
          !/^[A-Z][A-Z0-9_]{0,63}$/u.test(item.errorCode)))
    ) invalid();
    keywordIds.add(keywordId);
    sequences.add(sequence);
    return {
      sequence,
      keywordId,
      status: item.status as InternalAiAnswerOperationScopeItem["status"],
      attempt: Number(item.attempt),
      providerSubmitted: item.providerSubmitted,
      ...(typeof item.errorCode === "string" ? { errorCode: item.errorCode } : {}),
      updatedAt: timestamp(item.updatedAt)
    };
  });
  const firstSequence = cursor === undefined ? 0 : Number(cursor) + 1;
  if (
    items.some((item, index) => item.sequence !== firstSequence + index) ||
    (page.hasNext && page.nextCursor !== String(items.at(-1)?.sequence))
  ) invalid();
  return {
    workspaceId,
    projectId,
    jobId,
    items,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string" ? { nextCursor: page.nextCursor } : {})
    }
  };
}

function attempts(value: unknown): readonly ConnectorOperationAttemptSummary[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  return value.map((candidate, index) => {
    const input = record(candidate);
    if (input.sequence !== index + 1 || input.provider !== "ARSENKIN") invalid();
    return {
      sequence: index + 1,
      provider: "ARSENKIN",
      routingScope: member(input.routingScope, connectorRoutingScopes),
      outcome: member(input.outcome, ["SELECTED", "SUCCEEDED", "FALLBACK", "FAILED"] as const),
      ...(typeof input.reasonCode === "string" ? { reasonCode: bounded(input.reasonCode, 64) } : {}),
      occurredAt: timestamp(input.occurredAt)
    };
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
}

function member<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) invalid();
  return value.toLowerCase();
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function bounded(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum) invalid();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs returned an invalid AI answer collection response",
    retryable: true
  });
}

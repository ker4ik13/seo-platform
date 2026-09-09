import {
  frequencyCollectionKeywordLimit,
  frequencyCollectionModes,
  frequencyCollectionStatuses,
  frequencyCollectionProviders,
  connectorRoutingScopes,
  semanticFrequencyDevices,
  semanticFrequencyTypes,
  parseFrequencySeasonalityRequest,
  type FrequencyCollectionStatus,
  type FrequencyCollectionSummary,
  type ConnectorOperationAttemptSummary,
  type InternalFrequencyOperationScope,
  type InternalFrequencyOperationScopeItem,
  type SemanticFrequencyDevice,
  type SemanticFrequencyType
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function scopedFrequencyCollection(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedId?: string
): FrequencyCollectionSummary {
  const input = record(value);
  const id = uuid(input.id);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (expectedId !== undefined && id !== expectedId) ||
    typeof input.provider !== "string" ||
    !frequencyCollectionProviders.includes(input.provider as never)
  ) invalid();
  const provider = member(input.provider, frequencyCollectionProviders);
  if (
    !Array.isArray(input.types) ||
    input.types.length < 1 ||
    input.types.length > semanticFrequencyTypes.length
  ) {
    invalid();
  }
  const types = input.types.map((value) => member(value, semanticFrequencyTypes));
  if (new Set(types).size !== types.length) invalid();
  const mode = input.mode === undefined
    ? "FREQUENCY"
    : member(input.mode, frequencyCollectionModes);
  let seasonality;
  if (mode === "SEASONALITY") {
    if (provider === "ARSENKIN" && (types.length !== 1 || types[0] !== "BASE")) {
      invalid();
    }
    try {
      seasonality = parseFrequencySeasonalityRequest(input.seasonality);
    } catch {
      invalid();
    }
  } else if (input.seasonality !== undefined) {
    invalid();
  }
  const hasRoutingScope = input.routingScope !== undefined;
  const hasConnectorAttempts = input.connectorAttempts !== undefined;
  if (input.requiresUsageReview !== undefined && typeof input.requiresUsageReview !== "boolean") invalid();
  if (hasRoutingScope !== hasConnectorAttempts) invalid();
  return {
    id,
    workspaceId,
    projectId,
    ...(input.actorId === undefined ? {} : { actorId: uuid(input.actorId) }),
    provider,
    ...(input.credentialMode === undefined ? {} : { credentialMode: member(input.credentialMode, ["BYOK_API_KEY", "PLATFORM_PAID"] as const) }),
    ...(input.requiresUsageReview === undefined ? {} : { requiresUsageReview: input.requiresUsageReview as boolean }),
    ...(!hasRoutingScope
      ? {}
      : { routingScope: member(input.routingScope, connectorRoutingScopes) }),
    ...(!hasConnectorAttempts
      ? {}
      : { connectorAttempts: connectorAttempts(input.connectorAttempts) }),
    status: member(input.status, frequencyCollectionStatuses),
    ...optionalString(input.stage, "stage", 64),
    selectedKeywords: integer(
      input.selectedKeywords,
      1,
      frequencyCollectionKeywordLimit
    ),
    completedKeywords: integer(
      input.completedKeywords,
      0,
      frequencyCollectionKeywordLimit
    ),
    failedKeywords: integer(
      input.failedKeywords,
      0,
      frequencyCollectionKeywordLimit
    ),
    mode,
    types,
    regionCode: string(input.regionCode, 100),
    device: member(input.device, semanticFrequencyDevices),
    ...(seasonality ? { seasonality } : {}),
    ...optionalTimestamp(input.retryAt, "retryAt"),
    ...optionalString(input.failureCode, "failureCode", 64),
    version: integer(input.version, 1, Number.MAX_SAFE_INTEGER),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
    ...optionalTimestamp(input.startedAt, "startedAt"),
    ...optionalTimestamp(input.finishedAt, "finishedAt")
  };
}

function connectorAttempts(value: unknown): readonly ConnectorOperationAttemptSummary[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  return value.map((candidate, index) => {
    const input = record(candidate);
    if (input.sequence !== index + 1) invalid();
    const occurredAt = timestamp(input.occurredAt);
    const outcome = member(input.outcome, ["SELECTED", "SUCCEEDED", "FALLBACK", "FAILED"] as const);
    const provider = member(input.provider, ["XMLSTOCK", "ARSENKIN", "KEYS_SO"] as const);
    return {
      sequence: index + 1,
      provider,
      routingScope: member(input.routingScope, connectorRoutingScopes),
      outcome,
      ...optionalString(input.reasonCode, "reasonCode", 64),
      occurredAt
    };
  });
}

export function scopedFrequencyOperationScope(
  value: unknown,
  workspaceId: string,
  projectId: string,
  jobId: string,
  limit: number,
  cursor?: string
): InternalFrequencyOperationScope {
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
      (typeof page.nextCursor !== "string" ||
        input.items.length !== limit)) ||
    (!page.hasNext && page.nextCursor !== undefined) ||
    Object.keys(page).some(
      (key) => key !== "hasNext" && key !== "nextCursor"
    )
  ) {
    invalid();
  }
  const keywordIds = new Set<string>();
  const sequences = new Set<number>();
  const items = input.items.map((value): InternalFrequencyOperationScopeItem => {
    const item = record(value);
    const keywordId = uuid(item.keywordId);
    const sequence = integer(
      item.sequence,
      0,
      frequencyCollectionKeywordLimit - 1
    );
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
      (item.errorCode !== undefined &&
        (typeof item.errorCode !== "string" ||
          !/^[A-Z][A-Z0-9_]{0,63}$/u.test(item.errorCode)))
    ) {
      invalid();
    }
    keywordIds.add(keywordId);
    sequences.add(sequence);
    return {
      sequence,
      keywordId,
      status: item.status as InternalFrequencyOperationScopeItem["status"],
      ...(typeof item.errorCode === "string"
        ? { errorCode: item.errorCode }
        : {})
    };
  });
  const firstSequence = cursor === undefined ? 0 : Number(cursor) + 1;
  if (
    items.some((item, index) => item.sequence !== firstSequence + index) ||
    (page.hasNext &&
      page.nextCursor !== String(items.at(-1)?.sequence))
  ) invalid();
  return {
    workspaceId,
    projectId,
    jobId,
    items,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {})
    }
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function string(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max) invalid();
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid();
  return Number(value);
}

function member<const Values extends readonly string[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid();
  return value;
}

function optionalTimestamp(
  value: unknown,
  key: "retryAt" | "startedAt" | "finishedAt"
): Partial<Record<typeof key, string>> {
  return value === undefined ? {} : { [key]: timestamp(value) };
}

function optionalString(
  value: unknown,
  key: "stage" | "failureCode" | "reasonCode",
  max: number
): Partial<Record<typeof key, string>> {
  return value === undefined ? {} : { [key]: string(value, max) };
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs returned an invalid frequency collection response",
    retryable: true
  });
}

void (null as unknown as FrequencyCollectionStatus);
void (null as unknown as SemanticFrequencyDevice);
void (null as unknown as SemanticFrequencyType);

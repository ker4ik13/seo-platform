import {
  trackingContextStatuses,
  trackingContextScopeModes,
  trackingContextKeywordPageLimit,
  trackingContextKeywordReplacementLimit,
  trackingDepths,
  trackingDevices,
  trackingDomainMatchModes,
  trackingSearchEngines,
  trackingSearchSources,
  type ApiCollectionResponse,
  type TrackingContextCollection,
  type TrackingContextConfigurationSnapshot,
  type TrackingContextKeywordAssignmentItem,
  type TrackingContextKeywordAssignmentState,
  type TrackingContextKeywordReplacementResult,
  type TrackingContextLaunchProfile,
  type TrackingContextSummary,
  type TrackingDomainMatchRule
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

export interface TrackingContextKeywordPage {
  readonly data: readonly TrackingContextKeywordAssignmentItem[];
  readonly page: ApiCollectionResponse<TrackingContextKeywordAssignmentItem>["page"];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1000}$/u;
const CONTEXT_STATUSES = new Set<string>(trackingContextStatuses);
const SEARCH_ENGINES = new Set<string>(trackingSearchEngines);
const SEARCH_SOURCES = new Set<string>(trackingSearchSources);
const SCOPE_MODES = new Set<string>(trackingContextScopeModes);
const DEVICES = new Set<string>(trackingDevices);
const DEPTHS = new Set<number>(trackingDepths);
const DOMAIN_MATCH_MODES = new Set<string>(
  trackingDomainMatchModes
);
const MAX_CONTEXTS = 200;

export function trackingContextCollection(
  value: unknown,
  workspaceId: string,
  projectId: string
): TrackingContextCollection {
  const input = exactRecord(value, [
    "contexts",
    "contextsTruncated"
  ]);
  if (
    !Array.isArray(input.contexts) ||
    input.contexts.length > MAX_CONTEXTS ||
    typeof input.contextsTruncated !== "boolean"
  ) {
    throw invalidResponse();
  }
  const contexts = input.contexts.map((context) =>
    scopedTrackingContext(context, workspaceId, projectId)
  );
  if (
    new Set(contexts.map(({ id }) => id)).size !== contexts.length
  ) {
    throw invalidResponse();
  }
  return {
    contexts,
    contextsTruncated: input.contextsTruncated
  };
}

export function scopedTrackingContext(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedContextId?: string
): TrackingContextSummary {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "projectId",
    "name",
    "status",
    "configuration",
    "launchProfile",
    "assignedKeywordCount",
    "version",
    "createdBy",
    "updatedBy",
    "archivedBy",
    "createdAt",
    "updatedAt",
    "archivedAt"
  ]);
  const id = uuidValue(input.id);
  const responseWorkspaceId = uuidValue(input.workspaceId);
  const responseProjectId = uuidValue(input.projectId);
  const status = enumValue(
    input.status,
    CONTEXT_STATUSES
  ) as TrackingContextSummary["status"];
  const archivedBy =
    input.archivedBy === undefined
      ? undefined
      : uuidValue(input.archivedBy);
  const archivedAt =
    input.archivedAt === undefined
      ? undefined
      : isoDateValue(input.archivedAt);
  const createdAt = isoDateValue(input.createdAt);
  const updatedAt = isoDateValue(input.updatedAt);
  const version = positiveInteger(input.version);
  const configuration = trackingConfiguration(input.configuration);
  const launchProfile = trackingLaunchProfile(input.launchProfile);
  if (
    responseWorkspaceId !== workspaceId ||
    responseProjectId !== projectId ||
    (expectedContextId !== undefined &&
      id !== expectedContextId.toLowerCase()) ||
    typeof input.name !== "string" ||
    input.name.length < 1 ||
    input.name.length > 160 ||
    input.name !== input.name.trim() ||
    !Number.isSafeInteger(input.assignedKeywordCount) ||
    Number(input.assignedKeywordCount) < 0 ||
    configuration.configurationVersion > version ||
    Date.parse(configuration.createdAt) < Date.parse(createdAt) ||
    Date.parse(configuration.createdAt) > Date.parse(updatedAt) ||
    (status === "ARCHIVED") !==
      Boolean(archivedBy && archivedAt) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    (archivedAt !== undefined &&
      Date.parse(archivedAt) < Date.parse(createdAt))
  ) {
    throw invalidResponse();
  }

  return {
    id,
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    name: input.name,
    status,
    configuration,
    ...(launchProfile ? { launchProfile } : {}),
    assignedKeywordCount: Number(input.assignedKeywordCount),
    version,
    createdBy: uuidValue(input.createdBy),
    updatedBy: uuidValue(input.updatedBy),
    ...(archivedBy ? { archivedBy } : {}),
    createdAt,
    updatedAt,
    ...(archivedAt ? { archivedAt } : {})
  };
}

function trackingLaunchProfile(
  value: unknown
): TrackingContextLaunchProfile | undefined {
  if (value === undefined) return undefined;
  const input = exactRecord(value, [
    "searchSource",
    "includeUntracked",
    "scope"
  ]);
  const scope = exactRecord(input.scope, [
    "mode",
    "groupIds",
    "descendantGroupIds",
    "includeDescendants"
  ]);
  const searchSource = enumValue(
    input.searchSource,
    SEARCH_SOURCES
  ) as TrackingContextLaunchProfile["searchSource"];
  const mode = enumValue(
    scope.mode,
    SCOPE_MODES
  ) as TrackingContextLaunchProfile["scope"]["mode"];
  if (!Array.isArray(scope.groupIds)) throw invalidResponse();
  const groupIds = scope.groupIds.map(uuidValue);
  if (
    scope.descendantGroupIds !== undefined &&
    !Array.isArray(scope.descendantGroupIds)
  ) {
    throw invalidResponse();
  }
  const explicitDescendantGroupIds = (scope.descendantGroupIds ?? []).map(
    uuidValue
  );
  const descendantGroupIds = scope.descendantGroupIds !== undefined
    ? explicitDescendantGroupIds
    : scope.includeDescendants === false
      ? []
      : mode === "GROUPS"
        ? groupIds
        : [];
  if (
    new Set(groupIds).size !== groupIds.length ||
    new Set(descendantGroupIds).size !== descendantGroupIds.length ||
    (input.includeUntracked !== undefined &&
      typeof input.includeUntracked !== "boolean") ||
    (scope.includeDescendants !== undefined &&
      typeof scope.includeDescendants !== "boolean") ||
    (mode !== "GROUPS" && scope.includeDescendants === true) ||
    (mode !== "GROUPS" && descendantGroupIds.length > 0) ||
    descendantGroupIds.some((groupId) => !groupIds.includes(groupId)) ||
    (mode === "GROUPS" && groupIds.length === 0) ||
    (mode !== "GROUPS" && groupIds.length > 0)
  ) {
    throw invalidResponse();
  }
  return {
    searchSource,
    includeUntracked: input.includeUntracked ?? false,
    scope: {
      mode,
      groupIds,
      descendantGroupIds
    }
  };
}

export function trackingContextKeywordPage(
  payload: unknown,
  contextId: string
): TrackingContextKeywordPage {
  const response = exactRecord(payload, ["data", "page", "meta"]);
  apiMeta(response.meta);
  const page = exactRecord(response.page, [
    "hasNext",
    "nextCursor",
    "totalApprox"
  ]);
  if (
    !Array.isArray(response.data) ||
    response.data.length > trackingContextKeywordPageLimit ||
    typeof page.hasNext !== "boolean" ||
    (page.nextCursor !== undefined &&
      (typeof page.nextCursor !== "string" ||
        !CURSOR_PATTERN.test(page.nextCursor))) ||
    (page.hasNext && typeof page.nextCursor !== "string") ||
    (!page.hasNext && page.nextCursor !== undefined) ||
    (page.totalApprox !== undefined &&
      (!Number.isSafeInteger(page.totalApprox) ||
        Number(page.totalApprox) < 0))
  ) {
    throw invalidResponse();
  }
  const data = response.data.map((item) =>
    trackingContextKeywordItem(item, contextId)
  );
  if (
    new Set(data.map(({ assignmentId }) => assignmentId)).size !==
      data.length ||
    new Set(data.map(({ keywordId }) => keywordId)).size !== data.length
  ) {
    throw invalidResponse();
  }
  return {
    data,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {}),
      ...(typeof page.totalApprox === "number"
        ? { totalApprox: page.totalApprox }
        : {})
    }
  };
}

export function scopedTrackingContextKeywordState(
  value: unknown,
  contextId: string,
  keywordId: string,
  expectedAssigned?: boolean
): TrackingContextKeywordAssignmentState {
  const input = exactRecord(value, [
    "contextId",
    "keywordId",
    "assigned",
    "assignmentId",
    "changedAt"
  ]);
  const responseContextId = uuidValue(input.contextId);
  const responseKeywordId = uuidValue(input.keywordId);
  const assignmentId =
    input.assignmentId === undefined
      ? undefined
      : uuidValue(input.assignmentId);
  const changedAt =
    input.changedAt === undefined
      ? undefined
      : isoDateValue(input.changedAt);
  if (
    responseContextId !== contextId.toLowerCase() ||
    responseKeywordId !== keywordId.toLowerCase() ||
    typeof input.assigned !== "boolean" ||
    (expectedAssigned !== undefined &&
      input.assigned !== expectedAssigned) ||
    (input.assigned && !assignmentId) ||
    (!input.assigned && assignmentId !== undefined)
  ) {
    throw invalidResponse();
  }
  return {
    contextId: responseContextId,
    keywordId: responseKeywordId,
    assigned: input.assigned,
    ...(assignmentId ? { assignmentId } : {}),
    ...(changedAt ? { changedAt } : {})
  };
}

export function scopedTrackingContextKeywordReplacement(
  value: unknown,
  contextId: string
): TrackingContextKeywordReplacementResult {
  const input = exactRecord(value, [
    "contextId",
    "assignedKeywordCount",
    "addedKeywordCount",
    "removedKeywordCount",
    "unchangedKeywordCount",
    "keywordSetHash",
    "version",
    "changedAt"
  ]);
  const responseContextId = uuidValue(input.contextId);
  const assignedKeywordCount = boundedCount(input.assignedKeywordCount);
  const addedKeywordCount = boundedCount(input.addedKeywordCount);
  const removedKeywordCount = boundedCount(input.removedKeywordCount);
  const unchangedKeywordCount = boundedCount(input.unchangedKeywordCount);
  const keywordSetHash = exactRecord(input.keywordSetHash, [
    "algorithm",
    "value"
  ]);
  if (
    responseContextId !== contextId.toLowerCase() ||
    addedKeywordCount + unchangedKeywordCount !== assignedKeywordCount ||
    keywordSetHash.algorithm !== "SHA_256" ||
    typeof keywordSetHash.value !== "string" ||
    !/^[0-9a-f]{64}$/u.test(keywordSetHash.value)
  ) {
    throw invalidResponse();
  }
  return {
    contextId: responseContextId,
    assignedKeywordCount,
    addedKeywordCount,
    removedKeywordCount,
    unchangedKeywordCount,
    keywordSetHash: {
      algorithm: "SHA_256",
      value: keywordSetHash.value
    },
    version: positiveInteger(input.version),
    changedAt: isoDateValue(input.changedAt)
  };
}

function boundedCount(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > trackingContextKeywordReplacementLimit
  ) {
    throw invalidResponse();
  }
  return Number(value);
}

function trackingConfiguration(
  value: unknown
): TrackingContextConfigurationSnapshot {
  const input = exactRecord(value, [
    "searchEngine",
    "countryCode",
    "regionCode",
    "regionLabel",
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    "configurationVersion",
    "createdBy",
    "createdAt"
  ]);
  const countryCode = requiredString(input.countryCode, 2, 2);
  const language = requiredString(input.language, 2, 16);
  const regionCode = optionalString(input.regionCode, 1, 100);
  const regionLabel = optionalString(input.regionLabel, 1, 160);
  if (
    !/^[A-Z]{2}$/u.test(countryCode) ||
    (regionLabel !== undefined && regionCode === undefined) ||
    typeof input.safeSearch !== "boolean" ||
    typeof input.depth !== "number" ||
    !DEPTHS.has(input.depth)
  ) {
    throw invalidResponse();
  }
  return {
    searchEngine: enumValue(
      input.searchEngine,
      SEARCH_ENGINES
    ) as TrackingContextConfigurationSnapshot["searchEngine"],
    countryCode,
    ...(regionCode ? { regionCode } : {}),
    ...(regionLabel ? { regionLabel } : {}),
    language,
    device: enumValue(
      input.device,
      DEVICES
    ) as TrackingContextConfigurationSnapshot["device"],
    depth:
      input.depth as TrackingContextConfigurationSnapshot["depth"],
    domainMatchRule: trackingDomainMatchRule(input.domainMatchRule),
    safeSearch: input.safeSearch,
    configurationVersion: positiveInteger(
      input.configurationVersion
    ),
    createdBy: uuidValue(input.createdBy),
    createdAt: isoDateValue(input.createdAt)
  };
}

function trackingDomainMatchRule(
  value: unknown
): TrackingDomainMatchRule {
  const input = exactRecord(value, ["mode", "value"]);
  const mode = enumValue(
    input.mode,
    DOMAIN_MATCH_MODES
  ) as TrackingDomainMatchRule["mode"];
  if (mode !== "SPECIFIC_URL" && mode !== "URL_PREFIX") {
    if (input.value !== undefined) throw invalidResponse();
    return { mode };
  }
  const url = requiredString(input.value, 8, 2048);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidResponse();
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw invalidResponse();
  }
  return { mode, value: url };
}

function trackingContextKeywordItem(
  value: unknown,
  contextId: string
): TrackingContextKeywordAssignmentItem {
  const input = exactRecord(value, [
    "assignmentId",
    "contextId",
    "keywordId",
    "keywordVersion",
    "textOriginal",
    "language",
    "isTracked",
    "assignedBy",
    "assignedAt"
  ]);
  const responseContextId = uuidValue(input.contextId);
  if (responseContextId !== contextId.toLowerCase()) {
    throw invalidResponse();
  }
  return {
    assignmentId: uuidValue(input.assignmentId),
    contextId: responseContextId,
    keywordId: uuidValue(input.keywordId),
    keywordVersion: positiveInteger(input.keywordVersion),
    textOriginal: requiredString(input.textOriginal, 1, 10_000),
    language: requiredString(input.language, 2, 16),
    isTracked:
      input.isTracked === undefined
        ? true
        : booleanResponse(input.isTracked),
    assignedBy: uuidValue(input.assignedBy),
    assignedAt: isoDateValue(input.assignedAt)
  };
}

function booleanResponse(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidResponse();
  return value;
}

function apiMeta(value: unknown): void {
  const meta = exactRecord(value, ["requestId", "version"]);
  if (
    typeof meta.requestId !== "string" ||
    meta.requestId.length < 1 ||
    (meta.version !== undefined &&
      (!Number.isSafeInteger(meta.version) ||
        Number(meta.version) < 1))
  ) {
    throw invalidResponse();
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw invalidResponse();
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw invalidResponse();
  }
  return input;
}

function uuidValue(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidResponse();
  }
  return value.toLowerCase();
}

function isoDateValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw invalidResponse();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw invalidResponse();
  }
  return Number(value);
}

function requiredString(
  value: unknown,
  min: number,
  max: number
): string {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    value !== value.trim()
  ) {
    throw invalidResponse();
  }
  return value;
}

function optionalString(
  value: unknown,
  min: number,
  max: number
): string | undefined {
  return value === undefined
    ? undefined
    : requiredString(value, min, max);
}

function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw invalidResponse();
  }
  return value;
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data service returned an invalid response",
    retryable: true
  });
}

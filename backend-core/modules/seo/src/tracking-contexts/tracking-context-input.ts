import { BadRequestException } from "@nestjs/common";
import {
  trackingDepths,
  trackingDevices,
  trackingDomainMatchModes,
  trackingContextKeywordPageLimit,
  trackingContextKeywordReplacementLimit,
  trackingContextScopeModes,
  trackingSearchEngines,
  trackingSearchSources,
  type InternalChangeTrackingContextKeywordInput,
  type InternalChangeTrackingContextStatusInput,
  type InternalCreateTrackingContextInput,
  type InternalReplaceTrackingContextKeywordsInput,
  type InternalUpdateTrackingContextInput,
  type TrackingContextConfigurationInput,
  type TrackingContextKeywordQuery,
  type TrackingContextLaunchProfile,
  type TrackingDomainMatchRule
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { semanticCapacityEntitlement } from "../internal/semantic-capacity.js";

const SEARCH_ENGINES = new Set<string>(trackingSearchEngines);
const SEARCH_SOURCES = new Set<string>(trackingSearchSources);
const SCOPE_MODES = new Set<string>(trackingContextScopeModes);
const DEVICES = new Set<string>(trackingDevices);
const DEPTHS = new Set<number>(trackingDepths);
const DOMAIN_MATCH_MODES = new Set<string>(trackingDomainMatchModes);
const SIMPLE_DOMAIN_MATCH_MODES = new Set<string>([
  "EXACT_HOST",
  "INCLUDE_WWW",
  "INCLUDE_SUBDOMAINS",
  "CANONICAL_DOMAIN",
  "ANY_PROJECT_MIRROR"
]);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1000}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;

export function internalCreateTrackingContextInput(
  value: unknown
): InternalCreateTrackingContextInput {
  const input = strictRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "name",
    "configuration",
    "launchProfile",
    "isReusable"
  ]);
  if (
    input.isReusable !== undefined &&
    typeof input.isReusable !== "boolean"
  ) {
    invalid("isReusable");
  }
  return {
    ...scope(input),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    name: contextName(input.name),
    configuration: configurationInput(input.configuration),
    ...(input.launchProfile === undefined
      ? {}
      : { launchProfile: launchProfileInput(input.launchProfile) }),
    ...(input.isReusable === undefined
      ? {}
      : { isReusable: input.isReusable })
  };
}

export function internalUpdateTrackingContextInput(
  value: unknown
): InternalUpdateTrackingContextInput {
  const input = strictRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version",
    "name",
    "configuration",
    "launchProfile"
  ]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    name: contextName(input.name),
    configuration: configurationInput(input.configuration),
    ...(input.launchProfile === undefined
      ? {}
      : { launchProfile: launchProfileInput(input.launchProfile) })
  };
}

export function launchProfileInput(
  value: unknown
): TrackingContextLaunchProfile {
  const input = strictRecord(value, [
    "searchSource",
    "includeUntracked",
    "scope"
  ]);
  if (
    typeof input.searchSource !== "string" ||
    !SEARCH_SOURCES.has(input.searchSource)
  ) {
    invalid("launchProfile.searchSource");
  }
  const scope = strictRecord(input.scope, ["mode", "groupIds"]);
  if (typeof scope.mode !== "string" || !SCOPE_MODES.has(scope.mode)) {
    invalid("launchProfile.scope.mode");
  }
  if (!Array.isArray(scope.groupIds)) {
    invalid("launchProfile.scope.groupIds");
  }
  const groupIds = scope.groupIds.map((groupId, index) =>
    internalUuid(
      requiredString(groupId, `launchProfile.scope.groupIds.${index}`),
      `launchProfile.scope.groupIds.${index}`
    )
  );
  if (new Set(groupIds).size !== groupIds.length) {
    invalid("launchProfile.scope.groupIds");
  }
  if (
    (scope.mode === "GROUPS" && groupIds.length === 0) ||
    (scope.mode !== "GROUPS" && groupIds.length > 0)
  ) {
    invalid("launchProfile.scope.groupIds");
  }
  return {
    searchSource:
      input.searchSource as TrackingContextLaunchProfile["searchSource"],
    includeUntracked:
      input.includeUntracked === undefined
        ? false
        : booleanValue(input.includeUntracked, "launchProfile.includeUntracked"),
    scope: {
      mode: scope.mode as TrackingContextLaunchProfile["scope"]["mode"],
      groupIds
    }
  };
}

export function internalChangeTrackingContextStatusInput(
  value: unknown
): InternalChangeTrackingContextStatusInput {
  const input = strictRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
  };
}

export function internalChangeTrackingContextKeywordInput(
  value: unknown
): InternalChangeTrackingContextKeywordInput {
  const input = strictRecord(value, [
    "workspaceId",
    "projectId",
    "contextId",
    "keywordId",
    "actorId",
    "entitlement"
  ]);
  return {
    ...scope(input),
    contextId: internalUuid(
      requiredString(input.contextId, "contextId"),
      "contextId"
    ),
    keywordId: internalUuid(
      requiredString(input.keywordId, "keywordId"),
      "keywordId"
    ),
    entitlement: semanticCapacityEntitlement(input.entitlement)
  };
}

export function internalReplaceTrackingContextKeywordsInput(
  value: unknown
): InternalReplaceTrackingContextKeywordsInput {
  const input = strictRecord(value, [
    "workspaceId",
    "projectId",
    "contextId",
    "actorId",
    "version",
    "idempotencyKey",
    "keywordIds",
    "entitlement"
  ]);
  if (
    !Array.isArray(input.keywordIds) ||
    input.keywordIds.length < 1 ||
    input.keywordIds.length > trackingContextKeywordReplacementLimit
  ) {
    invalid("keywordIds");
  }
  const keywordIds = input.keywordIds.map((value, index) =>
    internalUuid(requiredString(value, `keywordIds.${index}`), `keywordIds.${index}`)
  );
  if (new Set(keywordIds).size !== keywordIds.length) {
    invalid("keywordIds");
  }
  return {
    ...scope(input),
    contextId: internalUuid(
      requiredString(input.contextId, "contextId"),
      "contextId"
    ),
    version: positiveInteger(input.version, "version"),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    keywordIds,
    entitlement: semanticCapacityEntitlement(input.entitlement)
  };
}

export function trackingContextKeywordQuery(
  value: unknown
): TrackingContextKeywordQuery {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  if (
    Object.keys(query).some(
      (key) => !["limit", "cursor", "search"].includes(key)
    )
  ) {
    invalid("query");
  }
  const limit = optionalSingleString(query.limit, "limit");
  const cursor = optionalSingleString(query.cursor, "cursor");
  const search = optionalSingleString(query.search, "search")?.normalize(
    "NFKC"
  );
  const parsedLimit = limit === undefined ? 100 : Number(limit);
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > trackingContextKeywordPageLimit
  ) {
    invalid("limit");
  }
  if (cursor && !CURSOR_PATTERN.test(cursor)) invalid("cursor");
  if (search && search.length > 200) invalid("search");
  return {
    limit: parsedLimit,
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {})
  };
}

export function configurationInput(
  value: unknown
): TrackingContextConfigurationInput {
  const input = strictRecord(value, [
    "searchEngine",
    "countryCode",
    "regionCode",
    "regionLabel",
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch"
  ]);
  if (
    typeof input.searchEngine !== "string" ||
    !SEARCH_ENGINES.has(input.searchEngine)
  ) {
    invalid("configuration.searchEngine");
  }
  if (typeof input.device !== "string" || !DEVICES.has(input.device)) {
    invalid("configuration.device");
  }
  if (typeof input.depth !== "number" || !DEPTHS.has(input.depth)) {
    invalid("configuration.depth");
  }
  if (typeof input.safeSearch !== "boolean") {
    invalid("configuration.safeSearch");
  }
  const normalizedRegionCode = optionalNormalizedField(
    input.regionCode,
    "configuration.regionCode",
    100,
    "regionCode"
  );
  const normalizedRegionLabel = optionalNormalizedField(
    input.regionLabel,
    "configuration.regionLabel",
    160,
    "regionLabel"
  );
  if (
    normalizedRegionLabel.regionLabel &&
    !normalizedRegionCode.regionCode
  ) {
    invalid("configuration.regionLabel");
  }
  return {
    searchEngine:
      input.searchEngine as TrackingContextConfigurationInput["searchEngine"],
    countryCode: countryCode(input.countryCode),
    ...normalizedRegionCode,
    ...normalizedRegionLabel,
    language: language(input.language),
    device: input.device as TrackingContextConfigurationInput["device"],
    depth: input.depth as TrackingContextConfigurationInput["depth"],
    domainMatchRule: domainMatchRule(input.domainMatchRule),
    safeSearch: input.safeSearch
  };
}

function domainMatchRule(value: unknown): TrackingDomainMatchRule {
  const record = strictRecord(value, ["mode", "value"]);
  if (
    typeof record.mode !== "string" ||
    !DOMAIN_MATCH_MODES.has(record.mode)
  ) {
    invalid("configuration.domainMatchRule.mode");
  }
  if (SIMPLE_DOMAIN_MATCH_MODES.has(record.mode)) {
    if (record.value !== undefined) {
      invalid("configuration.domainMatchRule.value");
    }
    return {
      mode: record.mode as Exclude<
        TrackingDomainMatchRule["mode"],
        "SPECIFIC_URL" | "URL_PREFIX"
      >
    };
  }
  return {
    mode: record.mode as "SPECIFIC_URL" | "URL_PREFIX",
    value: normalizedDomainUrl(record.value)
  };
}

function normalizedDomainUrl(value: unknown): string {
  const source = boundedString(
    value,
    "configuration.domainMatchRule.value",
    2_048,
    false
  );
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    invalid("configuration.domainMatchRule.value");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    invalid("configuration.domainMatchRule.value");
  }
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  return url.toString();
}

function contextName(value: unknown): string {
  return normalizedString(value, "name", 160);
}

function idempotencyKey(value: unknown): string {
  const key = requiredString(value, "idempotencyKey").trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) invalid("idempotencyKey");
  return key;
}

function countryCode(value: unknown): string {
  const code = requiredString(value, "configuration.countryCode")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/u.test(code)) invalid("configuration.countryCode");
  return code;
}

function language(value: unknown): string {
  const source = requiredString(value, "configuration.language").trim();
  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(source)[0] ?? "";
  } catch {
    invalid("configuration.language");
  }
  if (!canonical || canonical.length > 16) {
    invalid("configuration.language");
  }
  return canonical;
}

function optionalNormalizedField<
  Key extends "regionCode" | "regionLabel"
>(
  value: unknown,
  field: string,
  maxLength: number,
  key: Key
): Readonly<Partial<Record<Key, string>>> {
  if (value === undefined || value === null || value === "") {
    return {} as Readonly<Partial<Record<Key, string>>>;
  }
  return {
    [key]: normalizedString(value, field, maxLength)
  } as Partial<Record<Key, string>>;
}

function normalizedString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  const normalized = requiredString(value, field)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || normalized.length > maxLength) invalid(field);
  return normalized;
}

function scope(input: Readonly<Record<string, unknown>>): {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
} {
  return {
    workspaceId: internalUuid(
      requiredString(input.workspaceId, "workspaceId"),
      "workspaceId"
    ),
    projectId: internalUuid(
      requiredString(input.projectId, "projectId"),
      "projectId"
    ),
    actorId: internalUuid(
      requiredString(input.actorId, "actorId"),
      "actorId"
    )
  };
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    invalid("body");
  }
  return input;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value;
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
  normalize: boolean
): string {
  const source = requiredString(value, field);
  const result = normalize
    ? source.normalize("NFKC").trim()
    : source.trim();
  if (result.length > maxLength) invalid(field);
  return result;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function optionalSingleString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid tracking context field: ${field}`);
}

import { rankCommandKeywordLimit, rankExecutionPolicyShape } from "@seo-platform/contracts";
import { BadRequestException } from "@nestjs/common";
import type {
  InternalGetRankManifestChunkInput,
  InternalRankExecutionParameters,
  InternalRankManifestEstimateSeal,
  InternalRankRunProjectSnapshot,
  InternalSealRankManifestInput,
  RankManifestHash,
  TrackingDomainMatchRule
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DECIMAL_PAIR_COUNT_PATTERN =
  /^[1-9][0-9]{0,5}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9@._:-]{1,100}$/u;
const SIMPLE_DOMAIN_MATCH_MODES = new Set<string>([
  "EXACT_HOST",
  "INCLUDE_WWW",
  "INCLUDE_SUBDOMAINS",
  "CANONICAL_DOMAIN",
  "ANY_PROJECT_MIRROR"
]);
const URL_DOMAIN_MATCH_MODES = new Set<string>([
  "SPECIFIC_URL",
  "URL_PREFIX"
]);

export function internalSealRankManifestInput(
  value: unknown
): InternalSealRankManifestInput {
  const raw = strictRecord(value, [
    "providerPolicyVersion",
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "estimateId",
    "retryOfJobId",
    "provider",
    "operation",
    "project",
    "estimate",
    "execution",
    "retention"
  ]);
  const input = strictRecord(value, [
    ...(Object.hasOwn(raw, "providerPolicyVersion") ? ["providerPolicyVersion"] : []),
    "purpose",
    "saveProjectPosition",
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "estimateId",
    ...(Object.hasOwn(raw, "retryOfJobId") ? ["retryOfJobId"] : []),
    "provider",
    "operation",
    "project",
    "estimate",
    "execution",
    "retention"
  ]);
  const workspaceId = uuid(input.workspaceId, "workspaceId");
  const projectId = uuid(input.projectId, "projectId");
  const project = rankRunProject(input.project);
  const estimate = rankManifestEstimate(input.estimate);
  if (project.id !== projectId || project.workspaceId !== workspaceId) {
    invalid("project");
  }
  if (input.provider !== "ARSENKIN" && input.provider !== "XMLSTOCK") {
    invalid("provider");
  }
  if (input.operation !== "POSITIONS") invalid("operation");
  if (input.providerPolicyVersion !== undefined) {
    const policy = rankExecutionPolicyShape(input.providerPolicyVersion, input.provider);
    if (!policy || Number(estimate.pairCount) > policy.commandLimit) invalid("providerPolicyVersion");
  } else if (Number(estimate.pairCount) > 15000) invalid("estimate.pairCount");
  return {
    workspaceId,
    projectId,
    actorId: uuid(input.actorId, "actorId"),
    jobId: uuid(input.jobId, "jobId"),
    estimateId: uuid(input.estimateId, "estimateId"),
    ...(input.retryOfJobId === undefined
      ? {}
      : { retryOfJobId: uuid(input.retryOfJobId, "retryOfJobId") }),
    ...(input.providerPolicyVersion === undefined ? {} : { providerPolicyVersion: String(input.providerPolicyVersion) }),
    provider: input.provider,
    operation: "POSITIONS",
    project,
    estimate,
    execution: rankExecutionParameters(input.execution),
    retention: rankManifestRetention(input.retention)
  };
}

export function internalGetRankManifestChunkInput(
  value: unknown
): InternalGetRankManifestChunkInput {
  const input = strictRecord(value, [
    "workspaceId",
    "projectId",
    "jobId",
    "manifestId",
    "chunkIndex"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    jobId: uuid(input.jobId, "jobId"),
    manifestId: uuid(input.manifestId, "manifestId"),
    chunkIndex: chunkIndex(input.chunkIndex)
  };
}

export function internalRankManifestChunkQuery(
  value: unknown
): { readonly jobId: string } {
  const query = strictRecord(value, ["jobId"]);
  if (Object.keys(query).length !== 1) invalid("query");
  return { jobId: uuid(query.jobId, "jobId") };
}

export function rankExecutionParameters(
  value: unknown
): InternalRankExecutionParameters {
  const input = strictRecord(value, [
    "purpose",
    "saveProjectPosition",
    "searchEngine",
    "countryCode",
    "regionCode",
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    "format",
    "rawSerp",
    "fallbackMode",
    "providerMappingVersion"
  ]);
  if (input.searchEngine !== "GOOGLE" && input.searchEngine !== "YANDEX") {
    invalid("execution.searchEngine");
  }
  if (
    input.purpose !== undefined &&
    input.purpose !== "POSITION_TRACKING" &&
    input.purpose !== "COMPETITOR_SERP"
  ) {
    invalid("execution.purpose");
  }
  if (
    input.saveProjectPosition !== undefined &&
    typeof input.saveProjectPosition !== "boolean"
  ) {
    invalid("execution.saveProjectPosition");
  }
  if (input.device !== "DESKTOP" && input.device !== "MOBILE") {
    invalid("execution.device");
  }
  if (![10, 20, 30, 50, 100].includes(Number(input.depth))) {
    invalid("execution.depth");
  }
  if (typeof input.safeSearch !== "boolean") {
    invalid("execution.safeSearch");
  }
  if (input.format !== "SIMPLE") invalid("execution.format");
  if (input.rawSerp !== false) invalid("execution.rawSerp");
  if (input.fallbackMode !== "NONE") {
    invalid("execution.fallbackMode");
  }
  const providerMappingVersion = requiredString(
    input.providerMappingVersion,
    "execution.providerMappingVersion"
  ).trim();
  if (!VERSION_PATTERN.test(providerMappingVersion)) {
    invalid("execution.providerMappingVersion");
  }
  const regionCode = optionalNormalizedString(
    input.regionCode,
    "execution.regionCode",
    100
  );
  return {
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.saveProjectPosition === undefined
      ? {}
      : { saveProjectPosition: input.saveProjectPosition }),
    searchEngine: input.searchEngine,
    countryCode: countryCode(input.countryCode),
    ...(regionCode ? { regionCode } : {}),
    language: language(input.language),
    device: input.device,
    depth: Number(input.depth) as InternalRankExecutionParameters["depth"],
    domainMatchRule: domainMatchRule(input.domainMatchRule),
    safeSearch: input.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion
  };
}

function rankRunProject(value: unknown): InternalRankRunProjectSnapshot {
  const input = strictRecord(value, [
    "id",
    "workspaceId",
    "domain",
    "status",
    "version"
  ]);
  if (
    input.status !== "DRAFT" &&
    input.status !== "ACTIVE" &&
    input.status !== "ARCHIVED"
  ) {
    invalid("project.status");
  }
  const domain = requiredString(input.domain, "project.domain");
  if (
    domain.length < 3 ||
    domain.length > 255 ||
    domain.trim() !== domain ||
    // oxlint-disable-next-line no-control-regex -- Sealed project domains reject C0 and DEL characters.
    /[\u0000-\u001f\u007f]/u.test(domain)
  ) {
    invalid("project.domain");
  }
  return {
    id: uuid(input.id, "project.id"),
    workspaceId: uuid(input.workspaceId, "project.workspaceId"),
    domain,
    status: input.status,
    version: positiveInteger(input.version, "project.version")
  };
}

function rankManifestEstimate(
  value: unknown
): InternalRankManifestEstimateSeal {
  const input = strictRecord(value, [
    "trackingContextId",
    "contextVersion",
    "configurationVersion",
    "configurationHash",
    "semanticScopeHash",
    "scopeHash",
    "pairCount",
    "expiresAt"
  ]);
  const pairCount = requiredString(input.pairCount, "estimate.pairCount");
  if (!DECIMAL_PAIR_COUNT_PATTERN.test(pairCount) || Number(pairCount) > rankCommandKeywordLimit) {
    invalid("estimate.pairCount");
  }
  return {
    trackingContextId: uuid(
      input.trackingContextId,
      "estimate.trackingContextId"
    ),
    contextVersion: positiveInteger(
      input.contextVersion,
      "estimate.contextVersion"
    ),
    configurationVersion: positiveInteger(
      input.configurationVersion,
      "estimate.configurationVersion"
    ),
    configurationHash: manifestHash(
      input.configurationHash,
      "estimate.configurationHash"
    ),
    semanticScopeHash: manifestHash(
      input.semanticScopeHash,
      "estimate.semanticScopeHash"
    ),
    scopeHash: manifestHash(input.scopeHash, "estimate.scopeHash"),
    pairCount,
    expiresAt: isoTimestamp(input.expiresAt, "estimate.expiresAt")
  };
}

function rankManifestRetention(
  value: unknown
): InternalSealRankManifestInput["retention"] {
  const input = strictRecord(value, [
    "normalizedRankHistory",
    "rawSerp"
  ]);
  if (
    input.normalizedRankHistory !== "LONG_TERM" ||
    input.rawSerp !== "NOT_COLLECTED"
  ) {
    invalid("retention");
  }
  return {
    normalizedRankHistory: "LONG_TERM",
    rawSerp: "NOT_COLLECTED"
  };
}

function manifestHash(value: unknown, field: string): RankManifestHash {
  const input = strictRecord(value, ["algorithm", "value"]);
  if (
    input.algorithm !== "SHA_256" ||
    typeof input.value !== "string" ||
    !HASH_PATTERN.test(input.value)
  ) {
    invalid(field);
  }
  return {
    algorithm: "SHA_256",
    value: input.value
  };
}

function domainMatchRule(value: unknown): TrackingDomainMatchRule {
  const input = strictRecord(value, ["mode", "value"]);
  if (
    typeof input.mode !== "string" ||
    (!SIMPLE_DOMAIN_MATCH_MODES.has(input.mode) &&
      !URL_DOMAIN_MATCH_MODES.has(input.mode))
  ) {
    invalid("execution.domainMatchRule.mode");
  }
  if (SIMPLE_DOMAIN_MATCH_MODES.has(input.mode)) {
    if (input.value !== undefined) {
      invalid("execution.domainMatchRule.value");
    }
    return {
      mode: input.mode as Exclude<
        TrackingDomainMatchRule["mode"],
        "SPECIFIC_URL" | "URL_PREFIX"
      >
    };
  }
  return {
    mode: input.mode as "SPECIFIC_URL" | "URL_PREFIX",
    value: normalizedUrl(
      input.value,
      "execution.domainMatchRule.value"
    )
  };
}

function normalizedUrl(value: unknown, field: string): string {
  const source = requiredString(value, field).trim();
  if (source.length > 2_048) invalid(field);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    invalid(field);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    invalid(field);
  }
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

function countryCode(value: unknown): string {
  const code = requiredString(value, "execution.countryCode")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/u.test(code)) invalid("execution.countryCode");
  return code;
}

function language(value: unknown): string {
  const source = requiredString(value, "execution.language").trim();
  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(source)[0] ?? "";
  } catch {
    invalid("execution.language");
  }
  if (!canonical || canonical.length > 16) {
    invalid("execution.language");
  }
  return canonical;
}

function optionalNormalizedString(
  value: unknown,
  field: string,
  maxLength: number
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = requiredString(value, field)
    .normalize("NFKC")
    .trim();
  if (!normalized || normalized.length > maxLength) invalid(field);
  return normalized;
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    invalid("body");
  }
  return record;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function chunkIndex(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > rankCommandKeywordLimit - 1
  ) {
    invalid("chunkIndex");
  }
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) invalid(field);
  return value;
}

function isoTimestamp(value: unknown, field: string): string {
  const timestamp = requiredString(value, field);
  const parsed = new Date(timestamp);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== timestamp
  ) {
    invalid(field);
  }
  return timestamp;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid rank manifest field: ${field}`);
}

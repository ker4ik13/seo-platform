import type { RankManifestHash } from "./rank-runs.js";

export const rankExecutionGrantRequestSchemaVersion =
  "rank-execution-grant-request@1" as const;
export const rankExecutionGrantScopeSchemaVersion =
  "rank-execution-grant-scope@1" as const;
export const rankExecutionGrantSchemaVersion =
  "rank-execution-grant@1" as const;
export const rankExecutionGrantDecisionSchemaVersion =
  "rank-execution-grant-decision@1" as const;

export const rankExecutionGrantRequestHashDomain =
  rankExecutionGrantRequestSchemaVersion;
export const rankExecutionGrantScopeHashDomain =
  rankExecutionGrantScopeSchemaVersion;

/**
 * Domain separator used by the existing Jobs project-domain hash recipe.
 *
 * Keep this value independent from the canonical-JSON grant hash domains:
 * the project-domain digest is SHA-256 over this prefix followed by the
 * project's domain as UTF-8 bytes.
 */
export const rankEstimateProjectDomainHashDomain =
  "seo-platform.rank-estimate.project-domain.v1\u0000" as const;

export const rankExecutionGrantDecisionStatuses = [
  "GRANTED",
  "DENIED"
] as const;

export type RankExecutionGrantDecisionStatus =
  (typeof rankExecutionGrantDecisionStatuses)[number];

export const rankExecutionGrantDenialReasons = [
  "WORKSPACE_NOT_ACTIVE",
  "PROJECT_NOT_ACTIVE",
  "PROJECT_VERSION_CHANGED",
  "MEMBERSHIP_NOT_ACTIVE",
  "MEMBERSHIP_VERSION_CHANGED",
  "RUN_PERMISSION_DENIED",
  "ENTITLEMENT_NOT_AVAILABLE",
  "ENTITLEMENT_DENIED",
  "QUOTA_NOT_AVAILABLE",
  "QUOTA_EXHAUSTED"
] as const;

export type RankExecutionGrantDenialReason =
  (typeof rankExecutionGrantDenialReasons)[number];

export interface InternalRankExecutionGrantMembershipV1 {
  readonly id: string;
  readonly version: number;
}

export interface InternalRankExecutionGrantProjectV1 {
  readonly version: number;
  readonly domainHash: RankManifestHash;
}

export interface InternalRankExecutionGrantManifestV1 {
  readonly id: string;
  readonly hash: RankManifestHash;
  /**
   * Zero-based index. The first manual slice has at most four 250-keyword
   * chunks, so values above three are not representable by this version.
   */
  readonly chunkIndex: number;
}

export interface InternalRankExecutionGrantUsageIntentV1 {
  readonly meter: "RANK_PROVIDER_TASK";
  readonly quantity: "1";
}

/**
 * Trusted Jobs -> Platform API authorization request.
 *
 * The request deliberately carries no binding, route or credential
 * identifier. Jobs binds that private execution evidence into
 * executionEvidenceHash and re-checks the underlying rows locally before
 * consuming a returned grant.
 */
export interface InternalIssueRankExecutionGrantInputV1 {
  readonly schemaVersion: "rank-execution-grant-request@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly membership: InternalRankExecutionGrantMembershipV1;
  readonly project: InternalRankExecutionGrantProjectV1;
  readonly jobId: string;
  readonly jobItemId: string;
  /**
   * Stable Job version observed before grant issuance. Importing the grant
   * must not itself advance this version before local authorization checks it.
   */
  readonly jobVersion: number;
  /**
   * Grant sequence for this JobItem, not the Job retry attempt. It may advance
   * only after the previous grant is proven expired and unconsumed, before any
   * provider request bytes were authorized.
   */
  readonly executionAttempt: number;
  readonly purpose: "PROVIDER_SUBMIT";
  readonly provider: "ARSENKIN";
  readonly operation: "POSITIONS";
  readonly capability: "SERP_RANK_TRACKING";
  readonly credentialMode: "BYOK_API_KEY";
  readonly manifest: InternalRankExecutionGrantManifestV1;
  readonly executionEvidenceHash: RankManifestHash;
  readonly policyVersion: string;
  readonly usageIntent: InternalRankExecutionGrantUsageIntentV1;
}

export type InternalRankExecutionGrantRequestHashPreimageV1 =
  InternalIssueRankExecutionGrantInputV1;

/**
 * Returns the exact browser-safe preimage for the legacy Jobs project-domain
 * hash. It deliberately performs no trimming, case-folding or normalization:
 * callers must pass the stored canonical project domain verbatim, then hash
 * the returned string's UTF-8 bytes with SHA-256 on the server.
 */
export function rankEstimateProjectDomainHashPreimage(domain: string): string {
  if (typeof domain !== "string") {
    throw new TypeError("Invalid rank estimate project domain");
  }
  return `${rankEstimateProjectDomainHashDomain}${domain}`;
}

/**
 * Exact scope bound by the issuer grant. It repeats the allowlisted request
 * under an independent domain separator so a request receipt hash cannot be
 * substituted for a provider authorization scope hash.
 */
export interface InternalRankExecutionGrantScopeHashPreimageV1 {
  readonly schemaVersion: "rank-execution-grant-scope@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly membership: InternalRankExecutionGrantMembershipV1;
  readonly project: InternalRankExecutionGrantProjectV1;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly jobVersion: number;
  readonly executionAttempt: number;
  readonly purpose: "PROVIDER_SUBMIT";
  readonly provider: "ARSENKIN";
  readonly operation: "POSITIONS";
  readonly capability: "SERP_RANK_TRACKING";
  readonly credentialMode: "BYOK_API_KEY";
  readonly manifest: InternalRankExecutionGrantManifestV1;
  readonly executionEvidenceHash: RankManifestHash;
  readonly policyVersion: string;
  readonly usageIntent: InternalRankExecutionGrantUsageIntentV1;
}

export interface InternalRankExecutionGrantV1 {
  readonly schemaVersion: "rank-execution-grant@1";
  readonly id: string;
  readonly requestHash: RankManifestHash;
  readonly scopeHash: RankManifestHash;
  readonly issuer: "PLATFORM_API";
  readonly issuedAt: string;
  /** Exactly 30 seconds after issuedAt in this contract version. */
  readonly expiresAt: string;
}

interface InternalRankExecutionGrantDecisionBaseV1 {
  readonly schemaVersion: "rank-execution-grant-decision@1";
  readonly requestHash: RankManifestHash;
  readonly decidedAt: string;
}

export interface InternalRankExecutionGrantGrantedDecisionV1
  extends InternalRankExecutionGrantDecisionBaseV1 {
  readonly status: "GRANTED";
  readonly grant: InternalRankExecutionGrantV1;
  readonly reason?: never;
}

export interface InternalRankExecutionGrantDeniedDecisionV1
  extends InternalRankExecutionGrantDecisionBaseV1 {
  readonly status: "DENIED";
  readonly reason: RankExecutionGrantDenialReason;
  readonly grant?: never;
}

export type InternalRankExecutionGrantDecisionV1 =
  | InternalRankExecutionGrantGrantedDecisionV1
  | InternalRankExecutionGrantDeniedDecisionV1;

const UUID_V7_LOWERCASE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,63}$/u;
const DENIAL_REASONS: ReadonlySet<string> = new Set(
  rankExecutionGrantDenialReasons
);
const GRANT_TTL_MILLISECONDS = 30_000;
const MAX_EXECUTION_ATTEMPT = 1_000;
const MAX_MANIFEST_CHUNK_INDEX = 3;

const REQUEST_FIELDS = [
  "schemaVersion",
  "workspaceId",
  "projectId",
  "actorId",
  "membership",
  "project",
  "jobId",
  "jobItemId",
  "jobVersion",
  "executionAttempt",
  "purpose",
  "provider",
  "operation",
  "capability",
  "credentialMode",
  "manifest",
  "executionEvidenceHash",
  "policyVersion",
  "usageIntent"
] as const;

/**
 * Strict trust-boundary parser. It accepts only ordinary exact JSON objects:
 * extra/non-enumerable/symbol/accessor properties and non-standard
 * prototypes are rejected recursively.
 */
export function internalIssueRankExecutionGrantInput(
  value: unknown
): InternalIssueRankExecutionGrantInputV1 {
  const input = exactRecord(value, REQUEST_FIELDS, "request");
  const membership = exactRecord(
    input.membership,
    ["id", "version"],
    "membership"
  );
  const project = exactRecord(
    input.project,
    ["version", "domainHash"],
    "project"
  );
  const manifest = exactRecord(
    input.manifest,
    ["id", "hash", "chunkIndex"],
    "manifest"
  );
  const usageIntent = exactRecord(
    input.usageIntent,
    ["meter", "quantity"],
    "usageIntent"
  );

  if (
    input.schemaVersion !== rankExecutionGrantRequestSchemaVersion ||
    input.purpose !== "PROVIDER_SUBMIT" ||
    input.provider !== "ARSENKIN" ||
    input.operation !== "POSITIONS" ||
    input.capability !== "SERP_RANK_TRACKING" ||
    input.credentialMode !== "BYOK_API_KEY" ||
    usageIntent.meter !== "RANK_PROVIDER_TASK" ||
    usageIntent.quantity !== "1" ||
    typeof input.policyVersion !== "string" ||
    !POLICY_VERSION_PATTERN.test(input.policyVersion)
  ) {
    return invalidRequest();
  }

  return {
    schemaVersion: rankExecutionGrantRequestSchemaVersion,
    workspaceId: uuidV7(input.workspaceId, "workspaceId"),
    projectId: uuidV7(input.projectId, "projectId"),
    actorId: uuidV7(input.actorId, "actorId"),
    membership: {
      id: uuidV7(membership.id, "membership.id"),
      version: positiveInteger(membership.version, "membership.version")
    },
    project: {
      version: positiveInteger(project.version, "project.version"),
      domainHash: manifestHash(project.domainHash, "project.domainHash")
    },
    jobId: uuidV7(input.jobId, "jobId"),
    jobItemId: uuidV7(input.jobItemId, "jobItemId"),
    jobVersion: positiveInteger(input.jobVersion, "jobVersion"),
    executionAttempt: boundedPositiveInteger(
      input.executionAttempt,
      MAX_EXECUTION_ATTEMPT,
      "executionAttempt"
    ),
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: uuidV7(manifest.id, "manifest.id"),
      hash: manifestHash(manifest.hash, "manifest.hash"),
      chunkIndex: boundedNonNegativeInteger(
        manifest.chunkIndex,
        MAX_MANIFEST_CHUNK_INDEX,
        "manifest.chunkIndex"
      )
    },
    executionEvidenceHash: manifestHash(
      input.executionEvidenceHash,
      "executionEvidenceHash"
    ),
    policyVersion: input.policyVersion,
    usageIntent: {
      meter: "RANK_PROVIDER_TASK",
      quantity: "1"
    }
  };
}

/** Rebuilds the exact request hash preimage through an allowlist. */
export function rankExecutionGrantRequestHashPreimage(
  input: InternalIssueRankExecutionGrantInputV1
): InternalRankExecutionGrantRequestHashPreimageV1 {
  return internalIssueRankExecutionGrantInput(copyRequest(input));
}

/** Rebuilds the independently versioned authorization scope preimage. */
export function rankExecutionGrantScopeHashPreimage(
  input: InternalIssueRankExecutionGrantInputV1
): InternalRankExecutionGrantScopeHashPreimageV1 {
  const request = rankExecutionGrantRequestHashPreimage(input);
  return {
    ...request,
    schemaVersion: rankExecutionGrantScopeSchemaVersion
  };
}

/**
 * Strict parser for the Platform API decision. A GRANTED response is accepted
 * only when its duplicate request hash matches, decidedAt equals issuedAt and
 * the TTL is exactly 30 seconds.
 */
export function internalRankExecutionGrantDecision(
  value: unknown
): InternalRankExecutionGrantDecisionV1 {
  const record = recordValue(value, "decision");
  const status = Object.getOwnPropertyDescriptor(record, "status");
  if (
    status === undefined ||
    !status.enumerable ||
    !Object.hasOwn(status, "value")
  ) {
    return invalidDecision();
  }
  if (status.value === "GRANTED") {
    const input = exactRecord(
      record,
      ["schemaVersion", "status", "requestHash", "decidedAt", "grant"],
      "decision"
    );
    const requestHash = manifestHash(input.requestHash, "requestHash");
    const decidedAt = canonicalTimestamp(input.decidedAt, "decidedAt");
    const grant = parseGrant(input.grant);
    if (
      input.schemaVersion !== rankExecutionGrantDecisionSchemaVersion ||
      !hashesEqual(requestHash, grant.requestHash) ||
      decidedAt !== grant.issuedAt
    ) {
      return invalidDecision();
    }
    return {
      schemaVersion: rankExecutionGrantDecisionSchemaVersion,
      status: "GRANTED",
      requestHash,
      decidedAt,
      grant
    };
  }

  const input = exactRecord(
    record,
    ["schemaVersion", "status", "requestHash", "decidedAt", "reason"],
    "decision"
  );
  if (
    input.schemaVersion !== rankExecutionGrantDecisionSchemaVersion ||
    input.status !== "DENIED" ||
    typeof input.reason !== "string" ||
    !DENIAL_REASONS.has(input.reason)
  ) {
    return invalidDecision();
  }
  return {
    schemaVersion: rankExecutionGrantDecisionSchemaVersion,
    status: "DENIED",
    requestHash: manifestHash(input.requestHash, "requestHash"),
    decidedAt: canonicalTimestamp(input.decidedAt, "decidedAt"),
    reason: input.reason as RankExecutionGrantDenialReason
  };
}

/**
 * Rebuilds a decision through an explicit allowlist so credential/provider
 * diagnostics on a structurally compatible value cannot cross the boundary.
 */
export function redactInternalRankExecutionGrantDecision(
  input: InternalRankExecutionGrantDecisionV1
): InternalRankExecutionGrantDecisionV1 {
  return internalRankExecutionGrantDecision(copyDecision(input));
}

function parseGrant(value: unknown): InternalRankExecutionGrantV1 {
  const input = exactRecord(
    value,
    [
      "schemaVersion",
      "id",
      "requestHash",
      "scopeHash",
      "issuer",
      "issuedAt",
      "expiresAt"
    ],
    "grant"
  );
  const issuedAt = canonicalTimestamp(input.issuedAt, "grant.issuedAt");
  const expiresAt = canonicalTimestamp(input.expiresAt, "grant.expiresAt");
  if (
    input.schemaVersion !== rankExecutionGrantSchemaVersion ||
    input.issuer !== "PLATFORM_API" ||
    new Date(expiresAt).getTime() - new Date(issuedAt).getTime() !==
      GRANT_TTL_MILLISECONDS
  ) {
    return invalidDecision();
  }
  return {
    schemaVersion: rankExecutionGrantSchemaVersion,
    id: uuidV7(input.id, "grant.id"),
    requestHash: manifestHash(input.requestHash, "grant.requestHash"),
    scopeHash: manifestHash(input.scopeHash, "grant.scopeHash"),
    issuer: "PLATFORM_API",
    issuedAt,
    expiresAt
  };
}

function copyRequest(
  input: InternalIssueRankExecutionGrantInputV1
): InternalIssueRankExecutionGrantInputV1 {
  return {
    schemaVersion: input.schemaVersion,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    membership: {
      id: input.membership.id,
      version: input.membership.version
    },
    project: {
      version: input.project.version,
      domainHash: copyHash(input.project.domainHash)
    },
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    jobVersion: input.jobVersion,
    executionAttempt: input.executionAttempt,
    purpose: input.purpose,
    provider: input.provider,
    operation: input.operation,
    capability: input.capability,
    credentialMode: input.credentialMode,
    manifest: {
      id: input.manifest.id,
      hash: copyHash(input.manifest.hash),
      chunkIndex: input.manifest.chunkIndex
    },
    executionEvidenceHash: copyHash(input.executionEvidenceHash),
    policyVersion: input.policyVersion,
    usageIntent: {
      meter: input.usageIntent.meter,
      quantity: input.usageIntent.quantity
    }
  };
}

function copyDecision(
  input: InternalRankExecutionGrantDecisionV1
): InternalRankExecutionGrantDecisionV1 {
  if (input.status === "DENIED") {
    return {
      schemaVersion: input.schemaVersion,
      status: "DENIED",
      requestHash: copyHash(input.requestHash),
      decidedAt: input.decidedAt,
      reason: input.reason
    };
  }
  return {
    schemaVersion: input.schemaVersion,
    status: "GRANTED",
    requestHash: copyHash(input.requestHash),
    decidedAt: input.decidedAt,
    grant: {
      schemaVersion: input.grant.schemaVersion,
      id: input.grant.id,
      requestHash: copyHash(input.grant.requestHash),
      scopeHash: copyHash(input.grant.scopeHash),
      issuer: input.grant.issuer,
      issuedAt: input.grant.issuedAt,
      expiresAt: input.grant.expiresAt
    }
  };
}

function copyHash(value: RankManifestHash): RankManifestHash {
  return { algorithm: value.algorithm, value: value.value };
}

function manifestHash(value: unknown, name: string): RankManifestHash {
  const input = exactRecord(value, ["algorithm", "value"], name);
  if (
    input.algorithm !== "SHA_256" ||
    typeof input.value !== "string" ||
    !HASH_PATTERN.test(input.value)
  ) {
    throw invalid(name);
  }
  return { algorithm: "SHA_256", value: input.value };
}

function hashesEqual(left: RankManifestHash, right: RankManifestHash): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function uuidV7(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !UUID_V7_LOWERCASE_PATTERN.test(value)
  ) {
    throw invalid(name);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw invalid(name);
  }
  return Number(value);
}

function boundedPositiveInteger(
  value: unknown,
  maximum: number,
  name: string
): number {
  const parsed = positiveInteger(value, name);
  if (parsed > maximum) throw invalid(name);
  return parsed;
}

function boundedNonNegativeInteger(
  value: unknown,
  maximum: number,
  name: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw invalid(name);
  }
  return Number(value);
}

function canonicalTimestamp(value: unknown, name: string): string {
  if (typeof value !== "string") throw invalid(name);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw invalid(name);
  }
  return value;
}

function exactRecord<const Fields extends readonly string[]>(
  value: unknown,
  fields: Fields,
  name: string
): Readonly<Record<Fields[number], unknown>> {
  const input = recordValue(value, name);
  const keys = Object.keys(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field)) ||
    Object.getOwnPropertyNames(input).length !== keys.length ||
    Object.values(descriptors).some(
      (descriptor) =>
        !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
    )
  ) {
    throw invalid(name);
  }
  return input as Readonly<Record<Fields[number], unknown>>;
}

function recordValue(
  value: unknown,
  name: string
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw invalid(name);
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalidRequest(): never {
  throw new TypeError("Invalid rank execution grant request");
}

function invalidDecision(): never {
  throw new TypeError("Invalid rank execution grant decision");
}

function invalid(name: string): TypeError {
  return new TypeError(`Invalid rank execution grant ${name}`);
}

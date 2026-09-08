import { rankCommandKeywordLimit } from "@seo-platform/contracts";
import type { RankManifestHash } from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";

export const RANK_EXECUTION_EVIDENCE_SCHEMA =
  "rank-execution-evidence@2" as const;
export const ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION =
  "arsenkin-positions@2.0.0" as const;
export const XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION =
  "xmlstock-serp@1.0.0" as const;
export const XMLSTOCK_RANK_KILL_SWITCH_VERSION =
  "xmlstock-serp@1" as const;

export function rankExecutionConnectorVersion(
  provider: "ARSENKIN" | "XMLSTOCK"
): string {
  return provider === "XMLSTOCK"
    ? XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
    : ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION;
}

export function rankExecutionKillSwitchVersion(
  provider: "ARSENKIN" | "XMLSTOCK",
  configuredArsenkinVersion: string
): string {
  return provider === "XMLSTOCK"
    ? XMLSTOCK_RANK_KILL_SWITCH_VERSION
    : configuredArsenkinVersion;
}

export interface RankExecutionEvidenceV2 {
  readonly schemaVersion: "rank-execution-evidence@2";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly executionAttempt: number;
  readonly estimateId: string;
  readonly manifest: {
    readonly id: string;
    readonly hash: RankManifestHash;
    readonly chunkIndex: number;
  };
  readonly providerRequestIntent: {
    readonly id: string;
    readonly schemaVersion: "rank-provider-request-intent@1";
    readonly requestHash: RankManifestHash;
    readonly manifestChunkHash: RankManifestHash;
  };
  readonly binding: {
    readonly id: string;
    readonly version: number;
  };
  readonly route: {
    readonly id: string;
  };
  readonly credential: {
    readonly id: string;
    readonly version: number;
    readonly materialVersion: number;
    readonly validationId: string;
    readonly validationVersion: number;
    readonly validationConnectorVersion: string;
    readonly verifiedAt: string;
  };
  readonly estimateExecutionHash: RankManifestHash;
  readonly executionConnectorVersion: string;
  readonly providerPolicyVersion: string;
  readonly killSwitch: {
    readonly enabled: boolean;
    readonly version: string;
  };
}

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,63}$/u;

/**
 * Rebuilds the private Jobs-owned execution projection through an exact
 * allowlist before it is reduced to the opaque hash sent to Platform API.
 * Credential material and provider payloads are intentionally
 * unrepresentable in this contract.
 */
export function rankExecutionEvidence(
  value: unknown
): RankExecutionEvidenceV2 {
  const input = exactRecord(value, [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "jobId",
    "jobItemId",
    "executionAttempt",
    "estimateId",
    "manifest",
    "providerRequestIntent",
    "binding",
    "route",
    "credential",
    "estimateExecutionHash",
    "executionConnectorVersion",
    "providerPolicyVersion",
    "killSwitch"
  ]);
  const manifest = exactRecord(input.manifest, [
    "id",
    "hash",
    "chunkIndex"
  ]);
  const providerRequestIntent = exactRecord(
    input.providerRequestIntent,
    ["id", "schemaVersion", "requestHash", "manifestChunkHash"]
  );
  const binding = exactRecord(input.binding, ["id", "version"]);
  const route = exactRecord(input.route, ["id"]);
  const credential = exactRecord(input.credential, [
    "id",
    "version",
    "materialVersion",
    "validationId",
    "validationVersion",
    "validationConnectorVersion",
    "verifiedAt"
  ]);
  const killSwitch = exactRecord(input.killSwitch, [
    "enabled",
    "version"
  ]);

  if (
    input.schemaVersion !== RANK_EXECUTION_EVIDENCE_SCHEMA ||
    providerRequestIntent.schemaVersion !==
      "rank-provider-request-intent@1" ||
    !boundedInteger(input.executionAttempt, 1, 1_000) ||
    !boundedInteger(manifest.chunkIndex, 0, rankCommandKeywordLimit - 1) ||
    typeof input.executionConnectorVersion !== "string" ||
    !VERSION_PATTERN.test(input.executionConnectorVersion) ||
    typeof input.providerPolicyVersion !== "string" ||
    !VERSION_PATTERN.test(input.providerPolicyVersion) ||
    typeof credential.validationConnectorVersion !== "string" ||
    !VERSION_PATTERN.test(credential.validationConnectorVersion) ||
    killSwitch.enabled !== true ||
    typeof killSwitch.version !== "string" ||
    !VERSION_PATTERN.test(killSwitch.version)
  ) {
    invalid();
  }

  return {
    schemaVersion: RANK_EXECUTION_EVIDENCE_SCHEMA,
    workspaceId: uuidV7(input.workspaceId),
    projectId: uuidV7(input.projectId),
    jobId: uuidV7(input.jobId),
    jobItemId: uuidV7(input.jobItemId),
    executionAttempt: Number(input.executionAttempt),
    estimateId: uuidV7(input.estimateId),
    manifest: {
      id: uuidV7(manifest.id),
      hash: hash(manifest.hash),
      chunkIndex: Number(manifest.chunkIndex)
    },
    providerRequestIntent: {
      id: uuidV7(providerRequestIntent.id),
      schemaVersion: "rank-provider-request-intent@1",
      requestHash: hash(providerRequestIntent.requestHash),
      manifestChunkHash: hash(
        providerRequestIntent.manifestChunkHash
      )
    },
    binding: {
      id: uuidV7(binding.id),
      version: positiveInteger(binding.version)
    },
    route: { id: uuidV7(route.id) },
    credential: {
      id: uuidV7(credential.id),
      version: positiveInteger(credential.version),
      materialVersion: positiveInteger(credential.materialVersion),
      validationId: uuidV7(credential.validationId),
      validationVersion: positiveInteger(credential.validationVersion),
      validationConnectorVersion:
        credential.validationConnectorVersion as string,
      verifiedAt: timestamp(credential.verifiedAt)
    },
    estimateExecutionHash: hash(input.estimateExecutionHash),
    executionConnectorVersion: input.executionConnectorVersion,
    providerPolicyVersion: input.providerPolicyVersion,
    killSwitch: {
      enabled: killSwitch.enabled,
      version: killSwitch.version
    }
  };
}

export function rankExecutionEvidenceHash(
  value: RankExecutionEvidenceV2
): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(
      RANK_EXECUTION_EVIDENCE_SCHEMA,
      rankExecutionEvidence(value)
    )
  };
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid();
  }
  return input;
}

function uuidV7(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    invalid();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!boundedInteger(value, 1, 2_147_483_647)) invalid();
  return Number(value);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function hash(value: unknown): RankManifestHash {
  const input = exactRecord(value, ["algorithm", "value"]);
  if (
    input.algorithm !== "SHA_256" ||
    typeof input.value !== "string" ||
    !HASH_PATTERN.test(input.value)
  ) {
    invalid();
  }
  return { algorithm: "SHA_256", value: input.value };
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid();
  }
  return value;
}

function invalid(): never {
  throw new TypeError("Invalid rank execution evidence");
}

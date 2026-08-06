import { timingSafeEqual } from "node:crypto";
import {
  rankProviderKeywordLimit,
  type InternalCreateRankRunInput,
  type InternalRankExecutionParameters,
  type InternalSealRankManifestInput,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson
} from "@seo-platform/contracts/canonical-json";
import type {
  Prisma,
  RankEstimate
} from "../generated/prisma/client.js";
import { parseRankExecutionParameters } from "../rank-estimates/rank-estimate-execution.js";

const COMMAND_HASH_SCHEMA = "rank-manifest-command@1";

export interface RankManifestCommandBinding {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly estimateId: string;
  readonly trackingContextId: string;
  readonly projectDomain: string;
  readonly projectVersion: number;
  readonly pairCount: bigint;
}

export function rankManifestCommand(
  input: InternalCreateRankRunInput,
  estimate: RankEstimate,
  execution: InternalRankExecutionParameters,
  jobId: string,
  retry?: {
    readonly parentJobId: string;
    readonly pairCount: number;
    readonly expiresAt: Date;
  }
): InternalSealRankManifestInput {
  if (
    estimate.semanticScopeHash === null ||
    estimate.scopeHash === null ||
    (retry?.pairCount ?? estimate.keywordCount) < 1 ||
    (retry?.pairCount ?? estimate.keywordCount) > rankProviderKeywordLimit
  ) {
    invalid();
  }
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    jobId,
    estimateId: estimate.id,
    ...(retry ? { retryOfJobId: retry.parentJobId } : {}),
    provider: storedProvider(estimate.provider),
    operation: "POSITIONS",
    project: {
      id: input.project.id,
      workspaceId: input.project.workspaceId,
      domain: input.project.domain,
      status: input.project.status,
      version: input.project.version
    },
    estimate: {
      trackingContextId: estimate.trackingContextId,
      contextVersion: estimate.contextVersion,
      configurationVersion: estimate.configurationVersion,
      configurationHash: hashFromBytes(estimate.configurationHash),
      semanticScopeHash: hashFromBytes(estimate.semanticScopeHash),
      scopeHash: hashFromBytes(estimate.scopeHash),
      pairCount: String(retry?.pairCount ?? estimate.keywordCount),
      expiresAt: (retry?.expiresAt ?? estimate.expiresAt).toISOString()
    },
    execution: copyExecution(execution),
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  };
}

export function rankManifestCommandHash(
  command: InternalSealRankManifestInput
): Buffer {
  return Buffer.from(
    canonicalJsonSha256(COMMAND_HASH_SCHEMA, command),
    "hex"
  );
}

export function rankManifestCommandJson(
  command: InternalSealRankManifestInput
): Prisma.InputJsonValue {
  return JSON.parse(canonicalizeJson(command)) as Prisma.InputJsonValue;
}

export function storedRankManifestCommand(
  value: unknown,
  storedHash: Uint8Array,
  binding: RankManifestCommandBinding
): InternalSealRankManifestInput {
  const command = parseCommand(value);
  const actual = rankManifestCommandHash(command);
  const expected = Buffer.from(storedHash);
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    invalid();
  }
  assertBinding(command, binding);
  return command;
}

function assertBinding(
  command: InternalSealRankManifestInput,
  binding: RankManifestCommandBinding
): void {
  if (
    command.workspaceId !== binding.workspaceId ||
    command.projectId !== binding.projectId ||
    command.actorId !== binding.actorId ||
    command.jobId !== binding.jobId ||
    command.estimateId !== binding.estimateId ||
    command.project.id !== binding.projectId ||
    command.project.workspaceId !== binding.workspaceId ||
    command.project.domain !== binding.projectDomain ||
    command.project.status !== "ACTIVE" ||
    command.project.version !== binding.projectVersion ||
    command.estimate.trackingContextId !== binding.trackingContextId ||
    command.estimate.pairCount !== binding.pairCount.toString()
  ) {
    invalid();
  }
}

function parseCommand(value: unknown): InternalSealRankManifestInput {
  const hasRetry =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "retryOfJobId");
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "estimateId",
    ...(hasRetry ? ["retryOfJobId"] : []),
    "provider",
    "operation",
    "project",
    "estimate",
    "execution",
    "retention"
  ]);
  const project = exactRecord(input.project, [
    "id",
    "workspaceId",
    "domain",
    "status",
    "version"
  ]);
  const estimate = exactRecord(input.estimate, [
    "trackingContextId",
    "contextVersion",
    "configurationVersion",
    "configurationHash",
    "semanticScopeHash",
    "scopeHash",
    "pairCount",
    "expiresAt"
  ]);
  const retention = exactRecord(input.retention, [
    "normalizedRankHistory",
    "rawSerp"
  ]);
  const workspaceId = uuid(input.workspaceId);
  const projectId = uuid(input.projectId);
  const actorId = uuid(input.actorId);
  const jobId = uuid(input.jobId);
  const estimateId = uuid(input.estimateId);
  const retryOfJobId = input.retryOfJobId === undefined
    ? undefined
    : uuid(input.retryOfJobId);
  const trackingContextId = uuid(estimate.trackingContextId);
  const pairCount = decimal(
    estimate.pairCount,
    rankProviderKeywordLimit
  );
  if (
    (input.provider !== "ARSENKIN" && input.provider !== "XMLSTOCK") ||
    input.operation !== "POSITIONS" ||
    uuid(project.id) !== projectId ||
    uuid(project.workspaceId) !== workspaceId ||
    typeof project.domain !== "string" ||
    project.domain.length < 1 ||
    project.domain.length > 2_048 ||
    project.domain !== project.domain.trim() ||
    project.status !== "ACTIVE" ||
    !positiveInteger(project.version) ||
    !positiveInteger(estimate.contextVersion) ||
    !positiveInteger(estimate.configurationVersion) ||
    Number(estimate.configurationVersion) >
      Number(estimate.contextVersion) ||
    !timestamp(estimate.expiresAt) ||
    retention.normalizedRankHistory !== "LONG_TERM" ||
    retention.rawSerp !== "NOT_COLLECTED"
  ) {
    invalid();
  }
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    estimateId,
    ...(retryOfJobId ? { retryOfJobId } : {}),
    provider: input.provider,
    operation: "POSITIONS",
    project: {
      id: projectId,
      workspaceId,
      domain: project.domain,
      status: "ACTIVE",
      version: Number(project.version)
    },
    estimate: {
      trackingContextId,
      contextVersion: Number(estimate.contextVersion),
      configurationVersion: Number(estimate.configurationVersion),
      configurationHash: hash(estimate.configurationHash),
      semanticScopeHash: hash(estimate.semanticScopeHash),
      scopeHash: hash(estimate.scopeHash),
      pairCount,
      expiresAt: estimate.expiresAt
    },
    execution: parseRankExecutionParameters(input.execution),
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  };
}

function storedProvider(value: string): "ARSENKIN" | "XMLSTOCK" {
  if (value !== "ARSENKIN" && value !== "XMLSTOCK") invalid();
  return value;
}

function copyExecution(
  value: InternalRankExecutionParameters
): InternalRankExecutionParameters {
  return {
    searchEngine: value.searchEngine,
    countryCode: value.countryCode,
    ...(value.regionCode ? { regionCode: value.regionCode } : {}),
    language: value.language,
    device: value.device,
    depth: value.depth,
    domainMatchRule:
      "value" in value.domainMatchRule
        ? {
            mode: value.domainMatchRule.mode,
            value: value.domainMatchRule.value
          }
        : { mode: value.domainMatchRule.mode },
    safeSearch: value.safeSearch,
    format: value.format,
    rawSerp: value.rawSerp,
    fallbackMode: value.fallbackMode,
    providerMappingVersion: value.providerMappingVersion
  };
}

function hashFromBytes(value: Uint8Array): RankManifestHash {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) invalid();
  return {
    algorithm: "SHA_256",
    value: bytes.toString("hex")
  };
}

function hash(value: unknown): RankManifestHash {
  const input = exactRecord(value, ["algorithm", "value"]);
  if (
    input.algorithm !== "SHA_256" ||
    typeof input.value !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.value)
  ) {
    invalid();
  }
  return { algorithm: "SHA_256", value: input.value };
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
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

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  ) {
    invalid();
  }
  return value;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function decimal(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    invalid();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) invalid();
  return value;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function invalid(): never {
  throw new Error("Invalid immutable rank manifest command");
}

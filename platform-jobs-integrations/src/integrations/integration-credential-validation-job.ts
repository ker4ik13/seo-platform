import { createHash, timingSafeEqual } from "node:crypto";
import type {
  IntegrationCredentialValidationStatus,
  IntegrationCredentialValidationSummary,
  IntegrationProvider
} from "@seo-platform/contracts";
import type {
  Job,
  Prisma
} from "../generated/prisma/client.js";

export const INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE =
  "INTEGRATION_CREDENTIAL_VALIDATE";
export const INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND =
  "integration.credential.validation.v1";
export const ACTIVE_INTEGRATION_CREDENTIAL_VALIDATION_JOB_STATUSES = [
  "QUEUED",
  "WAITING_RATE_LIMIT",
  "RUNNING",
  "RETRY_SCHEDULED"
] as const;

export interface IntegrationCredentialValidationJobInput {
  readonly kind: typeof INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND;
  readonly credentialId: string;
  readonly credentialMaterialVersion: number;
  readonly connectorVersion: string;
}

export function integrationCredentialValidationScope(
  credentialId: string
): string {
  return `integration-credential-validation:${credentialId}`;
}

export function integrationCredentialValidationDeduplicationKey(
  credentialId: string,
  credentialMaterialVersion: number
): string {
  return `integration-credential-validation:${credentialId}:${credentialMaterialVersion}`;
}

export function integrationCredentialValidationRequestHash(input: {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly credentialId: string;
}): Buffer {
  return createHash("sha256")
    .update("seo-platform:integration-credential-validation:v1", "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(input), "utf8")
    .digest();
}

export function validationRequestHashMatches(
  stored: Uint8Array | null,
  candidate: Buffer
): boolean {
  if (!stored) return false;
  const value = Buffer.from(stored);
  return value.length === candidate.length && timingSafeEqual(value, candidate);
}

export function integrationCredentialValidationJobInput(
  value: Prisma.JsonValue
): IntegrationCredentialValidationJobInput {
  const input = record(value);
  if (
    input.kind !== INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND ||
    typeof input.credentialId !== "string" ||
    !UUID_PATTERN.test(input.credentialId) ||
    !Number.isSafeInteger(input.credentialMaterialVersion) ||
    Number(input.credentialMaterialVersion) < 1 ||
    typeof input.connectorVersion !== "string" ||
    !/^[a-z0-9][a-z0-9@._-]{0,31}$/u.test(input.connectorVersion)
  ) {
    throw new Error("Invalid integration credential validation job input");
  }
  return {
    kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
    credentialId: input.credentialId.toLowerCase(),
    credentialMaterialVersion: Number(
      input.credentialMaterialVersion
    ),
    connectorVersion: input.connectorVersion
  };
}

export function toValidationSummary(
  job: Job
): IntegrationCredentialValidationSummary {
  const input = integrationCredentialValidationJobInput(job.inputSnapshot);
  const errorCode = jobErrorCode(job.errorSummary);
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    credentialId: input.credentialId,
    credentialMaterialVersion: input.credentialMaterialVersion,
    provider: providerValue(job.provider),
    status: validationStatus(job.status, errorCode),
    ...(errorCode ? { errorCode } : {}),
    connectorVersion: input.connectorVersion,
    requestedAt: job.createdAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.retryAt ? { retryAt: job.retryAt.toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {})
  };
}

export function validationJobJson(
  value: unknown
): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function validationStatus(
  status: Job["status"],
  errorCode: string | undefined
): IntegrationCredentialValidationStatus {
  if (status === "QUEUED") return "QUEUED";
  if (status === "RUNNING") return "RUNNING";
  if (status === "COMPLETED") return "SUCCEEDED";
  if (status === "RETRY_SCHEDULED" || status === "WAITING_RATE_LIMIT") {
    return "RETRY_SCHEDULED";
  }
  if (status === "FAILED_RETRYABLE") return "FAILED_RETRYABLE";
  if (status === "FAILED_FINAL" && errorCode === "CREDENTIAL_CHANGED") {
    return "STALE";
  }
  return "FAILED_FINAL";
}

function jobErrorCode(value: Prisma.JsonValue | null): string | undefined {
  const error = value === null ? undefined : record(value);
  return typeof error?.code === "string" && error.code.length <= 100
    ? error.code
    : undefined;
}

function providerValue(value: string | null): IntegrationProvider {
  if (
    typeof value !== "string" ||
    !["XMLSTOCK", "ARSENKIN", "KEYS_SO"].includes(value)
  ) {
    throw new Error("Unsupported provider in credential validation job");
  }
  return value as IntegrationProvider;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("A validation job JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

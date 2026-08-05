import { Buffer } from "node:buffer";
import { Injectable } from "@nestjs/common";
import type {
  IntegrationCredentialStatus,
  IntegrationCredentialValidationSummary,
  IntegrationProvider
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  EncryptedIntegrationCredential
} from "./integration-credential-crypto.service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,100}$/u;
const CONNECTOR_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,31}$/u;
const MAX_EXECUTION_KEK_CANARY_VERSIONS = 128;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type CredentialValidationClaimOutcome =
  | "CLAIMED"
  | "TERMINAL"
  | "NOT_CLAIMABLE"
  | "EXHAUSTED";

export type CredentialValidationScopeState =
  | "READY"
  | "STALE"
  | "DISABLED"
  | "MODE_UNSUPPORTED"
  | "NOT_APPLICABLE";

export type CredentialValidationJobErrorCode =
  | "CREDENTIAL_CHANGED"
  | "CREDENTIAL_DISABLED"
  | "CREDENTIAL_MODE_UNSUPPORTED"
  | "CREDENTIAL_VALIDATION_UNAVAILABLE"
  | "CONNECTOR_VERSION_CHANGED"
  | "CREDENTIAL_KEY_VERSION_UNAVAILABLE"
  | "CREDENTIAL_DECRYPTION_FAILED"
  | "CREDENTIAL_VALIDATION_INTERNAL_ERROR";

export interface CredentialValidationClaim {
  readonly outcome: CredentialValidationClaimOutcome;
  readonly scopeState: CredentialValidationScopeState;
  readonly summary: IntegrationCredentialValidationSummary;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly jobVersion: number;
  readonly encryptedCredential?: EncryptedIntegrationCredential;
}

export interface IntegrationCredentialKekCanaryRecord {
  readonly keyVersion: number;
  readonly encrypted?: EncryptedIntegrationCredential;
}

export interface IntegrationCredentialExecutionKekCanaryRecord
  extends IntegrationCredentialKekCanaryRecord {
  readonly usedByCredential: boolean;
}

export interface IntegrationCredentialKeyVersions {
  readonly encryption: readonly number[];
  readonly fingerprint: readonly number[];
}

@Injectable()
export class IntegrationCredentialExecutionBrokerService {
  public constructor(private readonly prisma: PrismaService) {}

  public async keyVersions(): Promise<IntegrationCredentialKeyVersions> {
    const rows = await this.prisma.$queryRaw<readonly KeyVersionRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.list_integration_credential_key_versions()
      `
    );
    const encryption: number[] = [];
    const fingerprint: number[] = [];
    for (const row of rows) {
      const keyVersion = positiveInteger(row.keyVersion, "key version");
      if (row.keyKind === "ENCRYPTION") encryption.push(keyVersion);
      else if (row.keyKind === "FINGERPRINT") fingerprint.push(keyVersion);
      else throw invalidBrokerResponse("key kind");
    }
    return {
      encryption: uniqueSorted(encryption),
      fingerprint: uniqueSorted(fingerprint)
    };
  }

  public async registerKekCanary(
    encrypted: EncryptedIntegrationCredential
  ): Promise<IntegrationCredentialKekCanaryRecord> {
    const rows = await this.prisma.$queryRaw<readonly KekCanaryRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.register_integration_credential_kek_canary(
          ${encrypted.keyVersion}::integer,
          ${encrypted.ciphertext}::bytea,
          ${encrypted.nonce}::bytea,
          ${encrypted.authTag}::bytea,
          ${encrypted.encryptedDataKey}::bytea,
          ${encrypted.dataKeyNonce}::bytea,
          ${encrypted.dataKeyAuthTag}::bytea
        )
      `
    );
    return requiredCanary(rows, encrypted.keyVersion);
  }

  public async executionKekCanaries(
    requestedKeyVersions: readonly number[]
  ): Promise<
    readonly IntegrationCredentialExecutionKekCanaryRecord[]
  > {
    const requestedVersions = boundedRequestedCanaryVersions(
      requestedKeyVersions
    );
    const rows = await this.prisma.$queryRaw<
      readonly ExecutionKekCanaryRow[]
    >(
      Prisma.sql`
        SELECT *
        FROM public.list_integration_credential_execution_kek_canaries(
          ${requestedVersions.map(String)}::text[]
        )
      `
    );
    const records = rows.map(executionCanaryRecord);
    if (records.length > MAX_EXECUTION_KEK_CANARY_VERSIONS) {
      throw invalidBrokerResponse("canary projection limit");
    }
    const versions = records.map(({ keyVersion }) => keyVersion);
    if (new Set(versions).size !== versions.length) {
      throw invalidBrokerResponse("duplicate canary version");
    }
    const requested = new Set(requestedVersions);
    const returned = new Set(versions);
    if (requestedVersions.some((version) => !returned.has(version))) {
      throw invalidBrokerResponse("missing requested canary version");
    }
    if (
      records.some(
        ({ keyVersion, usedByCredential }) =>
          !usedByCredential && !requested.has(keyVersion)
      )
    ) {
      throw invalidBrokerResponse("unrequested unused canary version");
    }
    return records;
  }

  public async pendingValidationIds(
    limit: number
  ): Promise<readonly string[]> {
    const boundedLimit = boundedPendingLimit(limit);
    const rows = await this.prisma.$queryRaw<readonly ValidationIdRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.list_due_integration_credential_validations(
          ${boundedLimit}::integer
        )
      `
    );
    return rows.map(({ validationId }) => uuid(validationId, "validation id"));
  }

  public async scheduleValidationRefreshes(input: {
    readonly credentialIds?: readonly string[];
    readonly staleBefore?: Date;
    readonly connectorVersions: Readonly<Record<IntegrationProvider, string>>;
    readonly reason: "HOURLY" | "PROVIDER_OPERATION";
    readonly limit?: number;
  }): Promise<readonly string[]> {
    const limit = boundedPendingLimit(input.limit ?? 100);
    const credentialIds = input.credentialIds?.map((id) =>
      uuid(id, "credential id")
    );
    if (credentialIds && credentialIds.length > 500) {
      throw new TypeError("Too many credential refresh targets");
    }
    const rows = await this.prisma.$queryRaw<readonly ValidationIdRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.schedule_integration_credential_validation_refreshes(
          ${credentialIds ?? null}::uuid[],
          ${input.staleBefore ?? null}::timestamptz,
          ${JSON.stringify(input.connectorVersions)}::jsonb,
          ${input.reason}::text,
          ${limit}::integer
        )
      `
    );
    return rows.map(({ validationId }) =>
      uuid(validationId, "validation id")
    );
  }

  public async claimValidation(
    validationId: string,
    leaseOwner: string,
    leaseSeconds: number
  ): Promise<CredentialValidationClaim | undefined> {
    const rows = await this.prisma.$queryRaw<readonly ClaimRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.claim_integration_credential_validation(
          ${uuid(validationId, "validation id")}::uuid,
          ${leaseOwner}::text,
          ${leaseSeconds}::integer
        )
      `
    );
    if (rows.length === 0) return undefined;
    if (rows.length !== 1 || !rows[0]) {
      throw invalidBrokerResponse("claim cardinality");
    }
    return claimRecord(rows[0], leaseOwner);
  }

  public finishJobFailure(
    claim: CredentialValidationClaim,
    errorCode: CredentialValidationJobErrorCode,
    retryAfterSeconds?: number
  ): Promise<IntegrationCredentialValidationSummary> {
    const lease = claimedLease(claim);
    return this.requiredSummary(
      Prisma.sql`
        SELECT *
        FROM public.finish_integration_credential_validation_job_failure(
          ${claim.summary.id}::uuid,
          ${lease.owner}::text,
          ${lease.token}::uuid,
          ${claim.jobVersion}::integer,
          ${errorCode}::text,
          ${retryAfterSeconds ?? null}::integer
        )
      `
    );
  }

  public finishProviderFailure(
    claim: CredentialValidationClaim,
    input: {
      readonly errorCode: string;
      readonly credentialStatus?: Extract<
        IntegrationCredentialStatus,
        "INVALID" | "RATE_LIMITED" | "DEGRADED"
      >;
      readonly retryAfterSeconds?: number;
    }
  ): Promise<IntegrationCredentialValidationSummary> {
    const lease = claimedLease(claim);
    return this.requiredSummary(
      Prisma.sql`
        SELECT *
        FROM public.finish_integration_credential_validation_provider_failure(
          ${claim.summary.id}::uuid,
          ${lease.owner}::text,
          ${lease.token}::uuid,
          ${claim.jobVersion}::integer,
          ${input.errorCode}::text,
          ${input.credentialStatus ?? null}::text,
          ${input.retryAfterSeconds ?? null}::integer
        )
      `
    );
  }

  public finishSuccess(
    claim: CredentialValidationClaim,
    connectorVersion: string,
    providerMeta: Readonly<Record<string, unknown>> | undefined
  ): Promise<IntegrationCredentialValidationSummary> {
    const lease = claimedLease(claim);
    if (!CONNECTOR_VERSION_PATTERN.test(connectorVersion)) {
      throw new Error("Invalid credential validation connector version");
    }
    const providerMetaJson =
      providerMeta === undefined ? null : JSON.stringify(providerMeta);
    return this.requiredSummary(
      Prisma.sql`
        SELECT *
        FROM public.finish_integration_credential_validation_success(
          ${claim.summary.id}::uuid,
          ${lease.owner}::text,
          ${lease.token}::uuid,
          ${claim.jobVersion}::integer,
          ${connectorVersion}::text,
          ${providerMetaJson}::jsonb
        )
      `
    );
  }

  private async requiredSummary(
    query: Prisma.Sql
  ): Promise<IntegrationCredentialValidationSummary> {
    const rows = await this.prisma.$queryRaw<readonly SummaryRow[]>(query);
    if (rows.length !== 1 || !rows[0]) {
      throw new CredentialValidationLeaseLostError();
    }
    return summaryRecord(rows[0]);
  }
}

export class CredentialValidationLeaseLostError extends Error {
  public constructor() {
    super("CREDENTIAL_VALIDATION_LEASE_LOST");
    this.name = "CredentialValidationLeaseLostError";
  }
}

interface KeyVersionRow {
  readonly keyKind: string;
  readonly keyVersion: number;
}

interface KekCanaryRow {
  readonly keyVersion: number;
  readonly ciphertext: Uint8Array | null;
  readonly nonce: Uint8Array | null;
  readonly authTag: Uint8Array | null;
  readonly encryptedDataKey: Uint8Array | null;
  readonly dataKeyNonce: Uint8Array | null;
  readonly dataKeyAuthTag: Uint8Array | null;
}

interface ExecutionKekCanaryRow extends KekCanaryRow {
  readonly usedByCredential: boolean;
}

interface ValidationIdRow {
  readonly validationId: string;
}

interface SummaryRow {
  readonly validationId: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly credentialId: string;
  readonly credentialMaterialVersion: number;
  readonly connectorVersion: string;
  readonly jobStatus: string;
  readonly errorCode: string | null;
  readonly requestedAt: Date;
  readonly startedAt: Date | null;
  readonly retryAt: Date | null;
  readonly finishedAt: Date | null;
}

interface ClaimRow extends SummaryRow, KekCanaryRow {
  readonly claimOutcome: string;
  readonly scopeState: string;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly jobVersion: number;
}

function claimRecord(
  row: ClaimRow,
  leaseOwner: string
): CredentialValidationClaim {
  if (!isClaimOutcome(row.claimOutcome)) {
    throw invalidBrokerResponse("claim outcome");
  }
  if (!isScopeState(row.scopeState)) {
    throw invalidBrokerResponse("scope state");
  }
  const summary = summaryRecord(row);
  const jobVersion = positiveInteger(row.jobVersion, "job version");
  if (row.claimOutcome !== "CLAIMED") {
    if (
      row.leaseToken !== null ||
      row.leaseExpiresAt !== null ||
      row.scopeState !== "NOT_APPLICABLE"
    ) {
      throw invalidBrokerResponse("unclaimed lease projection");
    }
    return {
      outcome: row.claimOutcome,
      scopeState: row.scopeState,
      summary,
      jobVersion
    };
  }
  const leaseToken = uuid(row.leaseToken, "lease token");
  if (row.leaseExpiresAt === null) {
    throw invalidBrokerResponse("lease expiry");
  }
  const leaseExpiresAt = timestamp(
    row.leaseExpiresAt,
    "leaseExpiresAt"
  ).toISOString();
  if (row.scopeState === "READY") {
    const encrypted = canaryRecord(row).encrypted;
    if (!encrypted) throw invalidBrokerResponse("credential material");
    return {
      outcome: row.claimOutcome,
      scopeState: row.scopeState,
      summary,
      leaseOwner,
      leaseToken,
      leaseExpiresAt,
      jobVersion,
      encryptedCredential: encrypted
    };
  }
  if (hasEncryptedMaterial(row)) {
    throw invalidBrokerResponse("non-ready credential material");
  }
  return {
    outcome: row.claimOutcome,
    scopeState: row.scopeState,
    summary,
    leaseOwner,
    leaseToken,
    leaseExpiresAt,
    jobVersion
  };
}

function summaryRecord(row: SummaryRow): IntegrationCredentialValidationSummary {
  const errorCode =
    row.errorCode === null
      ? undefined
      : ERROR_CODE_PATTERN.test(row.errorCode)
        ? row.errorCode
        : (() => {
            throw invalidBrokerResponse("error code");
          })();
  return {
    id: uuid(row.validationId, "validation id"),
    workspaceId: uuid(row.workspaceId, "workspace id"),
    credentialId: uuid(row.credentialId, "credential id"),
    credentialMaterialVersion: positiveInteger(
      row.credentialMaterialVersion,
      "credential material version"
    ),
    provider: providerValue(row.provider),
    status: validationStatus(row.jobStatus, errorCode),
    ...(errorCode ? { errorCode } : {}),
    connectorVersion: connectorVersion(row.connectorVersion),
    requestedAt: timestamp(row.requestedAt, "requestedAt").toISOString(),
    ...(row.startedAt
      ? { startedAt: timestamp(row.startedAt, "startedAt").toISOString() }
      : {}),
    ...(row.retryAt
      ? { retryAt: timestamp(row.retryAt, "retryAt").toISOString() }
      : {}),
    ...(row.finishedAt
      ? { finishedAt: timestamp(row.finishedAt, "finishedAt").toISOString() }
      : {})
  };
}

function canaryRecord(row: KekCanaryRow): IntegrationCredentialKekCanaryRecord {
  const keyVersion = positiveInteger(row.keyVersion, "key version");
  if (!hasEncryptedMaterial(row)) return { keyVersion };
  return {
    keyVersion,
    encrypted: {
      keyVersion,
      ciphertext: buffer(row.ciphertext, "ciphertext"),
      nonce: fixedBuffer(row.nonce, 12, "nonce"),
      authTag: fixedBuffer(row.authTag, 16, "auth tag"),
      encryptedDataKey: buffer(row.encryptedDataKey, "encrypted data key"),
      dataKeyNonce: fixedBuffer(row.dataKeyNonce, 12, "data key nonce"),
      dataKeyAuthTag: fixedBuffer(row.dataKeyAuthTag, 16, "data key auth tag")
    }
  };
}

function executionCanaryRecord(
  row: ExecutionKekCanaryRow
): IntegrationCredentialExecutionKekCanaryRecord {
  if (typeof row.usedByCredential !== "boolean") {
    throw invalidBrokerResponse("canary usage marker");
  }
  return {
    ...canaryRecord(row),
    usedByCredential: row.usedByCredential
  };
}

function requiredCanary(
  rows: readonly KekCanaryRow[],
  expectedVersion: number
): IntegrationCredentialKekCanaryRecord {
  if (rows.length !== 1 || !rows[0]) {
    throw invalidBrokerResponse("canary cardinality");
  }
  const record = canaryRecord(rows[0]);
  if (record.keyVersion !== expectedVersion || !record.encrypted) {
    throw invalidBrokerResponse("registered canary");
  }
  return record;
}

function claimedLease(claim: CredentialValidationClaim): {
  readonly owner: string;
  readonly token: string;
} {
  if (
    claim.outcome !== "CLAIMED" ||
    !claim.leaseOwner ||
    !claim.leaseToken
  ) {
    throw new CredentialValidationLeaseLostError();
  }
  return { owner: claim.leaseOwner, token: claim.leaseToken };
}

function hasEncryptedMaterial(row: KekCanaryRow): boolean {
  const values = [
    row.ciphertext,
    row.nonce,
    row.authTag,
    row.encryptedDataKey,
    row.dataKeyNonce,
    row.dataKeyAuthTag
  ];
  const present = values.filter((value) => value !== null).length;
  if (present !== 0 && present !== values.length) {
    throw invalidBrokerResponse("partial encrypted material");
  }
  return present === values.length;
}

function validationStatus(
  status: string,
  errorCode: string | undefined
): IntegrationCredentialValidationSummary["status"] {
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
  if (status === "FAILED_FINAL") return "FAILED_FINAL";
  throw invalidBrokerResponse("validation job status");
}

function providerValue(value: string): IntegrationProvider {
  if (value === "XMLSTOCK" || value === "ARSENKIN" || value === "KEYS_SO") {
    return value;
  }
  throw invalidBrokerResponse("provider");
}

function connectorVersion(value: string): string {
  if (!CONNECTOR_VERSION_PATTERN.test(value)) {
    throw invalidBrokerResponse("connector version");
  }
  return value;
}

function boundedPendingLimit(value: number): number {
  if (!Number.isSafeInteger(value)) return 100;
  return Math.min(Math.max(value, 1), 500);
}

function boundedRequestedCanaryVersions(
  values: readonly number[]
): readonly number[] {
  if (values.length > MAX_EXECUTION_KEK_CANARY_VERSIONS) {
    throw invalidBrokerRequest("requested canary versions");
  }
  const versions = values.map((value) => {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > POSTGRES_INTEGER_MAX
    ) {
      throw invalidBrokerRequest("requested canary versions");
    }
    return value;
  });
  if (new Set(versions).size !== versions.length) {
    throw invalidBrokerRequest("duplicate requested canary version");
  }
  return versions.sort((left, right) => left - right);
}

function uniqueSorted(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidBrokerResponse(field);
  }
  return value;
}

function uuid(value: string | null, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidBrokerResponse(field);
  }
  return value.toLowerCase();
}

function timestamp(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw invalidBrokerResponse(field);
  }
  return value;
}

function buffer(value: Uint8Array | null, field: string): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw invalidBrokerResponse(field);
  }
  return Buffer.from(value);
}

function fixedBuffer(
  value: Uint8Array | null,
  length: number,
  field: string
): Buffer {
  const parsed = buffer(value, field);
  if (parsed.length !== length) throw invalidBrokerResponse(field);
  return parsed;
}

function isClaimOutcome(value: string): value is CredentialValidationClaimOutcome {
  return ["CLAIMED", "TERMINAL", "NOT_CLAIMABLE", "EXHAUSTED"].includes(
    value
  );
}

function isScopeState(value: string): value is CredentialValidationScopeState {
  return [
    "READY",
    "STALE",
    "DISABLED",
    "MODE_UNSUPPORTED",
    "NOT_APPLICABLE"
  ].includes(value);
}

function invalidBrokerResponse(field: string): Error {
  return new Error(`Invalid integration credential broker ${field}`);
}

function invalidBrokerRequest(field: string): Error {
  return new Error(`Invalid integration credential broker ${field}`);
}

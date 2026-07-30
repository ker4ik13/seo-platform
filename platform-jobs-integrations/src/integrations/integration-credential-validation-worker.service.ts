import { Buffer } from "node:buffer";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  IntegrationCredentialStatus,
  IntegrationProvider
} from "@seo-platform/contracts";
import {
  Prisma,
  type IntegrationCredential,
  type Job
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import type {
  CredentialValidationResult
} from "./integration-credential-validation.connector.js";
import {
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationJobInput,
  toValidationSummary,
  validationJobJson
} from "./integration-credential-validation-job.js";
import { integrationProviderMetadata } from "./integration-provider-catalog.js";

const SCHEDULED_STATUSES = [
  "RETRY_SCHEDULED",
  "WAITING_RATE_LIMIT"
] as const;
const TERMINAL_STATUSES = [
  "CANCELLED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "EXPIRED",
  "PARTIALLY_COMPLETED"
] as const;

interface ClaimedValidation {
  readonly job: Job;
  readonly claimed: boolean;
}

interface ValidationFailure {
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly credentialStatus?: Extract<
    IntegrationCredentialStatus,
    "INVALID" | "RATE_LIMITED" | "DEGRADED" | "DISABLED"
  >;
}

@Injectable()
export class IntegrationCredentialValidationWorkerService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: IntegrationCredentialCryptoService,
    private readonly connectors: IntegrationCredentialConnectorRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async process(
    validationId: string,
    leaseOwner: string
  ): Promise<ReturnType<typeof toValidationSummary>> {
    assertLeaseOwner(leaseOwner);
    const claim = await this.claim(validationId, leaseOwner);
    if (!claim.claimed) return toValidationSummary(claim.job);

    const job = claim.job;
    const input = integrationCredentialValidationJobInput(
      job.inputSnapshot
    );
    const credential =
      await this.prisma.integrationCredential.findFirst({
        where: {
          id: input.credentialId,
          workspaceId: job.workspaceId,
          deletedAt: null
        }
      });
    if (
      !credential ||
      credential.materialVersion !==
        input.credentialMaterialVersion ||
      credential.provider !== job.provider
    ) {
      return toValidationSummary(
        await this.finishStale(job, leaseOwner)
      );
    }
    if (
      credential.mode !== "BYOK_API_KEY" ||
      credential.status === "DISABLED"
    ) {
      return toValidationSummary(
        await this.finishJobOnlyFailure(
          job,
          leaseOwner,
          credential.status === "DISABLED"
            ? "CREDENTIAL_DISABLED"
            : "CREDENTIAL_MODE_UNSUPPORTED"
        )
      );
    }

    const provider = providerValue(credential.provider);
    let connectorVersion: string;
    try {
      connectorVersion = this.connectors.version(provider);
    } catch {
      return toValidationSummary(
        await this.finishFailure(
          job,
          credential,
          leaseOwner,
          {
            errorCode: "CREDENTIAL_VALIDATION_UNAVAILABLE",
            retryable: false
          }
        )
      );
    }
    if (connectorVersion !== input.connectorVersion) {
      return toValidationSummary(
        await this.finishFailure(
          job,
          credential,
          leaseOwner,
          {
            errorCode: "CONNECTOR_VERSION_CHANGED",
            retryable: false
          }
        )
      );
    }
    if (
      !this.config.integrationCredentials.keys.has(
        credential.keyVersion
      )
    ) {
      return this.finishJobOnlyRetry(
        job,
        leaseOwner,
        "CREDENTIAL_KEY_VERSION_UNAVAILABLE",
        60
      );
    }

    let secret: ReturnType<IntegrationCredentialCryptoService["decrypt"]>;
    try {
      secret = this.crypto.decrypt(
        credential.workspaceId,
        provider,
        credential.id,
        encryptedCredential(credential)
      );
    } catch {
      return this.finishJobOnlyRetry(
        job,
        leaseOwner,
        "CREDENTIAL_DECRYPTION_FAILED",
        60
      );
    }

    let result: CredentialValidationResult;
    try {
      result = await this.connectors.validate(
        provider,
        secret,
        this.config.integrationCredentialValidation.timeoutMs
      );
    } catch {
      return this.finishOrRetry(
        job,
        credential,
        leaseOwner,
        {
          errorCode: "CREDENTIAL_VALIDATION_INTERNAL_ERROR",
          retryable: true
        }
      );
    }

    if (result.ok) {
      return toValidationSummary(
        await this.finishSuccess(
          job,
          credential,
          provider,
          leaseOwner,
          result.providerMeta
        )
      );
    }
    const failure =
      result.credentialStatus === "DEGRADED" &&
      credential.verifiedAt === null
        ? {
            errorCode: result.errorCode,
            retryable: result.retryable,
            ...(result.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: result.retryAfterSeconds }
              : {})
          }
        : result;
    return this.finishOrRetry(
      job,
      credential,
      leaseOwner,
      failure
    );
  }

  public async pendingValidationIds(
    limit = 100
  ): Promise<readonly string[]> {
    const now = new Date();
    const jobs = await this.prisma.job.findMany({
      where: {
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
        OR: [
          {
            status: {
              in: ["QUEUED", ...SCHEDULED_STATUSES]
            },
            OR: [
              { retryAt: null },
              { retryAt: { lte: now } }
            ]
          },
          {
            status: "RUNNING",
            OR: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lte: now } }
            ]
          }
        ]
      },
      orderBy: [
        { priority: "asc" },
        { createdAt: "asc" },
        { id: "asc" }
      ],
      take: boundedPendingLimit(limit),
      select: { id: true }
    });
    return jobs.map(({ id }) => id);
  }

  private async claim(
    validationId: string,
    leaseOwner: string
  ): Promise<ClaimedValidation> {
    const current = await this.prisma.job.findFirst({
      where: {
        id: validationId,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE
      }
    });
    if (!current) throw validationNotFound();
    if (isTerminal(current.status)) {
      return { job: current, claimed: false };
    }
    const now = new Date();
    if (!isClaimable(current, now)) {
      return { job: current, claimed: false };
    }
    if (current.attempt >= current.maxAttempts) {
      const terminal = await this.finishExhausted(current, now);
      return { job: terminal, claimed: false };
    }
    const leaseExpiresAt = new Date(
      now.getTime() +
        this.config.integrationCredentialValidation.leaseSeconds * 1_000
    );
    const changed = await this.prisma.job.updateMany({
      where: {
        id: current.id,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
        status: current.status,
        version: current.version,
        attempt: { lt: current.maxAttempts },
        ...(current.status === "RUNNING"
          ? {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: now } }
              ]
            }
          : current.status === "QUEUED" ||
              isScheduled(current.status)
            ? {
                OR: [
                  { retryAt: null },
                  { retryAt: { lte: now } }
                ]
              }
          : {})
      },
      data: {
        status: "RUNNING",
        stage: "credential_validation_running",
        leaseOwner,
        leaseExpiresAt,
        retryAt: null,
        startedAt: current.startedAt ?? now,
        finishedAt: null,
        attempt: { increment: 1 },
        version: { increment: 1 }
      }
    });
    const claimed = await this.requiredJob(current.id);
    return { job: claimed, claimed: changed.count === 1 };
  }

  private async finishSuccess(
    job: Job,
    credential: IntegrationCredential,
    provider: IntegrationProvider,
    leaseOwner: string,
    providerMeta: Readonly<Record<string, unknown>> | undefined
  ): Promise<Job> {
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const credentialChanged =
        await transaction.integrationCredential.updateMany({
          where: {
            id: credential.id,
            workspaceId: job.workspaceId,
            materialVersion: credential.materialVersion,
            status: { notIn: ["DISABLED", "REVOKED"] },
            deletedAt: null
          },
          data: {
            status: "ACTIVE",
            capabilities: [
              ...integrationProviderMetadata(provider).capabilities
            ],
            verifiedAt: completedAt,
            lastSuccessAt: completedAt,
            lastErrorAt: null,
            lastErrorCode: null,
            ...(providerMeta
              ? {
                  providerMeta: mergedProviderMeta(
                    credential.providerMeta,
                    providerMeta
                  )
                }
              : {}),
            ...(job.actorId ? { updatedBy: job.actorId } : {}),
            version: { increment: 1 }
          }
        });
      if (credentialChanged.count !== 1) {
        return this.finishStaleInTransaction(
          transaction,
          job,
          leaseOwner,
          completedAt
        );
      }
      await this.updateClaimedJob(
        transaction,
        job,
        leaseOwner,
        {
          status: "COMPLETED",
          stage: "credential_validation_completed",
          progressCurrent: 1n,
          resultSummary: validationJobJson({
            credentialStatus: "ACTIVE"
          }),
          errorSummary: Prisma.DbNull,
          finishedAt: completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          version: { increment: 1 }
        }
      );
      return requiredTransactionJob(transaction, job.id);
    });
  }

  private finishFailure(
    job: Job,
    credential: IntegrationCredential,
    leaseOwner: string,
    failure: ValidationFailure
  ): Promise<Job> {
    return this.finishFailureWithStatus(
      job,
      credential,
      leaseOwner,
      failure,
      failure.retryable && job.attempt < job.maxAttempts
        ? failure.credentialStatus === "RATE_LIMITED"
          ? "WAITING_RATE_LIMIT"
          : "RETRY_SCHEDULED"
        : failure.retryable
          ? "FAILED_RETRYABLE"
          : "FAILED_FINAL"
    );
  }

  private async finishOrRetry(
    job: Job,
    credential: IntegrationCredential,
    leaseOwner: string,
    failure: ValidationFailure
  ): Promise<ReturnType<typeof toValidationSummary>> {
    const validation = await this.finishFailure(
      job,
      credential,
      leaseOwner,
      failure
    );
    if (isScheduled(validation.status)) {
      throw new CredentialValidationRetryError(failure.errorCode);
    }
    return toValidationSummary(validation);
  }

  private finishFailureWithStatus(
    job: Job,
    credential: IntegrationCredential,
    leaseOwner: string,
    failure: ValidationFailure,
    status:
      | "RETRY_SCHEDULED"
      | "WAITING_RATE_LIMIT"
      | "FAILED_RETRYABLE"
      | "FAILED_FINAL"
  ): Promise<Job> {
    return this.prisma.$transaction(async (transaction) => {
      const failedAt = new Date();
      const credentialChanged =
        await transaction.integrationCredential.updateMany({
          where: {
            id: credential.id,
            workspaceId: job.workspaceId,
            materialVersion: credential.materialVersion,
            status: { notIn: ["DISABLED", "REVOKED"] },
            deletedAt: null
          },
          data: {
            ...(failure.credentialStatus
              ? { status: failure.credentialStatus }
              : {}),
            lastErrorAt: failedAt,
            lastErrorCode: failure.errorCode,
            ...(job.actorId ? { updatedBy: job.actorId } : {}),
            version: { increment: 1 }
          }
        });
      if (credentialChanged.count !== 1) {
        return this.finishStaleInTransaction(
          transaction,
          job,
          leaseOwner,
          failedAt
        );
      }
      return this.writeFailureJob(
        transaction,
        job,
        leaseOwner,
        failure,
        status,
        failedAt
      );
    });
  }

  private finishStale(
    job: Job,
    leaseOwner: string
  ): Promise<Job> {
    return this.prisma.$transaction((transaction) =>
      this.finishStaleInTransaction(
        transaction,
        job,
        leaseOwner,
        new Date()
      )
    );
  }

  private finishJobOnlyFailure(
    job: Job,
    leaseOwner: string,
    errorCode: string
  ): Promise<Job> {
    return this.prisma.$transaction((transaction) =>
      this.writeFailureJob(
        transaction,
        job,
        leaseOwner,
        {
          errorCode,
          retryable: false
        },
        "FAILED_FINAL",
        new Date()
      )
    );
  }

  private async finishJobOnlyRetry(
    job: Job,
    leaseOwner: string,
    errorCode: string,
    retryAfterSeconds: number
  ): Promise<ReturnType<typeof toValidationSummary>> {
    const failure: ValidationFailure = {
      errorCode,
      retryable: true,
      retryAfterSeconds
    };
    const status =
      job.attempt < job.maxAttempts
        ? "RETRY_SCHEDULED"
        : "FAILED_RETRYABLE";
    const validation = await this.prisma.$transaction(
      (transaction) =>
        this.writeFailureJob(
          transaction,
          job,
          leaseOwner,
          failure,
          status,
          new Date()
        )
    );
    if (isScheduled(validation.status)) {
      throw new CredentialValidationRetryError(errorCode);
    }
    return toValidationSummary(validation);
  }

  private async writeFailureJob(
    transaction: Prisma.TransactionClient,
    job: Job,
    leaseOwner: string,
    failure: ValidationFailure,
    status:
      | "RETRY_SCHEDULED"
      | "WAITING_RATE_LIMIT"
      | "FAILED_RETRYABLE"
      | "FAILED_FINAL",
    failedAt: Date
  ): Promise<Job> {
    const scheduled = isScheduled(status);
    const retryAt = scheduled
      ? validationRetryAt(
          failedAt,
          job.attempt,
          failure.retryAfterSeconds
        )
      : null;
    await this.updateClaimedJob(transaction, job, leaseOwner, {
      status,
      stage:
        status === "RETRY_SCHEDULED"
          ? "credential_validation_retry_scheduled"
          : status === "WAITING_RATE_LIMIT"
            ? "credential_validation_waiting_rate_limit"
            : "credential_validation_failed",
      errorSummary: validationJobJson({
        code: failure.errorCode,
        retryable: failure.retryable,
        ...(failure.credentialStatus
          ? { credentialStatus: failure.credentialStatus }
          : {}),
        ...(retryAt ? { retryAt: retryAt.toISOString() } : {})
      }),
      resultSummary: Prisma.DbNull,
      ...(scheduled ? { finishedAt: null } : { finishedAt: failedAt }),
      leaseOwner: null,
      leaseExpiresAt: null,
      retryAt,
      version: { increment: 1 }
    });
    return requiredTransactionJob(transaction, job.id);
  }

  private async finishStaleInTransaction(
    transaction: Prisma.TransactionClient,
    job: Job,
    leaseOwner: string,
    finishedAt: Date
  ): Promise<Job> {
    await this.updateClaimedJob(transaction, job, leaseOwner, {
      status: "FAILED_FINAL",
      stage: "credential_validation_stale",
      errorSummary: validationJobJson({
        code: "CREDENTIAL_CHANGED",
        retryable: false
      }),
      resultSummary: Prisma.DbNull,
      finishedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      retryAt: null,
      version: { increment: 1 }
    });
    return requiredTransactionJob(transaction, job.id);
  }

  private async finishExhausted(
    job: Job,
    now: Date
  ): Promise<Job> {
    if (
      job.status !== "QUEUED" &&
      job.status !== "RETRY_SCHEDULED" &&
      job.status !== "WAITING_RATE_LIMIT" &&
      job.status !== "RUNNING"
    ) {
      return job;
    }
    await this.prisma.job.updateMany({
      where: {
        id: job.id,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
        status: job.status,
        version: job.version,
        attempt: { gte: job.maxAttempts },
        ...(job.status === "RUNNING"
          ? {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: now } }
              ]
            }
          : {
              OR: [
                { retryAt: null },
                { retryAt: { lte: now } }
              ]
            })
      },
      data: {
        status: "FAILED_RETRYABLE",
        stage: "credential_validation_failed",
        errorSummary: validationJobJson({
          code: "VALIDATION_ATTEMPTS_EXHAUSTED",
          retryable: true
        }),
        resultSummary: Prisma.DbNull,
        finishedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        retryAt: null,
        version: { increment: 1 }
      }
    });
    return this.requiredJob(job.id);
  }

  private async updateClaimedJob(
    transaction: Prisma.TransactionClient,
    job: Job,
    leaseOwner: string,
    data: Prisma.JobUpdateManyMutationInput
  ): Promise<void> {
    const changed = await transaction.job.updateMany({
      where: {
        id: job.id,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
        status: "RUNNING",
        leaseOwner,
        version: job.version
      },
      data
    });
    if (changed.count !== 1) {
      throw new CredentialValidationLeaseLostError();
    }
  }

  private requiredJob(validationId: string): Promise<Job> {
    return requiredTransactionJob(this.prisma, validationId);
  }
}

class CredentialValidationRetryError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "CredentialValidationRetryError";
  }
}

class CredentialValidationLeaseLostError extends Error {
  public constructor() {
    super("CREDENTIAL_VALIDATION_LEASE_LOST");
    this.name = "CredentialValidationLeaseLostError";
  }
}

function isClaimable(job: Job, now: Date): boolean {
  if (
    job.status === "QUEUED" ||
    isScheduled(job.status)
  ) {
    return !job.retryAt || job.retryAt <= now;
  }
  return (
    job.status === "RUNNING" &&
    (!job.leaseExpiresAt || job.leaseExpiresAt <= now)
  );
}

function isScheduled(
  status: Job["status"]
): status is (typeof SCHEDULED_STATUSES)[number] {
  return (SCHEDULED_STATUSES as readonly string[]).includes(status);
}

function boundedPendingLimit(limit: number): number {
  if (!Number.isSafeInteger(limit)) return 100;
  return Math.min(Math.max(limit, 1), 500);
}

function validationRetryAt(
  failedAt: Date,
  attempt: number,
  providerRetryAfterSeconds: number | undefined
): Date {
  const exponentialSeconds = Math.min(
    5 * 2 ** Math.max(attempt - 1, 0),
    300
  );
  const providerSeconds =
    typeof providerRetryAfterSeconds === "number" &&
    Number.isSafeInteger(providerRetryAfterSeconds) &&
    providerRetryAfterSeconds >= 0
      ? Math.min(providerRetryAfterSeconds, 3_600)
      : 0;
  return new Date(
    failedAt.getTime() +
      Math.max(exponentialSeconds, providerSeconds) * 1_000
  );
}

function isTerminal(status: Job["status"]): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function providerValue(value: string): IntegrationProvider {
  if (!["XMLSTOCK", "ARSENKIN", "KEYS_SO"].includes(value)) {
    throw new Error("Unsupported credential validation provider");
  }
  return value as IntegrationProvider;
}

function encryptedCredential(
  credential: IntegrationCredential
): Parameters<IntegrationCredentialCryptoService["decrypt"]>[3] {
  return {
    ciphertext: Buffer.from(credential.ciphertext),
    nonce: Buffer.from(credential.nonce),
    authTag: Buffer.from(credential.authTag),
    encryptedDataKey: Buffer.from(credential.encryptedDataKey),
    dataKeyNonce: Buffer.from(credential.dataKeyNonce),
    dataKeyAuthTag: Buffer.from(credential.dataKeyAuthTag),
    keyVersion: credential.keyVersion
  };
}

function mergedProviderMeta(
  current: Prisma.JsonValue | null,
  received: Readonly<Record<string, unknown>>
): Prisma.InputJsonValue {
  return validationJobJson({
    ...jsonRecord(current),
    ...received
  });
}

function jsonRecord(
  value: Prisma.JsonValue | null
): Readonly<Record<string, unknown>> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

async function requiredTransactionJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  validationId: string
): Promise<Job> {
  const job = await transaction.job.findUnique({
    where: { id: validationId }
  });
  if (!job) throw validationNotFound();
  return job;
}

function assertLeaseOwner(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,100}$/u.test(value)) {
    throw new Error("Invalid credential validation lease owner");
  }
}

function validationNotFound(): NotFoundException {
  return new NotFoundException("Credential validation not found");
}

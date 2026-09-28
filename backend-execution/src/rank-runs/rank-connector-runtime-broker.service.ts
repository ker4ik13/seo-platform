import { timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";
import {
  rankProviderRequestIntent,
  rankProviderRequestIntentHash,
  type RankProviderRequestIntentV1
} from "./rank-provider-request-intent.js";
import type {
  ArsenkinRankSubmitResult,
  ArsenkinStagedRankResultV1,
  ArsenkinRankWireRequest
} from "./arsenkin-rank.connector.js";
import {
  xmlStockRankPageProgress,
  xmlStockRankPageProgressHash,
  type XmlStockRankPageProgress,
  type XmlStockRankSubmitResult,
  type XmlStockRankWireRequest,
  type XmlStockStagedRankResultV1
} from "./xmlstock-rank.connector.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,63}$/u;
const STATUS_VALUES = new Set([
  "POLL_WAIT",
  "SUBMIT_OUTCOME_UNKNOWN",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "STAGED"
]);

export interface RankConnectorClaim {
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly executionId: string;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly credentialMaterialVersion: number;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly leaseGeneration: number;
  readonly executionVersion: number;
  readonly encryptedCredential: EncryptedIntegrationCredential;
}

export interface RankConnectorSubmitClaim extends RankConnectorClaim {}

export interface RankConnectorPollClaim extends RankConnectorClaim {
  readonly providerTaskId: string;
  readonly request: RankProviderRequestIntentV1;
  readonly providerProgress?: XmlStockRankPageProgress;
  readonly providerProgressInvalid?: true;
}

export interface RankConnectorSubmitPermit {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly executionVersion: number;
  readonly submitBytesStartedAt: string;
}

export interface RankConnectorBillingSettlement {
  readonly grantId: string;
  readonly required: boolean;
}

export interface RankConnectorCompletion {
  readonly executionId: string;
  readonly status: string;
  readonly executionVersion: number;
  readonly nextActionAt?: string;
}

@Injectable()
export class RankConnectorRuntimeBrokerService {
  public constructor(private readonly prisma: PrismaService) {}

  public async claimSubmit(
    leaseOwner: string,
    leaseSeconds: number,
    connectorVersion: string
  ): Promise<RankConnectorSubmitClaim | undefined> {
    validateClaimInput(leaseOwner, leaseSeconds, connectorVersion);
    const rows = await this.prisma.$queryRaw<readonly SubmitClaimRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.claim_rank_connector_submit_bounded(
          ${leaseOwner}::text,
          ${leaseSeconds}::integer,
          ${connectorVersion}::text
        )
      `
    );
    if (rows.length === 0) return undefined;
    if (rows.length !== 1 || !rows[0]) invalid("submit claim cardinality");
    return claim(rows[0], leaseOwner);
  }

  public async readSubmitRequest(
    claimValue: RankConnectorSubmitClaim
  ): Promise<RankProviderRequestIntentV1> {
    const rows = await this.prisma.$queryRaw<
      readonly SubmitRequestRow[]
    >(
      Prisma.sql`
        SELECT *
        FROM public.read_rank_connector_submit_request(
          ${claimValue.workspaceId}::uuid,
          ${claimValue.executionId}::uuid,
          ${claimValue.leaseOwner}::text,
          ${claimValue.leaseToken}::uuid,
          ${claimValue.leaseGeneration}::integer,
          ${claimValue.executionVersion}::integer
        )
      `
    );
    if (rows.length !== 1 || !rows[0]) {
      throw new RankConnectorLeaseLostError();
    }
    const row = rows[0];
    if (
      uuid(row.executionId, "request execution id") !==
        claimValue.executionId ||
      uuid(row.workspaceId, "request workspace id") !==
        claimValue.workspaceId
    ) {
      invalid("submit request scope");
    }
    const request = rankProviderRequestIntent(row.requestSnapshot);
    const actual = Buffer.from(
      rankProviderRequestIntentHash(request).value,
      "hex"
    );
    const expected = buffer(row.requestHash, "request hash", 32);
    if (!timingSafeEqual(actual, expected)) invalid("request hash");
    return request;
  }

  public async readBillingSettlement(
    claimValue: RankConnectorClaim
  ): Promise<RankConnectorBillingSettlement> {
    const rows = await this.prisma.$queryRaw<
      readonly BillingSettlementRow[]
    >(
      Prisma.sql`
        SELECT *
        FROM public.read_rank_connector_billing_settlement(
          ${claimValue.workspaceId}::uuid,
          ${claimValue.executionId}::uuid,
          ${claimValue.leaseOwner}::text,
          ${claimValue.leaseToken}::uuid,
          ${claimValue.leaseGeneration}::integer,
          ${claimValue.executionVersion}::integer
        )
      `
    );
    if (rows.length !== 1 || !rows[0]) {
      throw new RankConnectorLeaseLostError();
    }
    const row = rows[0];
    if (
      row.credentialMode !== "BYOK_API_KEY" &&
      row.credentialMode !== "PLATFORM_PAID"
    ) {
      invalid("billing credential mode");
    }
    return {
      grantId: uuid(row.grantId, "billing grant id"),
      required: row.credentialMode === "PLATFORM_PAID"
    };
  }

  public async authorizeSubmit(
    claimValue: RankConnectorSubmitClaim,
    connectorVersion: string
  ): Promise<RankConnectorSubmitPermit> {
    version(connectorVersion);
    const rows = await this.prisma.$queryRaw<
      readonly SubmitPermitRow[]
    >(
      Prisma.sql`
        SELECT *
        FROM public.authorize_rank_connector_execution_submit(
          ${claimValue.workspaceId}::uuid,
          ${claimValue.executionId}::uuid,
          ${claimValue.leaseOwner}::text,
          ${claimValue.leaseToken}::uuid,
          ${claimValue.leaseGeneration}::integer,
          ${claimValue.executionVersion}::integer,
          ${connectorVersion}::text
        )
      `
    );
    if (rows.length !== 1 || !rows[0]) {
      throw new RankConnectorLeaseLostError();
    }
    const row = rows[0];
    return {
      executionId: exactUuid(
        row.executionId,
        claimValue.executionId,
        "permit execution id"
      ),
      workspaceId: exactUuid(
        row.workspaceId,
        claimValue.workspaceId,
        "permit workspace id"
      ),
      executionVersion: positiveInteger(
        row.executionVersion,
        "permit version"
      ),
      submitBytesStartedAt: timestamp(
        row.submitBytesStartedAt,
        "submit marker"
      )
    };
  }

  public completeSubmit(
    claimValue: RankConnectorSubmitClaim,
    permit: RankConnectorSubmitPermit,
    outcome: ArsenkinRankSubmitResult | XmlStockRankSubmitResult,
    wireRequest: ArsenkinRankWireRequest | XmlStockRankWireRequest,
    wireRequestHash: Buffer
  ): Promise<RankConnectorCompletion> {
    const mapped = submitOutcome(outcome);
    return this.complete(
      Prisma.sql`
        SELECT *
        FROM public.complete_rank_connector_submit(
          ${claimValue.workspaceId}::uuid,
          ${claimValue.executionId}::uuid,
          ${claimValue.leaseOwner}::text,
          ${claimValue.leaseToken}::uuid,
          ${claimValue.leaseGeneration}::integer,
          ${permit.executionVersion}::integer,
          ${mapped.outcome}::text,
          ${mapped.providerTaskId ?? null}::text,
          ${JSON.stringify(wireRequest)}::jsonb,
          ${fixedHash(wireRequestHash)}::bytea,
          ${mapped.errorCode ?? null}::text
        )
      `
    );
  }

  public async claimPoll(
    leaseOwner: string,
    leaseSeconds: number,
    connectorVersion: string
  ): Promise<RankConnectorPollClaim | undefined> {
    validateClaimInput(leaseOwner, leaseSeconds, connectorVersion);
    const rows = await this.prisma.$queryRaw<readonly PollClaimRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.claim_rank_connector_poll(
          ${leaseOwner}::text,
          ${leaseSeconds}::integer,
          ${connectorVersion}::text
        )
      `
    );
    if (rows.length === 0) return undefined;
    if (rows.length !== 1 || !rows[0]) invalid("poll claim cardinality");
    const row = rows[0];
    const provider = rankProvider(row.provider);
    let providerProgress: XmlStockRankPageProgress | undefined;
    let providerProgressInvalid = false;
    try {
      providerProgress = storedProviderProgress(
        provider,
        row.providerProgressSnapshot,
        row.providerProgressHash
      );
    } catch (error) {
      if (provider !== "XMLSTOCK" || !(error instanceof TypeError)) {
        throw error;
      }
      providerProgressInvalid = true;
    }
    return {
      ...claim(row, leaseOwner),
      providerTaskId: taskId(row.providerTaskId),
      request: rankProviderRequestIntent(row.requestSnapshot),
      ...(providerProgress ? { providerProgress } : {}),
      ...(providerProgressInvalid ? { providerProgressInvalid: true } : {})
    };
  }

  public deferPollForProviderCapacity(
    claimValue: RankConnectorPollClaim,
    retryAfterSeconds: number
  ): Promise<RankConnectorCompletion> {
    const retryAfter = boundedRetryAfter(retryAfterSeconds);
    if (retryAfter === undefined || retryAfter < 1) {
      throw new TypeError("Invalid rank connector capacity retry delay");
    }
    return this.complete(
      Prisma.sql`
        SELECT *
        FROM public.defer_rank_connector_poll_capacity(
          ${claimValue.workspaceId}::uuid,
          ${claimValue.executionId}::uuid,
          ${claimValue.leaseOwner}::text,
          ${claimValue.leaseToken}::uuid,
          ${claimValue.leaseGeneration}::integer,
          ${claimValue.executionVersion}::integer,
          ${retryAfter}::integer
        )
      `
    );
  }

  public completePoll(
    claimValue: RankConnectorPollClaim,
    input:
      | { readonly outcome: "PENDING" }
      | {
          readonly outcome: "CHECKPOINTED";
          readonly progress: XmlStockRankPageProgress;
          readonly hash: Buffer;
        }
      | {
          readonly outcome: "RETRYABLE_FAILURE";
          readonly errorCode: string;
          readonly retryAfterSeconds?: number;
        }
      | {
          readonly outcome: "REJECTED";
          readonly errorCode: string;
        }
      | {
          readonly outcome: "READY";
          readonly observedAt: string;
          readonly snapshot:
            | ArsenkinStagedRankResultV1
            | XmlStockStagedRankResultV1;
          readonly hash: Buffer;
        }
  ): Promise<RankConnectorCompletion> {
    const retryAfterSeconds =
      "retryAfterSeconds" in input
        ? boundedRetryAfter(input.retryAfterSeconds)
        : undefined;
    const errorCode = "errorCode" in input ? input.errorCode : undefined;
    if (errorCode !== undefined && !/^[A-Z0-9_]{1,100}$/u.test(errorCode)) {
      throw new TypeError("Invalid rank connector error code");
    }
    return this.complete(
      Prisma.sql`
        SELECT *
        FROM public.complete_rank_connector_poll(
          ${claimValue.workspaceId}::uuid,
          ${claimValue.executionId}::uuid,
          ${claimValue.leaseOwner}::text,
          ${claimValue.leaseToken}::uuid,
          ${claimValue.leaseGeneration}::integer,
          ${claimValue.executionVersion}::integer,
          ${input.outcome}::text,
          ${retryAfterSeconds ?? null}::integer,
          ${input.outcome === "READY" ? new Date(input.observedAt) : null}::timestamptz,
          ${
            input.outcome === "READY"
              ? JSON.stringify(input.snapshot)
              : null
          }::jsonb,
          ${
            input.outcome === "READY" ? fixedHash(input.hash) : null
          }::bytea,
          ${errorCode ?? null}::text,
          ${
            input.outcome === "CHECKPOINTED"
              ? JSON.stringify(input.progress)
              : null
          }::jsonb,
          ${
            input.outcome === "CHECKPOINTED"
              ? fixedHash(input.hash)
              : null
          }::bytea
        )
      `
    );
  }

  private async complete(query: Prisma.Sql): Promise<RankConnectorCompletion> {
    const rows = await this.prisma.$queryRaw<
      readonly CompletionRow[]
    >(query);
    if (rows.length !== 1 || !rows[0]) {
      throw new RankConnectorLeaseLostError();
    }
    const row = rows[0];
    if (!STATUS_VALUES.has(row.status)) invalid("completion status");
    return {
      executionId: uuid(row.executionId, "completion execution id"),
      status: row.status,
      executionVersion: positiveInteger(
        row.executionVersion,
        "completion version"
      ),
      ...(row.nextActionAt
        ? {
            nextActionAt: timestamp(
              row.nextActionAt,
              "next action"
            )
          }
        : {})
    };
  }
}

export class RankConnectorLeaseLostError extends Error {
  public constructor() {
    super("RANK_CONNECTOR_LEASE_LOST");
    this.name = "RankConnectorLeaseLostError";
  }
}

interface EncryptedCredentialRow {
  readonly provider: string;
  readonly executionId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly credentialMaterialVersion: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
  readonly encryptedDataKey: Uint8Array;
  readonly dataKeyNonce: Uint8Array;
  readonly dataKeyAuthTag: Uint8Array;
  readonly keyVersion: number;
  readonly leaseGeneration: number;
  readonly executionVersion: number;
}

interface SubmitClaimRow extends EncryptedCredentialRow {}

interface PollClaimRow extends EncryptedCredentialRow {
  readonly provider: string;
  readonly providerTaskId: string;
  readonly requestSnapshot: unknown;
  readonly providerProgressSnapshot: unknown | null;
  readonly providerProgressHash: Uint8Array | null;
}

function storedProviderProgress(
  provider: "ARSENKIN" | "XMLSTOCK",
  snapshot: unknown | null,
  hashValue: Uint8Array | null
): XmlStockRankPageProgress | undefined {
  if (snapshot === null && hashValue === null) return undefined;
  if (provider !== "XMLSTOCK" || snapshot === null || hashValue === null) {
    invalid("provider progress");
  }
  const progress = xmlStockRankPageProgress(snapshot);
  const actual = Buffer.from(xmlStockRankPageProgressHash(progress).value, "hex");
  const expected = buffer(hashValue, "provider progress hash", 32);
  if (!timingSafeEqual(actual, expected)) invalid("provider progress hash");
  return progress;
}

interface SubmitRequestRow {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly requestSnapshot: unknown;
  readonly requestHash: Uint8Array;
}

interface BillingSettlementRow {
  readonly grantId: string;
  readonly credentialMode: string;
}

interface SubmitPermitRow {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly executionVersion: number;
  readonly submitBytesStartedAt: Date;
}

interface CompletionRow {
  readonly executionId: string;
  readonly status: string;
  readonly executionVersion: number;
  readonly nextActionAt: Date | null;
}

function claim(
  row: EncryptedCredentialRow,
  leaseOwner: string
): RankConnectorClaim {
  return {
    provider: rankProvider(row.provider),
    executionId: uuid(row.executionId, "execution id"),
    workspaceId: uuid(row.workspaceId, "workspace id"),
    credentialId: uuid(row.credentialId, "credential id"),
    credentialMaterialVersion: positiveInteger(
      row.credentialMaterialVersion,
      "credential material version"
    ),
    leaseOwner,
    leaseToken: uuid(row.leaseToken, "lease token"),
    leaseExpiresAt: timestamp(row.leaseExpiresAt, "lease expiry"),
    leaseGeneration: positiveInteger(
      row.leaseGeneration,
      "lease generation"
    ),
    executionVersion: positiveInteger(
      row.executionVersion,
      "execution version"
    ),
    encryptedCredential: {
      ciphertext: buffer(row.ciphertext, "ciphertext"),
      nonce: buffer(row.nonce, "nonce", 12),
      authTag: buffer(row.authTag, "auth tag", 16),
      encryptedDataKey: buffer(
        row.encryptedDataKey,
        "encrypted data key"
      ),
      dataKeyNonce: buffer(row.dataKeyNonce, "data key nonce", 12),
      dataKeyAuthTag: buffer(
        row.dataKeyAuthTag,
        "data key auth tag",
        16
      ),
      keyVersion: positiveInteger(row.keyVersion, "key version")
    }
  };
}

function submitOutcome(
  value: ArsenkinRankSubmitResult | XmlStockRankSubmitResult
): {
  readonly outcome:
    | "ACCEPTED"
    | "OUTCOME_UNKNOWN"
    | "RETRYABLE_FAILURE"
    | "REJECTED";
  readonly providerTaskId?: string;
  readonly errorCode?: string;
} {
  switch (value.status) {
    case "ACCEPTED":
      return { outcome: "ACCEPTED", providerTaskId: taskId(value.taskId) };
    case "OUTCOME_UNKNOWN":
      return { outcome: "OUTCOME_UNKNOWN", errorCode: value.code };
    case "RETRYABLE_FAILURE":
      return { outcome: "RETRYABLE_FAILURE", errorCode: value.code };
    case "REJECTED":
      return { outcome: "REJECTED", errorCode: value.code };
  }
}

function validateClaimInput(
  leaseOwner: string,
  leaseSeconds: number,
  connectorVersion: string
): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/u.test(leaseOwner) ||
    !Number.isSafeInteger(leaseSeconds) ||
    leaseSeconds < 5 ||
    leaseSeconds > 120
  ) {
    throw new TypeError("Invalid rank connector claim");
  }
  version(connectorVersion);
}

function rankProvider(value: string): "ARSENKIN" | "XMLSTOCK" {
  if (value !== "ARSENKIN" && value !== "XMLSTOCK") {
    invalid("provider");
  }
  return value;
}

function boundedRetryAfter(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Invalid rank connector retry delay");
  }
  return Math.min(value, 3_600);
}

function fixedHash(value: Uint8Array): Buffer {
  return buffer(value, "hash", 32);
}

function exactUuid(value: string, expected: string, field: string): string {
  const parsed = uuid(value, field);
  if (parsed !== expected) invalid(field);
  return parsed;
}

function uuid(value: string, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(field);
  return value.toLowerCase();
}

function taskId(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/u.test(value)
  ) {
    invalid("provider task id");
  }
  return value;
}

function version(value: string): string {
  if (!VERSION_PATTERN.test(value)) invalid("connector version");
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) invalid(field);
  return value;
}

function timestamp(value: Date, field: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid(field);
  return value.toISOString();
}

function buffer(
  value: Uint8Array,
  field: string,
  length?: number
): Buffer {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    (length !== undefined && value.byteLength !== length)
  ) {
    invalid(field);
  }
  return Buffer.from(value);
}

function invalid(field: string): never {
  throw new Error(`Invalid rank connector broker ${field}`);
}

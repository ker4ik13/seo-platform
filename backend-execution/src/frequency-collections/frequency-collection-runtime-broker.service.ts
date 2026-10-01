import { Injectable } from "@nestjs/common";
import type {
  FrequencyCollectionProvider,
  FrequencyCollectionMode,
  FrequencySeasonalityRequest,
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import {
  arsenkinWordstatKeywordLimit,
  parseFrequencySeasonalityRequest,
  semanticFrequencyTypes
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";

export interface FrequencyCollectionClaimItem {
  readonly jobItemId: string;
  readonly providerRequestId?: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly attempt: number;
}

export interface FrequencyCollectionClaim {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly provider: FrequencyCollectionProvider;
  readonly maxAttempts: number;
  readonly items: readonly FrequencyCollectionClaimItem[];
  readonly mode: FrequencyCollectionMode;
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly seasonality?: FrequencySeasonalityRequest;
  readonly jobVersion: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly encryptedCredential: EncryptedIntegrationCredential;
}

@Injectable()
export class FrequencyCollectionRuntimeBrokerService {
  public constructor(private readonly prisma: PrismaService) {}

  public async claim(
    leaseOwner: string,
    leaseSeconds: number,
    maxBatchItems = arsenkinWordstatKeywordLimit
  ): Promise<FrequencyCollectionClaim | undefined> {
    if (
      !/^[A-Za-z0-9._:-]{8,100}$/u.test(leaseOwner) ||
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 5 ||
      leaseSeconds > 120 ||
      !Number.isSafeInteger(maxBatchItems) ||
      maxBatchItems < 1 ||
      maxBatchItems > arsenkinWordstatKeywordLimit
    ) invalid();
    const rows = await this.prisma.$queryRaw<readonly ClaimRow[]>(Prisma.sql`
      SELECT * FROM public.claim_frequency_collection_batch(
        ${leaseOwner}::text,
        ${leaseSeconds}::integer,
        ${maxBatchItems}::integer
      )
    `);
    if (rows.length === 0) return undefined;
    if (rows.length > maxBatchItems || !rows[0]) invalid();
    const row = rows[0];
    const types = frequencyTypes(row.inputSnapshot);
    const mode = frequencyMode(row.inputSnapshot);
    const seasonalityRequest = seasonality(row.inputSnapshot);
    const collectionProvider = provider(row.provider);
    const result: FrequencyCollectionClaim = {
      jobId: uuid(row.jobId),
      workspaceId: uuid(row.workspaceId),
      projectId: uuid(row.projectId),
      actorId: uuid(row.actorId),
      credentialId: uuid(row.credentialId),
      provider: collectionProvider,
      maxAttempts: positive(row.maxAttempts),
      items: rows.map((item) => ({
        jobItemId: uuid(item.jobItemId),
        ...(item.providerRequestId === null
          ? {}
          : { providerRequestId: providerRequestId(item.providerRequestId) }),
        keywordId: uuid(item.keywordId),
        keywordVersion: positive(item.keywordVersion),
        attempt: positive(item.attempt)
      })),
      mode,
      types,
      regionCode: region(row.inputSnapshot),
      device: device(row.inputSnapshot),
      ...(seasonalityRequest ? { seasonality: seasonalityRequest } : {}),
      jobVersion: positive(row.jobVersion),
      leaseOwner,
      leaseExpiresAt: timestamp(row.leaseExpiresAt),
      encryptedCredential: {
        ciphertext: buffer(row.ciphertext),
        nonce: buffer(row.nonce),
        authTag: buffer(row.authTag),
        encryptedDataKey: buffer(row.encryptedDataKey),
        dataKeyNonce: buffer(row.dataKeyNonce),
        dataKeyAuthTag: buffer(row.dataKeyAuthTag),
        keyVersion: positive(row.keyVersion)
      }
    };
    validateBatchRows(rows, result);
    return result;
  }

  public async complete(
    claim: FrequencyCollectionClaim,
    snapshotCount: number
  ): Promise<void> {
    if (
      !Number.isSafeInteger(snapshotCount) ||
      snapshotCount < 1 ||
      snapshotCount > semanticFrequencyTypes.length
    ) invalid();
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.complete_frequency_collection_batch(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${snapshotCount}::integer
      )
    `);
    requiredCompletion(rows);
  }

  public async defer(
    claim: FrequencyCollectionClaim,
    providerRequestIdValue: string,
    retryAfterSeconds: number
  ): Promise<void> {
    const requestId = providerRequestId(providerRequestIdValue);
    if (
      !Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > 3_600
    ) invalid();
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.defer_frequency_collection_batch(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${requestId}::text,
        ${retryAfterSeconds}::integer
      )
    `);
    requiredCompletion(rows);
  }

  public async fail(
    claim: FrequencyCollectionClaim,
    input: {
      readonly code: string;
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number;
    }
  ): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.code)) invalid();
    const retryAfter = input.retryable
      ? Math.min(Math.max(input.retryAfterSeconds ?? 30, 5), 3_600)
      : undefined;
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.fail_frequency_collection_batch(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${input.code}::text,
        ${retryAfter ?? null}::integer
      )
    `);
    requiredCompletion(rows);
  }

  public async markSubmitting(
    claim: FrequencyCollectionClaim,
    marker: string,
    leaseSeconds: number
  ): Promise<FrequencyCollectionClaim | undefined> {
    if (
      !SUBMIT_MARKER_PATTERN.test(marker) ||
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 5 ||
      leaseSeconds > 120
    ) invalid();
    const rows = await this.prisma.$queryRaw<readonly LeaseRow[]>(Prisma.sql`
      SELECT * FROM public.mark_frequency_collection_batch_submitting(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${marker}::text,
        ${leaseSeconds}::integer
      )
    `);
    if (rows.length === 0) return undefined;
    const leaseExpiresAt = requiredLease(rows, claim);
    return {
      ...claim,
      leaseExpiresAt,
      items: claim.items.map((item) => ({
        ...item,
        providerRequestId: marker
      }))
    };
  }

  public async renew(
    claim: FrequencyCollectionClaim,
    leaseSeconds: number
  ): Promise<FrequencyCollectionClaim> {
    if (
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 5 ||
      leaseSeconds > 120
    ) invalid();
    const rows = await this.prisma.$queryRaw<readonly LeaseRow[]>(Prisma.sql`
      SELECT * FROM public.renew_frequency_collection_batch_lease(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${leaseSeconds}::integer
      )
    `);
    return {
      ...claim,
      leaseExpiresAt: requiredLease(rows, claim)
    };
  }

  public async quarantineAmbiguousSubmit(
    claim: FrequencyCollectionClaim
  ): Promise<void> {
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.quarantine_frequency_collection_batch_submit(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer
      )
    `);
    requiredCompletion(rows);
  }

  public async releaseForProviderCapacity(
    claim: FrequencyCollectionClaim,
    retryAfterSeconds: number
  ): Promise<void> {
    if (
      !Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > 3_600
    ) invalid();
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.defer_frequency_collection_batch_capacity(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${retryAfterSeconds}::integer
      )
    `);
    requiredCompletion(rows);
  }
}

function jobItemIds(claim: FrequencyCollectionClaim): Prisma.Sql {
  if (
    claim.items.length < 1 ||
    claim.items.length > arsenkinWordstatKeywordLimit
  ) invalid();
  return Prisma.sql`ARRAY[${Prisma.join(
    claim.items.map((item) => Prisma.sql`${item.jobItemId}::uuid`)
  )}]`;
}

interface ClaimRow {
  readonly jobId: string;
  readonly jobItemId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly provider: string;
  readonly providerRequestId: string | null;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly inputSnapshot: unknown;
  readonly jobVersion: number;
  readonly leaseExpiresAt: Date | string;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
  readonly encryptedDataKey: Uint8Array;
  readonly dataKeyNonce: Uint8Array;
  readonly dataKeyAuthTag: Uint8Array;
  readonly keyVersion: number;
}

interface CompletionRow {
  readonly jobId: string;
  readonly jobVersion: number;
}

interface LeaseRow extends CompletionRow {
  readonly leaseExpiresAt: Date | string;
}

function frequencyTypes(value: unknown): readonly SemanticFrequencyType[] {
  const types = record(value)?.types;
  if (!Array.isArray(types) || types.length < 1 || types.length > 3) invalid();
  const result = types.map((type) => {
    if (type !== "BASE" && type !== "EXACT" && type !== "FIXED") invalid();
    return type;
  });
  if (new Set(result).size !== result.length) invalid();
  return result;
}

function frequencyMode(value: unknown): FrequencyCollectionMode {
  const mode = record(value)?.mode;
  if (mode === undefined || mode === "FREQUENCY") return "FREQUENCY";
  if (mode === "SEASONALITY") return mode;
  invalid();
}

function seasonality(
  value: unknown
): FrequencySeasonalityRequest | undefined {
  const input = record(value);
  const mode = frequencyMode(value);
  if (mode === "FREQUENCY") {
    if (input?.seasonality !== undefined) invalid();
    return undefined;
  }
  try {
    return parseFrequencySeasonalityRequest(input?.seasonality);
  } catch {
    invalid();
  }
}

function region(value: unknown): string {
  const result = record(value)?.regionCode;
  if (typeof result !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/u.test(result)) invalid();
  return result;
}

function device(value: unknown): SemanticFrequencyDevice {
  const result = record(value)?.device;
  if (
    result !== "ALL" &&
    result !== "DESKTOP" &&
    result !== "MOBILE" &&
    result !== "PHONE_ONLY" &&
    result !== "TABLET_ONLY"
  ) invalid();
  return result;
}

function requiredCompletion(rows: readonly CompletionRow[]): void {
  if (
    rows.length !== 1 ||
    !rows[0] ||
    !UUID_PATTERN.test(rows[0].jobId) ||
    !Number.isSafeInteger(rows[0].jobVersion) ||
    rows[0].jobVersion < 1
  ) throw new FrequencyCollectionLeaseLostError();
}

function requiredLease(
  rows: readonly LeaseRow[],
  claim: FrequencyCollectionClaim
): string {
  if (
    rows.length !== 1 ||
    !rows[0] ||
    uuid(rows[0].jobId) !== claim.jobId ||
    positive(rows[0].jobVersion) !== claim.jobVersion
  ) {
    throw new FrequencyCollectionLeaseLostError();
  }
  const result = timestamp(rows[0].leaseExpiresAt);
  if (Date.parse(result) <= Date.now()) {
    throw new FrequencyCollectionLeaseLostError();
  }
  return result;
}

function validateBatchRows(
  rows: readonly ClaimRow[],
  claim: FrequencyCollectionClaim
): void {
  const itemIds = new Set<string>();
  const requestIds = new Set<string | null>();
  for (const row of rows) {
    if (
      uuid(row.jobId) !== claim.jobId ||
      uuid(row.workspaceId) !== claim.workspaceId ||
      uuid(row.projectId) !== claim.projectId ||
      uuid(row.actorId) !== claim.actorId ||
      uuid(row.credentialId) !== claim.credentialId ||
      provider(row.provider) !== claim.provider ||
      positive(row.maxAttempts) !== claim.maxAttempts ||
      positive(row.jobVersion) !== claim.jobVersion ||
      timestamp(row.leaseExpiresAt) !== claim.leaseExpiresAt ||
      JSON.stringify(frequencyTypes(row.inputSnapshot)) !==
        JSON.stringify(claim.types) ||
      frequencyMode(row.inputSnapshot) !== claim.mode ||
      region(row.inputSnapshot) !== claim.regionCode ||
      device(row.inputSnapshot) !== claim.device ||
      JSON.stringify(seasonality(row.inputSnapshot)) !==
        JSON.stringify(claim.seasonality)
    ) invalid();
    itemIds.add(uuid(row.jobItemId));
    requestIds.add(
      row.providerRequestId === null
        ? null
        : providerRequestId(row.providerRequestId)
    );
  }
  if (
    itemIds.size !== rows.length ||
    requestIds.size !== 1 ||
    (claim.provider === "XMLSTOCK" && rows.length !== 1)
  ) invalid();
}

export class FrequencyCollectionLeaseLostError extends Error {
  public constructor() {
    super("Frequency collection lease was lost");
    this.name = "FrequencyCollectionLeaseLostError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBMIT_MARKER_PATTERN =
  /^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid();
  return Number(value);
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) invalid();
  return date.toISOString();
}

function provider(value: unknown): FrequencyCollectionProvider {
  if (value !== "XMLSTOCK" && value !== "ARSENKIN") invalid();
  return value;
}

function providerRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/u.test(value)) {
    invalid();
  }
  return value;
}

function buffer(value: unknown): Buffer {
  const result = Buffer.from(value as Uint8Array);
  if (result.length < 1 || result.length > 65_536) invalid();
  return result;
}

function invalid(): never {
  throw new TypeError("Invalid frequency collection broker response");
}

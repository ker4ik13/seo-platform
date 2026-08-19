import { Injectable } from "@nestjs/common";
import type { AiAnswerDevice, AiAnswerSearchEngine } from "@seo-platform/contracts";
import { arsenkinAiAnswerKeywordLimit } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";

export interface AiAnswerClaimItem {
  readonly jobItemId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly attempt: number;
  readonly providerRequestId?: string;
}

export interface AiAnswerClaim {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly items: readonly AiAnswerClaimItem[];
  readonly searchEngine: AiAnswerSearchEngine;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly host: string;
  readonly excludeSubdomains: boolean;
  readonly brands: readonly string[];
  readonly maxAttempts: number;
  readonly jobVersion: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly encryptedCredential: EncryptedIntegrationCredential;
}

@Injectable()
export class AiAnswerRuntimeBrokerService {
  public constructor(private readonly prisma: PrismaService) {}

  public async claim(
    leaseOwner: string,
    leaseSeconds: number
  ): Promise<AiAnswerClaim | undefined> {
    validateLease(leaseOwner, leaseSeconds);
    const rows = await this.prisma.$queryRaw<readonly ClaimRow[]>(Prisma.sql`
      SELECT * FROM public.claim_ai_answer_collection_batch(
        ${leaseOwner}::text,
        ${leaseSeconds}::integer,
        ${arsenkinAiAnswerKeywordLimit}::integer
      )
    `);
    if (rows.length === 0) return undefined;
    if (rows.length > arsenkinAiAnswerKeywordLimit || !rows[0]) invalid();
    const row = rows[0];
    const input = parseInput(row.inputSnapshot);
    const result: AiAnswerClaim = {
      jobId: uuid(row.jobId),
      workspaceId: uuid(row.workspaceId),
      projectId: uuid(row.projectId),
      actorId: uuid(row.actorId),
      credentialId: uuid(row.credentialId),
      items: rows.map((item) => ({
        jobItemId: uuid(item.jobItemId),
        keywordId: uuid(item.keywordId),
        keywordVersion: positive(item.keywordVersion),
        attempt: positive(item.attempt),
        ...(item.providerRequestId === null
          ? {}
          : { providerRequestId: providerRequestId(item.providerRequestId) })
      })),
      ...input,
      maxAttempts: positive(row.maxAttempts),
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

  public async renew(claim: AiAnswerClaim, leaseSeconds: number): Promise<AiAnswerClaim> {
    validateLease(claim.leaseOwner, leaseSeconds);
    const rows = await this.prisma.$queryRaw<readonly LeaseRow[]>(Prisma.sql`
      SELECT * FROM public.renew_ai_answer_collection_batch_lease(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${leaseSeconds}::integer
      )
    `);
    return { ...claim, leaseExpiresAt: requiredLease(rows, claim) };
  }

  public async markSubmitting(
    claim: AiAnswerClaim,
    marker: string,
    leaseSeconds: number
  ): Promise<AiAnswerClaim | undefined> {
    if (!SUBMIT_MARKER_PATTERN.test(marker)) invalid();
    validateLease(claim.leaseOwner, leaseSeconds);
    const rows = await this.prisma.$queryRaw<readonly LeaseRow[]>(Prisma.sql`
      SELECT * FROM public.mark_ai_answer_collection_batch_submitting(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${marker}::text,
        ${leaseSeconds}::integer
      )
    `);
    if (rows.length === 0) return undefined;
    return {
      ...claim,
      leaseExpiresAt: requiredLease(rows, claim),
      items: claim.items.map((item) => ({ ...item, providerRequestId: marker }))
    };
  }

  public async defer(
    claim: AiAnswerClaim,
    taskId: string,
    retryAfterSeconds: number
  ): Promise<void> {
    const requestId = providerRequestId(taskId);
    validateRetry(retryAfterSeconds);
    requiredCompletion(await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.defer_ai_answer_collection_batch(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${requestId}::text,
        ${retryAfterSeconds}::integer
      )
    `));
  }

  public async releaseForCapacity(
    claim: AiAnswerClaim,
    retryAfterSeconds: number
  ): Promise<void> {
    validateRetry(retryAfterSeconds);
    requiredCompletion(await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.defer_ai_answer_collection_batch_capacity(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${retryAfterSeconds}::integer
      )
    `));
  }

  public async fail(
    claim: AiAnswerClaim,
    input: { readonly code: string; readonly retryable: boolean; readonly retryAfterSeconds?: number }
  ): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.code)) invalid();
    const retryAfter = input.retryable
      ? Math.min(Math.max(input.retryAfterSeconds ?? 30, 5), 3_600)
      : undefined;
    requiredCompletion(await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.fail_ai_answer_collection_batch(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${input.code}::text,
        ${retryAfter ?? null}::integer
      )
    `));
  }

  public async quarantineAmbiguousSubmit(claim: AiAnswerClaim): Promise<void> {
    requiredCompletion(await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.quarantine_ai_answer_collection_batch_submit(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer
      )
    `));
  }

  public async complete(claim: AiAnswerClaim): Promise<void> {
    requiredCompletion(await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.complete_ai_answer_collection_batch(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer
      )
    `));
  }
}

function jobItemIds(claim: AiAnswerClaim): Prisma.Sql {
  if (claim.items.length < 1 || claim.items.length > arsenkinAiAnswerKeywordLimit) invalid();
  return Prisma.sql`ARRAY[${Prisma.join(
    claim.items.map((item) => Prisma.sql`${item.jobItemId}::uuid`)
  )}]`;
}

function parseInput(value: unknown): Pick<
  AiAnswerClaim,
  "searchEngine" | "regionCode" | "device" | "host" | "excludeSubdomains" | "brands"
> {
  const input = object(value);
  if (
    (input.searchEngine !== "YANDEX" && input.searchEngine !== "GOOGLE") ||
    typeof input.regionCode !== "string" ||
    !/^(?:0|[1-9]\d{0,9})$/u.test(input.regionCode) ||
    (input.device !== "DESKTOP" && input.device !== "MOBILE") ||
    typeof input.host !== "string" ||
    typeof input.excludeSubdomains !== "boolean" ||
    !Array.isArray(input.brands) ||
    input.brands.some((brand) => typeof brand !== "string")
  ) invalid();
  return {
    searchEngine: input.searchEngine,
    regionCode: input.regionCode,
    device: input.device,
    host: input.host,
    excludeSubdomains: input.excludeSubdomains,
    brands: input.brands as string[]
  };
}

function validateBatchRows(rows: readonly ClaimRow[], claim: AiAnswerClaim): void {
  const itemIds = new Set<string>();
  const requestIds = new Set<string | null>();
  for (const row of rows) {
    if (
      uuid(row.jobId) !== claim.jobId ||
      uuid(row.workspaceId) !== claim.workspaceId ||
      uuid(row.projectId) !== claim.projectId ||
      uuid(row.actorId) !== claim.actorId ||
      uuid(row.credentialId) !== claim.credentialId ||
      positive(row.maxAttempts) !== claim.maxAttempts ||
      positive(row.jobVersion) !== claim.jobVersion ||
      timestamp(row.leaseExpiresAt) !== claim.leaseExpiresAt ||
      JSON.stringify(parseInput(row.inputSnapshot)) !== JSON.stringify(parseInput(rows[0]?.inputSnapshot))
    ) invalid();
    itemIds.add(uuid(row.jobItemId));
    requestIds.add(row.providerRequestId === null ? null : providerRequestId(row.providerRequestId));
  }
  if (itemIds.size !== rows.length || requestIds.size !== 1) invalid();
}

function requiredCompletion(rows: readonly CompletionRow[]): void {
  if (
    rows.length !== 1 ||
    !rows[0] ||
    !UUID_PATTERN.test(rows[0].jobId) ||
    !Number.isSafeInteger(rows[0].jobVersion) ||
    rows[0].jobVersion < 1
  ) throw new AiAnswerLeaseLostError();
}

function requiredLease(rows: readonly LeaseRow[], claim: AiAnswerClaim): string {
  if (
    rows.length !== 1 ||
    !rows[0] ||
    uuid(rows[0].jobId) !== claim.jobId ||
    positive(rows[0].jobVersion) !== claim.jobVersion
  ) throw new AiAnswerLeaseLostError();
  const value = timestamp(rows[0].leaseExpiresAt);
  if (Date.parse(value) <= Date.now()) throw new AiAnswerLeaseLostError();
  return value;
}

function validateLease(owner: string, seconds: number): void {
  if (!/^[A-Za-z0-9._:-]{8,100}$/u.test(owner) || !Number.isSafeInteger(seconds) || seconds < 5 || seconds > 120) invalid();
}

function validateRetry(seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > 3_600) invalid();
}

function providerRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:submitting:[0-9a-f-]{36}|[A-Za-z0-9._:-]{1,255})$/u.test(value)) invalid();
  return value;
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
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

function buffer(value: unknown): Buffer {
  const result = Buffer.from(value as Uint8Array);
  if (result.length < 1 || result.length > 65_536) invalid();
  return result;
}

function invalid(): never {
  throw new TypeError("Invalid AI answer runtime state");
}

export class AiAnswerLeaseLostError extends Error {
  public constructor() {
    super("AI answer collection lease was lost");
    this.name = "AiAnswerLeaseLostError";
  }
}

interface ClaimRow {
  readonly jobId: string;
  readonly jobItemId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly credentialId: string;
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBMIT_MARKER_PATTERN =
  /^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

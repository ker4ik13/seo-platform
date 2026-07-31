import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";
import type { KeysSoKeywordRow } from "./keys-so-keyword-research.connector.js";

export interface KeywordResearchClaim {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly credentialId: string;
  readonly domain: string;
  readonly database: string;
  readonly page: number;
  readonly maxKeywords: number;
  readonly collectedKeywords: number;
  readonly runVersion: number;
  readonly jobVersion: number;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly encryptedCredential: EncryptedIntegrationCredential;
}

@Injectable()
export class KeywordResearchRuntimeBrokerService {
  public constructor(private readonly prisma: PrismaService) {}

  public async claim(
    leaseOwner: string,
    leaseSeconds: number
  ): Promise<KeywordResearchClaim | undefined> {
    if (
      !/^[A-Za-z0-9._:-]{8,100}$/u.test(leaseOwner) ||
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 5 ||
      leaseSeconds > 60
    ) {
      throw new TypeError("Invalid keyword research lease");
    }
    const rows = await this.prisma.$queryRaw<readonly ClaimRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.claim_keyword_research_run(
          ${leaseOwner}::text,
          ${leaseSeconds}::integer
        )
      `
    );
    if (rows.length === 0) return undefined;
    if (rows.length !== 1 || !rows[0]) invalid();
    const row = rows[0];
    return {
      runId: uuid(row.runId),
      workspaceId: uuid(row.workspaceId),
      projectId: uuid(row.projectId),
      jobId: uuid(row.jobId),
      credentialId: uuid(row.credentialId),
      domain: string(row.domain, 253),
      database: string(row.database, 16),
      page: positive(row.page),
      maxKeywords: positive(row.maxKeywords),
      collectedKeywords: nonNegative(row.collectedKeywords),
      runVersion: positive(row.runVersion),
      jobVersion: positive(row.jobVersion),
      leaseOwner,
      leaseToken: uuid(row.leaseToken),
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
  }

  public async completePage(
    claim: KeywordResearchClaim,
    input: {
      readonly rows: readonly KeysSoKeywordRow[];
      readonly responseHash: Buffer;
      readonly totalAvailable?: number;
      readonly complete: boolean;
    }
  ): Promise<void> {
    if (input.rows.length > 25 || input.responseHash.length !== 32) invalid();
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.complete_keyword_research_page(
          ${claim.runId}::uuid,
          ${claim.leaseOwner}::text,
          ${claim.leaseToken}::uuid,
          ${claim.runVersion}::integer,
          ${claim.jobVersion}::integer,
          ${JSON.stringify(input.rows)}::jsonb,
          ${input.responseHash}::bytea,
          ${input.totalAvailable ?? null}::integer,
          ${input.complete}::boolean
        )
      `
    );
    requiredCompletion(rows);
  }

  public async fail(
    claim: KeywordResearchClaim,
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
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(
      Prisma.sql`
        SELECT *
        FROM public.fail_keyword_research_run(
          ${claim.runId}::uuid,
          ${claim.leaseOwner}::text,
          ${claim.leaseToken}::uuid,
          ${claim.runVersion}::integer,
          ${claim.jobVersion}::integer,
          ${input.code}::text,
          ${retryAfter ?? null}::integer
        )
      `
    );
    requiredCompletion(rows);
  }
}

interface ClaimRow {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly credentialId: string;
  readonly domain: string;
  readonly database: string;
  readonly page: number;
  readonly maxKeywords: number;
  readonly collectedKeywords: number;
  readonly runVersion: number;
  readonly jobVersion: number;
  readonly leaseToken: string;
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
  readonly runId: string;
  readonly runVersion: number;
}

function requiredCompletion(rows: readonly CompletionRow[]): void {
  if (
    rows.length !== 1 ||
    !rows[0] ||
    !UUID_PATTERN.test(rows[0].runId) ||
    !Number.isSafeInteger(rows[0].runVersion) ||
    rows[0].runVersion < 1
  ) {
    throw new KeywordResearchLeaseLostError();
  }
}

export class KeywordResearchLeaseLostError extends Error {
  public constructor() {
    super("Keyword research lease was lost");
    this.name = "KeywordResearchLeaseLostError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function string(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max) invalid();
  return value;
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid();
  return Number(value);
}

function nonNegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
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
  throw new TypeError("Invalid keyword research broker response");
}

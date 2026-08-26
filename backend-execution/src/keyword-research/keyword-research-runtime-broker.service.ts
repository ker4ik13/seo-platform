import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";
import type {
  KeysSoCompetitor,
  KeysSoDomainOverview,
  WordstatExpansionDevice
} from "@seo-platform/contracts";
import type { ArsenkinWordstatExpansionRow } from "./arsenkin-wordstat-expansion.connector.js";
import type { XmlStockWordstatExpansionRow } from "../frequency-collections/xmlstock-wordstat.connector.js";
import type { KeysSoKeywordRow } from "./keys-so-keyword-research.connector.js";

interface WordstatResearchInput {
  readonly queries: readonly string[];
  readonly regionCode: string;
  readonly device: WordstatExpansionDevice;
  readonly minusWords: readonly string[];
  readonly clearMinusPhrases: boolean;
  readonly includeRightColumn: boolean;
  readonly clearPlus: boolean;
  readonly maxKeywords: number;
}

interface KeywordResearchClaimBase {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly credentialId: string;
  readonly provider: "KEYS_SO" | "ARSENKIN" | "XMLSTOCK";
  readonly providerTaskId?: string;
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

export type KeywordResearchClaim =
  | (KeywordResearchClaimBase & {
      readonly source: "KEYS_SO";
      readonly provider: "KEYS_SO";
      readonly domain: string;
      readonly database: string;
    })
  | (KeywordResearchClaimBase & {
      readonly source: "ARSENKIN_WORDSTAT";
      readonly provider: "ARSENKIN";
      readonly input: WordstatResearchInput;
    })
  | (KeywordResearchClaimBase & {
      readonly source: "XMLSTOCK_WORDSTAT";
      readonly provider: "XMLSTOCK";
      readonly input: WordstatResearchInput;
    });

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
    const providerTaskId = optionalString(row.providerTaskId, 255);
    const common = {
      runId: uuid(row.runId),
      workspaceId: uuid(row.workspaceId),
      projectId: uuid(row.projectId),
      jobId: uuid(row.jobId),
      credentialId: uuid(row.credentialId),
      ...(providerTaskId ? { providerTaskId } : {}),
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
    if (row.source === "KEYS_SO" && row.provider === "KEYS_SO") {
      return {
        ...common,
        source: "KEYS_SO",
        provider: "KEYS_SO",
        domain: string(row.domain, 253),
        database: string(row.database, 16)
      };
    }
    if (row.source === "ARSENKIN_WORDSTAT" && row.provider === "ARSENKIN") {
      return {
        ...common,
        source: "ARSENKIN_WORDSTAT",
        provider: "ARSENKIN",
        input: wordstatInput(row.inputSnapshot, "ARSENKIN_WORDSTAT")
      };
    }
    if (row.source === "XMLSTOCK_WORDSTAT" && row.provider === "XMLSTOCK") {
      return {
        ...common,
        source: "XMLSTOCK_WORDSTAT",
        provider: "XMLSTOCK",
        input: wordstatInput(row.inputSnapshot, "XMLSTOCK_WORDSTAT")
      };
    }
    invalid();
  }

  public async completePage(
    claim: KeywordResearchClaim,
    input: {
      readonly rows: readonly KeysSoKeywordRow[];
      readonly responseHash: Buffer;
      readonly totalAvailable?: number;
      readonly complete: boolean;
      readonly overview?: KeysSoDomainOverview;
      readonly competitors?: readonly KeysSoCompetitor[];
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
          ${input.complete}::boolean,
          ${input.overview ? JSON.stringify(input.overview) : null}::jsonb,
          ${input.competitors ? JSON.stringify(input.competitors) : null}::jsonb
        )
      `
    );
    requiredCompletion(rows);
  }

  public async markSubmitting(
    claim: Extract<KeywordResearchClaim, { readonly source: "ARSENKIN_WORDSTAT" }>,
    marker: string,
    leaseSeconds: number
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<readonly SubmittingRow[]>(
      Prisma.sql`
        SELECT * FROM public.mark_keyword_research_submitting(
          ${claim.runId}::uuid,
          ${claim.leaseOwner}::text,
          ${claim.leaseToken}::uuid,
          ${claim.runVersion}::integer,
          ${claim.jobVersion}::integer,
          ${marker}::text,
          ${leaseSeconds}::integer
        )
      `
    );
    if (rows.length === 0) return false;
    if (rows.length !== 1 || !rows[0]) invalid();
    return true;
  }

  public async transitionWordstat(
    claim: Extract<KeywordResearchClaim, { readonly source: "ARSENKIN_WORDSTAT" }>,
    input:
      | { readonly action: "DEFER"; readonly taskId: string; readonly retryAfterSeconds: number }
      | { readonly action: "CAPACITY"; readonly retryAfterSeconds: number }
      | { readonly action: "QUARANTINE" }
      | { readonly action: "FAIL"; readonly code: string; readonly retryAfterSeconds?: number }
      | { readonly action: "COMPLETE"; readonly rows: readonly ArsenkinWordstatExpansionRow[]; readonly responseHash: Buffer }
  ): Promise<void> {
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(
      Prisma.sql`
        SELECT * FROM public.transition_wordstat_keyword_research_run(
          ${claim.runId}::uuid,
          ${claim.leaseOwner}::text,
          ${claim.leaseToken}::uuid,
          ${claim.runVersion}::integer,
          ${claim.jobVersion}::integer,
          ${input.action}::text,
          ${input.action === "DEFER" ? input.taskId : null}::text,
          ${input.action === "DEFER" || input.action === "CAPACITY" || input.action === "FAIL"
            ? input.retryAfterSeconds ?? null
            : null}::integer,
          ${input.action === "FAIL" ? input.code : null}::text,
          ${input.action === "COMPLETE" ? JSON.stringify(input.rows) : null}::jsonb,
          ${input.action === "COMPLETE" ? input.responseHash : null}::bytea
        )
      `
    );
    requiredCompletion(rows);
  }

  public async completeXmlStockSeed(
    claim: Extract<KeywordResearchClaim, { readonly source: "XMLSTOCK_WORDSTAT" }>,
    input: {
      readonly rows: readonly XmlStockWordstatExpansionRow[];
      readonly responseHash: Buffer;
    }
  ): Promise<void> {
    if (input.rows.length > 2_000 || input.responseHash.length !== 32) invalid();
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(
      Prisma.sql`
        SELECT * FROM public.complete_xmlstock_wordstat_research_seed(
          ${claim.runId}::uuid,
          ${claim.leaseOwner}::text,
          ${claim.leaseToken}::uuid,
          ${claim.runVersion}::integer,
          ${claim.jobVersion}::integer,
          ${JSON.stringify(input.rows)}::jsonb,
          ${input.responseHash}::bytea
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
  readonly source: string;
  readonly provider: string;
  readonly domain: string | null;
  readonly database: string | null;
  readonly inputSnapshot: unknown;
  readonly providerTaskId: string | null;
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

interface SubmittingRow extends CompletionRow {
  readonly leaseExpiresAt: Date | string;
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

function optionalString(value: unknown, max: number): string | undefined {
  return value === null || value === undefined ? undefined : string(value, max);
}

function wordstatInput(
  value: unknown,
  source: "ARSENKIN_WORDSTAT" | "XMLSTOCK_WORDSTAT"
): WordstatResearchInput {
  const input = jsonRecord(value);
  if (
    input.source !== source ||
    !Array.isArray(input.queries) ||
    input.queries.length < 1 ||
    input.queries.length > 500 ||
    input.queries.some((item) => typeof item !== "string") ||
    typeof input.regionCode !== "string" ||
    !/^\d{1,10}$/u.test(input.regionCode) ||
    !["ALL", "DESKTOP", "MOBILE", "PHONE_ONLY", "TABLET_ONLY"].includes(String(input.device)) ||
    !Array.isArray(input.minusWords) ||
    input.minusWords.some((item) => typeof item !== "string") ||
    typeof input.clearMinusPhrases !== "boolean" ||
    typeof input.includeRightColumn !== "boolean" ||
    typeof input.clearPlus !== "boolean"
  ) invalid();
  return {
    queries: input.queries as readonly string[],
    regionCode: input.regionCode,
    device: input.device as WordstatExpansionDevice,
    minusWords: input.minusWords as readonly string[],
    clearMinusPhrases: input.clearMinusPhrases,
    includeRightColumn: input.includeRightColumn,
    clearPlus: input.clearPlus,
    maxKeywords: positive(input.maxKeywords)
  };
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
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

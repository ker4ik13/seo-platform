import { Injectable } from "@nestjs/common";
import type {
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";

export interface FrequencyCollectionClaim {
  readonly jobId: string;
  readonly jobItemId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
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
    leaseSeconds: number
  ): Promise<FrequencyCollectionClaim | undefined> {
    if (
      !/^[A-Za-z0-9._:-]{8,100}$/u.test(leaseOwner) ||
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 5 ||
      leaseSeconds > 60
    ) invalid();
    const rows = await this.prisma.$queryRaw<readonly ClaimRow[]>(Prisma.sql`
      SELECT * FROM public.claim_frequency_collection_item(
        ${leaseOwner}::text,
        ${leaseSeconds}::integer
      )
    `);
    if (rows.length === 0) return undefined;
    if (rows.length !== 1 || !rows[0]) invalid();
    const row = rows[0];
    const types = frequencyTypes(row.inputSnapshot);
    return {
      jobId: uuid(row.jobId),
      jobItemId: uuid(row.jobItemId),
      workspaceId: uuid(row.workspaceId),
      projectId: uuid(row.projectId),
      actorId: uuid(row.actorId),
      credentialId: uuid(row.credentialId),
      keywordId: uuid(row.keywordId),
      keywordVersion: positive(row.keywordVersion),
      types,
      regionCode: region(row.inputSnapshot),
      device: device(row.inputSnapshot),
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
  }

  public async complete(
    claim: FrequencyCollectionClaim,
    snapshotCount: number
  ): Promise<void> {
    if (!Number.isSafeInteger(snapshotCount) || snapshotCount < 1 || snapshotCount > 3) invalid();
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.complete_frequency_collection_item(
        ${claim.jobId}::uuid,
        ${claim.jobItemId}::uuid,
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${snapshotCount}::integer
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
      SELECT * FROM public.fail_frequency_collection_item(
        ${claim.jobId}::uuid,
        ${claim.jobItemId}::uuid,
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${input.code}::text,
        ${retryAfter ?? null}::integer
      )
    `);
    requiredCompletion(rows);
  }
}

interface ClaimRow {
  readonly jobId: string;
  readonly jobItemId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
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

export class FrequencyCollectionLeaseLostError extends Error {
  public constructor() {
    super("Frequency collection lease was lost");
    this.name = "FrequencyCollectionLeaseLostError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function buffer(value: unknown): Buffer {
  const result = Buffer.from(value as Uint8Array);
  if (result.length < 1 || result.length > 65_536) invalid();
  return result;
}

function invalid(): never {
  throw new TypeError("Invalid frequency collection broker response");
}

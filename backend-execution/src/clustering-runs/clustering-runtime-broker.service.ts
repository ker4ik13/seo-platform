import { Injectable } from "@nestjs/common";
import type {
  ClusteringDepth,
  ClusteringFrequencyType,
  ClusteringMethod,
  ClusteringSearchEngine
} from "@seo-platform/contracts";
import { arsenkinClusteringKeywordLimit } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { EncryptedIntegrationCredential } from "../integrations/integration-credential-crypto.service.js";

export interface ClusteringClaimItem {
  readonly jobItemId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly attempt: number;
  readonly providerRequestId?: string;
}

export interface ClusteringClaim {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly items: readonly ClusteringClaimItem[];
  readonly searchEngine: ClusteringSearchEngine;
  readonly regionCode: string;
  readonly method: ClusteringMethod;
  readonly overlapCount: number;
  readonly depth: ClusteringDepth;
  readonly excludeMainPages: boolean;
  readonly stopDomains: readonly string[];
  readonly frequencyTypes: readonly ClusteringFrequencyType[];
  readonly replaceExistingClusters: boolean;
  readonly maxAttempts: number;
  readonly jobVersion: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly encryptedCredential: EncryptedIntegrationCredential;
}

@Injectable()
export class ClusteringRuntimeBrokerService {
  public constructor(private readonly prisma: PrismaService) {}

  public async claim(leaseOwner: string, leaseSeconds: number): Promise<ClusteringClaim | undefined> {
    validateLease(leaseOwner, leaseSeconds);
    const rows = await this.prisma.$queryRaw<readonly ClaimRow[]>(Prisma.sql`
      SELECT * FROM public.claim_clustering_run(
        ${leaseOwner}::text,
        ${leaseSeconds}::integer
      )
    `);
    if (rows.length === 0) return undefined;
    if (rows.length > arsenkinClusteringKeywordLimit || !rows[0]) invalid();
    const row = rows[0];
    const input = parseInput(row.inputSnapshot);
    const result: ClusteringClaim = {
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
    validateRows(rows, result);
    return result;
  }

  public async renew(claim: ClusteringClaim, leaseSeconds: number): Promise<ClusteringClaim> {
    validateLease(claim.leaseOwner, leaseSeconds);
    const rows = await this.prisma.$queryRaw<readonly LeaseRow[]>(Prisma.sql`
      SELECT * FROM public.renew_clustering_run_lease(
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
    claim: ClusteringClaim,
    marker: string,
    leaseSeconds: number
  ): Promise<ClusteringClaim | undefined> {
    if (!SUBMIT_MARKER_PATTERN.test(marker)) invalid();
    const rows = await this.prisma.$queryRaw<readonly LeaseRow[]>(Prisma.sql`
      SELECT * FROM public.mark_clustering_run_submitting(
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

  public async defer(claim: ClusteringClaim, taskId: string, retryAfterSeconds: number): Promise<void> {
    await this.transition(claim, {
      action: "DEFER",
      providerRequestId: providerRequestId(taskId),
      retryAfterSeconds
    });
  }

  public async releaseForCapacity(claim: ClusteringClaim, retryAfterSeconds: number): Promise<void> {
    await this.transition(claim, { action: "CAPACITY", retryAfterSeconds });
  }

  public async fail(
    claim: ClusteringClaim,
    input: { readonly code: string; readonly retryable: boolean; readonly retryAfterSeconds?: number }
  ): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.code)) invalid();
    await this.transition(claim, {
      action: "FAIL",
      errorCode: input.code,
      ...(input.retryable
        ? { retryAfterSeconds: Math.min(Math.max(input.retryAfterSeconds ?? 30, 5), 3_600) }
        : {})
    });
  }

  public async quarantineAmbiguousSubmit(claim: ClusteringClaim): Promise<void> {
    await this.transition(claim, { action: "QUARANTINE" });
  }

  public async complete(
    claim: ClusteringClaim,
    result: {
      readonly proposalId: string;
      readonly clusterCount: number;
      readonly unclusteredCount: number;
    }
  ): Promise<void> {
    uuid(result.proposalId);
    nonNegative(result.clusterCount);
    nonNegative(result.unclusteredCount);
    await this.transition(claim, {
      action: "COMPLETE",
      resultSummary: {
        proposalId: result.proposalId,
        clusterCount: result.clusterCount,
        unclusteredCount: result.unclusteredCount,
        completed: claim.items.length,
        failed: 0
      }
    });
  }

  private async transition(
    claim: ClusteringClaim,
    input: {
      readonly action: "COMPLETE" | "DEFER" | "FAIL" | "CAPACITY" | "QUARANTINE";
      readonly providerRequestId?: string;
      readonly retryAfterSeconds?: number;
      readonly errorCode?: string;
      readonly resultSummary?: Prisma.InputJsonObject;
    }
  ): Promise<void> {
    if (input.retryAfterSeconds !== undefined) validateRetry(input.retryAfterSeconds);
    const rows = await this.prisma.$queryRaw<readonly CompletionRow[]>(Prisma.sql`
      SELECT * FROM public.transition_clustering_run(
        ${claim.jobId}::uuid,
        ${jobItemIds(claim)}::uuid[],
        ${claim.leaseOwner}::text,
        ${claim.jobVersion}::integer,
        ${input.action}::text,
        ${input.providerRequestId ?? null}::text,
        ${input.retryAfterSeconds ?? null}::integer,
        ${input.errorCode ?? null}::text,
        ${input.resultSummary ? JSON.stringify(input.resultSummary) : null}::jsonb
      )
    `);
    requiredCompletion(rows);
  }
}

function jobItemIds(claim: ClusteringClaim): readonly string[] {
  if (claim.items.length < 1 || claim.items.length > arsenkinClusteringKeywordLimit) invalid();
  return claim.items.map((item) => item.jobItemId);
}

function parseInput(value: unknown): Pick<
  ClusteringClaim,
  | "searchEngine" | "regionCode" | "method" | "overlapCount" | "depth"
  | "excludeMainPages" | "stopDomains" | "frequencyTypes" | "replaceExistingClusters"
> {
  const input = object(value);
  if (
    (input.searchEngine !== "YANDEX" && input.searchEngine !== "GOOGLE") ||
    typeof input.regionCode !== "string" ||
    !/^(?:0|[1-9]\d{0,9})$/u.test(input.regionCode) ||
    (input.method !== "SOFT" && input.method !== "HARD") ||
    !Number.isSafeInteger(input.overlapCount) ||
    Number(input.overlapCount) < 2 ||
    Number(input.overlapCount) > 10 ||
    ![10, 20, 30].includes(Number(input.depth)) ||
    typeof input.excludeMainPages !== "boolean" ||
    !Array.isArray(input.stopDomains) ||
    input.stopDomains.some((entry) => typeof entry !== "string") ||
    !Array.isArray(input.frequencyTypes) ||
    input.frequencyTypes.some((entry) => !["BASE", "QUOTED", "OVERALL", "EXACT"].includes(String(entry))) ||
    typeof input.replaceExistingClusters !== "boolean"
  ) invalid();
  return {
    searchEngine: input.searchEngine,
    regionCode: input.regionCode,
    method: input.method,
    overlapCount: Number(input.overlapCount),
    depth: Number(input.depth) as ClusteringDepth,
    excludeMainPages: input.excludeMainPages,
    stopDomains: input.stopDomains as string[],
    frequencyTypes: input.frequencyTypes as ClusteringFrequencyType[],
    replaceExistingClusters: input.replaceExistingClusters
  };
}

function validateRows(rows: readonly ClaimRow[], claim: ClusteringClaim): void {
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
  ) throw new ClusteringLeaseLostError();
}

function requiredLease(rows: readonly LeaseRow[], claim: ClusteringClaim): string {
  if (
    rows.length !== 1 ||
    !rows[0] ||
    uuid(rows[0].jobId) !== claim.jobId ||
    positive(rows[0].jobVersion) !== claim.jobVersion
  ) throw new ClusteringLeaseLostError();
  const value = timestamp(rows[0].leaseExpiresAt);
  if (Date.parse(value) <= Date.now()) throw new ClusteringLeaseLostError();
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
  throw new TypeError("Invalid clustering runtime state");
}

export class ClusteringLeaseLostError extends Error {
  public constructor() {
    super("Clustering run lease was lost");
    this.name = "ClusteringLeaseLostError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBMIT_MARKER_PATTERN =
  /^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

interface LeaseRow {
  readonly jobId: string;
  readonly jobVersion: number;
  readonly leaseExpiresAt: Date | string;
}

interface CompletionRow {
  readonly jobId: string;
  readonly jobVersion: number;
}

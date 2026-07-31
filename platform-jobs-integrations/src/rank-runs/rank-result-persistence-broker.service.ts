import { timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { RankManifestHash } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  arsenkinStagedRankResult,
  arsenkinStagedRankResultHash,
  type ArsenkinStagedRankResultV1
} from "./arsenkin-rank.connector.js";
import {
  rankProviderRequestIntent,
  type RankProviderRequestIntentV1
} from "./rank-provider-request-intent.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface RankResultPersistenceClaim {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly manifestId: string;
  readonly manifestChunkIndex: number;
  readonly manifestChunkHash: RankManifestHash;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly leaseGeneration: number;
  readonly executionVersion: number;
  readonly request: RankProviderRequestIntentV1;
  readonly staged: ArsenkinStagedRankResultV1;
}

@Injectable()
export class RankResultPersistenceBrokerService {
  public constructor(private readonly prisma: PrismaService) {}

  public async claim(
    leaseOwner: string,
    leaseSeconds: number
  ): Promise<RankResultPersistenceClaim | undefined> {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/u.test(leaseOwner) ||
      !Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < 10 ||
      leaseSeconds > 300
    ) {
      throw new TypeError("Invalid rank result persistence claim");
    }
    const rows = await this.prisma.$queryRaw<
      readonly PersistenceClaimRow[]
    >(
      Prisma.sql`
        SELECT *
        FROM public.claim_rank_staged_result(
          ${leaseOwner}::text,
          ${leaseSeconds}::integer
        )
      `
    );
    if (rows.length === 0) return undefined;
    if (rows.length !== 1 || !rows[0]) invalid("claim cardinality");
    const row = rows[0];
    const staged = arsenkinStagedRankResult(row.normalizedResultSnapshot);
    const actual = Buffer.from(
      arsenkinStagedRankResultHash(staged).value,
      "hex"
    );
    const expected = bytes(row.normalizedResultHash, "staged hash", 32);
    if (!timingSafeEqual(actual, expected)) invalid("staged hash");
    return {
      executionId: uuid(row.executionId, "execution id"),
      workspaceId: uuid(row.workspaceId, "workspace id"),
      projectId: uuid(row.projectId, "project id"),
      jobId: uuid(row.jobId, "job id"),
      jobItemId: uuid(row.jobItemId, "job item id"),
      manifestId: uuid(row.manifestId, "manifest id"),
      manifestChunkIndex: boundedInteger(
        row.manifestChunkIndex,
        0,
        3,
        "chunk index"
      ),
      manifestChunkHash: {
        algorithm: "SHA_256",
        value: bytes(row.manifestChunkHash, "chunk hash", 32).toString(
          "hex"
        )
      },
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
      request: rankProviderRequestIntent(row.requestSnapshot),
      staged
    };
  }

  public async complete(
    claim: RankResultPersistenceClaim,
    persisted: boolean
  ): Promise<"STAGED" | "PERSISTED"> {
    const rows = await this.prisma.$queryRaw<
      readonly PersistenceCompletionRow[]
    >(
      Prisma.sql`
        SELECT *
        FROM public.complete_rank_staged_result(
          ${claim.workspaceId}::uuid,
          ${claim.executionId}::uuid,
          ${claim.leaseOwner}::text,
          ${claim.leaseToken}::uuid,
          ${claim.leaseGeneration}::integer,
          ${claim.executionVersion}::integer,
          ${persisted}::boolean
        )
      `
    );
    if (rows.length !== 1 || !rows[0]) {
      throw new RankResultPersistenceLeaseLostError();
    }
    const row = rows[0];
    if (
      uuid(row.executionId, "completion execution id") !==
        claim.executionId ||
      !["STAGED", "PERSISTED"].includes(row.status) ||
      !Number.isSafeInteger(row.executionVersion) ||
      row.executionVersion !== claim.executionVersion + 1
    ) {
      invalid("completion");
    }
    return row.status as "STAGED" | "PERSISTED";
  }
}

export class RankResultPersistenceLeaseLostError extends Error {
  public constructor() {
    super("RANK_RESULT_PERSISTENCE_LEASE_LOST");
    this.name = "RankResultPersistenceLeaseLostError";
  }
}

interface PersistenceClaimRow {
  readonly executionId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly leaseGeneration: number;
  readonly executionVersion: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly manifestId: string;
  readonly manifestChunkIndex: number;
  readonly manifestChunkHash: Uint8Array;
  readonly requestSnapshot: unknown;
  readonly normalizedResultSnapshot: unknown;
  readonly normalizedResultHash: Uint8Array;
}

interface PersistenceCompletionRow {
  readonly executionId: string;
  readonly status: string;
  readonly executionVersion: number;
}

function uuid(value: string, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(field);
  return value.toLowerCase();
}

function positiveInteger(value: number, field: string): number {
  return boundedInteger(value, 1, 2_147_483_647, field);
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(field);
  }
  return value;
}

function timestamp(value: Date, field: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid(field);
  return value.toISOString();
}

function bytes(
  value: Uint8Array,
  field: string,
  length: number
): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    invalid(field);
  }
  return Buffer.from(value);
}

function invalid(field: string): never {
  throw new Error(`Invalid rank result persistence broker ${field}`);
}

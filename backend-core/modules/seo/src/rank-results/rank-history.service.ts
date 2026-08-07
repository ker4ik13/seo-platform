import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import {
  normalizedRankDataQualityFlags,
  redactRankHistoryItem,
  type InternalRankHistoryCollection,
  type InternalRankHistoryCursorV1,
  type InternalRankHistoryQuery,
  type NormalizedRankDataQualityFlag,
  type RankHistoryItem,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  rankHistoryFilterHash
} from "@seo-platform/contracts/rank-results-canonical";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

const CURSOR_DOMAIN = "seo-platform.rank-history-cursor@1\0";
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const QUALITY_FLAGS = new Set<NormalizedRankDataQualityFlag>(
  normalizedRankDataQualityFlags
);

const HISTORY_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  keywordId: true,
  trackingContextId: true,
  configurationVersion: true,
  jobId: true,
  observedAt: true,
  found: true,
  position: true,
  absolutePosition: true,
  pixelPosition: true,
  rankingUrl: true,
  normalizedRankingUrl: true,
  title: true,
  snippet: true,
  resultType: true,
  serpFeatures: true,
  dataQualityFlags: true,
  provider: true,
  sourceMode: true,
  connectorVersion: true,
  createdAt: true
} satisfies Prisma.RankSnapshotSelect;

type RankHistoryRecord = Prisma.RankSnapshotGetPayload<{
  select: typeof HISTORY_SELECT;
}>;

interface CursorEnvelope {
  readonly payload: InternalRankHistoryCursorV1;
  readonly mac: string;
}

@Injectable()
export class RankHistoryService {
  private readonly cursorKey: string | undefined;

  public constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig
  ) {
    this.cursorKey = config.rankHistoryCursorKey;
  }

  public async list(
    query: InternalRankHistoryQuery
  ): Promise<InternalRankHistoryCollection> {
    const filterHash = rankHistoryFilterHash(query);
    const cursor = query.cursor
      ? this.decodeCursor(query.cursor, query, filterHash)
      : undefined;
    const rows = await this.prisma.rankSnapshot.findMany({
      where: {
        workspaceId: query.workspaceId,
        projectId: query.projectId,
        sourceMode: "BYOK",
        observedAt: {
          gte: new Date(query.observedFrom),
          lt: new Date(query.observedBefore)
        },
        ...(query.trackingContextId
          ? { trackingContextId: query.trackingContextId }
          : {}),
        ...(query.keywordId ? { keywordId: query.keywordId } : {}),
        ...(cursor
          ? {
              OR: [
                { observedAt: { lt: new Date(cursor.observedAt) } },
                {
                  observedAt: new Date(cursor.observedAt),
                  id: { lt: cursor.snapshotId }
                }
              ]
            }
          : {})
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: HISTORY_SELECT
    });
    const hasNext = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      items: pageRows.map((row) =>
        storedHistoryItem(row, query)
      ),
      page: {
        hasNext,
        ...(hasNext && last
          ? {
              nextCursor: this.encodeCursor({
                schemaVersion: "rank-history-cursor@1",
                workspaceId: query.workspaceId,
                projectId: query.projectId,
                filterHash,
                observedAt: last.observedAt.toISOString(),
                snapshotId: last.id
              })
            }
          : {})
      }
    };
  }

  private encodeCursor(
    payload: InternalRankHistoryCursorV1
  ): string {
    const envelope: CursorEnvelope = {
      payload,
      mac: cursorMac(this.requiredCursorKey(), payload)
    };
    return Buffer.from(
      canonicalizeJson(envelope),
      "utf8"
    ).toString("base64url");
  }

  private decodeCursor(
    encoded: string,
    query: InternalRankHistoryQuery,
    filterHash: RankManifestHash
  ): InternalRankHistoryCursorV1 {
    let value: unknown;
    try {
      const decoded = Buffer.from(encoded, "base64url");
      if (decoded.toString("base64url") !== encoded) {
        invalidCursor();
      }
      value = JSON.parse(decoded.toString("utf8"));
    } catch {
      invalidCursor();
    }
    const envelope = strictRecord(value, ["payload", "mac"]);
    const payload = strictRecord(envelope.payload, [
      "schemaVersion",
      "workspaceId",
      "projectId",
      "filterHash",
      "observedAt",
      "snapshotId"
    ]);
    const hash = storedHash(payload.filterHash);
    const cursor: InternalRankHistoryCursorV1 = {
      schemaVersion:
        payload.schemaVersion === "rank-history-cursor@1"
          ? payload.schemaVersion
          : invalidCursor(),
      workspaceId: uuid(payload.workspaceId),
      projectId: uuid(payload.projectId),
      filterHash: hash,
      observedAt: isoInstant(payload.observedAt),
      snapshotId: uuid(payload.snapshotId)
    };
    if (
      typeof envelope.mac !== "string" ||
      !HASH_PATTERN.test(envelope.mac) ||
      cursor.workspaceId !== query.workspaceId ||
      cursor.projectId !== query.projectId ||
      !hashesEqual(cursor.filterHash, filterHash) ||
      Date.parse(cursor.observedAt) < Date.parse(query.observedFrom) ||
      Date.parse(cursor.observedAt) >= Date.parse(query.observedBefore)
    ) {
      invalidCursor();
    }
    const expectedMac = cursorMac(this.requiredCursorKey(), cursor);
    const actualBytes = Buffer.from(envelope.mac, "hex");
    const expectedBytes = Buffer.from(expectedMac, "hex");
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      invalidCursor();
    }
    return cursor;
  }

  private requiredCursorKey(): string {
    if (!this.cursorKey) {
      throw new ServiceUnavailableException(
        "Rank history cursor authentication is not configured"
      );
    }
    return this.cursorKey;
  }
}

function storedHistoryItem(
  record: RankHistoryRecord,
  query: InternalRankHistoryQuery
): RankHistoryItem {
  if (
    record.workspaceId !== query.workspaceId ||
    record.projectId !== query.projectId ||
    (record.provider !== "ARSENKIN" && record.provider !== "XMLSTOCK") ||
    record.sourceMode !== "BYOK" ||
    !UUID_V7_PATTERN.test(record.id) ||
    !UUID_V7_PATTERN.test(record.keywordId) ||
    !UUID_V7_PATTERN.test(record.trackingContextId) ||
    !UUID_V7_PATTERN.test(record.jobId) ||
    !Number.isSafeInteger(record.configurationVersion) ||
    record.configurationVersion < 1 ||
    !(record.observedAt instanceof Date) ||
    Number.isNaN(record.observedAt.getTime()) ||
    !(record.createdAt instanceof Date) ||
    Number.isNaN(record.createdAt.getTime())
  ) {
    throw new Error("Stored rank history row is invalid");
  }
  const common = {
    snapshotId: record.id,
    keywordId: record.keywordId,
    trackingContextId: record.trackingContextId,
    configurationVersion: record.configurationVersion,
    provider: record.provider as "ARSENKIN" | "XMLSTOCK",
    connectorVersion: record.connectorVersion,
    observedAt: record.observedAt.toISOString(),
    storedAt: record.createdAt.toISOString(),
    jobId: record.jobId,
    dataQualityFlags: storedQualityFlags(record.dataQualityFlags)
  };
  if (!record.found) {
    if (
      record.position !== null ||
      record.absolutePosition !== null ||
      record.pixelPosition !== null ||
      record.rankingUrl !== null ||
      record.normalizedRankingUrl !== null ||
      record.title !== null ||
      record.snippet !== null ||
      record.resultType !== null ||
      !emptyJsonArray(record.serpFeatures)
    ) {
      throw new Error("Stored not-found rank history row is invalid");
    }
    return redactRankHistoryItem({
      ...common,
      found: false,
      position: null
    });
  }
  if (
    record.position === null ||
    record.position < 1 ||
    record.position > 100 ||
    record.rankingUrl === null ||
    record.normalizedRankingUrl === null ||
    record.resultType !== "ORGANIC" ||
    !emptyJsonArray(record.serpFeatures)
  ) {
    throw new Error("Stored found rank history row is invalid");
  }
  return redactRankHistoryItem({
    ...common,
    found: true,
    position: record.position,
    ...(record.absolutePosition === null
      ? {}
      : { absolutePosition: record.absolutePosition }),
    ...(record.pixelPosition === null
      ? {}
      : { pixelPosition: record.pixelPosition }),
    rankingUrl: record.rankingUrl,
    normalizedRankingUrl: record.normalizedRankingUrl,
    ...(record.title === null ? {} : { title: record.title }),
    ...(record.snippet === null ? {} : { snippet: record.snippet }),
    resultType: "ORGANIC",
    serpFeatures: []
  });
}

function storedQualityFlags(
  value: Prisma.JsonValue
): readonly NormalizedRankDataQualityFlag[] {
  if (!Array.isArray(value) || value.length > QUALITY_FLAGS.size) {
    throw new Error("Stored rank data-quality flags are invalid");
  }
  const result: NormalizedRankDataQualityFlag[] = [];
  const seen = new Set<string>();
  for (const flag of value) {
    if (
      typeof flag !== "string" ||
      !QUALITY_FLAGS.has(flag as NormalizedRankDataQualityFlag) ||
      seen.has(flag)
    ) {
      throw new Error("Stored rank data-quality flags are invalid");
    }
    seen.add(flag);
    result.push(flag as NormalizedRankDataQualityFlag);
  }
  return result;
}

function emptyJsonArray(value: Prisma.JsonValue): boolean {
  return Array.isArray(value) && value.length === 0;
}

function cursorMac(
  key: string,
  payload: InternalRankHistoryCursorV1
): string {
  return createHmac("sha256", key)
    .update(CURSOR_DOMAIN)
    .update(canonicalizeJson(payload))
    .digest("hex");
}

function strictRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalidCursor();
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !keys.includes(key))
  ) {
    invalidCursor();
  }
  return record;
}

function storedHash(value: unknown): RankManifestHash {
  const record = strictRecord(value, ["algorithm", "value"]);
  if (
    record.algorithm !== "SHA_256" ||
    typeof record.value !== "string" ||
    !HASH_PATTERN.test(record.value)
  ) {
    invalidCursor();
  }
  return {
    algorithm: "SHA_256",
    value: record.value
  };
}

function hashesEqual(
  left: RankManifestHash,
  right: RankManifestHash
): boolean {
  const leftBytes = Buffer.from(left.value, "hex");
  const rightBytes = Buffer.from(right.value, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    invalidCursor();
  }
  return value;
}

function isoInstant(value: unknown): string {
  if (typeof value !== "string" || value.length !== 24) {
    invalidCursor();
  }
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString() !== value
  ) {
    invalidCursor();
  }
  return value;
}

function invalidCursor(): never {
  throw new BadRequestException("Invalid rank history cursor");
}

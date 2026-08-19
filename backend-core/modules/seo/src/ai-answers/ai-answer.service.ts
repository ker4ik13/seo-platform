import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  InternalAiAnswerKeywords,
  InternalAiAnswerHistoryCollection,
  InternalAiAnswerHistoryQuery,
  InternalPersistAiAnswerSnapshotBatchInput,
  InternalResolveAiAnswerKeywordsInput,
  SemanticAiAnswerDetail,
  SemanticAiAnswerHistoryItem
} from "@seo-platform/contracts";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  previousAiAnswerPositionKey,
  previousAiAnswerPositions
} from "./ai-answer-history-projection.js";

const CURSOR_DOMAIN = "seo-platform.ai-answer-history-cursor@1\0";
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

interface AiAnswerHistoryCursor {
  readonly schemaVersion: "ai-answer-history-cursor@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly keywordId: string;
  readonly observedAt: string;
  readonly snapshotId: string;
}

interface CursorEnvelope {
  readonly payload: AiAnswerHistoryCursor;
  readonly mac: string;
}

@Injectable()
export class AiAnswerService {
  private readonly cursorKey: string | undefined;

  public constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig
  ) {
    this.cursorKey = config.rankHistoryCursorKey;
  }

  public async resolveBatch(
    input: InternalResolveAiAnswerKeywordsInput
  ): Promise<InternalAiAnswerKeywords> {
    const keywords = await this.prisma.keyword.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        id: { in: input.items.map(({ id }) => id) }
      },
      select: { id: true, textOriginal: true, version: true }
    });
    if (keywords.length !== input.items.length) {
      throw new NotFoundException("One or more AI answer keywords were not found");
    }
    const byId = new Map(keywords.map((keyword) => [keyword.id, keyword]));
    return {
      items: input.items.map((item) => {
        const keyword = byId.get(item.id);
        if (!keyword) throw new NotFoundException("AI answer keyword was not found");
        if (keyword.version !== item.version) {
          throw new ConflictException("Keyword changed after AI answer collection started");
        }
        return { id: keyword.id, text: keyword.textOriginal, version: keyword.version };
      })
    };
  }

  public async persistBatch(
    input: InternalPersistAiAnswerSnapshotBatchInput
  ): Promise<{ readonly created: number }> {
    return this.prisma.$transaction(async (transaction) => {
      const keywords = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          id: { in: input.items.map(({ keywordId }) => keywordId) }
        },
        select: { id: true, version: true }
      });
      if (keywords.length !== input.items.length) {
        throw new NotFoundException("One or more AI answer keywords were not found");
      }
      const versions = new Map(keywords.map(({ id, version }) => [id, version]));
      if (input.items.some((item) => versions.get(item.keywordId) !== item.keywordVersion)) {
        throw new ConflictException("Keyword changed before AI answer persistence");
      }
      const snapshots = await transaction.aiAnswerSnapshot.createMany({
        data: input.items.map(({ keywordId, snapshot }) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          keywordId,
          searchEngine: input.searchEngine,
          regionCode: input.regionCode,
          device: input.device,
          host: input.host,
          answerPresent: snapshot.answerPresent,
          siteFound: snapshot.siteFound,
          ...(snapshot.position === undefined ? {} : { position: snapshot.position }),
          ...(snapshot.rankingUrl === undefined ? {} : { rankingUrl: snapshot.rankingUrl }),
          brandFound: snapshot.brandFound,
          ...(snapshot.answerMarkdown === undefined ? {} : { answerMarkdown: snapshot.answerMarkdown }),
          provider: input.provider,
          sourceMode: "BYOK",
          jobId: input.jobId,
          observedAt: new Date(input.observedAt)
        })),
        skipDuplicates: true
      });
      const stored = await transaction.aiAnswerSnapshot.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: input.jobId,
          searchEngine: input.searchEngine,
          keywordId: { in: input.items.map(({ keywordId }) => keywordId) }
        },
        select: { id: true, keywordId: true }
      });
      if (stored.length !== input.items.length) {
        throw new Error("AI answer persistence projection is incomplete");
      }
      const snapshotByKeywordId = new Map(stored.map(({ id, keywordId }) => [keywordId, id]));
      await transaction.aiAnswerSource.createMany({
        data: input.items.flatMap(({ keywordId, snapshot }) => {
          const snapshotId = snapshotByKeywordId.get(keywordId);
          if (!snapshotId) throw new Error("AI answer snapshot is missing");
          return snapshot.sources.map((source, index) => ({
            snapshotId,
            position: index + 1,
            ...(source.providerId === undefined ? {} : { providerId: source.providerId }),
            url: source.url,
            ...(source.title === undefined ? {} : { title: source.title }),
            ...(source.description === undefined ? {} : { description: source.description })
          }));
        }),
        skipDuplicates: true
      });
      return { created: snapshots.count };
    });
  }

  public async latest(
    workspaceId: string,
    projectId: string,
    keywordId: string
  ): Promise<readonly SemanticAiAnswerDetail[]> {
    const keyword = await this.prisma.keyword.findFirst({
      where: { id: keywordId, workspaceId, projectId, status: { in: ["ACTIVE", "DELETED"] } },
      select: { id: true }
    });
    if (!keyword) throw new NotFoundException("Keyword not found");
    const snapshots = await this.prisma.aiAnswerSnapshot.findMany({
      where: { workspaceId, projectId, keywordId },
      orderBy: [
        { searchEngine: "asc" },
        { observedAt: "desc" },
        { id: "desc" }
      ],
      distinct: ["searchEngine"],
      include: { sources: { orderBy: { position: "asc" } } }
    });
    const previousPositions = await previousAiAnswerPositions(
      this.prisma,
      workspaceId,
      projectId,
      snapshots.map((snapshot) => ({
        keywordId: snapshot.keywordId,
        searchEngine: snapshot.searchEngine as SemanticAiAnswerDetail["searchEngine"],
        observedAt: snapshot.observedAt,
        snapshotId: snapshot.id
      }))
    );
    return snapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      keywordId: snapshot.keywordId,
      searchEngine: snapshot.searchEngine as SemanticAiAnswerDetail["searchEngine"],
      regionCode: snapshot.regionCode,
      device: snapshot.device as SemanticAiAnswerDetail["device"],
      answerPresent: snapshot.answerPresent,
      siteFound: snapshot.siteFound,
      ...(snapshot.position === null ? {} : { position: snapshot.position }),
      ...optionalPreviousPosition(
        previousPositions,
        snapshot.keywordId,
        snapshot.searchEngine as SemanticAiAnswerDetail["searchEngine"],
        snapshot.observedAt,
        snapshot.id
      ),
      ...(snapshot.rankingUrl === null ? {} : { rankingUrl: snapshot.rankingUrl }),
      brandFound: snapshot.brandFound,
      ...(snapshot.answerMarkdown === null ? {} : { answerMarkdown: snapshot.answerMarkdown }),
      sources: snapshot.sources.map((source) => ({
        position: source.position,
        ...(source.providerId === null ? {} : { providerId: source.providerId }),
        url: source.url,
        ...(source.title === null ? {} : { title: source.title }),
        ...(source.description === null ? {} : { description: source.description }),
        belongsToProject: urlBelongsToHost(source.url, snapshot.host)
      })),
      provider: "ARSENKIN",
      host: snapshot.host,
      jobId: snapshot.jobId,
      observedAt: snapshot.observedAt.toISOString()
    }));
  }

  public async history(
    input: InternalAiAnswerHistoryQuery
  ): Promise<InternalAiAnswerHistoryCollection> {
    const cursor = input.cursor ? this.decodeCursor(input.cursor, input) : undefined;
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        id: input.keywordId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: { in: ["ACTIVE", "DELETED"] }
      },
      select: { id: true }
    });
    if (!keyword) throw new NotFoundException("Keyword not found");
    const rows = await this.prisma.aiAnswerSnapshot.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        keywordId: input.keywordId,
        sourceMode: "BYOK",
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
      take: input.limit + 1,
      select: {
        id: true,
        keywordId: true,
        searchEngine: true,
        regionCode: true,
        device: true,
        answerPresent: true,
        siteFound: true,
        position: true,
        rankingUrl: true,
        brandFound: true,
        provider: true,
        sourceMode: true,
        observedAt: true
      }
    });
    const hasNext = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const previousPositions = await previousAiAnswerPositions(
      this.prisma,
      input.workspaceId,
      input.projectId,
      pageRows.map((row) => ({
        keywordId: row.keywordId,
        searchEngine: storedSearchEngine(row.searchEngine),
        observedAt: row.observedAt,
        snapshotId: row.id
      }))
    );
    const last = pageRows.at(-1);
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      keywordId: input.keywordId,
      items: pageRows.map((row) => {
        if (row.provider !== "ARSENKIN" || row.sourceMode !== "BYOK") {
          throw new Error("Stored AI answer history row is invalid");
        }
        const searchEngine = storedSearchEngine(row.searchEngine);
        return aiAnswerHistoryItem(
          row,
          searchEngine,
          previousPositions.get(
            previousAiAnswerPositionKey(
              row.keywordId,
              searchEngine,
              row.observedAt,
              row.id
            )
          )
        );
      }),
      page: {
        hasNext,
        ...(hasNext && last
          ? {
              nextCursor: this.encodeCursor({
                schemaVersion: "ai-answer-history-cursor@1",
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                keywordId: input.keywordId,
                observedAt: last.observedAt.toISOString(),
                snapshotId: last.id
              })
            }
          : {})
      }
    };
  }

  private encodeCursor(payload: AiAnswerHistoryCursor): string {
    const envelope: CursorEnvelope = {
      payload,
      mac: cursorMac(this.requiredCursorKey(), payload)
    };
    return Buffer.from(canonicalizeJson(envelope), "utf8").toString("base64url");
  }

  private decodeCursor(
    encoded: string,
    input: InternalAiAnswerHistoryQuery
  ): AiAnswerHistoryCursor {
    let value: unknown;
    try {
      const decoded = Buffer.from(encoded, "base64url");
      if (decoded.toString("base64url") !== encoded) invalidCursor();
      value = JSON.parse(decoded.toString("utf8"));
    } catch {
      invalidCursor();
    }
    const envelope = strictRecord(value, ["payload", "mac"]);
    const payload = strictRecord(envelope.payload, [
      "schemaVersion",
      "workspaceId",
      "projectId",
      "keywordId",
      "observedAt",
      "snapshotId"
    ]);
    const cursor: AiAnswerHistoryCursor = {
      schemaVersion: payload.schemaVersion === "ai-answer-history-cursor@1"
        ? payload.schemaVersion
        : invalidCursor(),
      workspaceId: uuidV7(payload.workspaceId),
      projectId: uuidV7(payload.projectId),
      keywordId: uuidV7(payload.keywordId),
      observedAt: isoInstant(payload.observedAt),
      snapshotId: uuidV7(payload.snapshotId)
    };
    if (
      typeof envelope.mac !== "string" ||
      !HASH_PATTERN.test(envelope.mac) ||
      cursor.workspaceId !== input.workspaceId ||
      cursor.projectId !== input.projectId ||
      cursor.keywordId !== input.keywordId
    ) {
      invalidCursor();
    }
    const expected = Buffer.from(cursorMac(this.requiredCursorKey(), cursor), "hex");
    const actual = Buffer.from(envelope.mac, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      invalidCursor();
    }
    return cursor;
  }

  private requiredCursorKey(): string {
    if (!this.cursorKey) {
      throw new ServiceUnavailableException(
        "AI answer history cursor authentication is not configured"
      );
    }
    return this.cursorKey;
  }
}

function optionalPreviousPosition(
  values: ReadonlyMap<string, number>,
  keywordId: string,
  searchEngine: SemanticAiAnswerDetail["searchEngine"],
  observedAt: Date,
  snapshotId: string
): Readonly<{ previousPosition?: number }> {
  const previousPosition = values.get(
    previousAiAnswerPositionKey(keywordId, searchEngine, observedAt, snapshotId)
  );
  return previousPosition === undefined ? {} : { previousPosition };
}

function aiAnswerHistoryItem(
  row: Readonly<{
    id: string;
    keywordId: string;
    regionCode: string;
    device: string;
    answerPresent: boolean;
    siteFound: boolean;
    position: number | null;
    rankingUrl: string | null;
    brandFound: boolean;
    observedAt: Date;
  }>,
  searchEngine: SemanticAiAnswerHistoryItem["searchEngine"],
  previousPosition: number | undefined
): SemanticAiAnswerHistoryItem {
  if (
    !UUID_V7_PATTERN.test(row.id) ||
    !UUID_V7_PATTERN.test(row.keywordId) ||
    !(row.observedAt instanceof Date) ||
    Number.isNaN(row.observedAt.getTime()) ||
    (row.siteFound !== (row.position !== null && row.rankingUrl !== null)) ||
    (!row.answerPresent && (row.siteFound || row.brandFound))
  ) {
    throw new Error("Stored AI answer history row is invalid");
  }
  return {
    snapshotId: row.id,
    keywordId: row.keywordId,
    searchEngine,
    regionCode: row.regionCode,
    device: storedDevice(row.device),
    answerPresent: row.answerPresent,
    siteFound: row.siteFound,
    ...(row.position === null ? {} : { position: row.position }),
    ...(previousPosition === undefined ? {} : { previousPosition }),
    ...(row.rankingUrl === null ? {} : { rankingUrl: row.rankingUrl }),
    brandFound: row.brandFound,
    provider: "ARSENKIN",
    observedAt: row.observedAt.toISOString()
  };
}

function storedSearchEngine(value: string): SemanticAiAnswerHistoryItem["searchEngine"] {
  if (value !== "YANDEX" && value !== "GOOGLE") {
    throw new Error("Stored AI answer search engine is invalid");
  }
  return value;
}

function storedDevice(value: string): SemanticAiAnswerHistoryItem["device"] {
  if (value !== "DESKTOP" && value !== "MOBILE") {
    throw new Error("Stored AI answer device is invalid");
  }
  return value;
}

function cursorMac(key: string, payload: AiAnswerHistoryCursor): string {
  return createHmac("sha256", key)
    .update(CURSOR_DOMAIN)
    .update(canonicalizeJson(payload))
    .digest("hex");
}

function strictRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
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

function uuidV7(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) invalidCursor();
  return value;
}

function isoInstant(value: unknown): string {
  if (typeof value !== "string" || value.length !== 24) invalidCursor();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) invalidCursor();
  return value;
}

function invalidCursor(): never {
  throw new BadRequestException("Invalid AI answer history cursor");
}

function urlBelongsToHost(value: string, host: string): boolean {
  try {
    const candidate = new URL(value).hostname.toLocaleLowerCase("en-US").replace(/^www\./u, "");
    return candidate === host || candidate.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

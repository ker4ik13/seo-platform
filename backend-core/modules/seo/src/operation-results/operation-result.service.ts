import { Injectable, NotFoundException } from "@nestjs/common";
import {
  arsenkinWordstatKeywordLimit,
  normalizedRankDataQualityFlags,
  semanticFrequencyTypes,
  semanticFrequencyQualityFlags,
  type CrawlOperationIssue,
  type CrawlOperationResultRow,
  type InternalCrawlOperationResultPage,
  type InternalFrequencyOperationResult,
  type InternalFrequencyOperationResultInput,
  type InternalRankExecutionParameters,
  type InternalRankOperationResult,
  type NormalizedRankDataQualityFlag,
  type RankOperationResultRow,
  type SemanticFrequencyQualityFlag
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { InternalCommandContext } from "../internal/internal-command-context.js";

const frequencySelect = {
  keywordId: true,
  type: true,
  regionCode: true,
  device: true,
  period: true,
  value: true,
  provider: true,
  sourceMode: true,
  jobId: true,
  qualityFlags: true,
  observedAt: true
} as const satisfies Prisma.FrequencySnapshotSelect;

const crawlSelect = {
  sequence: true,
  requestedUrl: true,
  finalUrl: true,
  redirectChain: true,
  statusCode: true,
  responseTimeMs: true,
  sizeBytes: true,
  contentType: true,
  title: true,
  h1: true,
  canonicalUrl: true,
  indexability: true,
  inSitemap: true,
  depth: true,
  wordCount: true,
  internalLinks: true,
  externalLinks: true,
  crawledAt: true,
  issueOccurrences: {
    orderBy: [{ severity: "desc" }, { code: "asc" }],
    select: { code: true, severity: true, title: true }
  }
} as const satisfies Prisma.CrawlPageSnapshotSelect;

@Injectable()
export class OperationResultService {
  public constructor(private readonly prisma: PrismaService) {}

  public async frequency(
    input: InternalFrequencyOperationResultInput
  ): Promise<InternalFrequencyOperationResult> {
    const [keywords, snapshots] = await Promise.all([
      this.prisma.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          id: { in: [...input.keywordIds] }
        },
        select: { id: true, textOriginal: true }
      }),
      this.prisma.frequencySnapshot.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: input.jobId,
          keywordId: { in: [...input.keywordIds] }
        },
        orderBy: [
          { keywordId: "asc" },
          { observedAt: "desc" },
          { id: "desc" }
        ],
        take:
          arsenkinWordstatKeywordLimit * semanticFrequencyTypes.length + 1,
        select: frequencySelect
      })
    ]);
    if (
      snapshots.length >
      arsenkinWordstatKeywordLimit * semanticFrequencyTypes.length
    ) invalidStored("frequency result is oversized");
    const keywordById = new Map(keywords.map((row) => [row.id, row.textOriginal]));
    const snapshotsById = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) {
      const current = snapshotsById.get(snapshot.keywordId) ?? [];
      current.push(snapshot);
      snapshotsById.set(snapshot.keywordId, current);
    }
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId: input.jobId,
      rows: input.keywordIds.map((keywordId) => {
        const keyword = keywordById.get(keywordId);
        if (keyword === undefined) {
          throw new NotFoundException("Frequency result keyword not found");
        }
        return {
          keywordId,
          keyword,
          snapshots: (snapshotsById.get(keywordId) ?? []).map((snapshot) => ({
            type: frequencyType(snapshot.type),
            regionCode: snapshot.regionCode,
            device: frequencyDevice(snapshot.device),
            ...(snapshot.period === null ? {} : { period: snapshot.period }),
            ...(snapshot.value === null ? {} : { value: snapshot.value.toString() }),
            provider: snapshot.provider,
            sourceMode: frequencySourceMode(snapshot.sourceMode),
            jobId: snapshot.jobId,
            qualityFlags: frequencyQualityFlags(snapshot.qualityFlags),
            observedAt: snapshot.observedAt.toISOString()
          }))
        };
      })
    };
  }

  public async rank(
    context: InternalCommandContext,
    jobId: string
  ): Promise<InternalRankOperationResult> {
    const manifest = await this.prisma.rankExecutionManifest.findFirst({
      where: {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        jobId
      },
      select: {
        trackingContextId: true,
        execution: true,
        context: { select: { name: true } },
        chunks: {
          orderBy: { chunkIndex: "asc" },
          select: {
            entries: {
              orderBy: { sequence: "asc" },
              select: {
                sequence: true,
                keywordId: true,
                keyword: { select: { textOriginal: true } },
                rankSnapshot: {
                  select: {
                    found: true,
                    position: true,
                    absolutePosition: true,
                    pixelPosition: true,
                    rankingUrl: true,
                    title: true,
                    snippet: true,
                    observedAt: true,
                    dataQualityFlags: true
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!manifest) throw new NotFoundException("Rank operation result not found");
    const rows = manifest.chunks.flatMap(({ entries }) => entries);
    if (rows.length > 1_000) invalidStored("rank result is oversized");
    return {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      jobId,
      trackingContextId: manifest.trackingContextId,
      contextName: manifest.context.name,
      execution: rankExecution(manifest.execution),
      rows: rows.map(rankRow)
    };
  }

  public async crawl(
    context: InternalCommandContext,
    crawlId: string,
    limit: number,
    cursor?: number
  ): Promise<InternalCrawlOperationResultPage> {
    const rows = await this.prisma.crawlPageSnapshot.findMany({
      where: {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        crawlId,
        ...(cursor === undefined ? {} : { sequence: { gt: cursor } })
      },
      orderBy: { sequence: "asc" },
      take: limit + 1,
      select: crawlSelect
    });
    const pageRows = rows.slice(0, limit);
    const hasNext = rows.length > limit;
    const last = pageRows.at(-1);
    return {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      crawlId,
      rows: pageRows.map(crawlRow),
      page: {
        hasNext,
        ...(hasNext && last ? { nextCursor: String(last.sequence) } : {})
      }
    };
  }
}

function rankRow(
  row: Readonly<{
    sequence: number;
    keywordId: string;
    keyword: { readonly textOriginal: string };
    rankSnapshot: {
      readonly found: boolean;
      readonly position: number | null;
      readonly absolutePosition: number | null;
      readonly pixelPosition: number | null;
      readonly rankingUrl: string | null;
      readonly title: string | null;
      readonly snippet: string | null;
      readonly observedAt: Date;
      readonly dataQualityFlags: Prisma.JsonValue;
    } | null;
  }>
): RankOperationResultRow {
  const snapshot = row.rankSnapshot;
  if (!snapshot) {
    return {
      sequence: row.sequence,
      keywordId: row.keywordId,
      keyword: row.keyword.textOriginal,
      state: "PENDING",
      dataQualityFlags: []
    };
  }
  if (!snapshot.found) {
    return {
      sequence: row.sequence,
      keywordId: row.keywordId,
      keyword: row.keyword.textOriginal,
      state: "NOT_FOUND",
      observedAt: snapshot.observedAt.toISOString(),
      dataQualityFlags: rankQualityFlags(snapshot.dataQualityFlags)
    };
  }
  if (snapshot.position === null || snapshot.rankingUrl === null) {
    invalidStored("found rank result is incomplete");
  }
  return {
    sequence: row.sequence,
    keywordId: row.keywordId,
    keyword: row.keyword.textOriginal,
    state: "FOUND",
    position: snapshot.position,
    ...(snapshot.absolutePosition === null
      ? {}
      : { absolutePosition: snapshot.absolutePosition }),
    ...(snapshot.pixelPosition === null
      ? {}
      : { pixelPosition: snapshot.pixelPosition }),
    rankingUrl: snapshot.rankingUrl,
    ...(snapshot.title === null ? {} : { title: snapshot.title }),
    ...(snapshot.snippet === null ? {} : { snippet: snapshot.snippet }),
    observedAt: snapshot.observedAt.toISOString(),
    dataQualityFlags: rankQualityFlags(snapshot.dataQualityFlags)
  };
}

function crawlRow(
  row: Prisma.CrawlPageSnapshotGetPayload<{ select: typeof crawlSelect }>
): CrawlOperationResultRow {
  return {
    sequence: row.sequence,
    requestedUrl: row.requestedUrl,
    finalUrl: row.finalUrl,
    redirectChain: storedStringArray(row.redirectChain),
    statusCode: row.statusCode,
    responseTimeMs: row.responseTimeMs,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.h1 === null ? {} : { h1: row.h1 }),
    ...(row.canonicalUrl === null ? {} : { canonicalUrl: row.canonicalUrl }),
    indexability: row.indexability,
    inSitemap: row.inSitemap,
    depth: row.depth,
    wordCount: row.wordCount,
    internalLinkCount: storedStringArray(row.internalLinks).length,
    externalLinkCount: storedStringArray(row.externalLinks).length,
    issues: row.issueOccurrences.map(
      (issue): CrawlOperationIssue => ({
        code: issue.code,
        severity: issue.severity,
        title: issue.title
      })
    ),
    crawledAt: row.crawledAt.toISOString()
  };
}

function rankExecution(value: Prisma.JsonValue): InternalRankExecutionParameters {
  const input = storedRecord(value);
  const rule = storedRecord(input.domainMatchRule);
  const mode = rule.mode;
  if (
    (input.searchEngine !== "GOOGLE" && input.searchEngine !== "YANDEX") ||
    typeof input.countryCode !== "string" ||
    typeof input.language !== "string" ||
    (input.regionCode !== undefined && typeof input.regionCode !== "string") ||
    (input.device !== "DESKTOP" && input.device !== "MOBILE") ||
    (input.depth !== 30 && input.depth !== 50 && input.depth !== 100) ||
    typeof input.safeSearch !== "boolean" ||
    input.format !== "SIMPLE" ||
    input.rawSerp !== false ||
    input.fallbackMode !== "NONE" ||
    typeof input.providerMappingVersion !== "string" ||
    typeof mode !== "string" ||
    ![
      "EXACT_HOST",
      "INCLUDE_WWW",
      "INCLUDE_SUBDOMAINS",
      "CANONICAL_DOMAIN",
      "ANY_PROJECT_MIRROR",
      "SPECIFIC_URL",
      "URL_PREFIX"
    ].includes(mode) ||
    ((mode === "SPECIFIC_URL" || mode === "URL_PREFIX") &&
      typeof rule.value !== "string")
  ) {
    invalidStored("rank execution is invalid");
  }
  return {
    searchEngine: input.searchEngine,
    countryCode: input.countryCode,
    ...(typeof input.regionCode === "string"
      ? { regionCode: input.regionCode }
      : {}),
    language: input.language,
    device: input.device,
    depth: input.depth,
    domainMatchRule:
      mode === "SPECIFIC_URL" || mode === "URL_PREFIX"
        ? { mode, value: rule.value as string }
        : {
            mode: mode as Exclude<
              InternalRankExecutionParameters["domainMatchRule"]["mode"],
              "SPECIFIC_URL" | "URL_PREFIX"
            >
          },
    safeSearch: input.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: input.providerMappingVersion
  };
}

function frequencyType(value: string): "BASE" | "EXACT" | "FIXED" {
  if (value !== "BASE" && value !== "EXACT" && value !== "FIXED") {
    invalidStored("frequency type is invalid");
  }
  return value;
}

function frequencyDevice(
  value: string
): "ALL" | "DESKTOP" | "MOBILE" | "PHONE_ONLY" | "TABLET_ONLY" {
  if (!['ALL', 'DESKTOP', 'MOBILE', 'PHONE_ONLY', 'TABLET_ONLY'].includes(value)) {
    invalidStored("frequency device is invalid");
  }
  return value as "ALL" | "DESKTOP" | "MOBILE" | "PHONE_ONLY" | "TABLET_ONLY";
}

function frequencySourceMode(
  value: string
): "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL" {
  if (!['BYOK', 'PLATFORM', 'IMPORT', 'MANUAL'].includes(value)) {
    invalidStored("frequency source mode is invalid");
  }
  return value as "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL";
}

function frequencyQualityFlags(value: Prisma.JsonValue): readonly SemanticFrequencyQualityFlag[] {
  return storedFlags(value, semanticFrequencyQualityFlags);
}

function rankQualityFlags(value: Prisma.JsonValue): readonly NormalizedRankDataQualityFlag[] {
  return storedFlags(value, normalizedRankDataQualityFlags);
}

function storedFlags<const Values extends readonly string[]>(
  value: Prisma.JsonValue,
  allowed: Values
): readonly Values[number][] {
  if (!Array.isArray(value) || value.length > allowed.length) {
    invalidStored("stored quality flags are invalid");
  }
  const result = value.map((flag) => {
    if (typeof flag !== "string" || !allowed.includes(flag)) {
      invalidStored("stored quality flag is invalid");
    }
    return flag as Values[number];
  });
  if (new Set(result).size !== result.length) {
    invalidStored("duplicate stored quality flag");
  }
  return result;
}

function storedStringArray(value: Prisma.JsonValue): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    invalidStored("stored URL list is invalid");
  }
  return value;
}

function storedRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidStored("stored object is invalid");
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalidStored(reason: string): never {
  throw new Error(`Stored operation result ${reason}`);
}

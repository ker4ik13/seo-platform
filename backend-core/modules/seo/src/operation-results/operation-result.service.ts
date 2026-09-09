import { Injectable, NotFoundException } from "@nestjs/common";
import {
  frequencySeasonalityPointLimit,
  normalizedRankDataQualityFlags,
  rankExecutionPurpose,
  semanticFrequencyTypes,
  semanticFrequencyQualityFlags,
  type AiAnswerOperationSourceSummary,
  type CrawlOperationIssue,
  type CrawlOperationResultRow,
  type InternalAiAnswerOperationResult,
  type InternalAiAnswerOperationResultInput,
  type InternalCrawlOperationResultPage,
  type InternalFrequencyOperationResult,
  type InternalFrequencyOperationResultInput,
  type InternalRankExecutionParameters,
  type InternalRankOperationResult,
  type NormalizedRankDataQualityFlag,
  type RankOperationSerpResult,
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

const rankEntrySelect = {
  sequence: true,
  keywordId: true,
  keyword: { select: { textOriginal: true, version: true, status: true } },
  rankSnapshot: {
    select: {
      id: true,
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
} as const satisfies Prisma.RankExecutionManifestEntrySelect;

@Injectable()
export class OperationResultService {
  public constructor(private readonly prisma: PrismaService) {}

  public async frequency(
    input: InternalFrequencyOperationResultInput
  ): Promise<InternalFrequencyOperationResult> {
    const [keywords, snapshots, seasonalityPoints] = await Promise.all([
      this.prisma.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          id: { in: [...input.keywordIds] }
        },
        select: { id: true, textOriginal: true, version: true, status: true }
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
          input.keywordIds.length * semanticFrequencyTypes.length + 1,
        select: frequencySelect
      }),
      this.prisma.frequencySeasonalityPoint.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: input.jobId,
          keywordId: { in: [...input.keywordIds] }
        },
        orderBy: [
          { keywordId: "asc" },
          { periodStart: "asc" },
          { id: "asc" }
        ],
        take: input.keywordIds.length * frequencySeasonalityPointLimit + 1
      })
    ]);
    if (
      snapshots.length >
      input.keywordIds.length * semanticFrequencyTypes.length
    ) invalidStored("frequency result is oversized");
    if (
      seasonalityPoints.length >
      input.keywordIds.length * frequencySeasonalityPointLimit
    ) {
      invalidStored("seasonality result is oversized");
    }
    const keywordById = new Map(keywords.map((row) => [row.id, row]));
    const snapshotsById = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) {
      const current = snapshotsById.get(snapshot.keywordId) ?? [];
      current.push(snapshot);
      snapshotsById.set(snapshot.keywordId, current);
    }
    const seasonalityById = new Map<string, typeof seasonalityPoints>();
    for (const point of seasonalityPoints) {
      const current = seasonalityById.get(point.keywordId) ?? [];
      current.push(point);
      seasonalityById.set(point.keywordId, current);
    }
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId: input.jobId,
      rows: input.keywordIds.map((keywordId) => {
        const keyword = keywordById.get(keywordId);
        return {
          keywordId,
          keyword: keyword?.textOriginal ?? "",
          keywordAvailable: keyword !== undefined,
          ...(keyword?.status === "ACTIVE" ? { keywordVersion: keyword.version } : {}),
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
          })),
          seasonality: (seasonalityById.get(keywordId) ?? []).map((point) => ({
            type: frequencyType(point.type),
            granularity: seasonalityGranularity(point.granularity),
            periodStart: point.periodStart.toISOString().slice(0, 10),
            value: point.value.toString(),
            // Keep DECIMAL(24, 18) in the plain-string format required by the
            // internal/public contract; Decimal.toString() uses an exponent
            // for the small shares commonly returned by XMLStock.
            ...(point.share === null ? {} : { share: point.share.toFixed() }),
            regionCode: point.regionCode,
            device: frequencyDevice(point.device),
            provider: seasonalityProvider(point.provider),
            sourceMode: seasonalitySourceMode(point.sourceMode),
            jobId: point.jobId,
            observedAt: point.observedAt.toISOString()
          }))
        };
      })
    };
  }

  public async aiAnswer(
    input: InternalAiAnswerOperationResultInput
  ): Promise<InternalAiAnswerOperationResult> {
    const [keywords, snapshots] = await Promise.all([
      this.prisma.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          id: { in: [...input.keywordIds] }
        },
        select: { id: true, textOriginal: true }
      }),
      this.prisma.aiAnswerSnapshot.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: input.jobId,
          keywordId: { in: [...input.keywordIds] }
        },
        select: {
          id: true,
          keywordId: true,
          answerPresent: true,
          siteFound: true,
          position: true,
          rankingUrl: true,
          brandFound: true,
          observedAt: true,
          _count: { select: { sources: true } }
        }
      })
    ]);
    if (snapshots.length > input.keywordIds.length) {
      invalidStored("AI answer result is oversized");
    }
    const sources = input.includeSources && snapshots.length > 0
      ? await this.prisma.aiAnswerSource.findMany({
          where: {
            snapshotId: { in: snapshots.map(({ id }) => id) },
            snapshot: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              jobId: input.jobId
            }
          },
          orderBy: [{ snapshotId: "asc" }, { position: "asc" }],
          select: {
            snapshotId: true,
            position: true,
            url: true,
            title: true,
            description: true
          }
        })
      : [];
    if (sources.length > snapshots.length * 100) {
      invalidStored("AI answer sources are oversized");
    }
    const sourcesBySnapshotId = new Map<string, AiAnswerOperationSourceSummary[]>();
    for (const source of sources) {
      const current = sourcesBySnapshotId.get(source.snapshotId) ?? [];
      current.push({
        position: source.position,
        url: source.url,
        ...(source.title === null ? {} : { title: source.title }),
        ...(source.description === null
          ? {}
          : { description: source.description })
      });
      sourcesBySnapshotId.set(source.snapshotId, current);
    }
    const keywordById = new Map(keywords.map((row) => [row.id, row.textOriginal]));
    const snapshotById = new Map(snapshots.map((row) => [row.keywordId, row]));
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId: input.jobId,
      rows: input.keywordIds.map((keywordId) => {
        const keyword = keywordById.get(keywordId);
        if (keyword === undefined) {
          throw new NotFoundException("AI answer result keyword not found");
        }
        const snapshot = snapshotById.get(keywordId);
        return {
          keywordId,
          keyword,
          ...(snapshot
            ? {
                snapshot: {
                  answerPresent: snapshot.answerPresent,
                  siteFound: snapshot.siteFound,
                  ...(snapshot.position === null ? {} : { position: snapshot.position }),
                  ...(snapshot.rankingUrl === null ? {} : { rankingUrl: snapshot.rankingUrl }),
                  brandFound: snapshot.brandFound,
                  sourceCount: snapshot._count.sources,
                  ...(input.includeSources
                    ? {
                        sources:
                          sourcesBySnapshotId.get(snapshot.id) ?? []
                      }
                    : {}),
                  observedAt: snapshot.observedAt.toISOString()
                }
              }
            : {})
        };
      })
    };
  }

  public async rank(
    context: InternalCommandContext,
    jobId: string,
    limit: number,
    cursor?: number
  ): Promise<InternalRankOperationResult> {
    const manifest = await this.prisma.rankExecutionManifest.findFirst({
      where: {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        jobId
      },
      select: {
        id: true,
        trackingContextId: true,
        execution: true,
        context: { select: { name: true } }
      }
    });
    if (!manifest) throw new NotFoundException("Rank operation result not found");
    const [rows, resultCounts] = await Promise.all([
      this.prisma.rankExecutionManifestEntry.findMany({
        where: {
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          manifestId: manifest.id,
          ...(cursor === undefined ? {} : { sequence: { gt: cursor } })
        },
        orderBy: { sequence: "asc" },
        take: limit + 1,
        select: rankEntrySelect
      }),
      this.prisma.rankSnapshot.groupBy({
        by: ["found"],
        where: {
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          jobId
        },
        _count: { _all: true }
      })
    ]);
    const pageRows = rows.slice(0, limit);
    const hasNext = rows.length > limit;
    const last = pageRows.at(-1);
    const execution = rankExecution(manifest.execution);
    const competitorCollection =
      rankExecutionPurpose(execution) === "COMPETITOR_SERP";
    const snapshotIds = competitorCollection
      ? pageRows.flatMap(({ rankSnapshot }) =>
          rankSnapshot ? [rankSnapshot.id] : []
        )
      : [];
    const serpResults = snapshotIds.length > 0
      ? await this.prisma.rankSerpResult.findMany({
          where: {
            snapshotId: { in: snapshotIds },
            position: { lte: execution.depth },
            snapshot: {
              workspaceId: context.workspaceId,
              projectId: context.projectId,
              jobId
            }
          },
          orderBy: [{ snapshotId: "asc" }, { position: "asc" }],
          select: {
            snapshotId: true,
            position: true,
            rankingUrl: true,
            faviconUrl: true,
            title: true,
            snippet: true
          }
        })
      : [];
    if (
      serpResults.length >
      snapshotIds.length * execution.depth
    ) {
      invalidStored("competitor SERP result is oversized");
    }
    const serpResultsBySnapshotId = new Map<string, RankOperationSerpResult[]>();
    for (const result of serpResults) {
      const current = serpResultsBySnapshotId.get(result.snapshotId) ?? [];
      current.push({
        position: result.position,
        rankingUrl: result.rankingUrl,
        ...(result.faviconUrl === null
          ? {}
          : { faviconUrl: result.faviconUrl }),
        ...(result.title === null ? {} : { title: result.title }),
        ...(result.snippet === null ? {} : { snippet: result.snippet })
      });
      serpResultsBySnapshotId.set(result.snapshotId, current);
    }
    return {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      jobId,
      trackingContextId: manifest.trackingContextId,
      contextName: manifest.context.name,
      execution,
      counts: {
        foundCount:
          resultCounts.find(({ found }) => found)?._count._all ?? 0,
        notFoundCount:
          resultCounts.find(({ found }) => !found)?._count._all ?? 0
      },
      rows: pageRows.map((row) =>
        rankRow(row, competitorCollection, serpResultsBySnapshotId)
      ),
      page: {
        hasNext,
        ...(hasNext && last ? { nextCursor: String(last.sequence) } : {})
      }
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
  row: Prisma.RankExecutionManifestEntryGetPayload<{
    select: typeof rankEntrySelect;
  }>,
  competitorCollection: boolean,
  serpResultsBySnapshotId: ReadonlyMap<
    string,
    readonly RankOperationSerpResult[]
  >
): RankOperationResultRow {
  const snapshot = row.rankSnapshot;
  const editableKeyword = row.keyword.status === "ACTIVE"
    ? { keywordVersion: row.keyword.version, keywordAvailable: true }
    : { keywordAvailable: false };
  if (!snapshot) {
    return {
      ...editableKeyword,
      sequence: row.sequence,
      keywordId: row.keywordId,
      keyword: row.keyword.textOriginal,
      state: "PENDING",
      ...(competitorCollection ? { serpResults: [] } : {}),
      dataQualityFlags: []
    };
  }
  if (!snapshot.found) {
    return {
      ...editableKeyword,
      sequence: row.sequence,
      keywordId: row.keywordId,
      keyword: row.keyword.textOriginal,
      state: "NOT_FOUND",
      observedAt: snapshot.observedAt.toISOString(),
      ...(competitorCollection
        ? { serpResults: serpResultsBySnapshotId.get(snapshot.id) ?? [] }
        : {}),
      dataQualityFlags: rankQualityFlags(snapshot.dataQualityFlags)
    };
  }
  if (snapshot.position === null || snapshot.rankingUrl === null) {
    invalidStored("found rank result is incomplete");
  }
  return {
    ...editableKeyword,
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
    ...(competitorCollection
      ? { serpResults: serpResultsBySnapshotId.get(snapshot.id) ?? [] }
      : {}),
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
  const purpose = input.purpose;
  const saveProjectPosition = input.saveProjectPosition;
  if (
    (purpose !== undefined &&
      purpose !== "POSITION_TRACKING" &&
      purpose !== "COMPETITOR_SERP") ||
    (saveProjectPosition !== undefined &&
      typeof saveProjectPosition !== "boolean") ||
    (input.searchEngine !== "GOOGLE" && input.searchEngine !== "YANDEX") ||
    typeof input.countryCode !== "string" ||
    typeof input.language !== "string" ||
    (input.regionCode !== undefined && typeof input.regionCode !== "string") ||
    (input.device !== "DESKTOP" && input.device !== "MOBILE") ||
    ![10, 20, 30, 50, 100].includes(Number(input.depth)) ||
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
    ...(purpose === undefined ? {} : { purpose }),
    ...(saveProjectPosition === undefined ? {} : { saveProjectPosition }),
    searchEngine: input.searchEngine,
    countryCode: input.countryCode,
    ...(typeof input.regionCode === "string"
      ? { regionCode: input.regionCode }
      : {}),
    language: input.language,
    device: input.device,
    depth: Number(input.depth) as InternalRankExecutionParameters["depth"],
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

function seasonalityGranularity(value: string): "MONTH" | "WEEK" | "DAY" {
  if (value === "MONTH" || value === "WEEK" || value === "DAY") return value;
  invalidStored("seasonality granularity is invalid");
}

function seasonalityProvider(value: string): "XMLSTOCK" | "ARSENKIN" {
  if (value === "XMLSTOCK" || value === "ARSENKIN") return value;
  invalidStored("seasonality provider is invalid");
}

function seasonalitySourceMode(value: string): "BYOK" | "PLATFORM" {
  if (value === "BYOK" || value === "PLATFORM") return value;
  invalidStored("seasonality source mode is invalid");
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

import { rankDimensionMetadata } from "../rank-results/rank-dimension.js";
import {
  rankDimensionConfigurationPredicate,
  rankDimensionConfigurationWhereAny,
  rankDimensionSources,
  resolvedRankDimensionMergeTargets
} from "../rank-results/rank-dimension-merge.js";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional
} from "@nestjs/common";
import {
  projectPositionHistoryMaxPoints,
  parseSemanticRankColumnKey,
  parseSemanticRankDimensionKey,
  semanticRankDimensionKey,
  semanticKeywordBulkCreatePreviewMaxGroups,
  semanticOperationScopePageSize,
  type ApiCollectionResponse,
  type InternalCreateSemanticKeywordInput,
  type InternalDeleteSemanticKeywordInput,
  type InternalSemanticKeywordBulkCreateInput,
  type InternalSemanticKeywordBulkCreatePreviewInput,
  type InternalSemanticKeywordBulkInput,
  type InternalSemanticKeywordCleaningInput,
  type InternalSemanticKeywordMergeInput,
  type InternalUpdateSemanticKeywordInput,
  type KeywordListQuery,
  type ProjectPositionHistory,
  type ProjectPositionHistoryPoint,
  type ProjectPositionHistoryQuery,
  type ProjectPositionSummary,
  type ProjectPositionTopCounts,
  type SemanticKeywordBulkResult,
  type SemanticKeywordBulkCreateResult,
  type SemanticKeywordBulkCreatePreviewResult,
  type SemanticKeywordCreateOutcome,
  type SemanticKeywordCleaningPreview,
  type SemanticKeywordCleaningPreviewChange,
  type SemanticKeywordCleaningResult,
  type SemanticKeywordMergeResult,
  type SemanticKeywordMergeSuggestion,
  type SemanticOperationScopeKeyword,
  type SemanticOperationScopePageInput,
  type SemanticKeywordTagDeleteResult,
  type SemanticKeywordTagOption,
  type SemanticKeywordIntent,
  type SemanticKeywordPositionHistoryProvider,
  type SemanticKeywordListItem,
  type SemanticKeywordListFrequencyValue,
  type SemanticKeywordListPosition,
  type SemanticKeywordInsights,
  type SemanticRankDimension,
  type SemanticRankComparisonItem,
  type SemanticKeywordSort,
  type SemanticFrequencyDevice,
  type FrequencyCollectionProvider,
  type FrequencySeasonalityGranularity,
  type SemanticFrequencyQualityFlag,
  type SemanticFrequencyType,
  type SemanticAiAnswerSummary,
  type SemanticAiAnswerHistoryItem
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertStoredKeywordCapacity,
  lockStoredKeywordCapacity
} from "../internal/semantic-capacity.js";
import {
  lockSemanticKeywordWrites,
  SemanticVersionService,
  type SemanticKeywordVersionState,
  type SemanticVersionIdentity
} from "../semantic-versions/semantic-version.service.js";
import { normalizeKeywordText } from "./keyword-normalization.js";
import { cleanKeywordText } from "./keyword-cleaning.js";
import { KeywordRankComparisonService } from "./keyword-rank-comparison.service.js";
import { normalizePageUrl } from "../pages/page-url.js";
import { ensureKeywordSystemGroupIds } from "../keyword-groups/semantic-system-groups.js";
import {
  projectSiteResults,
  rankHistorySearchSource
} from "../rank-results/rank-serp-projection.js";
import {
  previousAiAnswerPositionKey,
  previousAiAnswerPositions
} from "../ai-answers/ai-answer-history-projection.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface KeywordCursor {
  readonly version: 2;
  readonly id: string;
  readonly sort: SemanticKeywordSort;
  readonly sortValue: string | number;
  readonly filterHash: string;
}

interface ProjectPositionHistoryDayRow {
  readonly dayKey: string;
  readonly observedAt: Date;
  readonly measuredKeywordCount: bigint;
  readonly positionedKeywordCount: bigint;
  readonly top1KeywordCount: bigint;
  readonly top3KeywordCount: bigint;
  readonly top5KeywordCount: bigint;
  readonly top10KeywordCount: bigint;
  readonly top30KeywordCount: bigint;
  readonly top50KeywordCount: bigint;
  readonly top100KeywordCount?: bigint;
  readonly top200KeywordCount?: bigint;
}

const KEYWORD_INCLUDE = {
  memberships: {
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: {
      group: {
        select: { id: true, path: true, name: true, systemKind: true }
      }
    }
  },
  tags: {
    orderBy: { createdAt: "asc" as const },
    select: {
      tag: {
        select: { id: true, name: true }
      }
    }
  },
  typedCustomValues: {
    where: { column: { status: "ACTIVE" as const } },
    orderBy: { columnId: "asc" as const },
    take: 500,
    include: { column: { select: { type: true } } }
  },
  _count: {
    select: {
      memberships: {
        where: { group: { status: "ACTIVE", systemKind: null } }
      }
    }
  }
} satisfies Prisma.KeywordInclude;

const KEYWORD_MUTATION_INCLUDE = {
  ...KEYWORD_INCLUDE,
  memberships: {
    orderBy: { createdAt: "asc" as const },
    take: 2_001,
    select: {
      group: {
        select: { id: true, path: true, name: true, systemKind: true }
      }
    }
  }
} satisfies Prisma.KeywordInclude;

type KeywordAggregate = Prisma.KeywordGetPayload<{
  include: typeof KEYWORD_INCLUDE;
}>;

type KeywordMutationAggregate = Prisma.KeywordGetPayload<{
  include: typeof KEYWORD_MUTATION_INCLUDE;
}>;

const KEYWORD_AGGREGATE_HYDRATION_BATCH_SIZE = 250;
const POSITION_HISTORY_PROJECTION_SCHEMA_VERSION =
  "project-position-history@3";
const POSITION_HISTORY_REBUILD_ATTEMPTS = 2;

type RankSearchEngine = SemanticKeywordListPosition["searchEngine"];

interface PreviousFoundPositionAnchor {
  readonly keywordId: string;
  readonly searchEngine: RankSearchEngine;
  readonly observedAt: Date;
  readonly snapshotId: string;
}

interface PreviousFoundPositionRow {
  readonly keywordId: string;
  readonly searchEngine: RankSearchEngine;
  readonly observedAt: Date;
  readonly snapshotId: string;
  readonly previousPosition: number;
}

@Injectable()
export class KeywordService {
  private readonly positionHistoryBuilds = new Map<
    string,
    Promise<ProjectPositionHistory>
  >();

  public constructor(
    private readonly prisma: PrismaService,
    private readonly semanticVersions: SemanticVersionService,
    @Optional()
    private readonly rankComparisons?: KeywordRankComparisonService
  ) {}

  public async positionSummary(
    workspaceId: string,
    projectId: string,
    query: ProjectPositionHistoryQuery = { includeUntracked: false }
  ): Promise<ProjectPositionSummary> {
    const dimension = query.rankDimensionKey
      ? parseSemanticRankDimensionKey(query.rankDimensionKey)
      : undefined;
    if (query.rankDimensionKey && !dimension) {
      throw new BadRequestException("Invalid rank dimension");
    }
    const sourceDimensions = dimension
      ? await rankDimensionSources(this.prisma, { workspaceId, projectId }, dimension)
      : undefined;
    const dimensionFilter = sourceDimensions
      ? rankDimensionConfigurationPredicate(sourceDimensions)
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<readonly { position: number }[]>(Prisma.sql`
      SELECT DISTINCT ON (COALESCE(merge.target_keyword_id, current.keyword_id))
        current.position
      FROM current_ranks current
      LEFT JOIN keyword_merges merge
        ON merge.workspace_id = current.workspace_id
       AND merge.project_id = current.project_id
       AND merge.source_keyword_id = current.keyword_id
      JOIN keywords keyword
        ON keyword.workspace_id = current.workspace_id
       AND keyword.project_id = current.project_id
       AND keyword.id = COALESCE(merge.target_keyword_id, current.keyword_id)
      JOIN tracking_context_versions configuration
        ON configuration.workspace_id = current.workspace_id
       AND configuration.project_id = current.project_id
       AND configuration.context_id = current.tracking_context_id
       AND configuration.configuration_version = current.configuration_version
      WHERE current.workspace_id = ${workspaceId}::uuid
        AND current.project_id = ${projectId}::uuid
        AND keyword.status::text = 'ACTIVE'
        AND (${query.includeUntracked}::boolean OR keyword.is_tracked = TRUE)
        AND current.found
        AND current.position IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM rank_dimension_history_deletions deletion
          WHERE deletion.workspace_id = current.workspace_id
            AND deletion.project_id = current.project_id
            AND deletion.search_engine = configuration.search_engine::text
            AND deletion.country_code = configuration.country_code
            AND deletion.region_code = COALESCE(configuration.region_code, configuration.country_code)
            AND deletion.language = configuration.language
            AND deletion.device = configuration.device::text
            AND current.observed_at <= deletion.excluded_through
        )
        ${dimensionFilter}
      ORDER BY COALESCE(merge.target_keyword_id, current.keyword_id), current.observed_at DESC, current.snapshot_id DESC
    `);
    const positions = rows.map(({ position }) => position);
    const topCounts = positionTopCounts(positions);
    if (positions.length === 0) {
      return { positionedKeywordCount: 0, ...topCounts };
    }
    const average =
      positions.reduce((sum, position) => sum + position, 0) /
      positions.length;
    return {
      positionedKeywordCount: positions.length,
      averagePosition: Math.round(average * 10) / 10,
      ...topCounts
    };
  }

  public async positionHistory(
    workspaceId: string,
    projectId: string,
    query: ProjectPositionHistoryQuery = { includeUntracked: false }
  ): Promise<ProjectPositionHistory> {
    if (
      !this.prisma.projectPositionHistoryRevision ||
      !this.prisma.projectPositionHistoryProjection
    ) {
      return this.computePositionHistory(workspaceId, projectId, query);
    }
    const scopeHash = positionHistoryScopeHash(query);
    const revision = await this.positionHistoryRevision(workspaceId, projectId);
    const cached = await this.positionHistoryProjection(
      workspaceId,
      projectId,
      scopeHash,
      revision
    );
    if (cached) return cached;

    const buildKey = `${workspaceId}:${projectId}:${scopeHash}`;
    const currentBuild = this.positionHistoryBuilds.get(buildKey);
    if (currentBuild) return currentBuild;
    const build = this.rebuildPositionHistoryProjection(
      workspaceId,
      projectId,
      query,
      scopeHash
    );
    this.positionHistoryBuilds.set(buildKey, build);
    try {
      return await build;
    } finally {
      if (this.positionHistoryBuilds.get(buildKey) === build) {
        this.positionHistoryBuilds.delete(buildKey);
      }
    }
  }

  public async warmPositionHistory(
    workspaceId: string,
    projectId: string
  ): Promise<void> {
    await this.positionHistory(workspaceId, projectId, {
      includeUntracked: false
    });
  }

  private async rebuildPositionHistoryProjection(
    workspaceId: string,
    projectId: string,
    query: ProjectPositionHistoryQuery,
    scopeHash: string
  ): Promise<ProjectPositionHistory> {
    let result: ProjectPositionHistory = { points: [], truncated: false };
    for (
      let attempt = 0;
      attempt < POSITION_HISTORY_REBUILD_ATTEMPTS;
      attempt += 1
    ) {
      const revisionBefore = await this.positionHistoryRevision(
        workspaceId,
        projectId
      );
      const concurrentProjection = await this.positionHistoryProjection(
        workspaceId,
        projectId,
        scopeHash,
        revisionBefore
      );
      if (concurrentProjection) return concurrentProjection;
      result = await this.computePositionHistory(workspaceId, projectId, query);
      const revisionAfter = await this.positionHistoryRevision(
        workspaceId,
        projectId
      );
      if (revisionAfter !== revisionBefore) continue;
      const now = new Date();
      await this.prisma.projectPositionHistoryProjection.upsert({
        where: {
          workspaceId_projectId_scopeHash: {
            workspaceId,
            projectId,
            scopeHash
          }
        },
        create: {
          workspaceId,
          projectId,
          scopeHash,
          schemaVersion: POSITION_HISTORY_PROJECTION_SCHEMA_VERSION,
          sourceRevision: revisionAfter,
          payload: result as unknown as Prisma.InputJsonValue,
          builtAt: now
        },
        update: {
          schemaVersion: POSITION_HISTORY_PROJECTION_SCHEMA_VERSION,
          sourceRevision: revisionAfter,
          payload: result as unknown as Prisma.InputJsonValue,
          builtAt: now
        }
      });
      const confirmedRevision = await this.positionHistoryRevision(
        workspaceId,
        projectId
      );
      if (confirmedRevision !== revisionAfter) continue;
      return result;
    }
    return result;
  }

  private async positionHistoryRevision(
    workspaceId: string,
    projectId: string
  ): Promise<bigint> {
    const row = await this.prisma.projectPositionHistoryRevision.upsert({
      where: {
        workspaceId_projectId: { workspaceId, projectId }
      },
      create: { workspaceId, projectId, revision: 1n },
      update: {},
      select: { revision: true }
    });
    return row.revision;
  }

  private async positionHistoryProjection(
    workspaceId: string,
    projectId: string,
    scopeHash: string,
    sourceRevision: bigint
  ): Promise<ProjectPositionHistory | undefined> {
    const projection =
      await this.prisma.projectPositionHistoryProjection.findUnique({
        where: {
          workspaceId_projectId_scopeHash: {
            workspaceId,
            projectId,
            scopeHash
          }
        },
        select: {
          schemaVersion: true,
          sourceRevision: true,
          payload: true
        }
      });
    if (
      !projection ||
      projection.schemaVersion !== POSITION_HISTORY_PROJECTION_SCHEMA_VERSION ||
      projection.sourceRevision !== sourceRevision
    ) {
      return undefined;
    }
    return storedPositionHistoryProjection(projection.payload);
  }

  private async computePositionHistory(
    workspaceId: string,
    projectId: string,
    query: ProjectPositionHistoryQuery
  ): Promise<ProjectPositionHistory> {
    const dimension = query.rankDimensionKey
      ? parseSemanticRankDimensionKey(query.rankDimensionKey)
      : undefined;
    if (query.rankDimensionKey && !dimension) {
      throw new BadRequestException("Invalid rank dimension");
    }
    const sourceDimensions = dimension
      ? await rankDimensionSources(this.prisma, { workspaceId, projectId }, dimension)
      : undefined;
    const dimensionFilter = sourceDimensions
      ? rankDimensionConfigurationPredicate(sourceDimensions)
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      readonly ProjectPositionHistoryDayRow[]
    >(Prisma.sql`
      WITH daily_latest AS (
        SELECT
          TO_CHAR(
            snapshot.observed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD'
          ) AS "dayKey",
          snapshot.observed_at AS "observedAt",
          COALESCE(merge.target_keyword_id, snapshot.keyword_id) AS keyword_id,
          snapshot.found,
          snapshot.position,
          ROW_NUMBER() OVER (
            PARTITION BY
              (snapshot.observed_at AT TIME ZONE 'UTC')::date,
              COALESCE(merge.target_keyword_id, snapshot.keyword_id)
            ORDER BY snapshot.observed_at DESC, snapshot.id DESC
          ) AS daily_sequence
        FROM rank_snapshots snapshot
        LEFT JOIN keyword_merges merge
          ON merge.workspace_id = snapshot.workspace_id
         AND merge.project_id = snapshot.project_id
         AND merge.source_keyword_id = snapshot.keyword_id
        INNER JOIN keywords keyword
          ON keyword.workspace_id = snapshot.workspace_id
         AND keyword.project_id = snapshot.project_id
         AND keyword.id = COALESCE(merge.target_keyword_id, snapshot.keyword_id)
        INNER JOIN tracking_context_versions configuration
          ON configuration.workspace_id = snapshot.workspace_id
         AND configuration.project_id = snapshot.project_id
         AND configuration.context_id = snapshot.tracking_context_id
         AND configuration.configuration_version = snapshot.configuration_version
        WHERE snapshot.workspace_id = ${workspaceId}::uuid
          AND snapshot.project_id = ${projectId}::uuid
          AND snapshot.position_tracking_enabled = TRUE
          AND keyword.status = 'ACTIVE'
          AND (${query.includeUntracked}::boolean OR keyword.is_tracked = TRUE)
          AND NOT EXISTS (
            SELECT 1 FROM rank_dimension_history_deletions deletion
            WHERE deletion.workspace_id = snapshot.workspace_id
              AND deletion.project_id = snapshot.project_id
              AND deletion.search_engine = configuration.search_engine::text
              AND deletion.country_code = configuration.country_code
              AND deletion.region_code = COALESCE(configuration.region_code, configuration.country_code)
              AND deletion.language = configuration.language
              AND deletion.device = configuration.device::text
              AND snapshot.observed_at <= deletion.excluded_through
          )
          ${dimensionFilter}
      ),
      keyword_day_states AS (
        SELECT
          "dayKey",
          "observedAt",
          keyword_id,
          found,
          position,
          LAG("dayKey") OVER (
            PARTITION BY keyword_id ORDER BY "dayKey"
          ) AS "previousDayKey",
          LAG(found) OVER (
            PARTITION BY keyword_id ORDER BY "dayKey"
          ) AS "previousFound",
          LAG(position) OVER (
            PARTITION BY keyword_id ORDER BY "dayKey"
          ) AS "previousPosition"
        FROM daily_latest
        WHERE daily_sequence = 1
      ),
      daily_deltas AS (
        SELECT
          "dayKey",
          MAX("observedAt") AS "observedAt",
          COUNT(*) FILTER (WHERE "previousDayKey" IS NULL)::bigint AS "measuredKeywordDelta",
          SUM(
            CASE WHEN found = TRUE AND position IS NOT NULL THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" = TRUE AND "previousPosition" IS NOT NULL THEN 1 ELSE 0 END
          )::bigint AS "positionedKeywordDelta",
          SUM(
            CASE WHEN found = TRUE AND position = 1 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" = TRUE AND "previousPosition" = 1 THEN 1 ELSE 0 END
          )::bigint AS "top1KeywordDelta",
          SUM(
            CASE WHEN found = TRUE AND position BETWEEN 1 AND 3 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" = TRUE AND "previousPosition" BETWEEN 1 AND 3 THEN 1 ELSE 0 END
          )::bigint AS "top3KeywordDelta",
          SUM(
            CASE WHEN found = TRUE AND position BETWEEN 1 AND 5 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" = TRUE AND "previousPosition" BETWEEN 1 AND 5 THEN 1 ELSE 0 END
          )::bigint AS "top5KeywordDelta",
          SUM(
            CASE WHEN found = TRUE AND position BETWEEN 1 AND 10 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" = TRUE AND "previousPosition" BETWEEN 1 AND 10 THEN 1 ELSE 0 END
          )::bigint AS "top10KeywordDelta",
          SUM(
            CASE WHEN found = TRUE AND position BETWEEN 1 AND 30 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" = TRUE AND "previousPosition" BETWEEN 1 AND 30 THEN 1 ELSE 0 END
          )::bigint AS "top30KeywordDelta",
          SUM(
            CASE WHEN found = TRUE AND position BETWEEN 1 AND 50 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" = TRUE AND "previousPosition" BETWEEN 1 AND 50 THEN 1 ELSE 0 END
          )::bigint AS "top50KeywordDelta",
          SUM(
            CASE WHEN found AND position BETWEEN 1 AND 100 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" AND "previousPosition" BETWEEN 1 AND 100 THEN 1 ELSE 0 END
          )::bigint AS "top100KeywordDelta",
          SUM(
            CASE WHEN found AND position BETWEEN 1 AND 200 THEN 1 ELSE 0 END -
            CASE WHEN "previousFound" AND "previousPosition" BETWEEN 1 AND 200 THEN 1 ELSE 0 END
          )::bigint AS "top200KeywordDelta"
        FROM keyword_day_states
        GROUP BY "dayKey"
      ),
      daily_aggregates AS (
        SELECT
          "dayKey",
          "observedAt",
          (SUM("measuredKeywordDelta") OVER cumulative_history)::bigint AS "measuredKeywordCount",
          (SUM("positionedKeywordDelta") OVER cumulative_history)::bigint AS "positionedKeywordCount",
          (SUM("top1KeywordDelta") OVER cumulative_history)::bigint AS "top1KeywordCount",
          (SUM("top3KeywordDelta") OVER cumulative_history)::bigint AS "top3KeywordCount",
          (SUM("top5KeywordDelta") OVER cumulative_history)::bigint AS "top5KeywordCount",
          (SUM("top10KeywordDelta") OVER cumulative_history)::bigint AS "top10KeywordCount",
          (SUM("top30KeywordDelta") OVER cumulative_history)::bigint AS "top30KeywordCount",
          (SUM("top50KeywordDelta") OVER cumulative_history)::bigint AS "top50KeywordCount",
          (SUM("top100KeywordDelta") OVER cumulative_history)::bigint AS "top100KeywordCount",
          (SUM("top200KeywordDelta") OVER cumulative_history)::bigint AS "top200KeywordCount"
        FROM daily_deltas
        WINDOW cumulative_history AS (
          ORDER BY "dayKey" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
      ),
      bounded_days AS (
        SELECT *
        FROM daily_aggregates
        ORDER BY "dayKey" DESC
        LIMIT ${projectPositionHistoryMaxPoints + 1}
      )
      SELECT *
      FROM bounded_days
      ORDER BY "dayKey" ASC
    `);
    const boundedRows = rows.length > projectPositionHistoryMaxPoints
      ? rows.slice(1)
      : rows;
    const points = boundedRows.map((row): ProjectPositionHistoryPoint => ({
      id: `day:${row.dayKey}`,
      date: row.dayKey,
      observedAt: row.observedAt.toISOString(),
      measuredKeywordCount: safeHistoryCount(row.measuredKeywordCount),
      positionedKeywordCount: safeHistoryCount(row.positionedKeywordCount),
      top1KeywordCount: safeHistoryCount(row.top1KeywordCount),
      top3KeywordCount: safeHistoryCount(row.top3KeywordCount),
      top5KeywordCount: safeHistoryCount(row.top5KeywordCount),
      top10KeywordCount: safeHistoryCount(row.top10KeywordCount),
      top30KeywordCount: safeHistoryCount(row.top30KeywordCount),
      top50KeywordCount: safeHistoryCount(row.top50KeywordCount),
      top100KeywordCount: safeHistoryCount(row.top100KeywordCount ?? row.top50KeywordCount),
      top200KeywordCount: safeHistoryCount(row.top200KeywordCount ?? row.top50KeywordCount)
    }));
    return {
      points,
      truncated: rows.length > projectPositionHistoryMaxPoints
    };
  }

  public async list(
    workspaceId: string,
    projectId: string,
    query: KeywordListQuery,
    requestId: string
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const search = normalizeKeywordText(query.search);
    const multiSearch = query.multiSearch
      ? {
          mode: query.multiSearch.mode,
          terms: query.multiSearch.terms.map((term) => normalizeKeywordText(term))
        }
      : undefined;
    const tag = normalizeTagName(query.tag ?? "");
    const sort = query.sort ?? "CREATED_DESC";
    const selectedGroup = query.groupId
      ? await this.prisma.keywordGroup.findFirst({
          where: {
            id: query.groupId,
            workspaceId,
            projectId,
            status: "ACTIVE"
          },
          select: { systemKind: true }
        })
      : undefined;
    const selectedGroupIds = query.groupIds?.length
      ? [...query.groupIds]
      : query.groupId
        ? [query.groupId]
        : [];
    const keywordStatus =
      selectedGroup?.systemKind === "TRASH" ? "DELETED" : "ACTIVE";
    const filterHash = keywordFilterHash(query, search, tag);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, sort, filterHash)
      : undefined;
    const baseWhere: Prisma.KeywordWhereInput = {
      workspaceId,
      projectId,
      status: keywordStatus,
      ...(search
        ? {
            textNormalized: {
              contains: search
            }
          }
        : {}),
      ...keywordMultiSearchWhere(multiSearch),
      ...(tag
        ? {
            tags: {
              some: {
                projectId,
                tag: {
                  workspaceId,
                  projectId,
                  status: "ACTIVE",
                  normalizedName: { contains: tag }
                }
              }
            }
          }
        : {}),
      ...(query.intent ? { intent: query.intent } : {}),
      ...(query.isFavorite === undefined
        ? {}
        : { isFavorite: query.isFavorite }),
      ...(query.priorityMin === undefined &&
      query.priorityMax === undefined
        ? {}
        : {
            priority: {
              ...(query.priorityMin === undefined
                ? {}
                : { gte: query.priorityMin }),
              ...(query.priorityMax === undefined
                ? {}
                : { lte: query.priorityMax })
            }
          }),
      ...(selectedGroupIds.length > 0
        ? {
            memberships: {
              some: {
                projectId,
                groupId:
                  selectedGroupIds.length === 1
                    ? selectedGroupIds[0]!
                    : { in: selectedGroupIds }
              }
            }
          }
        : {}),
      ...(query.clusterId ? { clusterId: query.clusterId } : {}),
      ...(query.isTracked === undefined
        ? {}
        : { isTracked: query.isTracked })
    };
    let externalSortValueById = new Map<string, string | number>();
    let rows: KeywordAggregate[];
    let totalApprox: number | undefined;
    let hasNext = false;
    const advancedFilters = hasAdvancedKeywordFilters(query);
    if (isExternalKeywordSort(sort) || advancedFilters) {
      const [externalPage, count] = await Promise.all([
        isMetricKeywordSort(sort)
          ? metricSortedKeywordPage(
              this.prisma,
              workspaceId,
              projectId,
              query,
              search,
              tag,
              sort,
              cursor,
              keywordStatus
            )
          : sort === "TAGS_ASC" || sort === "TAGS_DESC"
            ? tagSortedKeywordPage(
              this.prisma,
              workspaceId,
              projectId,
              query,
              search,
              tag,
              sort,
              cursor,
              keywordStatus
            )
            : rawSortedKeywordPage(this.prisma, workspaceId, projectId, query, search, tag, sort, cursor, keywordStatus),
        cursor
          ? Promise.resolve(undefined)
          : advancedFilters
            ? rawKeywordCount(this.prisma, workspaceId, projectId, query, search, tag, keywordStatus)
            : this.prisma.keyword.count({ where: baseWhere })
      ]);
      hasNext = externalPage.ids.length > query.limit;
      const pageIds = externalPage.ids.slice(0, query.limit);
      const aggregates = await hydratedKeywordRows(
        this.prisma,
        baseWhere,
        pageIds
      );
      const aggregateById = new Map(aggregates.map((row) => [row.id, row]));
      rows = pageIds.flatMap((id) => {
        const row = aggregateById.get(id);
        return row ? [row] : [];
      });
      externalSortValueById = externalPage.sortValueById;
      totalApprox = count;
    } else {
      const where: Prisma.KeywordWhereInput = {
        ...baseWhere,
        ...(cursor ? cursorWhere(cursor) : {})
      };
      const [anchors, count] = await Promise.all([
        this.prisma.keyword.findMany({
          where,
          orderBy: keywordOrderBy(sort),
          take: query.limit + 1,
          select: { id: true }
        }),
        cursor
          ? Promise.resolve(undefined)
          : this.prisma.keyword.count({ where: baseWhere })
      ]);
      hasNext = anchors.length > query.limit;
      rows = await hydratedKeywordRows(
        this.prisma,
        baseWhere,
        anchors.slice(0, query.limit).map(({ id }) => id)
      );
      totalApprox = count;
    }
    const pageRows = rows;
    const pageIds = [
      ...new Set(
        pageRows.flatMap(({ targetPageId }) =>
          targetPageId ? [targetPageId] : []
        )
      )
    ];
    const keywordIds = pageRows.map(({ id }) => id);
    const metricProjection = query.metricProjection
      ? new Set(query.metricProjection)
      : undefined;
    const includeFrequencies =
      metricProjection === undefined || metricProjection.has("FREQUENCIES");
    const includePositions =
      metricProjection === undefined ||
      metricProjection.has("POSITIONS") ||
      metricProjection.has("RANKING_SITE_RESULTS");
    const includeRankingSiteResults =
      metricProjection === undefined || metricProjection.has("RANKING_SITE_RESULTS");
    const includeAiAnswers =
      metricProjection === undefined || metricProjection.has("AI_ANSWERS");
    const includeTargetUrlIndicator =
      metricProjection === undefined || metricProjection.has("TARGET_URL_INDICATOR");
    const includeMultipleUrlIndicator =
      metricProjection === undefined || metricProjection.has("MULTIPLE_URL_INDICATOR");
    const includeCurrentRanks =
      includePositions || includeTargetUrlIndicator || includeMultipleUrlIndicator;
    const dynamicRankColumnKeys = query.rankColumnKeys ?? [];
    const dynamicRankDimensionKeys = [...new Set(
      dynamicRankColumnKeys.map((key) => parseSemanticRankColumnKey(key)!.dimension.key)
    )];
    const needsLegacyMetricMerges =
      includeFrequencies || includeCurrentRanks || includeAiAnswers;
    const keywordMerges = keywordIds.length === 0 || !needsLegacyMetricMerges
      ? []
      : await this.prisma.keywordMerge?.findMany({
          where: {
            workspaceId,
            projectId,
            targetKeywordId: { in: keywordIds }
          },
          select: { sourceKeywordId: true, targetKeywordId: true }
        }) ?? [];
    const mergedTargetBySourceId = new Map(
      keywordMerges.map(({ sourceKeywordId, targetKeywordId }) => [
        sourceKeywordId,
        targetKeywordId
      ])
    );
    const historyKeywordIds = [
      ...keywordIds,
      ...mergedTargetBySourceId.keys()
    ];
    const visibleKeywordId = (keywordId: string): string =>
      mergedTargetBySourceId.get(keywordId) ?? keywordId;
    const clusterIds = [
      ...new Set(
        pageRows.flatMap(({ clusterId }) => (clusterId ? [clusterId] : []))
      )
    ];
    const [
      pages,
      clusters,
      frequencySnapshots,
      currentRanks,
      aiAnswerSnapshots,
      selectedGroupMemberships,
      rankDeletions,
      rankComparisonItems
    ] = await Promise.all([
      pageIds.length === 0
        ? Promise.resolve([])
        : this.prisma.page.findMany({
            where: {
              workspaceId,
              projectId,
              id: { in: pageIds },
              status: "ACTIVE"
            },
            select: { id: true, url: true }
          }),
      clusterIds.length === 0
        ? Promise.resolve([])
        : this.prisma.cluster.findMany({
            where: {
              workspaceId,
              projectId,
              id: { in: clusterIds },
              status: "ACTIVE"
            },
            select: { id: true, name: true }
          }),
      keywordIds.length === 0 || !includeFrequencies
        ? Promise.resolve([])
        : this.prisma.frequencySnapshot.findMany({
            where: {
              workspaceId,
              projectId,
              keywordId: { in: historyKeywordIds },
            },
            orderBy: [
              { observedAt: "desc" },
              { id: "desc" },
              { keywordId: "asc" }
            ],
            distinct: ["keywordId", "type"],
            select: {
              keywordId: true,
              type: true,
              value: true,
              regionCode: true,
              device: true,
              provider: true,
              observedAt: true
            }
          }),
      keywordIds.length === 0 || !includeCurrentRanks
        ? Promise.resolve([])
        : this.prisma.currentRank.findMany({
            where: {
              workspaceId,
              projectId,
              keywordId: { in: historyKeywordIds }
            },
            orderBy: [
              { observedAt: "desc" },
              { snapshotId: "desc" },
              { keywordId: "asc" },
              { trackingContextId: "desc" }
            ],
            select: {
              keywordId: true,
              trackingContextId: true,
              configurationVersion: true,
              found: true,
              position: true,
              rankingUrl: true,
              observedAt: true,
              snapshotId: true
            }
          }),
      keywordIds.length === 0 || !includeAiAnswers
        ? Promise.resolve([])
        : this.prisma.aiAnswerSnapshot.findMany({
            where: {
              workspaceId,
              projectId,
              keywordId: { in: historyKeywordIds },
              positionTrackingEnabled: true
            },
            orderBy: [
              { keywordId: "asc" },
              { searchEngine: "asc" },
              { observedAt: "desc" },
              { id: "desc" }
            ],
            distinct: ["keywordId", "searchEngine"],
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
              observedAt: true
            }
          }),
      keywordIds.length === 0 || selectedGroupIds.length === 0
        ? Promise.resolve([])
        : this.prisma.keywordGroupMembership.findMany({
            where: {
              projectId,
              keywordId: { in: keywordIds },
              groupId: { in: selectedGroupIds },
              group: { workspaceId, projectId, status: "ACTIVE" }
            },
            orderBy: [{ createdAt: "asc" }, { groupId: "asc" }],
            select: {
              keywordId: true,
              group: { select: { id: true, path: true, name: true } }
            }
          }),
      keywordIds.length === 0 || !includeCurrentRanks
        ? Promise.resolve([])
        : this.prisma.rankDimensionHistoryDeletion.findMany({
            where: { workspaceId, projectId },
            orderBy: { excludedThrough: "desc" },
            take: 2_000,
            select: {
              searchEngine: true,
              countryCode: true,
              regionCode: true,
              language: true,
              device: true,
              excludedThrough: true
            }
          }),
      keywordIds.length === 0 || dynamicRankDimensionKeys.length === 0
        ? Promise.resolve([] as readonly SemanticRankComparisonItem[])
        : (this.rankComparisons ?? new KeywordRankComparisonService(this.prisma))
            .compareTrusted(
              { workspaceId, projectId },
              {
                keywordIds,
                dimensionKeys: dynamicRankDimensionKeys,
                columnKeys: dynamicRankColumnKeys,
                includeSiteResultCount: false
              }
            )
    ]);
    const rankConfigurations = currentRanks.length === 0
      ? []
      : await this.prisma.trackingContextVersion.findMany({
          where: {
            workspaceId,
            projectId,
            OR: uniqueRankConfigurationReferences(currentRanks)
          },
          select: {
            contextId: true,
            configurationVersion: true,
            searchEngine: true,
            countryCode: true,
            regionCode: true,
            regionLabel: true,
            language: true,
            device: true
          }
        });
    const configurationById = new Map(
      rankConfigurations.map((configuration) => [
        `${configuration.contextId}:${configuration.configurationVersion}`,
        configuration
      ])
    );
    const indicatorDimensionMergeTargets = resolvedRankDimensionMergeTargets(
      currentRanks.length === 0 ||
        (!includeTargetUrlIndicator && !includeMultipleUrlIndicator)
        ? []
        : await (this.prisma.rankDimensionMerge?.findMany({
            where: { workspaceId, projectId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 2_000,
            select: {
              sourceDimensionKey: true,
              targetDimensionKey: true,
              targetRegionLabel: true
            }
          }) ?? Promise.resolve([]))
    );
    const pageUrlById = new Map(pages.map(({ id, url }) => [id, url]));
    const visibleCurrentRanks = currentRanks.filter((rank) => {
      const configuration = configurationById.get(
        `${rank.trackingContextId}:${rank.configurationVersion}`
      );
      return configuration && !rankIsExcluded(rank.observedAt, configuration, rankDeletions);
    });
    const clusterNameById = new Map(
      clusters.map(({ id, name }) => [id, name])
    );
    const selectedGroupByKeywordId = new Map<
      string,
      (typeof selectedGroupMemberships)[number]["group"]
    >();
    for (const membership of selectedGroupMemberships) {
      if (!selectedGroupByKeywordId.has(membership.keywordId)) {
        selectedGroupByKeywordId.set(membership.keywordId, membership.group);
      }
    }
    const frequenciesByKeywordId = new Map<
      string,
      SemanticKeywordListFrequencyValue[]
    >();
    for (const snapshot of frequencySnapshots) {
      const targetKeywordId = visibleKeywordId(snapshot.keywordId);
      const frequencies = frequenciesByKeywordId.get(targetKeywordId) ?? [];
      if (frequencies.some(({ type }) => type === snapshot.type)) continue;
      frequencies.push({
        type: snapshot.type as SemanticKeywordListFrequencyValue["type"],
        ...(snapshot.value === null
          ? {}
          : { value: snapshot.value.toString() }),
        regionCode: snapshot.regionCode,
        device: frequencyDevice(snapshot.device),
        provider: snapshot.provider,
        observedAt: snapshot.observedAt.toISOString()
      });
      frequenciesByKeywordId.set(targetKeywordId, frequencies);
    }
    const previousAiPositions = await previousAiAnswerPositions(
      this.prisma,
      workspaceId,
      projectId,
      aiAnswerSnapshots.map((snapshot) => ({
        keywordId: snapshot.keywordId,
        searchEngine: snapshot.searchEngine as SemanticAiAnswerSummary["searchEngine"],
        regionCode: snapshot.regionCode,
        device: snapshot.device as "DESKTOP" | "MOBILE",
        observedAt: snapshot.observedAt,
        snapshotId: snapshot.id
      }))
    );
    const aiAnswersByKeywordId = new Map<string, SemanticAiAnswerSummary[]>();
    for (const snapshot of aiAnswerSnapshots) {
      const targetKeywordId = visibleKeywordId(snapshot.keywordId);
      const answers = aiAnswersByKeywordId.get(targetKeywordId) ?? [];
      const searchEngine = snapshot.searchEngine as SemanticAiAnswerSummary["searchEngine"];
      const existingIndex = answers.findIndex(
        (answer) => answer.searchEngine === searchEngine
      );
      if (
        existingIndex >= 0 &&
        answers[existingIndex]!.observedAt >= snapshot.observedAt.toISOString()
      ) continue;
      const previousPosition = previousAiPositions.get(
        previousAiAnswerPositionKey(
          snapshot.keywordId,
          searchEngine,
          snapshot.regionCode,
          snapshot.device as "DESKTOP" | "MOBILE",
          snapshot.observedAt,
          snapshot.id
        )
      );
      const answer: SemanticAiAnswerSummary = {
        searchEngine,
        answerPresent: snapshot.answerPresent,
        siteFound: snapshot.siteFound,
        ...(snapshot.position === null ? {} : { position: snapshot.position }),
        ...(previousPosition === undefined ? {} : { previousPosition }),
        ...(snapshot.rankingUrl === null ? {} : { rankingUrl: snapshot.rankingUrl }),
        brandFound: snapshot.brandFound,
        observedAt: snapshot.observedAt.toISOString()
      };
      if (existingIndex >= 0) answers[existingIndex] = answer;
      else answers.push(answer);
      aiAnswersByKeywordId.set(targetKeywordId, answers);
    }
    const latestRankByKeywordEngine = new Map<
      string,
      Readonly<{
        rank: (typeof visibleCurrentRanks)[number];
        searchEngine: RankSearchEngine;
      }>
    >();
    const latestRankByKeywordDimension = new Map<
      string,
      (typeof visibleCurrentRanks)[number]
    >();
    for (const rank of visibleCurrentRanks) {
      const configuration = configurationById.get(
        `${rank.trackingContextId}:${rank.configurationVersion}`
      );
      if (!configuration) continue;
      const searchEngine = configuration.searchEngine as RankSearchEngine;
      const targetKeywordId = visibleKeywordId(rank.keywordId);
      const engineKey = `${targetKeywordId}:${searchEngine}`;
      if (!latestRankByKeywordEngine.has(engineKey)) {
        latestRankByKeywordEngine.set(engineKey, { rank, searchEngine });
      }
      const storedDimensionKey = storedRankDimensionKey(configuration);
      const dimensionKey = storedDimensionKey
        ? indicatorDimensionMergeTargets.get(storedDimensionKey)?.key ??
          storedDimensionKey
        : `${rank.trackingContextId}:${rank.configurationVersion}`;
      const keywordDimensionKey = `${targetKeywordId}:${dimensionKey}`;
      if (!latestRankByKeywordDimension.has(keywordDimensionKey)) {
        latestRankByKeywordDimension.set(keywordDimensionKey, rank);
      }
    }
    const previousPositions = includePositions
      ? await previousFoundPositions(
          this.prisma,
          workspaceId,
          projectId,
          [...latestRankByKeywordEngine.values()].map(({ rank, searchEngine }) => ({
            keywordId: rank.keywordId,
            searchEngine,
            observedAt: rank.observedAt,
            snapshotId: rank.snapshotId
          }))
        )
      : new Map<string, number>();
    const currentDimensionRanks = [...latestRankByKeywordDimension.values()];
    const currentRankSnapshotIds = currentDimensionRanks.map(
      ({ snapshotId }) => snapshotId
    );
    const currentSerpSnapshots =
      !includeRankingSiteResults || currentRankSnapshotIds.length === 0
      ? []
      : await this.prisma.rankSnapshot.findMany({
          where: {
            workspaceId,
            projectId,
            id: { in: currentRankSnapshotIds }
          },
          select: {
            id: true,
            keywordId: true,
            manifest: { select: { projectDomain: true } },
            serpResults: {
              orderBy: { position: "asc" },
              select: {
                position: true,
                rankingUrl: true,
                normalizedRankingUrl: true,
                faviconUrl: true,
                title: true,
                snippet: true
              }
            }
          }
        });
    const multipleResultSnapshotIds =
      includeMultipleUrlIndicator && !includeRankingSiteResults
        ? await snapshotIdsWithMultipleProjectUrls(
            this.prisma,
            workspaceId,
            projectId,
            currentRankSnapshotIds
          )
        : new Set<string>();
    const siteResultsBySnapshotId = new Map(
      currentSerpSnapshots.map((snapshot) => [
        snapshot.id,
        projectSiteResults(
          snapshot.serpResults,
          snapshot.manifest.projectDomain
        )
      ])
    );
    const keywordsWithMultipleRankingUrls = new Set(
      currentDimensionRanks.flatMap((rank) =>
        multipleResultSnapshotIds.has(rank.snapshotId)
          ? [visibleKeywordId(rank.keywordId)]
          : []
      ).concat(currentSerpSnapshots.flatMap((snapshot) =>
        (siteResultsBySnapshotId.get(snapshot.id)?.length ?? 0) > 1
          ? [visibleKeywordId(snapshot.keywordId)]
          : []
      ))
    );
    const keywordsWithTargetUrlMismatch = new Set<string>();
    if (includeTargetUrlIndicator) {
      const rowById = new Map(pageRows.map((row) => [row.id, row]));
      for (const rank of currentDimensionRanks) {
        if (!rank.found || !rank.rankingUrl) continue;
        const keywordId = visibleKeywordId(rank.keywordId);
        const row = rowById.get(keywordId);
        const targetUrl = row?.targetPageId
          ? pageUrlById.get(row.targetPageId)
          : undefined;
        if (targetUrl && !sameKeywordRankingUrl(targetUrl, rank.rankingUrl)) {
          keywordsWithTargetUrlMismatch.add(keywordId);
        }
      }
    }
    const rankComparisonByKeywordId = new Map<
      string,
      SemanticRankComparisonItem[]
    >();
    for (const comparison of rankComparisonItems) {
      const comparisons = rankComparisonByKeywordId.get(comparison.keywordId) ?? [];
      comparisons.push(comparison);
      rankComparisonByKeywordId.set(comparison.keywordId, comparisons);
    }
    const positionsByKeywordId = new Map<
      string,
      Map<SemanticKeywordListPosition["searchEngine"], SemanticKeywordListPosition>
    >();
    for (const { rank, searchEngine } of includePositions
      ? latestRankByKeywordEngine.values()
      : []) {
      const configuration = configurationById.get(
        `${rank.trackingContextId}:${rank.configurationVersion}`
      );
      if (!configuration) continue;
      const targetKeywordId = visibleKeywordId(rank.keywordId);
      const positions = positionsByKeywordId.get(targetKeywordId) ?? new Map();
      const previousPosition = previousPositions.get(
        previousFoundPositionKey(
          rank.keywordId,
          searchEngine,
          rank.observedAt,
          rank.snapshotId
        )
      );
      const siteResults = siteResultsBySnapshotId.get(rank.snapshotId) ?? [];
      const regionCode = configuration.regionCode ?? configuration.countryCode;
      const dimension =
        configuration.countryCode &&
        regionCode &&
        configuration.language &&
        (configuration.device === "DESKTOP" || configuration.device === "MOBILE")
          ? {
              key: semanticRankDimensionKey({
                searchEngine,
                countryCode: configuration.countryCode,
                regionCode,
                language: configuration.language,
                device: configuration.device
              }),
              searchEngine,
              countryCode: configuration.countryCode,
              regionCode,
              ...(configuration.regionLabel
                ? { regionLabel: configuration.regionLabel }
                : {}),
              language: configuration.language,
              device: configuration.device
            }
          : undefined;
      positions.set(searchEngine, {
        searchEngine,
        ...(dimension ? { dimension } : {}),
        found: rank.found,
        ...(rank.position === null ? {} : { position: rank.position }),
        ...(previousPosition === undefined ? {} : { previousPosition }),
        ...(rank.rankingUrl === null || rank.rankingUrl === undefined
          ? {}
          : { rankingUrl: rank.rankingUrl }),
        ...(siteResults.length === 0 ? {} : { siteResults }),
        observedAt: rank.observedAt.toISOString()
      });
      positionsByKeywordId.set(targetKeywordId, positions);
    }
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) => ({
        ...keywordItem(
          row,
          row.targetPageId
            ? pageUrlById.get(row.targetPageId)
            : undefined,
          row.clusterId ? clusterNameById.get(row.clusterId) : undefined,
          frequenciesByKeywordId.get(row.id),
          [...(positionsByKeywordId.get(row.id)?.values() ?? [])],
          selectedGroupByKeywordId.get(row.id),
          aiAnswersByKeywordId.get(row.id),
          keywordsWithMultipleRankingUrls.has(row.id),
          query.includeNotes === true,
          undefined,
          dynamicRankDimensionKeys.length === 0
            ? undefined
            : {
                dimensionKeys: dynamicRankDimensionKeys,
                items: rankComparisonByKeywordId.get(row.id) ?? []
              }
        ),
        ...(keywordsWithTargetUrlMismatch.has(row.id)
          ? { hasTargetUrlMismatch: true }
          : {})
      })),
      page: {
        hasNext,
        ...(totalApprox === undefined ? {} : { totalApprox }),
        ...(hasNext && last
          ? {
              nextCursor: encodeCursor({
                version: 2,
                id: last.id,
                sort,
                sortValue:
                  externalSortValueById.get(last.id) ?? cursorValue(last, sort),
                filterHash
              })
            }
          : {})
      },
      meta: { requestId }
    };
  }

  public async operationScope(
    workspaceId: string,
    projectId: string,
    query: SemanticOperationScopePageInput,
    requestId: string
  ): Promise<ApiCollectionResponse<SemanticOperationScopeKeyword>> {
    const baseWhere: Prisma.KeywordWhereInput = {
      workspaceId,
      projectId,
      status: "ACTIVE",
      ...(query.groupIds
        ? {
            memberships: {
              some: {
                projectId,
                groupId: { in: [...query.groupIds] },
                group: { workspaceId, projectId, status: "ACTIVE" }
              }
            }
          }
        : {})
    };
    const where: Prisma.KeywordWhereInput = {
      ...baseWhere,
      ...(query.cursor ? { id: { gt: query.cursor } } : {})
    };
    const [rows, totalApprox] = await Promise.all([
      this.prisma.keyword.findMany({
        where,
        orderBy: { id: "asc" },
        take: semanticOperationScopePageSize + 1,
        select: { id: true, version: true, isTracked: true }
      }),
      query.cursor
        ? Promise.resolve(undefined)
        : this.prisma.keyword.count({ where: baseWhere })
    ]);
    const data = rows.slice(0, semanticOperationScopePageSize);
    const hasNext = rows.length > semanticOperationScopePageSize;
    return {
      data,
      page: {
        hasNext,
        ...(hasNext && data.length > 0
          ? { nextCursor: data[data.length - 1]!.id }
          : {}),
        ...(totalApprox === undefined ? {} : { totalApprox })
      },
      meta: { requestId }
    };
  }

  public async tagOptions(
    workspaceId: string,
    projectId: string,
    search?: string
  ): Promise<readonly string[]> {
    const normalizedSearch = normalizeTagName(search ?? "");
    const tags = await this.prisma.tag.findMany({
      where: {
        workspaceId,
        projectId,
        status: "ACTIVE",
        ...(normalizedSearch
          ? { normalizedName: { contains: normalizedSearch } }
          : {})
      },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      take: 100,
      select: { name: true }
    });
    return tags.map(({ name }) => name);
  }

  public async tagManagementOptions(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticKeywordTagOption[]> {
    const tags = await this.prisma.tag.findMany({
      where: { workspaceId, projectId, status: "ACTIVE" },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true, name: true }
    });
    if (tags.length === 0) return [];
    const counts = await this.prisma.keywordTag.groupBy({
      by: ["tagId"],
      where: {
        projectId,
        tagId: { in: tags.map(({ id }) => id) }
      },
      _count: { _all: true }
    });
    const countByTagId = new Map(
      counts.map(({ tagId, _count }) => [tagId, _count._all])
    );
    return tags.map(({ id, name }) => ({
      id,
      name,
      keywordCount: countByTagId.get(id) ?? 0
    }));
  }

  public async deleteTag(
    workspaceId: string,
    projectId: string,
    actorId: string,
    tagId: string
  ): Promise<SemanticKeywordTagDeleteResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockSemanticKeywordWrites(transaction, projectId);
      const tag = await transaction.tag.findFirst({
        where: { id: tagId, workspaceId, projectId, status: "ACTIVE" },
        select: { id: true, name: true }
      });
      if (!tag) throw new BadRequestException("Semantic tag is unavailable");
      const detachedKeywordCount = await transaction.keywordTag.count({
        where: { projectId, tagId }
      });
      if (detachedKeywordCount > 0) {
        await transaction.keyword.updateMany({
          where: {
            workspaceId,
            projectId,
            tags: { some: { projectId, tagId } }
          },
          data: { updatedBy: actorId, version: { increment: 1 } }
        });
        await transaction.keywordTag.deleteMany({
          where: { projectId, tagId }
        });
      }
      await transaction.tag.update({
        where: { id: tag.id },
        data: { status: "DELETED" }
      });
      await this.semanticVersions.createIrreversibleVersion(
        transaction,
        {
          workspaceId,
          projectId,
          actorId,
          reason: "BULK_UPDATE",
          summary: `Удалён тег «${tag.name}» у ${detachedKeywordCount} запросов`
        },
        detachedKeywordCount,
        { action: "TAG_DELETE", tagId: tag.id }
      );
      return {
        tagId: tag.id,
        name: tag.name,
        detachedKeywordCount
      };
    });
  }

  public async mergeSuggestions(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticKeywordMergeSuggestion[]> {
    const sources = await this.prisma.keyword.findMany({
      where: {
        workspaceId,
        projectId,
        status: "ACTIVE",
        textOriginal: { contains: "\uFFFD" },
        mergedInto: null
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        version: true,
        textOriginal: true,
        textNormalized: true,
        language: true
      }
    });
    const suggestions: SemanticKeywordMergeSuggestion[] = [];
    for (const source of sources) {
      const tokens = source.textNormalized
        .split(/\s+/u)
        .filter((token) => token.length >= 2 && !token.includes("\uFFFD"))
        .sort((left, right) => right.length - left.length)
        .slice(0, 2);
      const candidates = await this.prisma.keyword.findMany({
        where: {
          workspaceId,
          projectId,
          status: "ACTIVE",
          language: source.language,
          id: { not: source.id },
          NOT: { textOriginal: { contains: "\uFFFD" } },
          ...(tokens.length === 0
            ? {}
            : {
                AND: tokens.map((token) => ({
                  textNormalized: { contains: token }
                }))
              })
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 50,
        select: { id: true, version: true, textOriginal: true, textNormalized: true }
      });
      const repaired = source.textNormalized.replaceAll("\uFFFD", "");
      const ranked = candidates
        .map((candidate) => ({
          candidate,
          similarity: boundedTextSimilarity(repaired, candidate.textNormalized)
        }))
        .sort((left, right) =>
          right.similarity - left.similarity ||
          left.candidate.id.localeCompare(right.candidate.id)
        );
      const best = ranked[0];
      if (!best || best.similarity < 0.35) continue;
      suggestions.push({
        source: {
          id: source.id,
          version: source.version,
          text: source.textOriginal
        },
        candidate: {
          id: best.candidate.id,
          version: best.candidate.version,
          text: best.candidate.textOriginal
        },
        similarity: best.similarity,
        reason: "BROKEN_ENCODING"
      });
    }
    return suggestions.sort((left, right) =>
      right.similarity - left.similarity ||
      left.source.id.localeCompare(right.source.id)
    );
  }

  public async insights(
    workspaceId: string,
    projectId: string,
    keywordId: string,
    dimensionKey?: string,
    snapshotId?: string
  ): Promise<SemanticKeywordInsights> {
    const dimensionMerges = await this.prisma.rankDimensionMerge?.findMany({
      where: { workspaceId, projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2_000,
      select: {
        sourceDimensionKey: true,
        targetDimensionKey: true,
        targetRegionLabel: true
      }
    }) ?? [];
    const dimensionMergeTargets = resolvedRankDimensionMergeTargets(
      dimensionMerges
    );
    const selectedDimension = dimensionKey
      ? parseSemanticRankDimensionKey(dimensionKey)
      : undefined;
    if (dimensionKey && !selectedDimension) {
      throw new BadRequestException("Invalid rank dimension");
    }
    const insightDimensions = selectedDimension
      ? await rankDimensionSources(
          this.prisma,
          { workspaceId, projectId },
          selectedDimension
        )
      : undefined;
    const sourceDimensionKeys = insightDimensions
      ? new Set(insightDimensions.map(({ key }) => key))
      : undefined;
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        id: keywordId,
        workspaceId,
        projectId,
        status: { in: ["ACTIVE", "DELETED"] }
      },
      select: {
        id: true,
        note: true,
        memberships: {
          where: {
            projectId,
            group: { workspaceId, projectId, status: "ACTIVE" }
          },
          orderBy: [
            { createdAt: "asc" },
            { groupId: "asc" }
          ],
          take: 201,
          select: {
            group: {
              select: {
                id: true,
                name: true,
                path: true,
                color: true,
                systemKind: true
              }
            }
          }
        }
      }
    });
    if (!keyword) {
      throw new HttpException("Keyword not found", HttpStatus.NOT_FOUND);
    }
    const mergedSources = await this.prisma.keywordMerge?.findMany({
      where: {
        workspaceId,
        projectId,
        targetKeywordId: keywordId
      },
      orderBy: [{ createdAt: "asc" }, { sourceKeywordId: "asc" }],
      take: 1_000,
      select: { sourceKeywordId: true }
    }) ?? [];
    const keywordIdentityIds = [
      keywordId,
      ...mergedSources.map(({ sourceKeywordId }) => sourceKeywordId)
    ];
    const rankDeletions = await this.prisma.rankDimensionHistoryDeletion.findMany({
      where: { workspaceId, projectId },
      orderBy: { excludedThrough: "desc" },
      take: 2_000,
      select: {
        searchEngine: true,
        countryCode: true,
        regionCode: true,
        language: true,
        device: true,
        excludedThrough: true
      }
    });
    const [
      frequencies,
      seasonalityPoints,
      currentRanks,
      rankSnapshots,
      aiPositionSnapshots,
      aiSourceSnapshots
    ] = await Promise.all([
      this.prisma.frequencySnapshot.findMany({
        where: {
          workspaceId,
          projectId,
          keywordId: { in: keywordIdentityIds }
        },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        take: 100
      }),
      this.prisma.frequencySeasonalityPoint.findMany({
        where: { workspaceId, projectId, keywordId: { in: keywordIdentityIds } },
        orderBy: [
          { observedAt: "desc" },
          { jobId: "desc" },
          { periodStart: "asc" },
          { id: "asc" }
        ],
        take: 1_000
      }),
      this.prisma.currentRank.findMany({
        where: { workspaceId, projectId, keywordId: { in: keywordIdentityIds } },
        orderBy: [{ observedAt: "desc" }, { snapshotId: "desc" }],
        take: 200
      }),
      this.prisma.rankSnapshot.findMany({
        where: {
          workspaceId,
          projectId,
          keywordId: { in: keywordIdentityIds },
          ...(snapshotId ? { id: snapshotId } : {}),
          ...(insightDimensions
            ? {
                manifest: {
                  configuration: rankDimensionConfigurationWhereAny(
                    insightDimensions
                  )
                }
              }
            : {}),
          ...(rankDeletions.length === 0
            ? {}
            : { AND: rankDeletions.map(rankDeletionExclusionWhere) })
        },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        take: 240,
        select: {
          id: true,
          keywordId: true,
          trackingContextId: true,
          configurationVersion: true,
          provider: true,
          positionTrackingEnabled: true,
          found: true,
          position: true,
          observedAt: true,
          manifest: {
            select: { execution: true, projectDomain: true }
          }
        }
      }),
      this.prisma.aiAnswerSnapshot.findMany({
        where: {
          workspaceId,
          projectId,
          keywordId: { in: keywordIdentityIds },
          positionTrackingEnabled: true,
          ...(selectedDimension
            ? {
                searchEngine: selectedDimension.searchEngine,
                regionCode: {
                  in: insightDimensions!.map(({ regionCode }) => regionCode)
                },
                device: selectedDimension.device
              }
            : {})
        },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        take: 240,
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
          observedAt: true,
          sources: {
            orderBy: { position: "asc" },
            select: {
              position: true,
              url: true,
              title: true,
              description: true
            }
          }
        }
      }),
      this.prisma.aiAnswerSnapshot.findMany({
        where: {
          workspaceId,
          projectId,
          keywordId: { in: keywordIdentityIds },
          ...(selectedDimension
            ? {
                searchEngine: selectedDimension.searchEngine,
                regionCode: {
                  in: insightDimensions!.map(({ regionCode }) => regionCode)
                },
                device: selectedDimension.device
              }
            : {})
        },
        orderBy: [
          { searchEngine: "asc" },
          { observedAt: "desc" },
          { id: "desc" }
        ],
        distinct: ["searchEngine", "regionCode", "device"],
        take: 240,
        select: {
          id: true,
          answerPresent: true,
          searchEngine: true,
          regionCode: true,
          device: true,
          observedAt: true,
          sources: {
            orderBy: { position: "asc" },
            select: {
              position: true,
              url: true,
              title: true,
              description: true
            }
          }
        }
      })
    ]);
    const rankRows = [...currentRanks, ...rankSnapshots];
    const contextIds = [...new Set(rankRows.map(({ trackingContextId }) => trackingContextId))];
    const [contexts, configurations] = contextIds.length === 0
      ? [[], []] as const
      : await Promise.all([
          this.prisma.trackingContext.findMany({
            where: {
              workspaceId,
              projectId,
              id: { in: contextIds }
            },
            select: { id: true, name: true }
          }),
          this.prisma.trackingContextVersion.findMany({
            where: {
              workspaceId,
              projectId,
              OR: uniqueRankConfigurationReferences(rankRows)
            },
            select: {
              contextId: true,
              configurationVersion: true,
              searchEngine: true,
              device: true,
              regionCode: true,
              regionLabel: true,
              countryCode: true,
              language: true,
              depth: true
            }
          })
        ]);
    const contextById = new Map(contexts.map((context) => [context.id, context]));
    const configurationById = new Map(
      configurations.map((configuration) => [
        `${configuration.contextId}:${configuration.configurationVersion}`,
        configuration
      ])
    );
    const latestCurrentRankByDimension = new Map<string, (typeof currentRanks)[number]>();
    for (const rank of currentRanks) {
      const configuration = configurationById.get(
        `${rank.trackingContextId}:${rank.configurationVersion}`
      );
      if (!(
        configuration &&
        (!sourceDimensionKeys || sourceDimensionKeys.has(
          rankDimensionMetadata(configuration).dimensionKey
        )) &&
        !rankIsExcluded(rank.observedAt, configuration, rankDeletions)
      )) continue;
      const key = resolvedRankDimensionMetadata(
        configuration,
        selectedDimension,
        sourceDimensionKeys,
        dimensionMergeTargets
      ).dimensionKey;
      if (!latestCurrentRankByDimension.has(key)) {
        latestCurrentRankByDimension.set(key, rank);
      }
    }
    const visibleCurrentRanks = [...latestCurrentRankByDimension.values()];
    const currentRankAnchors = visibleCurrentRanks.flatMap((rank) => {
      const configuration = configurationById.get(
        `${rank.trackingContextId}:${rank.configurationVersion}`
      );
      if (!configuration) return [];
      return [{
        keywordId: rank.keywordId,
        searchEngine: configuration.searchEngine as RankSearchEngine,
        observedAt: rank.observedAt,
        snapshotId: rank.snapshotId
      }];
    });
    const previousPositions = await previousFoundPositions(
      this.prisma,
      workspaceId,
      projectId,
      currentRankAnchors
    );
    const serpCandidateSnapshots = rankSnapshots.filter(
      ({ provider }) =>
        provider === "ARSENKIN" ||
        provider === "XMLSTOCK" ||
        provider === "KEY_COLLECTOR"
    );
    const rankSerpResults = serpCandidateSnapshots.length === 0
      ? []
      : await this.prisma.rankSerpResult.findMany({
          where: {
            snapshotId: {
              in: serpCandidateSnapshots.map(({ id }) => id)
            },
            // The general inspector shows a compact TOP-10 preview. A
            // dimension-specific request powers the "several site URLs"
            // modal and must include the whole captured depth: the second
            // project URL can legitimately be at position 43 or below.
            ...(selectedDimension ? {} : { position: { lte: 10 } }),
            snapshot: {
              workspaceId,
              projectId,
              keywordId: { in: keywordIdentityIds }
            }
          },
          orderBy: [
            { snapshotObservedAt: "desc" },
            { snapshotId: "desc" },
            { position: "asc" }
          ]
        });
    const serpResultsBySnapshotId = new Map<
      string,
      typeof rankSerpResults
    >();
    for (const result of rankSerpResults) {
      const rows = serpResultsBySnapshotId.get(result.snapshotId) ?? [];
      serpResultsBySnapshotId.set(result.snapshotId, [...rows, result]);
    }
    const latestSerpSnapshotByEngine = new Map<
      string,
      (typeof rankSnapshots)[number]
    >();
    for (const snapshot of serpCandidateSnapshots) {
      if ((serpResultsBySnapshotId.get(snapshot.id)?.length ?? 0) === 0) {
        continue;
      }
      const configuration = configurationById.get(
        `${snapshot.trackingContextId}:${snapshot.configurationVersion}`
      );
      if (
        configuration &&
        !latestSerpSnapshotByEngine.has(
          resolvedRankDimensionMetadata(
            configuration,
            selectedDimension,
            sourceDimensionKeys,
            dimensionMergeTargets
          ).dimensionKey
        )
      ) {
        latestSerpSnapshotByEngine.set(
          resolvedRankDimensionMetadata(
            configuration,
            selectedDimension,
            sourceDimensionKeys,
            dimensionMergeTargets
          ).dimensionKey,
          snapshot
        );
      }
    }
    const latestSerpSnapshots = [...latestSerpSnapshotByEngine.values()];
    const keywordGroups = [...(keyword.memberships ?? [])]
      .map(({ group }) => ({
        ...group,
        path: group.path ?? group.name
      }))
      .sort((left, right) =>
        left.path.localeCompare(right.path, "ru", { sensitivity: "base" }) ||
        left.id.localeCompare(right.id)
      );
    return {
      keywordId,
      ...(keyword.note ? { note: keyword.note } : {}),
      groups: keywordGroups.slice(0, 200).map((group) => ({
        id: group.id,
        name: group.name,
        path: group.path,
        ...(group.color ? { color: group.color } : {}),
        ...(group.systemKind ? { systemKind: group.systemKind } : {})
      })),
      ...(keywordGroups.length > 200 ? { groupsTruncated: true } : {}),
      frequencies: frequencies.map((snapshot) => ({
        type: frequencyType(snapshot.type),
        regionCode: snapshot.regionCode,
        device: frequencyDevice(snapshot.device),
        ...(snapshot.period === null ? {} : { period: snapshot.period }),
        ...(snapshot.value === null ? {} : { value: snapshot.value.toString() }),
        provider: snapshot.provider,
        sourceMode: snapshot.sourceMode,
        jobId: snapshot.jobId,
        qualityFlags: frequencyQualityFlags(snapshot.qualityFlags),
        observedAt: snapshot.observedAt.toISOString()
      })),
      seasonality: latestSeasonalityPoints(seasonalityPoints).map((point) => ({
        type: frequencyType(point.type),
        granularity: frequencySeasonalityGranularity(point.granularity),
        periodStart: point.periodStart.toISOString().slice(0, 10),
        value: point.value.toString(),
        // Prisma Decimal switches small values to exponent notation in
        // `toString()`. The public contract deliberately uses a plain decimal
        // string, so keep all scale digits emitted by the DECIMAL(24, 18)
        // column without scientific notation.
        ...(point.share === null ? {} : { share: point.share.toFixed() }),
        regionCode: point.regionCode,
        device: frequencyDevice(point.device),
        provider: frequencyProvider(point.provider),
        sourceMode: frequencySeasonalitySourceMode(point.sourceMode),
        jobId: point.jobId,
        observedAt: point.observedAt.toISOString()
      })),
      positions: visibleCurrentRanks.flatMap((rank) => {
        const context = contextById.get(rank.trackingContextId);
        const configuration = configurationById.get(
          `${rank.trackingContextId}:${rank.configurationVersion}`
        );
        if (!context || !configuration) return [];
        const searchEngine = configuration.searchEngine as RankSearchEngine;
        const previousPosition = previousPositions.get(
          previousFoundPositionKey(
            rank.keywordId,
            searchEngine,
            rank.observedAt,
            rank.snapshotId
          )
        );
        return [{
          ...resolvedRankDimensionMetadata(
            configuration,
            selectedDimension,
            sourceDimensionKeys,
            dimensionMergeTargets
          ),
          trackingContextId: rank.trackingContextId,
          contextName: context.name,
          found: rank.found,
          ...(rank.position === null ? {} : { position: rank.position }),
          ...(previousPosition === undefined ? {} : { previousPosition }),
          ...(rank.rankingUrl === null || rank.rankingUrl === undefined ? {} : { rankingUrl: rank.rankingUrl }),
          observedAt: rank.observedAt.toISOString()
        }];
      }),
      positionHistory: rankSnapshots.flatMap((snapshot) => {
        if (!snapshot.positionTrackingEnabled) return [];
        const context = contextById.get(snapshot.trackingContextId);
        const configuration = configurationById.get(
          `${snapshot.trackingContextId}:${snapshot.configurationVersion}`
        );
        if (!context || !configuration) return [];
        const searchSource = rankHistorySearchSource(
          snapshot.manifest.execution,
          configuration.searchEngine
        );
        return [{
          ...resolvedRankDimensionMetadata(
            configuration,
            selectedDimension,
            sourceDimensionKeys,
            dimensionMergeTargets
          ),
          snapshotId: snapshot.id,
          trackingContextId: snapshot.trackingContextId,
          contextName: context.name,
          ...(searchSource ? { searchSource } : {}),
          depth: configuration.depth,
          provider: rankHistoryProvider(snapshot.provider),
          found: snapshot.found,
          ...(snapshot.position === null ? {} : { position: snapshot.position }),
          observedAt: snapshot.observedAt.toISOString()
        }];
      }),
      competitorSnapshots: latestSerpSnapshots.flatMap((snapshot) => {
        const context = contextById.get(snapshot.trackingContextId);
        const configuration = configurationById.get(
          `${snapshot.trackingContextId}:${snapshot.configurationVersion}`
        );
        const results = serpResultsBySnapshotId.get(snapshot.id) ?? [];
        if (!context || !configuration || results.length === 0) return [];
        const searchSource = rankHistorySearchSource(
          snapshot.manifest.execution,
          configuration.searchEngine
        );
        return [{
          ...resolvedRankDimensionMetadata(
            configuration,
            selectedDimension,
            sourceDimensionKeys,
            dimensionMergeTargets
          ),
          snapshotId: snapshot.id,
          trackingContextId: snapshot.trackingContextId,
          contextName: context.name,
          ...(searchSource ? { searchSource } : {}),
          provider: competitorSnapshotProvider(snapshot.provider),
          observedAt: snapshot.observedAt.toISOString(),
          results: results.map((result) => ({
            position: result.position,
            url: result.rankingUrl,
            ...(result.faviconUrl === null || result.faviconUrl === undefined
              ? {}
              : { faviconUrl: result.faviconUrl }),
            ...(result.title === null ? {} : { title: result.title }),
            ...(result.snippet === null ? {} : { snippet: result.snippet })
          }))
        }];
      }),
      aiPositionHistory: aiPositionSnapshots.map((snapshot) => ({
        snapshotId: snapshot.id,
        keywordId,
        searchEngine: snapshot.searchEngine as SemanticAiAnswerHistoryItem["searchEngine"],
        regionCode: snapshot.regionCode,
        device: snapshot.device as SemanticAiAnswerHistoryItem["device"],
        answerPresent: snapshot.answerPresent,
        siteFound: snapshot.siteFound,
        ...(snapshot.position === null ? {} : { position: snapshot.position }),
        ...(snapshot.rankingUrl === null ? {} : { rankingUrl: snapshot.rankingUrl }),
        brandFound: snapshot.brandFound,
        provider: "ARSENKIN" as const,
        results: snapshot.sources.map((source) => ({
          position: source.position,
          url: source.url,
          ...(source.title === null ? {} : { title: source.title }),
          ...(source.description === null ? {} : { snippet: source.description })
        })),
        observedAt: snapshot.observedAt.toISOString()
      })),
      aiCompetitorSnapshots: aiSourceSnapshots.map((snapshot) => ({
        ...(typeof snapshot.answerPresent === "boolean" ? { answerPresent: snapshot.answerPresent } : {}),
        snapshotId: snapshot.id,
        searchEngine: snapshot.searchEngine as SemanticAiAnswerHistoryItem["searchEngine"],
        regionCode: snapshot.regionCode,
        device: snapshot.device as SemanticAiAnswerHistoryItem["device"],
        provider: "ARSENKIN" as const,
        observedAt: snapshot.observedAt.toISOString(),
        results: snapshot.sources.map((source) => ({
          position: source.position,
          url: source.url,
          ...(source.title === null ? {} : { title: source.title }),
          ...(source.description === null ? {} : { snippet: source.description })
        }))
      }))
    };
  }

  public async deleteFrequencyContext(
    workspaceId: string,
    projectId: string,
    keywordId: string,
    type: SemanticFrequencyType,
    regionCode: string,
    device: SemanticFrequencyDevice
  ): Promise<void> {
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        id: keywordId,
        workspaceId,
        projectId,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (!keyword) {
      throw new HttpException("Keyword not found", HttpStatus.NOT_FOUND);
    }
    await this.prisma.frequencySnapshot.deleteMany({
      where: {
        workspaceId,
        projectId,
        keywordId,
        type,
        regionCode,
        device
      }
    });
  }

  public async create(
    input: InternalCreateSemanticKeywordInput,
    semanticVersion?: SemanticVersionIdentity
  ): Promise<SemanticKeywordListItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const normalized = normalizeRequiredKeyword(input.text);
        const normalizedHash = sha256(normalized);
        await lockStoredKeywordCapacity(
          transaction,
          input.workspaceId
        );
        await lockSemanticKeywordWrites(transaction, input.projectId);
        const existing = await transaction.keyword.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            language: input.language,
            normalizedHash
          },
          include: KEYWORD_INCLUDE
        });
        const isActiveDuplicate = existing?.status === "ACTIVE";
        const isTrashedDuplicate = existing?.status === "DELETED"
          ? Boolean(
              await transaction.keywordGroupMembership.findFirst({
                where: {
                  projectId: input.projectId,
                  keywordId: existing.id,
                  group: {
                    workspaceId: input.workspaceId,
                    projectId: input.projectId,
                    status: "ACTIVE",
                    systemKind: "TRASH"
                  }
                },
                select: { keywordId: true }
              })
            )
          : false;
        const duplicateGroupId = input.duplicateGroupId ?? input.groupId;
        if (
          existing &&
          isActiveDuplicate &&
          (input.duplicatePolicy === "ADD_TO_GROUP" ||
            input.duplicatePolicy === "MOVE_TO_GROUP") &&
          duplicateGroupId
        ) {
          const linked = await linkActiveKeywordToGroup(
            transaction,
            input.workspaceId,
            input.projectId,
            existing.id,
            duplicateGroupId,
            input.actorId,
            existing.version,
            input.duplicatePolicy === "MOVE_TO_GROUP"
          );
          if (!linked.changed) {
            return {
              ...keywordItem(
                linked.after,
                await targetUrlFor(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  linked.after.targetPageId
                ),
                await clusterNameFor(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  linked.after.clusterId
                ),
                [],
                [],
                linked.group
              ),
              createOutcome: "SKIPPED_EXISTING"
            };
          }
          const change = {
            entityId: linked.after.id,
            operation: "UPDATE" as const,
            beforeState: keywordVersionState(linked.before),
            afterState: keywordVersionState(linked.after),
            beforeVersion: existing.version,
            afterVersion: linked.after.version
          };
          if (semanticVersion) {
            await this.semanticVersions.appendBulkKeywordChange(
              transaction,
              semanticVersion,
              change
            );
          } else {
            await this.semanticVersions.createWithKeywordChange(
              transaction,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                reason: "KEYWORD_CREATE",
                summary: input.duplicatePolicy === "MOVE_TO_GROUP"
                  ? "Существующий запрос перенесён в папку"
                  : "Добавлен существующий запрос в папку"
              },
              change
            );
          }
          return {
            ...keywordItem(
              linked.after,
              await targetUrlFor(
                transaction,
                input.workspaceId,
                input.projectId,
                linked.after.targetPageId
              ),
              await clusterNameFor(
                transaction,
                input.workspaceId,
                input.projectId,
                linked.after.clusterId
              ),
              [],
              [],
              linked.group
            ),
            createOutcome: "LINKED_EXISTING"
          };
        }
        if (
          existing &&
          (isActiveDuplicate ||
            (isTrashedDuplicate && input.duplicatePolicy !== "RESTORE_TRASHED"))
        ) {
          if (
            input.duplicatePolicy === "REJECT_EXISTING" &&
            !isTrashedDuplicate
          ) {
            throw duplicateKeyword();
          }
          return {
            ...keywordItem(
              existing,
              await targetUrlFor(
                transaction,
                input.workspaceId,
                input.projectId,
                existing.targetPageId
              ),
              await clusterNameFor(
                transaction,
                input.workspaceId,
                input.projectId,
                existing.clusterId
              )
            ),
            createOutcome: "SKIPPED_EXISTING"
          };
        }
        if (!existing) {
          await assertStoredKeywordCapacity(
            transaction,
            input.workspaceId,
            input.projectId,
            1n,
            input.entitlement
          );
        }
        await lockKeywordGroupTree(transaction, input.projectId);
        if (input.clusterId) {
          await lockSemanticClusterSet(transaction, input.projectId);
        }
        const writeGroupId = existing ? duplicateGroupId : input.groupId;
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          writeGroupId
        );
        const systemGroups = await ensureKeywordSystemGroupIds(
          transaction,
          input.workspaceId,
          input.projectId
        );
        await assertCluster(
          transaction,
          input.workspaceId,
          input.projectId,
          input.clusterId
        );
        const pageId = input.targetUrl
          ? await resolvePage(
              transaction,
              input.workspaceId,
              input.projectId,
              input.actorId,
              input.targetUrl
            )
          : undefined;
        const tags = await resolveTags(
          transaction,
          input.workspaceId,
          input.projectId,
          input.tagNames
        );
        if (existing) {
          await lockKeyword(transaction, input.projectId, existing.id);
          const beforeState = keywordVersionState(existing);
          const restored = await transaction.keyword.updateMany({
            where: {
              id: existing.id,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              status: "DELETED",
              version: existing.version,
              language: input.language,
              normalizedHash
            },
            data: {
              textOriginal: input.text,
              note: input.note ?? null,
              textNormalized: normalized,
              normalizedHash,
              language: input.language,
              priority: input.priority,
              isFavorite: input.isFavorite,
              isTracked: input.isTracked ?? true,
              intent: input.intent ?? null,
              clusterId: input.clusterId ?? null,
              targetPageId: pageId ?? null,
              status: "ACTIVE",
              deletedAt: null,
              updatedBy: input.actorId,
              version: { increment: 1 }
            }
          });
          if (restored.count !== 1) {
            throw keywordVersionConflict(existing.version);
          }
          await transaction.keywordGroupMembership.deleteMany({
            where: { projectId: input.projectId, keywordId: existing.id }
          });
          await transaction.keywordGroupMembership.create({
            data: {
              projectId: input.projectId,
              keywordId: existing.id,
              groupId: writeGroupId ?? systemGroups.UNGROUPED
            }
          });
          await transaction.keywordTag.deleteMany({
            where: { projectId: input.projectId, keywordId: existing.id }
          });
          if (tags.length > 0) {
            await transaction.keywordTag.createMany({
              data: tags.map((tag) => ({
                projectId: input.projectId,
                keywordId: existing.id,
                tagId: tag.id
              }))
            });
          }
          const result = await requiredKeyword(
            transaction,
            input.workspaceId,
            input.projectId,
            existing.id
          );
          const change = {
            entityId: result.id,
            operation: "UPDATE" as const,
            beforeState,
            afterState: keywordVersionState(result),
            beforeVersion: existing.version,
            afterVersion: result.version
          };
          if (semanticVersion) {
            await this.semanticVersions.appendBulkKeywordChange(
              transaction,
              semanticVersion,
              change
            );
          } else {
            await this.semanticVersions.createWithKeywordChange(
              transaction,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                reason: "KEYWORD_CREATE",
                summary: "Восстановлен поисковый запрос"
              },
              change
            );
          }
          return {
            ...keywordItem(
              result,
              input.targetUrl,
              await clusterNameFor(
                transaction,
                input.workspaceId,
                input.projectId,
                result.clusterId
              )
            ),
            createOutcome: "RESTORED"
          };
        }
        const created = await transaction.keyword.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            textOriginal: input.text,
            note: input.note ?? null,
            textNormalized: normalized,
            normalizedHash,
            language: input.language,
            priority: input.priority,
            isFavorite: input.isFavorite,
            isTracked: input.isTracked ?? true,
            ...(input.intent ? { intent: input.intent } : {}),
            ...(input.clusterId ? { clusterId: input.clusterId } : {}),
            ...(pageId ? { targetPageId: pageId } : {}),
            sourceMode: "MANUAL",
            createdBy: input.actorId,
            updatedBy: input.actorId
          }
        });
        await transaction.keywordGroupMembership.create({
          data: {
            projectId: input.projectId,
            keywordId: created.id,
            groupId: input.groupId ?? systemGroups.UNGROUPED
          }
        });
        if (tags.length > 0) {
          await transaction.keywordTag.createMany({
            data: tags.map((tag) => ({
              projectId: input.projectId,
              keywordId: created.id,
              tagId: tag.id
            }))
          });
        }
        const result = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          created.id
        );
        const change = {
          entityId: result.id,
          operation: "CREATE" as const,
          beforeState: null,
          afterState: keywordVersionState(result),
          beforeVersion: null,
          afterVersion: result.version
        };
        if (semanticVersion) {
          await this.semanticVersions.appendBulkKeywordChange(
            transaction,
            semanticVersion,
            change
          );
        } else {
          await this.semanticVersions.createWithKeywordChange(
            transaction,
            {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              actorId: input.actorId,
              reason: "KEYWORD_CREATE",
              summary: "Добавлен поисковый запрос"
            },
            change
          );
        }
        return {
          ...keywordItem(
            result,
            input.targetUrl,
            await clusterNameFor(
              transaction,
              input.workspaceId,
              input.projectId,
              result.clusterId
            )
          ),
          createOutcome: "CREATED"
        };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateKeyword();
      throw error;
    }
  }

  public async bulkCreate(
    input: InternalSemanticKeywordBulkCreateInput
  ): Promise<SemanticKeywordBulkCreateResult> {
    const semanticVersion =
      await this.semanticVersions.createOpenBulkVersion({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        reason: "KEYWORD_CREATE",
        summary: `Добавление ${input.items.length} запросов`
      });
    const rows: SemanticKeywordBulkCreateResult["rows"][number][] = [];
    try {
      for (const [index, item] of input.items.entries()) {
        try {
          const keyword = await this.create(
            {
              ...item,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              actorId: input.actorId,
              entitlement: input.entitlement,
              duplicatePolicy: item.duplicatePolicy ?? input.duplicatePolicy
            },
            semanticVersion
          );
          rows.push({
            index,
            outcome: keyword.createOutcome ?? "CREATED",
            keywordId: keyword.id,
            version: keyword.version,
            ...(keyword.trashed === true ? { trashed: true } : {})
          });
        } catch (error) {
          const code = semanticKeywordCreateErrorCode(error);
          rows.push({
            index,
            outcome: code === "DUPLICATE" ? "REJECTED_EXISTING" : "FAILED",
            errorCode: code
          });
        }
      }
    } finally {
      await this.semanticVersions.finalizeBulkVersion(semanticVersion);
    }
    const count = (outcome: SemanticKeywordCreateOutcome): number =>
      rows.filter((row) => row.outcome === outcome).length;
    return {
      selected: rows.length,
      created: count("CREATED"),
      restored: count("RESTORED"),
      linked: count("LINKED_EXISTING"),
      skipped: count("SKIPPED_EXISTING"),
      rejected: count("REJECTED_EXISTING"),
      failed: count("FAILED"),
      rows
    };
  }

  public async previewBulkCreate(
    input: InternalSemanticKeywordBulkCreatePreviewInput
  ): Promise<SemanticKeywordBulkCreatePreviewResult> {
    const candidates = input.items.map((item) => {
      const normalized = normalizeRequiredKeyword(item.text);
      return {
        ...item,
        normalizedHash: sha256(normalized)
      };
    });
    const lookupKeys = [
      ...new Map(
        candidates.map((candidate) => [
          cleaningKey(candidate.language, candidate.normalizedHash),
          {
            language: candidate.language,
            normalizedHash: candidate.normalizedHash
          }
        ] as const)
      ).values()
    ];
    const matches = lookupKeys.length === 0
      ? []
      : await this.prisma.keyword.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            OR: lookupKeys
          },
          select: {
            id: true,
            language: true,
            normalizedHash: true,
            status: true,
            version: true,
            memberships: {
              where: {
                projectId: input.projectId,
                group: {
                  workspaceId: input.workspaceId,
                  projectId: input.projectId,
                  status: "ACTIVE"
                }
              },
              orderBy: { createdAt: "asc" },
              take: semanticKeywordBulkCreatePreviewMaxGroups + 1,
              select: {
                group: {
                  select: {
                    id: true,
                    name: true,
                    path: true,
                    systemKind: true
                  }
                }
              }
            }
          }
        });
    const matchByKey = new Map(
      matches.map((match) => [
        cleaningKey(match.language, match.normalizedHash),
        match
      ] as const)
    );
    const targetPairs = [
      ...new Map(
        candidates.flatMap((candidate) => {
          if (!candidate.groupId) return [];
          const match = matchByKey.get(
            cleaningKey(candidate.language, candidate.normalizedHash)
          );
          return match
            ? [[
                cleaningKey(match.id, candidate.groupId),
                { keywordId: match.id, groupId: candidate.groupId }
              ] as const]
            : [];
        })
      ).values()
    ];
    const targetMemberships = targetPairs.length === 0
      ? []
      : await this.prisma.keywordGroupMembership.findMany({
          where: {
            projectId: input.projectId,
            OR: targetPairs,
            group: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              status: "ACTIVE"
            }
          },
          select: {
            keywordId: true,
            group: {
              select: {
                id: true,
                name: true,
                path: true,
                systemKind: true
              }
            }
          }
        });
    const targetMembershipByKey = new Map(
      targetMemberships.map(({ keywordId, group }) => [
        cleaningKey(keywordId, group.id),
        {
          id: group.id,
          name: group.name,
          path: group.path ?? group.name,
          ...(group.systemKind === null
            ? {}
            : { systemKind: group.systemKind })
        }
      ] as const)
    );
    const rows: SemanticKeywordBulkCreatePreviewResult["rows"][number][] =
      candidates.map((candidate, index) => {
        const match = matchByKey.get(
          cleaningKey(candidate.language, candidate.normalizedHash)
        );
        if (!match) {
          return {
            index,
            state: "NEW",
            groups: [],
            groupsTruncated: false,
            inTargetGroup: false
          };
        }
        const memberships = match.memberships.map(({ group }) => ({
          id: group.id,
          name: group.name,
          path: group.path ?? group.name,
          ...(group.systemKind === null
            ? {}
            : { systemKind: group.systemKind })
        }));
        const targetMembership = candidate.groupId
          ? memberships.find(({ id }) => id === candidate.groupId) ??
            targetMembershipByKey.get(
              cleaningKey(match.id, candidate.groupId)
            )
          : undefined;
        let groups = memberships.slice(
          0,
          semanticKeywordBulkCreatePreviewMaxGroups
        );
        if (
          targetMembership &&
          !groups.some(({ id }) => id === targetMembership.id)
        ) {
          groups = [
            ...groups.slice(0, semanticKeywordBulkCreatePreviewMaxGroups - 1),
            targetMembership
          ];
        }
        const trashed = memberships.some(
          ({ systemKind }) => systemKind === "TRASH"
        );
        return {
          index,
          state: match.status === "ACTIVE"
            ? "ACTIVE_DUPLICATE"
            : trashed
              ? "TRASHED_DUPLICATE"
              : "RESTORABLE_DELETED",
          keywordId: match.id,
          version: match.version,
          groups,
          groupsTruncated:
            memberships.length > semanticKeywordBulkCreatePreviewMaxGroups,
          inTargetGroup: targetMembership !== undefined
        };
      });
    const count = (
      state: SemanticKeywordBulkCreatePreviewResult["rows"][number]["state"]
    ): number => rows.filter((row) => row.state === state).length;
    return {
      selected: rows.length,
      newKeywords: count("NEW"),
      activeDuplicates: count("ACTIVE_DUPLICATE"),
      trashedDuplicates: count("TRASHED_DUPLICATE"),
      restorableDeleted: count("RESTORABLE_DELETED"),
      rows
    };
  }

  public async update(
    keywordId: string,
    input: InternalUpdateSemanticKeywordInput,
    semanticVersion?: SemanticVersionIdentity
  ): Promise<SemanticKeywordListItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockSemanticKeywordWrites(transaction, input.projectId);
        if (input.groupId !== undefined) {
          await lockKeywordGroupTree(transaction, input.projectId);
        }
        await lockKeyword(transaction, input.projectId, keywordId);
        if (input.clusterId !== undefined) {
          await lockSemanticClusterSet(transaction, input.projectId);
        }
        const current = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId,
          input.groupId !== undefined
        );
        const beforeState = keywordVersionState(current);
        assertKeywordVersion(current.version, input.version);
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          input.groupId
        );
        await assertCluster(
          transaction,
          input.workspaceId,
          input.projectId,
          input.clusterId
        );
        const pageId =
          input.targetUrl === undefined
            ? undefined
            : input.targetUrl === null
              ? null
              : await resolvePage(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  input.actorId,
                  input.targetUrl
                );
        const tags =
          input.tagNames === undefined
            ? undefined
            : await resolveTags(
                transaction,
                input.workspaceId,
                input.projectId,
                input.tagNames
              );
        if (input.tagNames !== undefined && (input.addTagNames !== undefined || input.removeTagNames !== undefined)) {
          throw new HttpException({ code: "VALIDATION_FAILED", message: "Use either tag replacement or tag changes" }, HttpStatus.BAD_REQUEST);
        }
        const removedNames = new Set((input.removeTagNames ?? []).map(normalizeTagName));
        const removedTagIds = current.tags.filter(({ tag }) => removedNames.has(normalizeTagName(tag.name))).map(({ tag }) => tag.id);
        const addedTags = input.addTagNames === undefined ? [] : await resolveTags(transaction, input.workspaceId, input.projectId, input.addTagNames, true);
        if (input.addTagNames !== undefined || input.removeTagNames !== undefined) {
          const retained = current.tags.filter(({ tag }) => !removedTagIds.includes(tag.id)).map(({ tag }) => tag.id);
          // Preserve legacy rows above the cap; a delta may reduce their tags
          // without silently truncating them, but cannot increase that count.
          if (new Set([...retained, ...addedTags.map(tag => tag.id)]).size > Math.max(50, current.tags.length)) {
            throw new HttpException({ code: "VALIDATION_FAILED", message: "У одного запроса может быть не больше 50 тегов. Существующие теги сохранены." }, HttpStatus.BAD_REQUEST);
          }
        }
        const normalized =
          input.text === undefined
            ? undefined
            : normalizeRequiredKeyword(input.text);
        await transaction.keyword.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: keywordId
            }
          },
          data: {
            ...(input.text === undefined
              ? {}
              : {
                  textOriginal: input.text,
                  textNormalized: normalized!,
                  normalizedHash: sha256(normalized!)
                }),
            ...(input.note === undefined ? {} : { note: input.note }),
            ...(input.language === undefined
              ? {}
              : { language: input.language }),
            ...(input.priority === undefined
              ? {}
              : { priority: input.priority }),
            ...(input.isFavorite === undefined
              ? {}
              : { isFavorite: input.isFavorite }),
            ...(input.isTracked === undefined
              ? {}
              : { isTracked: input.isTracked }),
            ...(input.showAiAnswerButton === undefined
              ? {}
              : { showAiAnswerButton: input.showAiAnswerButton }),
            ...(input.intent === undefined ? {} : { intent: input.intent }),
            ...(input.clusterId === undefined
              ? {}
              : { clusterId: input.clusterId }),
            ...(pageId === undefined ? {} : { targetPageId: pageId }),
            ...(current.status === "DELETED" && input.groupId !== undefined
              ? { status: "ACTIVE" as const, deletedAt: null }
              : {}),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        if (input.groupId !== undefined) {
          const systemGroups = await ensureKeywordSystemGroupIds(
            transaction,
            input.workspaceId,
            input.projectId
          );
          await transaction.keywordGroupMembership.deleteMany({
            where: { projectId: input.projectId, keywordId }
          });
          await transaction.keywordGroupMembership.create({
            data: {
              projectId: input.projectId,
              keywordId,
              groupId: input.groupId ?? systemGroups.UNGROUPED
            }
          });
        }
        if (tags !== undefined) {
          await transaction.keywordTag.deleteMany({
            where: { projectId: input.projectId, keywordId }
          });
          if (tags.length > 0) {
            await transaction.keywordTag.createMany({
              data: tags.map((tag) => ({
                projectId: input.projectId,
                keywordId,
                tagId: tag.id
              }))
            });
          }
        }
        if (removedTagIds.length > 0) {
          await transaction.keywordTag.deleteMany({ where: { projectId: input.projectId, keywordId, tagId: { in: removedTagIds } } });
        }
        if (addedTags.length > 0) {
          await transaction.keywordTag.createMany({ data: addedTags.map(tag => ({ projectId: input.projectId, keywordId, tagId: tag.id })), skipDuplicates: true });
        }
        const result = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId
        );
        const targetUrl =
          input.targetUrl === undefined
            ? await targetUrlFor(
                transaction,
                input.workspaceId,
                input.projectId,
                result.targetPageId
              )
            : (input.targetUrl ?? undefined);
        const afterState = keywordVersionState(result);
        if (!sameKeywordVersionState(beforeState, afterState)) {
          const change = {
            entityId: result.id,
            operation: "UPDATE" as const,
            beforeState,
            afterState,
            beforeVersion: current.version,
            afterVersion: result.version
          };
          if (semanticVersion) {
            await this.semanticVersions.appendBulkKeywordChange(
              transaction,
              semanticVersion,
              change
            );
          } else {
            await this.semanticVersions.createWithKeywordChange(
              transaction,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                reason: "KEYWORD_UPDATE",
                summary: "Изменён поисковый запрос"
              },
              change
            );
          }
        }
        return keywordItem(
          result,
          targetUrl,
          await clusterNameFor(
            transaction,
            input.workspaceId,
            input.projectId,
            result.clusterId
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateKeyword();
      throw error;
    }
  }

  public async merge(
    input: InternalSemanticKeywordMergeInput
  ): Promise<SemanticKeywordMergeResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockSemanticKeywordWrites(transaction, input.projectId);
      const ids = [input.keeper.id, ...input.sources.map(({ id }) => id)]
        .sort((left, right) => left.localeCompare(right));
      for (const keywordId of ids) {
        await lockKeyword(transaction, input.projectId, keywordId);
      }
      const keywords = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          id: { in: ids },
          status: "ACTIVE"
        },
        include: KEYWORD_MUTATION_INCLUDE
      });
      if (keywords.length !== ids.length) {
        throw new HttpException(
          { code: "NOT_FOUND", message: "Один из запросов больше недоступен" },
          HttpStatus.NOT_FOUND
        );
      }
      const byId = new Map(keywords.map((keyword) => [keyword.id, keyword]));
      const keeper = byId.get(input.keeper.id)!;
      assertKeywordVersion(keeper.version, input.keeper.version);
      const sources = input.sources.map((selection) => {
        const source = byId.get(selection.id)!;
        assertKeywordVersion(source.version, selection.version);
        if (source.language !== keeper.language) {
          throw new HttpException(
            { code: "VALIDATION_FAILED", message: "Объединять можно запросы одного языка" },
            HttpStatus.BAD_REQUEST
          );
        }
        return source;
      });
      const existingSourceMerges = await transaction.keywordMerge.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          sourceKeywordId: { in: ids }
        },
        select: { sourceKeywordId: true }
      });
      if (existingSourceMerges.length > 0) {
        throw new ConflictException("Keyword merge target changed");
      }

      const memberships = [
        ...keeper.memberships,
        ...sources.flatMap(({ memberships }) => memberships)
      ];
      const regularGroupIds = new Set(
        memberships.flatMap(({ group }) =>
          group.systemKind === null ? [group.id] : []
        )
      );
      const ungroupedGroupIds = new Set(
        memberships.flatMap(({ group }) =>
          group.systemKind === "UNGROUPED" ? [group.id] : []
        )
      );
      const groupIds = regularGroupIds.size > 0
        ? regularGroupIds
        : new Set([...ungroupedGroupIds].slice(0, 1));
      const tagIds = new Set([
        ...keeper.tags.map(({ tag }) => tag.id),
        ...sources.flatMap(({ tags }) => tags.map(({ tag }) => tag.id))
      ]);
      const sourceIds = sources.map(({ id }) => id);
      const mergedAt = new Date();

      await transaction.keywordMerge.updateMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          targetKeywordId: { in: sourceIds }
        },
        data: { targetKeywordId: keeper.id }
      });
      await transaction.keywordMerge.createMany({
        data: sources.map((source) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          sourceKeywordId: source.id,
          targetKeywordId: keeper.id,
          sourceText: source.textOriginal,
          sourceLanguage: source.language,
          createdBy: input.actorId,
          createdAt: mergedAt
        }))
      });

      if (groupIds.size > 0) {
        if (regularGroupIds.size > 0 && ungroupedGroupIds.size > 0) {
          await transaction.keywordGroupMembership.deleteMany({
            where: {
              projectId: input.projectId,
              keywordId: keeper.id,
              groupId: { in: [...ungroupedGroupIds] }
            }
          });
        }
        await transaction.keywordGroupMembership.createMany({
          data: [...groupIds].map((groupId) => ({
            projectId: input.projectId,
            keywordId: keeper.id,
            groupId
          })),
          skipDuplicates: true
        });
      }
      if (tagIds.size > 0) {
        await transaction.keywordTag.createMany({
          data: [...tagIds].map((tagId) => ({
            projectId: input.projectId,
            keywordId: keeper.id,
            tagId
          })),
          skipDuplicates: true
        });
      }
      const sourceCustomValues = sources.flatMap(
        ({ typedCustomValues }) => typedCustomValues
      );
      if (sourceCustomValues.length > 0) {
        await transaction.semanticKeywordCustomValue.createMany({
          data: sourceCustomValues.map((value) => ({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            keywordId: keeper.id,
            columnId: value.columnId,
            textValue: value.textValue,
            integerValue: value.integerValue,
            decimalValue: value.decimalValue,
            booleanValue: value.booleanValue,
            dateValue: value.dateValue,
            datetimeValue: value.datetimeValue,
            stringArrayValue: value.stringArrayValue,
            userId: value.userId,
            updatedBy: input.actorId
          })),
          skipDuplicates: true
        });
      }
      const activeSourceAssignments = await transaction.trackingContextKeywordAssignment.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          keywordId: { in: sourceIds },
          removedAt: null
        },
        select: { contextId: true }
      });
      if (activeSourceAssignments.length > 0) {
        await transaction.trackingContextKeywordAssignment.createMany({
          data: [...new Set(activeSourceAssignments.map(({ contextId }) => contextId))]
            .map((contextId) => ({
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              contextId,
              keywordId: keeper.id,
              assignedBy: input.actorId,
              assignedAt: mergedAt
            })),
          skipDuplicates: true
        });
        await transaction.trackingContextKeywordAssignment.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            keywordId: { in: sourceIds },
            removedAt: null
          },
          data: {
            removedBy: input.actorId,
            removedAt: mergedAt
          }
        });
      }

      const updatedKeeper = await transaction.keyword.update({
        where: { id: keeper.id },
        data: {
          priority: Math.max(keeper.priority, ...sources.map(({ priority }) => priority)),
          isFavorite: keeper.isFavorite || sources.some(({ isFavorite }) => isFavorite),
          isTracked: keeper.isTracked || sources.some(({ isTracked }) => isTracked),
          showAiAnswerButton:
            keeper.showAiAnswerButton ||
            sources.some(({ showAiAnswerButton }) => showAiAnswerButton),
          intent: keeper.intent ?? sources.find(({ intent }) => intent)?.intent ?? null,
          clusterId: keeper.clusterId ?? sources.find(({ clusterId }) => clusterId)?.clusterId ?? null,
          targetPageId:
            keeper.targetPageId ??
            sources.find(({ targetPageId }) => targetPageId)?.targetPageId ??
            null,
          note: mergeKeywordNotes(
            keeper.note,
            sources.map(({ note }) => note)
          ),
          customValues: mergeLegacyKeywordValues(
            keeper.customValues,
            sources.map(({ customValues }) => customValues)
          ),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      await transaction.keyword.updateMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          id: { in: sourceIds },
          status: "ACTIVE"
        },
        data: {
          status: "DELETED",
          deletedAt: mergedAt,
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      await transaction.keywordGroupMembership.deleteMany({
        where: { projectId: input.projectId, keywordId: { in: sourceIds } }
      });
      await transaction.keywordTag.deleteMany({
        where: { projectId: input.projectId, keywordId: { in: sourceIds } }
      });
      await transaction.semanticKeywordCustomValue.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          keywordId: { in: sourceIds }
        }
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: "semantics.keyword.merged.v1",
          aggregateId: keeper.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          payload: {
            keeperKeywordId: keeper.id,
            mergedKeywordIds: sourceIds,
            mergedAt: mergedAt.toISOString()
          },
          metadata: {
            producer: "seo-data",
            source: "keyword-merge"
          }
        }
      });
      return {
        keeperKeywordId: keeper.id,
        keeperVersion: updatedKeeper.version,
        mergedKeywordIds: sourceIds,
        mergedAt: mergedAt.toISOString()
      };
    });
  }

  public async delete(
    keywordId: string,
    input: InternalDeleteSemanticKeywordInput
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await lockKeywordGroupTree(transaction, input.projectId);
      await lockKeyword(transaction, input.projectId, keywordId);
      const current = await transaction.keyword.findUnique({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: keywordId
          }
        },
        include: KEYWORD_MUTATION_INCLUDE
      });
      if (!current) {
        throw new HttpException(
          { code: "NOT_FOUND", message: "Semantic keyword not found" },
          HttpStatus.NOT_FOUND
        );
      }
      if (current.memberships.length > 2_000) {
        throw new ConflictException("Keyword has too many folder memberships");
      }
      const beforeState = keywordVersionState(current);
      assertKeywordVersion(current.version, input.version);
      const systemGroups = await ensureKeywordSystemGroupIds(
        transaction,
        input.workspaceId,
        input.projectId
      );
      if (input.permanent === true) {
        const isTrashed =
          current.status === "DELETED" &&
          current.memberships.some(
            ({ group }) => group.id === systemGroups.TRASH
          );
        if (!isTrashed) {
          throw new HttpException(
            {
              code: "RESOURCE_STATE_CONFLICT",
              message: "Only trashed keywords can be permanently deleted"
            },
            HttpStatus.CONFLICT
          );
        }
        // Rank manifests and snapshots are deliberately immutable. Removing
        // their keyword row would either violate provenance FKs or require
        // weakening the audit trail. Permanent deletion therefore destroys
        // every user-controlled keyword value and releases its unique
        // identity while retaining an opaque tombstone for historical rows.
        await transaction.keywordGroupMembership.deleteMany({
          where: { projectId: input.projectId, keywordId }
        });
        await transaction.keywordTag.deleteMany({
          where: { projectId: input.projectId, keywordId }
        });
        await transaction.semanticKeywordCustomValue.deleteMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            keywordId
          }
        });
        await transaction.keyword.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: keywordId
            }
          },
          data: {
            textOriginal: "",
            textNormalized: `__purged__:${keywordId}`,
            normalizedHash: sha256(
              `purged:${input.workspaceId}:${input.projectId}:${keywordId}`
            ),
            language: "und",
            priority: 0,
            isFavorite: false,
            showAiAnswerButton: false,
            intent: null,
            clusterId: null,
            targetPageId: null,
            isTracked: false,
            customValues: {},
            note: null,
            sourceMode: "MANUAL",
            sourceId: null,
            createdBy: null,
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        return;
      }
      if (current.status !== "ACTIVE") {
        throw new HttpException(
          { code: "NOT_FOUND", message: "Semantic keyword not found" },
          HttpStatus.NOT_FOUND
        );
      }
      await transaction.keywordGroupMembership.deleteMany({
        where: { projectId: input.projectId, keywordId }
      });
      await transaction.keywordGroupMembership.create({
        data: {
          projectId: input.projectId,
          keywordId,
          groupId: systemGroups.TRASH
        }
      });
      await transaction.keyword.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: keywordId
          }
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      await this.semanticVersions.createWithKeywordChange(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "KEYWORD_DELETE",
          summary: "Удалён поисковый запрос"
        },
        {
          entityId: current.id,
          operation: "DELETE",
          beforeState,
          afterState: {
            ...beforeState,
            status: "DELETED",
            groupId: systemGroups.TRASH
          },
          beforeVersion: current.version,
          afterVersion: current.version + 1
        }
      );
    });
  }

  public async bulkUpdate(
    input: InternalSemanticKeywordBulkInput
  ): Promise<SemanticKeywordBulkResult> {
    const semanticVersion =
      await this.semanticVersions.createOpenBulkVersion({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        reason: "BULK_UPDATE",
        summary: `Массовое изменение ${input.items.length} запросов`
      });
    const updatedItems: SemanticKeywordListItem[] = [];
    const conflictedIds: string[] = [];
    const skippedIds: string[] = [];
    const failedIds: string[] = [];
    try {
      for (const item of input.items) {
        try {
          updatedItems.push(
            await this.update(
              item.id,
              {
                ...input.patch,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                version: item.version
              },
              semanticVersion
            )
          );
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          const status = error.getStatus();
          if (status === HttpStatus.PRECONDITION_FAILED) {
            conflictedIds.push(item.id);
          } else if (status === HttpStatus.NOT_FOUND) {
            skippedIds.push(item.id);
          } else if (
            status === HttpStatus.BAD_REQUEST ||
            status === HttpStatus.CONFLICT
          ) {
            failedIds.push(item.id);
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      await this.semanticVersions.finalizeBulkVersion(semanticVersion);
      throw error;
    }
    await this.semanticVersions.finalizeBulkVersion(semanticVersion);
    return {
      selected: input.items.length,
      changed: updatedItems.length,
      skipped: skippedIds.length,
      failed: failedIds.length,
      conflicted: conflictedIds.length,
      updatedItems,
      conflictedIds,
      skippedIds,
      failedIds
    };
  }

  public async previewCleaning(
    input: InternalSemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningPreview> {
    const rows = await this.prisma.keyword.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        id: { in: input.items.map(({ id }) => id) }
      },
      select: {
        id: true,
        textOriginal: true,
        language: true,
        version: true
      }
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const candidates: CleaningCandidate[] = input.items.map((item) => {
      const row = byId.get(item.id);
      if (!row) {
        return {
          keywordId: item.id,
          state: "UNAVAILABLE",
          expectedVersion: item.version
        };
      }
      const afterText = cleanKeywordText(row.textOriginal, input.rules);
      const change = {
        keywordId: item.id,
        expectedVersion: item.version,
        currentVersion: row.version,
        beforeText: row.textOriginal,
        afterText
      } as const;
      if (row.version !== item.version) {
        return { ...change, state: "CONFLICTED" };
      }
      const normalized = normalizeKeywordText(afterText);
      if (!normalized || Buffer.byteLength(afterText, "utf8") > 2_000) {
        return { ...change, state: "INVALID" };
      }
      if (afterText === row.textOriginal) {
        return { ...change, state: "UNCHANGED" };
      }
      return {
        ...change,
        state: "APPLICABLE",
        language: row.language,
        normalizedHash: sha256(normalized)
      };
    });
    const applicable = candidates.filter(
      (candidate): candidate is ApplicableCleaningCandidate =>
        candidate.state === "APPLICABLE"
    );
    const occupants = applicable.length === 0
      ? []
      : await this.prisma.keyword.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            OR: applicable.map(({ language, normalizedHash }) => ({
              language,
              normalizedHash
            }))
          },
          select: { id: true, language: true, normalizedHash: true }
        });
    const targetCounts = new Map<string, number>();
    for (const candidate of applicable) {
      const key = cleaningKey(candidate.language, candidate.normalizedHash);
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }
    const changes = candidates.map((candidate) => {
      if (!isApplicableCleaningCandidate(candidate)) {
        return publicCleaningChange(candidate);
      }
      const key = cleaningKey(candidate.language, candidate.normalizedHash);
      const duplicate =
        (targetCounts.get(key) ?? 0) > 1 ||
        occupants.some(
          (occupant) =>
            occupant.id !== candidate.keywordId &&
            cleaningKey(occupant.language, occupant.normalizedHash) === key
        );
      return publicCleaningChange(
        duplicate ? { ...candidate, state: "DUPLICATE" } : candidate
      );
    });
    return cleaningPreview(changes);
  }

  public async clean(
    input: InternalSemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningResult> {
    const preview = await this.previewCleaning(input);
    const updatedItems: SemanticKeywordListItem[] = [];
    const unchangedIds: string[] = [];
    const conflictedIds: string[] = [];
    const failedIds: string[] = [];
    const semanticVersion = preview.applicable > 0
      ? await this.semanticVersions.createOpenBulkVersion({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLEANING",
          summary: `Очистка ${input.items.length} запросов`
        })
      : undefined;
    try {
      for (const change of preview.changes) {
        if (change.state === "UNCHANGED") {
          unchangedIds.push(change.keywordId);
          continue;
        }
        if (change.state === "CONFLICTED") {
          conflictedIds.push(change.keywordId);
          continue;
        }
        if (change.state !== "APPLICABLE" || !semanticVersion) {
          failedIds.push(change.keywordId);
          continue;
        }
        try {
          updatedItems.push(
            await this.update(
              change.keywordId,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                version: change.expectedVersion,
                text: change.afterText!
              },
              semanticVersion
            )
          );
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          if (error.getStatus() === HttpStatus.PRECONDITION_FAILED) {
            conflictedIds.push(change.keywordId);
          } else if (
            error.getStatus() === HttpStatus.NOT_FOUND ||
            error.getStatus() === HttpStatus.BAD_REQUEST ||
            error.getStatus() === HttpStatus.CONFLICT
          ) {
            failedIds.push(change.keywordId);
          } else {
            throw error;
          }
        }
      }
    } finally {
      if (semanticVersion) {
        await this.semanticVersions.finalizeBulkVersion(semanticVersion);
      }
    }
    return {
      selected: input.items.length,
      changed: updatedItems.length,
      unchanged: unchangedIds.length,
      conflicted: conflictedIds.length,
      failed: failedIds.length,
      updatedItems,
      unchangedIds,
      conflictedIds,
      failedIds
    };
  }
}

async function hydratedKeywordRows(
  prisma: PrismaService,
  where: Prisma.KeywordWhereInput,
  orderedIds: readonly string[]
): Promise<KeywordAggregate[]> {
  if (orderedIds.length === 0) return [];
  const hydrated: KeywordAggregate[] = [];
  for (
    let offset = 0;
    offset < orderedIds.length;
    offset += KEYWORD_AGGREGATE_HYDRATION_BATCH_SIZE
  ) {
    const ids = orderedIds.slice(
      offset,
      offset + KEYWORD_AGGREGATE_HYDRATION_BATCH_SIZE
    );
    hydrated.push(...await prisma.keyword.findMany({
      where: { ...where, id: { in: [...ids] } },
      include: KEYWORD_INCLUDE
    }));
  }
  const byId = new Map(hydrated.map((row) => [row.id, row]));
  return orderedIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

type CleaningCandidate = SemanticKeywordCleaningPreviewChange &
  Readonly<{ language?: string; normalizedHash?: string }>;

type ApplicableCleaningCandidate = CleaningCandidate &
  Readonly<{
    state: "APPLICABLE";
    language: string;
    normalizedHash: string;
  }>;

function isApplicableCleaningCandidate(
  candidate: CleaningCandidate
): candidate is ApplicableCleaningCandidate {
  return (
    candidate.state === "APPLICABLE" &&
    candidate.language !== undefined &&
    candidate.normalizedHash !== undefined
  );
}

function publicCleaningChange(
  candidate: CleaningCandidate
): SemanticKeywordCleaningPreviewChange {
  return {
    keywordId: candidate.keywordId,
    state: candidate.state,
    expectedVersion: candidate.expectedVersion,
    ...(candidate.currentVersion === undefined
      ? {}
      : { currentVersion: candidate.currentVersion }),
    ...(candidate.beforeText === undefined
      ? {}
      : { beforeText: candidate.beforeText }),
    ...(candidate.afterText === undefined
      ? {}
      : { afterText: candidate.afterText })
  };
}

function cleaningPreview(
  changes: readonly SemanticKeywordCleaningPreviewChange[]
): SemanticKeywordCleaningPreview {
  return {
    selected: changes.length,
    applicable: changes.filter(({ state }) => state === "APPLICABLE").length,
    unchanged: changes.filter(({ state }) => state === "UNCHANGED").length,
    conflicted: changes.filter(({ state }) => state === "CONFLICTED").length,
    failed: changes.filter(({ state }) =>
      ["UNAVAILABLE", "DUPLICATE", "INVALID"].includes(state)
    ).length,
    changes
  };
}

function cleaningKey(language: string, normalizedHash: string): string {
  return `${language}\u0000${normalizedHash}`;
}

async function requiredKeyword(
  transaction: Prisma.TransactionClient | PrismaService,
  workspaceId: string,
  projectId: string,
  keywordId: string,
  allowTrashedMove = false
): Promise<KeywordMutationAggregate> {
  const keyword = await transaction.keyword.findUnique({
    where: {
      workspaceId_projectId_id: { workspaceId, projectId, id: keywordId }
    },
    include: KEYWORD_MUTATION_INCLUDE
  });
  const movableTrash = Boolean(
    allowTrashedMove &&
    keyword?.status === "DELETED" &&
    keyword.memberships.some(({ group }) => group.systemKind === "TRASH")
  );
  if (!keyword || (keyword.status !== "ACTIVE" && !movableTrash)) {
    throw new HttpException(
      { code: "NOT_FOUND", message: "Semantic keyword not found" },
      HttpStatus.NOT_FOUND
    );
  }
  if (keyword.memberships.length > 2_000) {
    throw new ConflictException("Keyword has too many folder memberships");
  }
  return keyword;
}

async function assertGroup(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  groupId: string | null | undefined
): Promise<void> {
  if (!groupId) return;
  const group = await transaction.keywordGroup.findFirst({
    where: { id: groupId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true, systemKind: true }
  });
  if (!group || group.systemKind === "TRASH") {
    throw new BadRequestException("Keyword group does not belong to project");
  }
}

async function linkActiveKeywordToGroup(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  keywordId: string,
  groupId: string,
  actorId: string,
  expectedVersion: number,
  replaceGroups = false
): Promise<Readonly<{
  group: { id: string; path: string | null; name: string };
  before: KeywordMutationAggregate;
  after: KeywordMutationAggregate;
  changed: boolean;
}>> {
  await lockKeywordGroupTree(transaction, projectId);
  const group = await transaction.keywordGroup.findFirst({
    where: { id: groupId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true, path: true, name: true, systemKind: true }
  });
  if (!group || group.systemKind !== null) {
    throw new BadRequestException(
      "An existing keyword can only be added to a regular project group"
    );
  }
  await lockKeyword(transaction, projectId, keywordId);
  const before = await requiredKeyword(
    transaction,
    workspaceId,
    projectId,
    keywordId
  );
  if (before.version !== expectedVersion) {
    throw keywordVersionConflict(expectedVersion);
  }
  const selectedGroup = { id: group.id, path: group.path, name: group.name };
  if (
    before.memberships.some(({ group: current }) => current.id === groupId) &&
    (!replaceGroups || before.memberships.length === 1)
  ) {
    return { group: selectedGroup, before, after: before, changed: false };
  }
  const updated = await transaction.keyword.updateMany({
    where: {
      id: keywordId,
      workspaceId,
      projectId,
      status: "ACTIVE",
      version: expectedVersion
    },
    data: {
      updatedBy: actorId,
      version: { increment: 1 }
    }
  });
  if (updated.count !== 1) throw keywordVersionConflict(expectedVersion);
  await transaction.keywordGroupMembership.deleteMany({
    where: replaceGroups
      ? { projectId, keywordId }
      : {
          projectId,
          keywordId,
          group: { workspaceId, projectId, systemKind: "UNGROUPED" }
        }
  });
  await transaction.keywordGroupMembership.create({
    data: { projectId, keywordId, groupId }
  });
  const after = await requiredKeyword(
    transaction,
    workspaceId,
    projectId,
    keywordId
  );
  return { group: selectedGroup, before, after, changed: true };
}

async function assertCluster(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string | null | undefined
): Promise<void> {
  if (!clusterId) return;
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true }
  });
  if (!cluster) {
    throw new BadRequestException("Semantic cluster does not belong to project");
  }
}

async function clusterNameFor(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string | null
): Promise<string | undefined> {
  if (!clusterId) return undefined;
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" },
    select: { name: true }
  });
  return cluster?.name;
}

async function resolveTags(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  names: readonly string[],
  preserveExistingName = false
): Promise<readonly { readonly id: string }[]> {
  const result: { id: string }[] = [];
  for (const name of names) {
    const normalizedName = normalizeTagName(name);
    const tag = await transaction.tag.upsert({
      where: {
        projectId_normalizedName: { projectId, normalizedName }
      },
      create: {
        workspaceId,
        projectId,
        name,
        normalizedName
      },
      update: {
        ...(preserveExistingName ? {} : { name }),
        status: "ACTIVE"
      },
      select: { id: true }
    });
    result.push(tag);
  }
  return result;
}

async function resolvePage(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  actorId: string,
  source: string
): Promise<string> {
  const normalized = normalizePageUrl(source, "targetUrl");
  const existing = await transaction.page.findUnique({
    where: {
      projectId_urlHash: { projectId, urlHash: normalized.hash }
    },
    select: { id: true, workspaceId: true, status: true }
  });
  if (
    existing &&
    (existing.workspaceId !== workspaceId || existing.status !== "ACTIVE")
  ) {
    throw new HttpException(
      {
        code: "RESOURCE_STATE_CONFLICT",
        message: "Target page is not an active page in this workspace"
      },
      HttpStatus.CONFLICT
    );
  }
  const page = await transaction.page.upsert({
    where: {
      projectId_urlHash: { projectId, urlHash: normalized.hash }
    },
    create: {
      workspaceId,
      projectId,
      url: normalized.original,
      normalizedUrl: normalized.normalized,
      urlHash: normalized.hash,
      createdBy: actorId,
      updatedBy: actorId
    },
    update: {
      // Page identity and lifecycle are owned by the Page Map. Assigning the
      // same URL to another keyword must not create an invisible page edit.
    },
    select: { id: true }
  });
  await transaction.pageSource.upsert({
    where: {
      pageId_source: { pageId: page.id, source: "MANUAL" }
    },
    create: {
      workspaceId,
      projectId,
      pageId: page.id,
      source: "MANUAL"
    },
    update: { lastSeenAt: new Date() }
  });
  return page.id;
}

async function targetUrlFor(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  pageId: string | null
): Promise<string | undefined> {
  if (!pageId) return undefined;
  const page = await transaction.page.findFirst({
    where: {
      id: pageId,
      workspaceId,
      projectId,
      status: "ACTIVE"
    },
    select: { url: true }
  });
  return page?.url;
}

async function lockKeyword(
  transaction: Prisma.TransactionClient,
  projectId: string,
  keywordId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "keywords"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${keywordId}::uuid
    FOR UPDATE
  `;
}

async function lockKeywordGroupTree(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-group-tree:${projectId}`}, 0)
    )
  `;
}

async function lockSemanticClusterSet(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-cluster-set:${projectId}`}, 0)
    )
  `;
}

function keywordItem(
  row: KeywordAggregate,
  targetUrl: string | undefined,
  clusterName?: string,
  frequencies: readonly SemanticKeywordListFrequencyValue[] = [],
  positions: readonly SemanticKeywordListPosition[] = [],
  displayGroup?: Readonly<{ id: string; path: string | null; name: string }>,
  aiAnswers: readonly SemanticAiAnswerSummary[] = [],
  hasMultipleRankingUrls = false,
  includeNote = false,
  groupMembershipCount = row._count?.memberships ?? row.memberships.filter(
    ({ group }) => group.systemKind === null
  ).length,
  rankComparison?: SemanticKeywordListItem["rankComparison"]
): SemanticKeywordListItem {
  const tags = row.tags.slice(0, 50).map(({ tag }) => tag.name);
  const group = displayGroup ?? row.memberships[0]?.group;
  const note = row.note?.trim() ? row.note : undefined;
  const baseFrequency = frequencies.find(({ type }) => type === "BASE");
  const legacyBaseFrequency = baseFrequency
    ? {
        ...(baseFrequency.value === undefined
          ? {}
          : { value: baseFrequency.value }),
        regionCode: baseFrequency.regionCode,
        device: baseFrequency.device,
        provider: baseFrequency.provider,
        observedAt: baseFrequency.observedAt
      }
    : undefined;
  return {
    id: row.id,
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    isTracked: row.isTracked,
    showAiAnswerButton: row.showAiAnswerButton,
    ...(row.intent
      ? {
          intent: row.intent as SemanticKeywordIntent
        }
      : {}),
    ...(group ? { groupId: group.id, groupPath: group.path ?? group.name } : {}),
    ...(groupMembershipCount > 1 ? { groupMembershipCount } : {}),
    ...(row.clusterId ? { clusterId: row.clusterId } : {}),
    ...(clusterName ? { clusterName } : {}),
    ...(row.targetPageId ? { targetPageId: row.targetPageId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tags,
    tagsTruncated: row.tags.length > 50,
    hasNote: note !== undefined,
    ...(includeNote && note !== undefined ? { note } : {}),
    ...(hasMultipleRankingUrls ? { hasMultipleRankingUrls: true } : {}),
    customValues: (row.typedCustomValues ?? []).map(keywordCustomValue),
    ...(legacyBaseFrequency ? { frequency: legacyBaseFrequency } : {}),
    ...(frequencies.length > 0 ? { frequencies } : {}),
    ...(positions.length > 0 ? { positions } : {}),
    ...(aiAnswers.length > 0 ? { aiAnswers } : {}),
    ...(rankComparison ? { rankComparison } : {}),
    sourceMode: row.sourceMode,
    ...(row.status === "DELETED" ? { trashed: true } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version
  };
}

function keywordVersionState(
  row: KeywordAggregate | KeywordMutationAggregate
): SemanticKeywordVersionState {
  const groupIds = row.memberships.map(({ group }) => group.id);
  return {
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    normalizedHash: row.normalizedHash,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    isTracked: row.isTracked,
    intent: row.intent,
    status: row.status === "DELETED" ? "DELETED" : "ACTIVE",
    clusterId: row.clusterId,
    targetPageId: row.targetPageId,
    groupId: groupIds[0] ?? null,
    ...(groupIds.length > 1 ? { groupIds } : {}),
    tagIds: row.tags.map(({ tag }) => tag.id)
  };
}

function sameKeywordVersionState(
  left: SemanticKeywordVersionState,
  right: SemanticKeywordVersionState
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeKeywordNotes(
  keeperNote: string | null,
  sourceNotes: readonly (string | null)[]
): string | null {
  const notes = [...new Set(
    [keeperNote, ...sourceNotes]
      .map((note) => note?.trim())
      .filter((note): note is string => Boolean(note))
  )];
  return notes.length > 0 ? notes.join("\n\n") : null;
}

function boundedTextSimilarity(left: string, right: string): number {
  const leftCharacters = Array.from(left.slice(0, 512));
  const rightCharacters = Array.from(right.slice(0, 512));
  const maximum = Math.max(leftCharacters.length, rightCharacters.length);
  if (maximum === 0) return 1;
  if (Math.abs(leftCharacters.length - rightCharacters.length) > maximum * 0.65) {
    return 0;
  }
  let previous = Array.from(
    { length: rightCharacters.length + 1 },
    (_, index) => index
  );
  for (let leftIndex = 0; leftIndex < leftCharacters.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < rightCharacters.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex]! + 1,
        previous[rightIndex + 1]! + 1,
        previous[rightIndex]! +
          (leftCharacters[leftIndex] === rightCharacters[rightIndex] ? 0 : 1)
      ));
    }
    previous = current;
  }
  return Math.max(0, 1 - previous[rightCharacters.length]! / maximum);
}

function mergeLegacyKeywordValues(
  keeper: Prisma.JsonValue,
  sources: readonly Prisma.JsonValue[]
): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const value of [...sources, keeper]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = item as Prisma.InputJsonValue;
    }
  }
  return result as Prisma.InputJsonObject;
}

function keywordCustomValue(
  row: KeywordAggregate["typedCustomValues"][number]
) {
  return {
    columnId: row.columnId,
    value: keywordCustomValueData(row),
    version: row.version,
    updatedAt: row.updatedAt.toISOString()
  };
}

function keywordCustomValueData(
  row: KeywordAggregate["typedCustomValues"][number]
) {
  switch (row.column.type) {
    case "TEXT":
    case "LONG_TEXT":
    case "SELECT":
    case "STATUS":
    case "URL":
      return row.textValue!;
    case "INTEGER":
      return Number(row.integerValue!);
    case "DECIMAL":
      return row.decimalValue!.toString();
    case "BOOLEAN":
      return row.booleanValue!;
    case "DATE":
      return row.dateValue!.toISOString().slice(0, 10);
    case "DATETIME":
      return row.datetimeValue!.toISOString();
    case "MULTI_SELECT":
      return row.stringArrayValue;
    case "USER":
      return row.userId!;
  }
}

function assertKeywordVersion(current: number, expected: number): void {
  if (current === expected) return;
  throw keywordVersionConflict(current);
}

function keywordVersionConflict(current: number): HttpException {
  return new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic keyword version conflict",
      currentVersion: current
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function duplicateKeyword(): HttpException {
  return new HttpException(
    {
      code: "DUPLICATE",
      message: "This keyword already exists in the project"
    },
    HttpStatus.CONFLICT
  );
}

function semanticKeywordCreateErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "object" && response !== null) {
      const body = response as Readonly<Record<string, unknown>>;
      if (typeof body.code === "string") return body.code;
      if (typeof body.error === "object" && body.error !== null) {
        const nested = body.error as Readonly<Record<string, unknown>>;
        if (typeof nested.code === "string") return nested.code;
      }
    }
    if (error.getStatus() === HttpStatus.BAD_REQUEST) return "INVALID_INPUT";
    if (error.getStatus() === HttpStatus.NOT_FOUND) return "NOT_FOUND";
    if (error.getStatus() === HttpStatus.CONFLICT) {
      return "RESOURCE_STATE_CONFLICT";
    }
  }
  return "INTERNAL_ERROR";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function normalizeRequiredKeyword(value: string): string {
  const normalized = normalizeKeywordText(value);
  if (!normalized) throw new BadRequestException("Keyword text is empty");
  return normalized;
}

function normalizeTagName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeCursor(value: KeywordCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  sort: SemanticKeywordSort,
  filterHash: string
): KeywordCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw invalidCursor();
  }
  const cursor = parsed as Readonly<Record<string, unknown>>;
  if (
    cursor.version !== 2 ||
    typeof cursor.id !== "string" ||
    !UUID_PATTERN.test(cursor.id) ||
    cursor.sort !== sort ||
    cursor.filterHash !== filterHash ||
    (typeof cursor.sortValue !== "string" &&
      typeof cursor.sortValue !== "number")
  ) {
    throw invalidCursor();
  }
  return {
    version: 2,
    id: cursor.id,
    sort,
    sortValue: cursor.sortValue,
    filterHash
  };
}

function keywordFilterHash(
  query: KeywordListQuery,
  normalizedSearch: string,
  normalizedTag: string
): string {
  return sha256(
    JSON.stringify({
      search: normalizedSearch,
      tag: normalizedTag,
      intent: query.intent ?? null,
      groupId: query.groupId ?? null,
      groupIds: query.groupIds ?? null,
      clusterId: query.clusterId ?? null,
      isFavorite: query.isFavorite ?? null,
      isTracked: query.isTracked ?? null,
      priorityMin: query.priorityMin ?? null,
      priorityMax: query.priorityMax ?? null,
      frequencyBaseMin: query.frequencyBaseMin ?? null,
      frequencyBaseMax: query.frequencyBaseMax ?? null,
      frequencyExactMin: query.frequencyExactMin ?? null,
      frequencyExactMax: query.frequencyExactMax ?? null,
      frequencyFixedMin: query.frequencyFixedMin ?? null,
      frequencyFixedMax: query.frequencyFixedMax ?? null,
      wordCountMin: query.wordCountMin ?? null,
      wordCountMax: query.wordCountMax ?? null,
      targetUrlState: query.targetUrlState ?? null,
      rankDimensionKey: query.rankDimensionKey ?? null,
      rankState: query.rankState ?? null,
      rankPositionMin: query.rankPositionMin ?? null,
      rankPositionMax: query.rankPositionMax ?? null,
      rankCheckedFrom: query.rankCheckedFrom ?? null,
      rankCheckedBefore: query.rankCheckedBefore ?? null,
      rankSortDimensionKey: query.rankSortDimensionKey ?? null,
      multiSearch: query.multiSearch ?? null
    })
  );
}

function keywordOrderBy(
  sort: SemanticKeywordSort
): Prisma.KeywordOrderByWithRelationInput[] {
  switch (sort) {
    case "CREATED_ASC":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "UPDATED_DESC":
      return [{ updatedAt: "desc" }, { id: "desc" }];
    case "UPDATED_ASC":
      return [{ updatedAt: "asc" }, { id: "asc" }];
    case "TEXT_ASC":
      return [{ textNormalized: "asc" }, { id: "asc" }];
    case "TEXT_DESC":
      return [{ textNormalized: "desc" }, { id: "desc" }];
    case "PRIORITY_DESC":
      return [{ priority: "desc" }, { id: "desc" }];
    case "PRIORITY_ASC":
      return [{ priority: "asc" }, { id: "asc" }];
    case "SOURCE_ASC":
      return [{ sourceMode: "asc" }, { id: "asc" }];
    case "SOURCE_DESC":
      return [{ sourceMode: "desc" }, { id: "desc" }];
    case "TAGS_ASC":
    case "TAGS_DESC":
      throw new Error("Tag keyword sorts are resolved by tagSortedKeywordPage");
    case "CREATED_DESC":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "FREQUENCY_BASE_DESC":
    case "FREQUENCY_BASE_ASC":
    case "FREQUENCY_EXACT_DESC":
    case "FREQUENCY_EXACT_ASC":
    case "FREQUENCY_FIXED_DESC":
    case "FREQUENCY_FIXED_ASC":
    case "YANDEX_POSITION_ASC":
    case "YANDEX_POSITION_DESC":
    case "GOOGLE_POSITION_ASC":
    case "GOOGLE_POSITION_DESC":
    case "YANDEX_CHECKED_AT_ASC":
    case "YANDEX_CHECKED_AT_DESC":
    case "GOOGLE_CHECKED_AT_ASC":
    case "GOOGLE_CHECKED_AT_DESC":
    case "YANDEX_AI_POSITION_ASC":
    case "YANDEX_AI_POSITION_DESC":
    case "GOOGLE_AI_POSITION_ASC":
    case "GOOGLE_AI_POSITION_DESC":
    case "YANDEX_AI_CHECKED_AT_ASC":
    case "YANDEX_AI_CHECKED_AT_DESC":
    case "GOOGLE_AI_CHECKED_AT_ASC":
    case "GOOGLE_AI_CHECKED_AT_DESC":
    case "RANK_POSITION_ASC":
    case "RANK_POSITION_DESC":
    case "RANK_CHECKED_AT_ASC":
    case "RANK_CHECKED_AT_DESC":
    case "RANK_AI_POSITION_ASC":
    case "RANK_AI_POSITION_DESC":
    case "RANK_AI_CHECKED_AT_ASC":
    case "RANK_AI_CHECKED_AT_DESC":
      throw new Error("Metric keyword sorts are resolved by metricSortedKeywordPage");
  }
}

function cursorValue(
  row: KeywordAggregate,
  sort: SemanticKeywordSort
): string | number {
  switch (sort) {
    case "CREATED_ASC":
    case "CREATED_DESC":
      return row.createdAt.toISOString();
    case "UPDATED_DESC":
    case "UPDATED_ASC":
      return row.updatedAt.toISOString();
    case "TEXT_ASC":
    case "TEXT_DESC":
      return row.textNormalized;
    case "PRIORITY_DESC":
    case "PRIORITY_ASC":
      return row.priority;
    case "SOURCE_ASC":
    case "SOURCE_DESC":
      return row.sourceMode;
    case "TAGS_ASC":
    case "TAGS_DESC":
      throw new Error("Tag cursor value is provided by tagSortedKeywordPage");
    case "FREQUENCY_BASE_DESC":
    case "FREQUENCY_BASE_ASC":
    case "FREQUENCY_EXACT_DESC":
    case "FREQUENCY_EXACT_ASC":
    case "FREQUENCY_FIXED_DESC":
    case "FREQUENCY_FIXED_ASC":
    case "YANDEX_POSITION_ASC":
    case "YANDEX_POSITION_DESC":
    case "GOOGLE_POSITION_ASC":
    case "GOOGLE_POSITION_DESC":
    case "YANDEX_CHECKED_AT_ASC":
    case "YANDEX_CHECKED_AT_DESC":
    case "GOOGLE_CHECKED_AT_ASC":
    case "GOOGLE_CHECKED_AT_DESC":
    case "YANDEX_AI_POSITION_ASC":
    case "YANDEX_AI_POSITION_DESC":
    case "GOOGLE_AI_POSITION_ASC":
    case "GOOGLE_AI_POSITION_DESC":
    case "YANDEX_AI_CHECKED_AT_ASC":
    case "YANDEX_AI_CHECKED_AT_DESC":
    case "GOOGLE_AI_CHECKED_AT_ASC":
    case "GOOGLE_AI_CHECKED_AT_DESC":
    case "RANK_POSITION_ASC":
    case "RANK_POSITION_DESC":
    case "RANK_CHECKED_AT_ASC":
    case "RANK_CHECKED_AT_DESC":
    case "RANK_AI_POSITION_ASC":
    case "RANK_AI_POSITION_DESC":
    case "RANK_AI_CHECKED_AT_ASC":
    case "RANK_AI_CHECKED_AT_DESC":
      throw new Error("Metric cursor value is provided by metricSortedKeywordPage");
  }
}

function cursorWhere(cursor: KeywordCursor): Prisma.KeywordWhereInput {
  if (isExternalKeywordSort(cursor.sort)) throw invalidCursor();
  const ascending = isAscendingKeywordSort(cursor.sort);
  const idDirection = ascending ? "gt" : "lt";
  const comparison = ascending ? "gt" : "lt";
  const field =
    cursor.sort === "UPDATED_DESC" || cursor.sort === "UPDATED_ASC"
      ? "updatedAt"
      : cursor.sort === "TEXT_ASC" || cursor.sort === "TEXT_DESC"
        ? "textNormalized"
        : cursor.sort === "PRIORITY_DESC" || cursor.sort === "PRIORITY_ASC"
          ? "priority"
          : cursor.sort === "SOURCE_ASC" || cursor.sort === "SOURCE_DESC"
            ? "sourceMode"
          : "createdAt";
  const value =
    field === "priority"
      ? requiredCursorNumber(cursor.sortValue)
      : field === "textNormalized" || field === "sourceMode"
        ? requiredCursorString(cursor.sortValue)
        : requiredCursorDate(cursor.sortValue);
  return {
    OR: [
      { [field]: { [comparison]: value } },
      {
        [field]: value,
        id: { [idDirection]: cursor.id }
      }
    ]
  };
}

function isMetricKeywordSort(sort: SemanticKeywordSort): boolean {
  return (
    sort.startsWith("FREQUENCY_") ||
    sort.startsWith("YANDEX_POSITION_") ||
    sort.startsWith("GOOGLE_POSITION_") ||
    sort.startsWith("YANDEX_CHECKED_AT_") ||
    sort.startsWith("GOOGLE_CHECKED_AT_") ||
    sort.startsWith("YANDEX_AI_POSITION_") ||
    sort.startsWith("GOOGLE_AI_POSITION_") ||
    sort.startsWith("YANDEX_AI_CHECKED_AT_") ||
    sort.startsWith("GOOGLE_AI_CHECKED_AT_") ||
    sort.startsWith("RANK_POSITION_") ||
    sort.startsWith("RANK_CHECKED_AT_") ||
    sort.startsWith("RANK_AI_POSITION_") ||
    sort.startsWith("RANK_AI_CHECKED_AT_")
  );
}

function isExternalKeywordSort(sort: SemanticKeywordSort): boolean {
  return isMetricKeywordSort(sort) || sort === "TAGS_ASC" || sort === "TAGS_DESC";
}

function previousFoundPositionKey(
  keywordId: string,
  searchEngine: RankSearchEngine,
  observedAt: Date,
  snapshotId: string
): string {
  return `${keywordId}:${searchEngine}:${observedAt.toISOString()}:${snapshotId}`;
}

function hasAdvancedKeywordFilters(query: KeywordListQuery): boolean {
  return [
    query.frequencyBaseMin, query.frequencyBaseMax, query.frequencyExactMin, query.frequencyExactMax,
    query.frequencyFixedMin, query.frequencyFixedMax, query.wordCountMin, query.wordCountMax,
    query.targetUrlState, query.rankState, query.rankPositionMin, query.rankPositionMax,
    query.rankCheckedFrom, query.rankCheckedBefore
  ].some(value => value !== undefined);
}

async function rawKeywordCount(
  prisma: PrismaService, workspaceId: string, projectId: string, query: KeywordListQuery,
  search: string, tag: string, keywordStatus: "ACTIVE" | "DELETED"
): Promise<number> {
  const filters = keywordRawFilters(workspaceId, projectId, query, search, tag, keywordStatus);
  const rows = await prisma.$queryRaw<readonly { count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM keywords k WHERE ${Prisma.join(filters, " AND ")}
  `;
  const count = rows[0]?.count;
  if (count === undefined || count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Keyword filter count is invalid");
  return Number(count);
}

async function rawSortedKeywordPage(
  prisma: PrismaService, workspaceId: string, projectId: string, query: KeywordListQuery,
  search: string, tag: string, sort: SemanticKeywordSort, cursor: KeywordCursor | undefined,
  keywordStatus: "ACTIVE" | "DELETED"
): Promise<Readonly<{ ids: readonly string[]; sortValueById: Map<string, string | number> }>> {
  const filters = keywordRawFilters(workspaceId, projectId, query, search, tag, keywordStatus);
  const ascending = isAscendingKeywordSort(sort), operator = ascending ? Prisma.sql`>` : Prisma.sql`<`;
  const direction = ascending ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  if (sort === "PRIORITY_ASC" || sort === "PRIORITY_DESC") {
    const value = cursor ? requiredCursorNumber(cursor.sortValue) : undefined;
    const rows = await prisma.$queryRaw<readonly { id: string; sort_value: number }[]>`
      SELECT k.id, k.priority AS sort_value FROM keywords k
      WHERE ${Prisma.join(filters, " AND ")}
        ${value === undefined ? Prisma.empty : Prisma.sql`AND (k.priority, k.id) ${operator} (${value}, ${cursor!.id}::uuid)`}
      ORDER BY k.priority ${direction}, k.id ${direction} LIMIT ${query.limit + 1}`;
    return { ids: rows.map(row => row.id), sortValueById: new Map(rows.map(row => [row.id, row.sort_value])) };
  }
  if (["TEXT_ASC", "TEXT_DESC", "SOURCE_ASC", "SOURCE_DESC"].includes(sort)) {
    const field = sort.startsWith("TEXT_") ? Prisma.sql`k.text_normalized` : Prisma.sql`k.source_mode::text`;
    const value = cursor ? requiredCursorString(cursor.sortValue) : undefined;
    const rows = await prisma.$queryRaw<readonly { id: string; sort_value: string }[]>`
      SELECT k.id, ${field} AS sort_value FROM keywords k
      WHERE ${Prisma.join(filters, " AND ")}
        ${value === undefined ? Prisma.empty : Prisma.sql`AND (${field}, k.id) ${operator} (${value}, ${cursor!.id}::uuid)`}
      ORDER BY ${field} ${direction}, k.id ${direction} LIMIT ${query.limit + 1}`;
    return { ids: rows.map(row => row.id), sortValueById: new Map(rows.map(row => [row.id, row.sort_value])) };
  }
  const field = sort.startsWith("UPDATED_") ? Prisma.sql`k.updated_at` : Prisma.sql`k.created_at`;
  const value = cursor ? requiredCursorDate(cursor.sortValue) : undefined;
  const rows = await prisma.$queryRaw<readonly { id: string; sort_value: Date }[]>`
    SELECT k.id, ${field} AS sort_value FROM keywords k
    WHERE ${Prisma.join(filters, " AND ")}
      ${value === undefined ? Prisma.empty : Prisma.sql`AND (${field}, k.id) ${operator} (${value}, ${cursor!.id}::uuid)`}
    ORDER BY ${field} ${direction}, k.id ${direction} LIMIT ${query.limit + 1}`;
  return { ids: rows.map(row => row.id), sortValueById: new Map(rows.map(row => [row.id, row.sort_value.toISOString()])) };
}

async function previousFoundPositions(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  anchors: readonly PreviousFoundPositionAnchor[]
): Promise<ReadonlyMap<string, number>> {
  if (anchors.length === 0) return new Map();
  const serializedAnchors = anchors.map((anchor) => ({
    keyword_id: anchor.keywordId,
    search_engine: anchor.searchEngine,
    observed_at: anchor.observedAt.toISOString(),
    snapshot_id: anchor.snapshotId
  }));
  const rows = await prisma.$queryRaw<readonly PreviousFoundPositionRow[]>`
    WITH anchors AS (
      SELECT
        anchor.keyword_id,
        anchor.search_engine,
        anchor.observed_at,
        anchor.snapshot_id
      FROM jsonb_to_recordset(${JSON.stringify(serializedAnchors)}::jsonb) AS anchor(
        keyword_id uuid,
        search_engine text,
        observed_at timestamptz,
        snapshot_id uuid
      )
    )
    SELECT
      anchors.keyword_id::text AS "keywordId",
      anchors.search_engine AS "searchEngine",
      anchors.observed_at AS "observedAt",
      anchors.snapshot_id::text AS "snapshotId",
      previous.position AS "previousPosition"
    FROM anchors
    INNER JOIN rank_snapshots current_snapshot
      ON current_snapshot.workspace_id = ${workspaceId}::uuid
     AND current_snapshot.project_id = ${projectId}::uuid
     AND current_snapshot.keyword_id = anchors.keyword_id
     AND current_snapshot.observed_at = anchors.observed_at
     AND current_snapshot.id = anchors.snapshot_id
    INNER JOIN tracking_context_versions current_configuration
      ON current_configuration.workspace_id = current_snapshot.workspace_id
     AND current_configuration.project_id = current_snapshot.project_id
     AND current_configuration.context_id = current_snapshot.tracking_context_id
     AND current_configuration.configuration_version = current_snapshot.configuration_version
    INNER JOIN LATERAL (
      SELECT snapshot.found, snapshot.position
      FROM rank_snapshots snapshot
      INNER JOIN tracking_context_versions configuration
        ON configuration.workspace_id = snapshot.workspace_id
       AND configuration.project_id = snapshot.project_id
       AND configuration.context_id = snapshot.tracking_context_id
       AND configuration.configuration_version = snapshot.configuration_version
      WHERE snapshot.workspace_id = ${workspaceId}::uuid
        AND snapshot.project_id = ${projectId}::uuid
        AND snapshot.keyword_id = anchors.keyword_id
        AND configuration.search_engine = current_configuration.search_engine
        AND configuration.country_code = current_configuration.country_code
        AND COALESCE(configuration.region_code, configuration.country_code) =
            COALESCE(current_configuration.region_code, current_configuration.country_code)
        AND configuration.language = current_configuration.language
        AND configuration.device = current_configuration.device
        AND snapshot.position_tracking_enabled = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM rank_dimension_history_deletions deletion
          WHERE deletion.workspace_id = snapshot.workspace_id
            AND deletion.project_id = snapshot.project_id
            AND deletion.search_engine = configuration.search_engine::text
            AND deletion.country_code = configuration.country_code
            AND deletion.region_code = COALESCE(configuration.region_code, configuration.country_code)
            AND deletion.language = configuration.language
            AND deletion.device = configuration.device::text
            AND snapshot.observed_at <= deletion.excluded_through
        )
        AND (snapshot.observed_at, snapshot.id) <
            (anchors.observed_at, anchors.snapshot_id)
      ORDER BY snapshot.observed_at DESC, snapshot.id DESC
      LIMIT 1
    ) previous ON previous.found = TRUE AND previous.position IS NOT NULL
    WHERE current_configuration.search_engine::text = anchors.search_engine
  `;
  const expectedKeys = new Set(
    anchors.map((anchor) =>
      previousFoundPositionKey(
        anchor.keywordId,
        anchor.searchEngine,
        anchor.observedAt,
        anchor.snapshotId
      )
    )
  );
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = previousFoundPositionKey(
      row.keywordId,
      row.searchEngine,
      row.observedAt,
      row.snapshotId
    );
    if (
      !expectedKeys.has(key) ||
      !Number.isSafeInteger(row.previousPosition) ||
      row.previousPosition <= 0 ||
      result.has(key)
    ) {
      throw new HttpException(
        "Invalid previous rank projection",
        HttpStatus.BAD_GATEWAY
      );
    }
    result.set(key, row.previousPosition);
  }
  return result;
}

async function metricSortedKeywordPage(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  query: KeywordListQuery,
  search: string,
  tag: string,
  sort: SemanticKeywordSort,
  cursor: KeywordCursor | undefined,
  keywordStatus: "ACTIVE" | "DELETED"
): Promise<Readonly<{
  ids: readonly string[];
  sortValueById: Map<string, string>;
}>> {
  const ascending = sort.endsWith("_ASC");
  const rankPositionSort =
    sort.startsWith("YANDEX_POSITION_") ||
    sort.startsWith("GOOGLE_POSITION_") ||
    sort.startsWith("RANK_POSITION_");
  const aiPositionSort =
    sort.startsWith("YANDEX_AI_POSITION_") ||
    sort.startsWith("GOOGLE_AI_POSITION_") ||
    sort.startsWith("RANK_AI_POSITION_");
  const aiCheckedAtSort =
    sort.startsWith("YANDEX_AI_CHECKED_AT_") ||
    sort.startsWith("GOOGLE_AI_CHECKED_AT_") ||
    sort.startsWith("RANK_AI_CHECKED_AT_");
  const rankSortDimension = query.rankSortDimensionKey
    ? parseSemanticRankDimensionKey(query.rankSortDimensionKey)
    : undefined;
  if (
    sort.startsWith("RANK_") &&
    !rankSortDimension
  ) {
    throw new Error("Validated rank sort dimension is invalid");
  }
  const positionBucket = 1_000_000n;
  const nullSentinel = aiPositionSort || rankPositionSort
    ? ascending
      ? positionBucket * 3n
      : 0n
      : ascending
        ? 9_223_372_036_854_775_807n
        : -1n;
  const rankEngine = rankSortDimension?.searchEngine ??
    (sort.startsWith("YANDEX_") ? "YANDEX" : "GOOGLE");
  const currentRankDimensionFilter = rankSortDimension
    ? Prisma.sql`
        AND tcv.country_code = ${rankSortDimension.countryCode}
        AND COALESCE(tcv.region_code, tcv.country_code) = ${rankSortDimension.regionCode}
        AND tcv.language = ${rankSortDimension.language}
        AND tcv.device::text = ${rankSortDimension.device}`
    : Prisma.empty;
  const previousRankDimensionFilter = rankSortDimension
    ? Prisma.sql`
        AND previous_tcv.country_code = ${rankSortDimension.countryCode}
        AND COALESCE(previous_tcv.region_code, previous_tcv.country_code) = ${rankSortDimension.regionCode}
        AND previous_tcv.language = ${rankSortDimension.language}
        AND previous_tcv.device::text = ${rankSortDimension.device}`
    : Prisma.empty;
  const positionMetric = ascending
    ? Prisma.sql`CASE
        WHEN latest_rank.found AND latest_rank.position IS NOT NULL
          THEN latest_rank.position::bigint
        WHEN latest_rank.historical_position IS NOT NULL
          THEN ${positionBucket}::bigint + latest_rank.historical_position::bigint
        ELSE ${positionBucket * 2n}::bigint
      END`
    : Prisma.sql`CASE
        WHEN latest_rank.found AND latest_rank.position IS NOT NULL
          THEN ${positionBucket * 3n}::bigint + latest_rank.position::bigint
        WHEN latest_rank.historical_position IS NOT NULL
          THEN ${positionBucket * 2n}::bigint + latest_rank.historical_position::bigint
        ELSE ${positionBucket}::bigint
      END`;
  const aiPositionMetric = ascending
    ? Prisma.sql`CASE
        WHEN latest_ai.site_found AND latest_ai.position IS NOT NULL
          THEN latest_ai.position::bigint
        WHEN latest_ai.historical_position IS NOT NULL
          THEN ${positionBucket}::bigint + latest_ai.historical_position::bigint
        ELSE ${positionBucket * 2n}::bigint
      END`
    : Prisma.sql`CASE
        WHEN latest_ai.site_found AND latest_ai.position IS NOT NULL
          THEN ${positionBucket * 3n}::bigint + latest_ai.position::bigint
        WHEN latest_ai.historical_position IS NOT NULL
          THEN ${positionBucket * 2n}::bigint + latest_ai.historical_position::bigint
        ELSE ${positionBucket}::bigint
      END`;
  const filters = keywordRawFilters(
    workspaceId,
    projectId,
    query,
    search,
    tag,
    keywordStatus
  );
  const metricJoin = sort.startsWith("FREQUENCY_")
    ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT fs.value AS metric
          FROM frequency_snapshots fs
          WHERE fs.workspace_id = k.workspace_id
            AND fs.project_id = k.project_id
            AND fs.keyword_id = k.id
            AND fs.type = ${frequencyTypeForSort(sort)}
          ORDER BY fs.observed_at DESC, fs.id DESC
          LIMIT 1
        ) metric_source ON TRUE`
    : aiPositionSort
      ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT ${aiPositionMetric} AS metric
          FROM (
            SELECT
              current_ai.site_found,
              current_ai.position,
              (
                SELECT CASE
                  WHEN previous.site_found = TRUE AND previous.position IS NOT NULL
                    THEN previous.position
                  ELSE NULL
                END
                FROM ai_answer_snapshots previous
                WHERE previous.workspace_id = current_ai.workspace_id
                  AND previous.project_id = current_ai.project_id
                  AND previous.keyword_id = current_ai.keyword_id
                  AND previous.search_engine = current_ai.search_engine
                  AND previous.region_code = current_ai.region_code
                  AND previous.device = current_ai.device
                  AND previous.position_tracking_enabled = TRUE
                  AND (previous.observed_at, previous.id) <
                      (current_ai.observed_at, current_ai.id)
                ORDER BY previous.observed_at DESC, previous.id DESC
                LIMIT 1
              ) AS historical_position
            FROM ai_answer_snapshots current_ai
            WHERE current_ai.workspace_id = k.workspace_id
              AND current_ai.project_id = k.project_id
              AND current_ai.keyword_id = k.id
              AND current_ai.search_engine = ${rankEngine}
              ${rankSortDimension
                ? Prisma.sql`
                  AND current_ai.region_code = ${rankSortDimension.regionCode}
                  AND current_ai.device::text = ${rankSortDimension.device}`
                : Prisma.empty}
              AND current_ai.position_tracking_enabled = TRUE
            ORDER BY current_ai.observed_at DESC, current_ai.id DESC
            LIMIT 1
          ) latest_ai
        ) metric_source ON TRUE`
      : aiCheckedAtSort
        ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT floor(extract(epoch from latest_ai.observed_at) * 1000)::bigint AS metric
          FROM ai_answer_snapshots latest_ai
          WHERE latest_ai.workspace_id = k.workspace_id
            AND latest_ai.project_id = k.project_id
            AND latest_ai.keyword_id = k.id
            AND latest_ai.search_engine = ${rankEngine}
            ${rankSortDimension
              ? Prisma.sql`
                AND latest_ai.region_code = ${rankSortDimension.regionCode}
                AND latest_ai.device::text = ${rankSortDimension.device}`
              : Prisma.empty}
            AND latest_ai.position_tracking_enabled = TRUE
          ORDER BY latest_ai.observed_at DESC, latest_ai.id DESC
          LIMIT 1
        ) metric_source ON TRUE`
      : rankPositionSort
      ? Prisma.sql`
        LEFT JOIN (
          WITH filtered_keywords AS MATERIALIZED (
            SELECT k.id FROM keywords k
            WHERE ${Prisma.join(filters, " AND ")}
          ), current_candidates AS MATERIALIZED (
            SELECT cr.keyword_id, cr.found, cr.position, cr.observed_at,
              cr.snapshot_id, tcv.country_code,
              COALESCE(tcv.region_code, tcv.country_code) AS region_code,
              tcv.language, tcv.device,
              row_number() OVER (
                PARTITION BY cr.keyword_id
                ORDER BY cr.observed_at DESC, cr.snapshot_id DESC,
                  cr.tracking_context_id DESC
              ) AS current_order
            FROM filtered_keywords selected
            JOIN current_ranks cr
              ON cr.workspace_id = ${workspaceId}::uuid
             AND cr.project_id = ${projectId}::uuid
             AND cr.keyword_id = selected.id
            JOIN tracking_context_versions tcv
              ON tcv.workspace_id = cr.workspace_id
             AND tcv.project_id = cr.project_id
             AND tcv.context_id = cr.tracking_context_id
             AND tcv.configuration_version = cr.configuration_version
            WHERE tcv.search_engine::text = ${rankEngine}
              ${currentRankDimensionFilter}
              AND NOT EXISTS (
                SELECT 1 FROM rank_dimension_history_deletions deletion
                WHERE deletion.workspace_id = cr.workspace_id
                  AND deletion.project_id = cr.project_id
                  AND deletion.search_engine = tcv.search_engine::text
                  AND deletion.country_code = tcv.country_code
                  AND deletion.region_code = COALESCE(tcv.region_code, tcv.country_code)
                  AND deletion.language = tcv.language
                  AND deletion.device = tcv.device::text
                  AND cr.observed_at <= deletion.excluded_through
              )
          ), latest_current AS MATERIALIZED (
            SELECT * FROM current_candidates WHERE current_order = 1
          ), previous_candidates AS MATERIALIZED (
            SELECT latest.keyword_id, snapshot.found, snapshot.position,
              row_number() OVER (
                PARTITION BY latest.keyword_id
                ORDER BY snapshot.observed_at DESC, snapshot.id DESC
              ) AS history_order
            FROM latest_current latest
            JOIN rank_snapshots snapshot
              ON snapshot.workspace_id = ${workspaceId}::uuid
             AND snapshot.project_id = ${projectId}::uuid
             AND snapshot.keyword_id = latest.keyword_id
            JOIN tracking_context_versions previous_tcv
              ON previous_tcv.workspace_id = snapshot.workspace_id
             AND previous_tcv.project_id = snapshot.project_id
             AND previous_tcv.context_id = snapshot.tracking_context_id
             AND previous_tcv.configuration_version = snapshot.configuration_version
            WHERE (latest.found = FALSE OR latest.position IS NULL)
              AND snapshot.position_tracking_enabled = TRUE
              AND (snapshot.observed_at, snapshot.id) <
                  (latest.observed_at, latest.snapshot_id)
              AND previous_tcv.search_engine::text = ${rankEngine}
              AND previous_tcv.country_code = latest.country_code
              AND COALESCE(previous_tcv.region_code, previous_tcv.country_code) =
                  latest.region_code
              AND previous_tcv.language = latest.language
              AND previous_tcv.device = latest.device
              ${previousRankDimensionFilter}
              AND NOT EXISTS (
                SELECT 1 FROM rank_dimension_history_deletions deletion
                WHERE deletion.workspace_id = snapshot.workspace_id
                  AND deletion.project_id = snapshot.project_id
                  AND deletion.search_engine = previous_tcv.search_engine::text
                  AND deletion.country_code = previous_tcv.country_code
                  AND deletion.region_code = COALESCE(previous_tcv.region_code, previous_tcv.country_code)
                  AND deletion.language = previous_tcv.language
                  AND deletion.device = previous_tcv.device::text
                  AND snapshot.observed_at <= deletion.excluded_through
              )
          )
          SELECT latest_rank.keyword_id, ${positionMetric} AS metric
          FROM (
            SELECT current.keyword_id, current.found, current.position,
              CASE WHEN previous.found THEN previous.position ELSE NULL END
                AS historical_position
            FROM latest_current current
            LEFT JOIN previous_candidates previous
              ON previous.keyword_id = current.keyword_id
             AND previous.history_order = 1
          ) latest_rank
        ) metric_source ON metric_source.keyword_id = k.id`
      : Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT floor(extract(epoch from cr.observed_at) * 1000)::bigint AS metric
          FROM current_ranks cr
          INNER JOIN tracking_context_versions tcv
            ON tcv.workspace_id = cr.workspace_id
           AND tcv.project_id = cr.project_id
           AND tcv.context_id = cr.tracking_context_id
           AND tcv.configuration_version = cr.configuration_version
          WHERE cr.workspace_id = k.workspace_id
            AND cr.project_id = k.project_id
            AND cr.keyword_id = k.id
            AND tcv.search_engine::text = ${rankEngine}
            ${currentRankDimensionFilter}
            AND NOT EXISTS (
              SELECT 1 FROM rank_dimension_history_deletions deletion
              WHERE deletion.workspace_id = cr.workspace_id
                AND deletion.project_id = cr.project_id
                AND deletion.search_engine = tcv.search_engine::text
                AND deletion.country_code = tcv.country_code
                AND deletion.region_code = COALESCE(tcv.region_code, tcv.country_code)
                AND deletion.language = tcv.language
                AND deletion.device = tcv.device::text
                AND cr.observed_at <= deletion.excluded_through
            )
          ORDER BY cr.observed_at DESC, cr.snapshot_id DESC,
                   cr.tracking_context_id DESC
          LIMIT 1
        ) metric_source ON TRUE`;
  const cursorValue = cursor
    ? requiredMetricCursorValue(cursor.sortValue)
    : undefined;
  const cursorClause = cursorValue === undefined
    ? Prisma.empty
    : ascending
      ? Prisma.sql`WHERE (ranked.sort_value, ranked.id) > (${cursorValue}::bigint, ${cursor!.id}::uuid)`
      : Prisma.sql`WHERE (ranked.sort_value, ranked.id) < (${cursorValue}::bigint, ${cursor!.id}::uuid)`;
  const order = ascending
    ? Prisma.sql`ranked.sort_value ASC, ranked.id ASC`
    : Prisma.sql`ranked.sort_value DESC, ranked.id DESC`;
  const rows = await prisma.$queryRaw<readonly Readonly<{ id: string; sort_value: bigint }>[]>
    `
      SELECT ranked.id, ranked.sort_value
      FROM (
        SELECT k.id, COALESCE(metric_source.metric, ${nullSentinel}::bigint) AS sort_value
        FROM keywords k
        ${metricJoin}
        WHERE ${Prisma.join(filters, " AND ")}
      ) ranked
      ${cursorClause}
      ORDER BY ${order}
      LIMIT ${query.limit + 1}
    `;
  return {
    ids: rows.map(({ id }) => id),
    sortValueById: new Map(rows.map(({ id, sort_value }) => [id, sort_value.toString()]))
  };
}

async function tagSortedKeywordPage(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  query: KeywordListQuery,
  search: string,
  tag: string,
  sort: SemanticKeywordSort,
  cursor: KeywordCursor | undefined,
  keywordStatus: "ACTIVE" | "DELETED"
): Promise<Readonly<{
  ids: readonly string[];
  sortValueById: Map<string, string>;
}>> {
  const ascending = sort === "TAGS_ASC";
  const missingValue = ascending ? "\u{10ffff}" : "";
  const filters = keywordRawFilters(
    workspaceId,
    projectId,
    query,
    search,
    tag,
    keywordStatus
  );
  const cursorValue = cursor
    ? requiredCursorString(cursor.sortValue)
    : undefined;
  const cursorClause = cursorValue === undefined
    ? Prisma.empty
    : ascending
      ? Prisma.sql`WHERE (ranked.sort_value, ranked.id) > (${cursorValue}::text, ${cursor!.id}::uuid)`
      : Prisma.sql`WHERE (ranked.sort_value, ranked.id) < (${cursorValue}::text, ${cursor!.id}::uuid)`;
  const order = ascending
    ? Prisma.sql`ranked.sort_value ASC, ranked.id ASC`
    : Prisma.sql`ranked.sort_value DESC, ranked.id DESC`;
  const rows = await prisma.$queryRaw<readonly Readonly<{
    id: string;
    sort_value: string;
  }>[]>`
    SELECT ranked.id, ranked.sort_value
    FROM (
      SELECT
        k.id,
        COALESCE(tag_source.tag_name, ${missingValue}::text) AS sort_value
      FROM keywords k
      LEFT JOIN LATERAL (
        SELECT MIN(t.normalized_name) AS tag_name
        FROM keyword_tags kt
        INNER JOIN tags t
          ON t.id = kt.tag_id
         AND t.workspace_id = k.workspace_id
         AND t.project_id = k.project_id
         AND t.status::text = 'ACTIVE'
        WHERE kt.project_id = k.project_id
          AND kt.keyword_id = k.id
      ) tag_source ON TRUE
      WHERE ${Prisma.join(filters, " AND ")}
    ) ranked
    ${cursorClause}
    ORDER BY ${order}
    LIMIT ${query.limit + 1}
  `;
  return {
    ids: rows.map(({ id }) => id),
    sortValueById: new Map(
      rows.map(({ id, sort_value }) => [id, sort_value])
    )
  };
}

function keywordRawFilters(
  workspaceId: string,
  projectId: string,
  query: KeywordListQuery,
  search: string,
  tag: string,
  keywordStatus: "ACTIVE" | "DELETED"
): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [
    Prisma.sql`k.workspace_id = ${workspaceId}::uuid`,
    Prisma.sql`k.project_id = ${projectId}::uuid`,
    Prisma.sql`k.status::text = ${keywordStatus}`
  ];
  if (search) filters.push(Prisma.sql`strpos(k.text_normalized, ${search}) > 0`);
  if (query.multiSearch) {
    const terms = query.multiSearch.terms.map((term) => normalizeKeywordText(term));
    if (query.multiSearch.mode === "EXACT") {
      filters.push(Prisma.sql`k.text_normalized IN (${Prisma.join(terms)})`);
    } else if (query.multiSearch.mode === "CONTAINS") {
      filters.push(Prisma.sql`(${Prisma.join(
        terms.map((term) => Prisma.sql`strpos(k.text_normalized, ${term}) > 0`),
        " OR "
      )})`);
    } else {
      filters.push(Prisma.sql`(${Prisma.join(
        terms.map((term) => Prisma.sql`(${Prisma.join(
          term.split(/\s+/u).map((word) => Prisma.sql`strpos(k.text_normalized, ${word}) > 0`),
          " AND "
        )})`),
        " OR "
      )})`);
    }
  }
  if (tag) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM keyword_tags filter_kt
      INNER JOIN tags filter_tag
        ON filter_tag.id = filter_kt.tag_id
       AND filter_tag.workspace_id = k.workspace_id
       AND filter_tag.project_id = k.project_id
       AND filter_tag.status::text = 'ACTIVE'
      WHERE filter_kt.project_id = k.project_id
        AND filter_kt.keyword_id = k.id
        AND strpos(filter_tag.normalized_name, ${tag}) > 0
    )`);
  }
  if (query.intent) filters.push(Prisma.sql`k.intent::text = ${query.intent}`);
  if (query.isFavorite !== undefined) filters.push(Prisma.sql`k.is_favorite = ${query.isFavorite}`);
  if (query.priorityMin !== undefined) filters.push(Prisma.sql`k.priority >= ${query.priorityMin}`);
  if (query.priorityMax !== undefined) filters.push(Prisma.sql`k.priority <= ${query.priorityMax}`);
  for (const [type, min, max] of [
    ["BASE", query.frequencyBaseMin, query.frequencyBaseMax],
    ["EXACT", query.frequencyExactMin, query.frequencyExactMax],
    ["FIXED", query.frequencyFixedMin, query.frequencyFixedMax]
  ] as const) {
    if (min === undefined && max === undefined) continue;
    const latest = Prisma.sql`(
      SELECT fs.value FROM frequency_snapshots fs
      WHERE fs.project_id = k.project_id AND fs.keyword_id = k.id AND fs.type = ${type}
      ORDER BY fs.observed_at DESC, fs.id DESC LIMIT 1
    )`;
    if (min !== undefined) filters.push(Prisma.sql`${latest} >= ${BigInt(min)}`);
    if (max !== undefined) filters.push(Prisma.sql`${latest} <= ${BigInt(max)}`);
  }
  const wordCount = Prisma.sql`CASE WHEN btrim(k.text_original) = '' THEN 0 ELSE cardinality(regexp_split_to_array(btrim(k.text_original), E'\\s+')) END`;
  if (query.wordCountMin !== undefined) filters.push(Prisma.sql`${wordCount} >= ${query.wordCountMin}`);
  if (query.wordCountMax !== undefined) filters.push(Prisma.sql`${wordCount} <= ${query.wordCountMax}`);
  if (query.targetUrlState === "SET") filters.push(Prisma.sql`k.target_page_id IS NOT NULL`);
  if (query.targetUrlState === "EMPTY") filters.push(Prisma.sql`k.target_page_id IS NULL`);
  if (query.rankDimensionKey && (query.rankState || query.rankPositionMin !== undefined || query.rankPositionMax !== undefined || query.rankCheckedFrom || query.rankCheckedBefore)) {
    const dimension = parseSemanticRankDimensionKey(query.rankDimensionKey);
    if (!dimension) throw new Error("Validated rank dimension is invalid");
    const base = Prisma.sql`
      SELECT cr.found, cr.position, cr.observed_at
      FROM current_ranks cr
      INNER JOIN tracking_context_versions tcv
        ON tcv.workspace_id = cr.workspace_id AND tcv.project_id = cr.project_id
       AND tcv.context_id = cr.tracking_context_id AND tcv.configuration_version = cr.configuration_version
      WHERE cr.workspace_id = k.workspace_id AND cr.project_id = k.project_id AND cr.keyword_id = k.id
        AND tcv.search_engine::text = ${dimension.searchEngine} AND tcv.country_code = ${dimension.countryCode}
        AND COALESCE(tcv.region_code, tcv.country_code) = ${dimension.regionCode}
        AND tcv.language = ${dimension.language} AND tcv.device::text = ${dimension.device}
        AND NOT EXISTS (
          SELECT 1 FROM rank_dimension_history_deletions deletion
          WHERE deletion.workspace_id = cr.workspace_id
            AND deletion.project_id = cr.project_id
            AND deletion.search_engine = tcv.search_engine::text
            AND deletion.country_code = tcv.country_code
            AND deletion.region_code = COALESCE(tcv.region_code, tcv.country_code)
            AND deletion.language = tcv.language
            AND deletion.device = tcv.device::text
            AND cr.observed_at <= deletion.excluded_through
        )
      ORDER BY cr.observed_at DESC, cr.snapshot_id DESC, cr.tracking_context_id DESC LIMIT 1`;
    if (query.rankState === "NOT_CHECKED") {
      filters.push(Prisma.sql`NOT EXISTS (${base})`);
    } else {
      const conditions: Prisma.Sql[] = [];
      if (query.rankState === "NOT_FOUND") conditions.push(Prisma.sql`NOT latest.found`);
      if (query.rankState === "FOUND" || query.rankPositionMin !== undefined || query.rankPositionMax !== undefined) conditions.push(Prisma.sql`latest.found`);
      if (query.rankPositionMin !== undefined) conditions.push(Prisma.sql`latest.position >= ${query.rankPositionMin}`);
      if (query.rankPositionMax !== undefined) conditions.push(Prisma.sql`latest.position <= ${query.rankPositionMax}`);
      if (query.rankCheckedFrom) conditions.push(Prisma.sql`latest.observed_at >= ${new Date(query.rankCheckedFrom)}`);
      if (query.rankCheckedBefore) conditions.push(Prisma.sql`latest.observed_at < ${new Date(query.rankCheckedBefore)}`);
      filters.push(Prisma.sql`EXISTS (SELECT 1 FROM (${base}) latest${conditions.length ? Prisma.sql` WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty})`);
    }
  }
  const groupIds = query.groupIds?.length
    ? query.groupIds
    : query.groupId
      ? [query.groupId]
      : [];
  if (groupIds.length > 0) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1 FROM keyword_group_memberships kgm
      WHERE kgm.project_id = k.project_id
        AND kgm.keyword_id = k.id
        AND kgm.group_id IN (${Prisma.join(
          groupIds.map((groupId) => Prisma.sql`${groupId}::uuid`)
        )})
    )`);
  }
  if (query.clusterId) filters.push(Prisma.sql`k.cluster_id = ${query.clusterId}::uuid`);
  if (query.isTracked !== undefined) {
    filters.push(Prisma.sql`k.is_tracked = ${query.isTracked}`);
  }
  return filters;
}

function keywordMultiSearchWhere(
  search: Readonly<{
    mode: NonNullable<KeywordListQuery["multiSearch"]>["mode"];
    terms: readonly string[];
  }> | undefined
): Prisma.KeywordWhereInput {
  if (!search) return {};
  if (search.mode === "EXACT") {
    return { textNormalized: { in: [...search.terms] } };
  }
  if (search.mode === "CONTAINS") {
    return {
      OR: search.terms.map((term) => ({
        textNormalized: { contains: term }
      }))
    };
  }
  return {
    OR: search.terms.map((term) => ({
      AND: term.split(/\s+/u).map((word) => ({
        textNormalized: { contains: word }
      }))
    }))
  };
}

function frequencyTypeForSort(sort: SemanticKeywordSort): "BASE" | "EXACT" | "FIXED" {
  if (sort.includes("_EXACT_")) return "EXACT";
  if (sort.includes("_FIXED_")) return "FIXED";
  return "BASE";
}

function requiredMetricCursorValue(value: string | number): bigint {
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) throw invalidCursor();
  try {
    return BigInt(value);
  } catch {
    throw invalidCursor();
  }
}

function isAscendingKeywordSort(sort: SemanticKeywordSort): boolean {
  return sort.endsWith("_ASC");
}

function requiredCursorNumber(value: string | number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidCursor();
  }
  return value;
}

function requiredCursorString(value: string | number): string {
  if (typeof value !== "string") throw invalidCursor();
  return value;
}

function requiredCursorDate(value: string | number): Date {
  if (typeof value !== "string") throw invalidCursor();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidCursor();
  return date;
}

function invalidCursor(): BadRequestException {
  return new BadRequestException(
    "Keyword cursor is invalid for the current query"
  );
}

function frequencyType(value: string): "BASE" | "EXACT" | "FIXED" {
  if (value === "BASE" || value === "EXACT" || value === "FIXED") {
    return value;
  }
  throw new Error("Stored frequency type is unsupported");
}

function frequencyDevice(value: string): SemanticFrequencyDevice {
  if (
    value === "ALL" ||
    value === "DESKTOP" ||
    value === "MOBILE" ||
    value === "PHONE_ONLY" ||
    value === "TABLET_ONLY"
  ) return value;
  throw new Error("Stored frequency device is unsupported");
}

function frequencySeasonalityGranularity(
  value: string
): FrequencySeasonalityGranularity {
  if (value === "MONTH" || value === "WEEK" || value === "DAY") {
    return value;
  }
  throw new Error("Stored frequency seasonality granularity is unsupported");
}

function frequencyProvider(value: string): FrequencyCollectionProvider {
  if (value === "XMLSTOCK" || value === "ARSENKIN") return value;
  throw new Error("Stored frequency seasonality provider is unsupported");
}

function frequencySeasonalitySourceMode(
  value: string
): "BYOK" | "PLATFORM" {
  if (value === "BYOK" || value === "PLATFORM") return value;
  throw new Error("Stored frequency seasonality source mode is unsupported");
}

function latestSeasonalityPoints<
  Point extends Readonly<{
    type: string;
    granularity: string;
    regionCode: string;
    device: string;
    jobId: string;
  }>
>(points: readonly Point[]): readonly Point[] {
  const latestJobByContext = new Map<string, string>();
  return points.filter((point) => {
    const contextKey = JSON.stringify([
      point.type,
      point.granularity,
      point.regionCode,
      point.device
    ]);
    const latestJobId = latestJobByContext.get(contextKey);
    if (latestJobId === undefined) {
      latestJobByContext.set(contextKey, point.jobId);
      return true;
    }
    return latestJobId === point.jobId;
  });
}

function rankDeletionExclusionWhere(
  deletion: Readonly<{
    searchEngine: string;
    countryCode: string;
    regionCode: string;
    language: string;
    device: string;
    excludedThrough: Date;
  }>
): Prisma.RankSnapshotWhereInput {
  const searchEngine = storedDeletionSearchEngine(deletion.searchEngine);
  const device = storedDeletionDevice(deletion.device);
  return {
    NOT: {
      observedAt: { lte: deletion.excludedThrough },
      manifest: {
        configuration: {
          searchEngine,
          countryCode: deletion.countryCode,
          language: deletion.language,
          device,
          OR: [
            { regionCode: deletion.regionCode },
            ...(deletion.regionCode === deletion.countryCode
              ? [{ regionCode: null }]
              : [])
          ]
        }
      }
    }
  };
}

export function uniqueRankConfigurationReferences(
  ranks: readonly Readonly<{
    trackingContextId: string;
    configurationVersion: number;
  }>[]
): { contextId: string; configurationVersion: number }[] {
  const unique = new Map<string, { contextId: string; configurationVersion: number }>();
  for (const rank of ranks) {
    const key = `${rank.trackingContextId}:${rank.configurationVersion}`;
    if (!unique.has(key)) {
      unique.set(key, {
        contextId: rank.trackingContextId,
        configurationVersion: rank.configurationVersion
      });
    }
  }
  return [...unique.values()];
}

function rankIsExcluded(
  observedAt: Date,
  configuration: Readonly<{
    searchEngine: string;
    countryCode: string;
    regionCode: string | null;
    language: string;
    device: string;
  }>,
  deletions: readonly Readonly<{
    searchEngine: string;
    countryCode: string;
    regionCode: string;
    language: string;
    device: string;
    excludedThrough: Date;
  }>[]
): boolean {
  return deletions.some((deletion) =>
    deletion.searchEngine === configuration.searchEngine &&
    deletion.countryCode === configuration.countryCode &&
    deletion.regionCode === (configuration.regionCode ?? configuration.countryCode) &&
    deletion.language === configuration.language &&
    deletion.device === configuration.device &&
    observedAt <= deletion.excludedThrough
  );
}

function storedRankDimensionKey(
  configuration: Readonly<{
    searchEngine: string;
    countryCode?: string;
    regionCode?: string | null;
    language?: string;
    device?: string;
  }>
): string | undefined {
  if (
    (configuration.searchEngine !== "YANDEX" &&
      configuration.searchEngine !== "GOOGLE") ||
    !configuration.countryCode ||
    !configuration.language ||
    (configuration.device !== "DESKTOP" && configuration.device !== "MOBILE")
  ) return undefined;
  return semanticRankDimensionKey({
    searchEngine: configuration.searchEngine,
    countryCode: configuration.countryCode,
    regionCode: configuration.regionCode ?? configuration.countryCode,
    language: configuration.language,
    device: configuration.device
  });
}

async function snapshotIdsWithMultipleProjectUrls(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  snapshotIds: readonly string[]
): Promise<ReadonlySet<string>> {
  if (snapshotIds.length === 0) return new Set();
  const rows = await prisma.$queryRaw<readonly { snapshotId: string }[]>(Prisma.sql`
    SELECT result.snapshot_id AS "snapshotId"
    FROM rank_serp_results result
    JOIN rank_snapshots snapshot
      ON snapshot.observed_at = result.snapshot_observed_at
        AND snapshot.id = result.snapshot_id
        AND snapshot.workspace_id = ${workspaceId}::uuid
        AND snapshot.project_id = ${projectId}::uuid
    JOIN rank_execution_manifests manifest
      ON manifest.workspace_id = snapshot.workspace_id
        AND manifest.project_id = snapshot.project_id
        AND manifest.id = snapshot.manifest_id
        AND manifest.job_id = snapshot.job_id
    CROSS JOIN LATERAL (
      SELECT regexp_replace(
        lower(split_part(split_part(regexp_replace(manifest.project_domain, '^https?://', '', 'i'), '/', 1), ':', 1)),
        '^www\\.', ''
      ) AS host
    ) project_host
    CROSS JOIN LATERAL (
      SELECT regexp_replace(
        lower(split_part(split_part(regexp_replace(result.ranking_url, '^https?://', '', 'i'), '/', 1), ':', 1)),
        '^www\\.', ''
      ) AS host
    ) result_host
    WHERE result.snapshot_id IN (${Prisma.join(
      snapshotIds.map((id) => Prisma.sql`${id}::uuid`)
    )})
      AND (
        result_host.host = project_host.host OR
        result_host.host LIKE '%.' || project_host.host
      )
    GROUP BY result.snapshot_id
    HAVING count(DISTINCT result.normalized_ranking_url) > 1
  `);
  return new Set(rows.map(({ snapshotId }) => snapshotId));
}

function sameKeywordRankingUrl(left: string, right: string): boolean {
  try {
    return normalizePageUrl(left).normalized === normalizePageUrl(right).normalized;
  } catch {
    return left === right;
  }
}

function storedDeletionSearchEngine(value: string): "YANDEX" | "GOOGLE" {
  if (value === "YANDEX" || value === "GOOGLE") return value;
  throw new Error("Stored rank deletion search engine is unsupported");
}

function storedDeletionDevice(value: string): "DESKTOP" | "MOBILE" {
  if (value === "DESKTOP" || value === "MOBILE") return value;
  throw new Error("Stored rank deletion device is unsupported");
}

function frequencyQualityFlags(value: unknown): readonly SemanticFrequencyQualityFlag[] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new Error("Stored frequency quality flags are invalid");
  }
  const flags = value.map((flag): SemanticFrequencyQualityFlag => {
    if (
      flag === "CONTEXT_INCOMPLETE" ||
      flag === "STALE" ||
      flag === "PARTIAL" ||
      flag === "ESTIMATED"
    ) return flag;
    throw new Error("Stored frequency quality flag is unsupported");
  });
  if (new Set(flags).size !== flags.length) {
    throw new Error("Stored frequency quality flags contain duplicates");
  }
  return flags;
}

function rankHistoryProvider(
  value: string
): SemanticKeywordPositionHistoryProvider {
  if (
    value === "ARSENKIN" ||
    value === "XMLSTOCK" ||
    value === "KEY_COLLECTOR" ||
    value === "MANUAL_IMPORT"
  ) return value;
  throw new Error("Stored rank history provider is unsupported");
}

function positionTopCounts(
  positions: readonly number[]
): ProjectPositionTopCounts {
  return positions.reduce(
    (counts, position) => addPositionTopCount(counts, position, 1),
    emptyPositionTopCounts()
  );
}

function safeHistoryCount(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Project position history count is invalid");
  }
  return Number(value);
}

function positionHistoryScopeHash(
  query: ProjectPositionHistoryQuery
): string {
  return sha256([
    POSITION_HISTORY_PROJECTION_SCHEMA_VERSION,
    query.includeUntracked ? "ALL_ACTIVE" : "TRACKED_ONLY",
    query.rankDimensionKey ?? "ALL_DIMENSIONS"
  ].join("\0"));
}

function storedPositionHistoryProjection(
  value: unknown
): ProjectPositionHistory | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (!Array.isArray(input.points) || input.points.length > projectPositionHistoryMaxPoints || typeof input.truncated !== "boolean") {
    return undefined;
  }
  let previousDate = "";
  const points: ProjectPositionHistoryPoint[] = [];
  for (const value of input.points) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const point = value as Readonly<Record<string, unknown>>;
    if (
      typeof point.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(point.date) ||
      Number.isNaN(Date.parse(`${point.date}T00:00:00.000Z`)) ||
      point.id !== `day:${point.date}` ||
      typeof point.observedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(point.observedAt) ||
      new Date(point.observedAt).toISOString() !== point.observedAt ||
      point.observedAt.slice(0, 10) !== point.date ||
      (previousDate && point.date <= previousDate)
    ) {
      return undefined;
    }
    const counts = [
      point.top1KeywordCount,
      point.top3KeywordCount,
      point.top5KeywordCount,
      point.top10KeywordCount,
      point.top30KeywordCount,
      point.top50KeywordCount,
      point.top100KeywordCount ?? point.top50KeywordCount,
      point.top200KeywordCount ?? point.top100KeywordCount ?? point.top50KeywordCount,
      point.positionedKeywordCount,
      point.measuredKeywordCount
    ];
    if (
      counts.some(
        (count) => !Number.isSafeInteger(count) || Number(count) < 0
      ) ||
      counts.some(
        (count, index) =>
          index > 0 && Number(counts[index - 1]) > Number(count)
      )
    ) {
      return undefined;
    }
    points.push({
      id: point.id,
      date: point.date,
      observedAt: point.observedAt,
      top1KeywordCount: Number(point.top1KeywordCount),
      top3KeywordCount: Number(point.top3KeywordCount),
      top5KeywordCount: Number(point.top5KeywordCount),
      top10KeywordCount: Number(point.top10KeywordCount),
      top30KeywordCount: Number(point.top30KeywordCount),
      top50KeywordCount: Number(point.top50KeywordCount),
      ...(point.top100KeywordCount === undefined ? {} : { top100KeywordCount: Number(point.top100KeywordCount) }),
      ...(point.top200KeywordCount === undefined ? {} : { top200KeywordCount: Number(point.top200KeywordCount) }),
      positionedKeywordCount: Number(point.positionedKeywordCount),
      measuredKeywordCount: Number(point.measuredKeywordCount)
    });
    previousDate = point.date;
  }
  return { points, truncated: input.truncated };
}

function emptyPositionTopCounts(): ProjectPositionTopCounts {
  return {
    top1KeywordCount: 0,
    top3KeywordCount: 0,
    top5KeywordCount: 0,
    top10KeywordCount: 0,
    top30KeywordCount: 0,
    top50KeywordCount: 0,
    top100KeywordCount: 0,
    top200KeywordCount: 0
  };
}

function addPositionTopCount(
  counts: ProjectPositionTopCounts,
  position: number,
  amount: number
): ProjectPositionTopCounts {
  return {
    top1KeywordCount: counts.top1KeywordCount + (position === 1 ? amount : 0),
    top3KeywordCount: counts.top3KeywordCount + (position <= 3 ? amount : 0),
    top5KeywordCount: counts.top5KeywordCount + (position <= 5 ? amount : 0),
    top10KeywordCount:
      counts.top10KeywordCount + (position <= 10 ? amount : 0),
    top30KeywordCount:
      counts.top30KeywordCount + (position <= 30 ? amount : 0),
    top50KeywordCount:
      counts.top50KeywordCount + (position <= 50 ? amount : 0),
    top100KeywordCount: (counts.top100KeywordCount ?? 0) + (position <= 100 ? amount : 0),
    top200KeywordCount: (counts.top200KeywordCount ?? 0) + (position <= 200 ? amount : 0)
  };
}

function competitorSnapshotProvider(
  value: string
): "ARSENKIN" | "XMLSTOCK" | "KEY_COLLECTOR" {
  if (
    value === "ARSENKIN" ||
    value === "XMLSTOCK" ||
    value === "KEY_COLLECTOR"
  ) return value;
  throw new Error("Stored SERP snapshot provider is unsupported");
}

function resolvedRankDimensionMetadata(
  configuration: Parameters<typeof rankDimensionMetadata>[0],
  selectedDimension: SemanticRankDimension | undefined,
  sourceDimensionKeys: ReadonlySet<string> | undefined,
  mergeTargets: ReadonlyMap<string, SemanticRankDimension>
) {
  const stored = rankDimensionMetadata(configuration);
  if (selectedDimension && sourceDimensionKeys?.has(stored.dimensionKey)) {
    return rankDimensionMetadataFromDimension(selectedDimension);
  }
  const merged = mergeTargets.get(stored.dimensionKey);
  if (merged) {
    return rankDimensionMetadataFromDimension(merged);
  }
  return stored;
}

function rankDimensionMetadataFromDimension(
  dimension: SemanticRankDimension
) {
  return {
    searchEngine: dimension.searchEngine,
    countryCode: dimension.countryCode,
    regionCode: dimension.regionCode,
    language: dimension.language,
    device: dimension.device,
    ...(dimension.regionLabel
      ? { regionLabel: dimension.regionLabel }
      : {}),
    dimensionKey: dimension.key
  };
}

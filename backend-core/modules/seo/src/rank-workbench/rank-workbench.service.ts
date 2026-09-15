import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable
} from "@nestjs/common";
import {
  parseDeleteRankDimensionHistoryInput,
  parseRankPositionReportInput,
  parseSemanticRankDimensionKey,
  parseSerpWorkbenchInput,
  serpWorkbenchSnapshotProviders,
  type DeleteRankDimensionHistoryInput,
  type RankDimensionHistoryDeletion,
  type RankPositionReport,
  type RankPositionReportCell,
  type RankPositionReportInput,
  type RankPositionReportSummary,
  type RankPositionReportTrendPoint,
  type SemanticRankDimension,
  type SerpWorkbenchInput,
  type SerpWorkbenchReport,
  type SerpWorkbenchSnapshotProvider
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  rankDimensionConfigurationPredicate,
  rankDimensionSources
} from "../rank-results/rank-dimension-merge.js";

type ReadScope = Readonly<{ workspaceId: string; projectId: string }>;
type WriteScope = ReadScope & Readonly<{ actorId: string }>;

interface PositionKeywordRow {
  readonly id: string;
  readonly version: number;
  readonly query: string;
  readonly language: string;
  readonly createdAt: Date;
  readonly groupPath: string | null;
  readonly targetUrl: string | null;
  readonly frequencyBase: bigint | null;
  readonly frequencyExact: bigint | null;
  readonly frequencyFixed: bigint | null;
  readonly latestSnapshotId: string | null;
  readonly latestFound: boolean | null;
  readonly latestPosition: number | null;
  readonly previousSnapshotId: string | null;
  readonly previousPosition: number | null;
  readonly totalCount: bigint;
  readonly measuredCount: bigint;
  readonly foundCount: bigint;
  readonly notFoundCount: bigint;
  readonly improvedCount: bigint;
  readonly declinedCount: bigint;
  readonly unchangedCount: bigint;
  readonly newCount: bigint;
  readonly lostCount: bigint;
  readonly top3Count: bigint;
  readonly top10Count: bigint;
  readonly top30Count: bigint;
  readonly averagePosition: number | null;
}

interface DailyRankRow {
  readonly keywordId: string;
  readonly day: Date;
  readonly snapshotId: string;
  readonly observedAt: Date;
  readonly found: boolean;
  readonly position: number | null;
  readonly previousPosition: number | null;
  readonly rankingUrl: string | null;
  readonly siteResultCount: bigint;
}

interface DailyAiRankRow {
  readonly keywordId: string;
  readonly day: Date;
  readonly snapshotId: string;
  readonly observedAt: Date;
  readonly answerPresent: boolean;
  readonly siteFound: boolean;
  readonly position: number | null;
  readonly previousPosition: number | null;
  readonly rankingUrl: string | null;
  readonly brandFound: boolean;
}

interface TrendRow {
  readonly day: Date;
  readonly measured: bigint;
  readonly found: bigint;
  readonly top3: bigint;
  readonly top10: bigint;
  readonly top30: bigint;
  readonly averagePosition: number | null;
}

interface KeywordPageRow {
  readonly id: string;
  readonly version: number;
  readonly query: string;
  readonly language: string;
  readonly groupPath: string | null;
  readonly targetUrl: string | null;
  readonly totalCount: bigint;
}

interface LatestSerpSnapshotRow {
  readonly keywordId: string;
  readonly snapshotId: string;
  readonly observedAt: Date;
  readonly provider: string;
}

interface LatestAiSerpSnapshotRow {
  readonly keywordId: string;
  readonly dimensionKey: string;
  readonly snapshotId: string;
  readonly observedAt: Date;
  readonly sources: readonly Readonly<{
    position: number;
    url: string;
    title: string | null;
    description: string | null;
  }>[];
}

const ZERO_SUMMARY: RankPositionReportSummary = {
  keywordCount: 0,
  measuredCount: 0,
  foundCount: 0,
  notFoundCount: 0,
  improvedCount: 0,
  declinedCount: 0,
  unchangedCount: 0,
  newCount: 0,
  lostCount: 0,
  top3Count: 0,
  top10Count: 0,
  top30Count: 0
};

@Injectable()
export class RankWorkbenchService {
  public constructor(private readonly prisma: PrismaService) {}

  public async positions(
    scope: ReadScope,
    value: RankPositionReportInput
  ): Promise<RankPositionReport> {
    const input = parseInput(parseRankPositionReportInput, value);
    const dimension = requiredDimension(input.dimensionKey);
    const sourceDimensions = await rankDimensionSources(
      this.prisma,
      scope,
      dimension
    );
    const offset = decodeOffsetCursor(input.cursor, positionFilterHash(input));
    const aiMode = input.mode === "AI";
    const [rows, trendRows] = await Promise.all([
      this.positionKeywordPage(scope, input, dimension, sourceDimensions, offset),
      this.positionTrend(scope, input, dimension, sourceDimensions)
    ]);
    const dates = rankWorkbenchReportDates(
      input.dateLimit,
      trendRows.map(({ day }) => day)
    );
    const pageRows = rows.slice(0, input.limit);
    const hasNext = rows.length > input.limit;
    const keywordIds = pageRows.map(({ id }) => id);
    const [dailyRows, dailyAiRows] = keywordIds.length === 0 || dates.length === 0
      ? [[], []] as const
      : aiMode
        ? [
            [],
            await this.dailyAiRanks(
              scope,
              dimension,
              sourceDimensions,
              keywordIds,
              dates
            )
          ] as const
        : [
            await this.dailyRanks(
              scope,
              input,
              dimension,
              sourceDimensions,
              keywordIds,
              dates
            ),
            []
          ] as const;
    const dateSet = new Set(dates);
    const cellsByKeyword = new Map<string, Map<string, RankPositionReportCell>>();
    for (const row of dailyRows) {
      const date = calendarDate(row.day);
      const byDate = cellsByKeyword.get(row.keywordId) ?? new Map();
      byDate.set(date, {
        date,
        snapshotId: row.snapshotId,
        observedAt: row.observedAt.toISOString(),
        found: row.found,
        ...(row.position === null ? {} : { position: row.position }),
        ...(row.previousPosition === null
          ? {}
          : { previousPosition: row.previousPosition }),
        ...(row.rankingUrl === null ? {} : { rankingUrl: row.rankingUrl }),
        siteResultCount: safeCount(row.siteResultCount)
      });
      cellsByKeyword.set(row.keywordId, byDate);
    }
    for (const row of dailyAiRows) {
      const date = calendarDate(row.day);
      const byDate = cellsByKeyword.get(row.keywordId) ?? new Map();
      byDate.set(date, {
        date,
        snapshotId: row.snapshotId,
        observedAt: row.observedAt.toISOString(),
        found: row.siteFound,
        ...(row.position === null ? {} : { position: row.position }),
        ...(row.previousPosition === null
          ? {}
          : { previousPosition: row.previousPosition }),
        ...(row.rankingUrl === null ? {} : { rankingUrl: row.rankingUrl }),
        siteResultCount: row.siteFound ? 1 : 0
      });
      cellsByKeyword.set(row.keywordId, byDate);
    }
    const first = pageRows[0];
    return {
      dimension,
      dates,
      summary: first ? positionSummary(first) : ZERO_SUMMARY,
      trend: trendRows
        .filter(({ day }) => dateSet.has(calendarDate(day)))
        .map(positionTrendPoint),
      rows: pageRows.map((row) => ({
        keywordId: row.id,
        version: row.version,
        query: row.query,
        language: row.language,
        createdAt: row.createdAt.toISOString(),
        ...(row.groupPath === null ? {} : { groupPath: row.groupPath }),
        ...(row.targetUrl === null ? {} : { targetUrl: row.targetUrl }),
        frequencies: positionFrequencies(row),
        cells: dates.flatMap((date) => {
          const cell = cellsByKeyword.get(row.id)?.get(date);
          return cell ? [cell] : [];
        })
      })),
      page: {
        hasNext,
        ...(hasNext
          ? {
              nextCursor: encodeOffsetCursor(
                offset + input.limit,
                positionFilterHash(input)
              )
            }
          : {}),
        ...(first ? { totalApprox: safeCount(first.totalCount) } : {})
      }
    };
  }

  public async serp(
    scope: ReadScope,
    value: SerpWorkbenchInput
  ): Promise<SerpWorkbenchReport> {
    const input = parseInput(parseSerpWorkbenchInput, value);
    const dimensions = input.dimensionKeys.map(requiredDimension);
    const dimensionsWithSources = await Promise.all(
      dimensions.map(async (dimension) => ({
        dimension,
        sources: await rankDimensionSources(this.prisma, scope, dimension)
      }))
    );
    const filterHash = serpFilterHash(input);
    const offset = decodeOffsetCursor(input.cursor, filterHash);
    const page = await this.keywordPage(scope, input, offset);
    const pageRows = page.slice(0, input.limit);
    const hasNext = page.length > input.limit;
    const keywordIds = pageRows.map(({ id }) => id);
    const snapshots = keywordIds.length === 0
      ? []
      : (await Promise.all(
          dimensionsWithSources.map(({ dimension, sources }) =>
            this.latestSerpSnapshots(scope, keywordIds, dimension, sources)
          )
        )).flat();
    const aiSnapshots = keywordIds.length === 0
      ? []
      : (await Promise.all(
          dimensionsWithSources.map(({ dimension, sources }) =>
            this.latestAiSerpSnapshots(scope, keywordIds, dimension, sources)
          )
        )).flat();
    const snapshotIds = snapshots.map(({ snapshotId }) => snapshotId);
    const [results, tags] = await Promise.all([
      snapshotIds.length === 0
        ? Promise.resolve([])
        : this.prisma.rankSerpResult.findMany({
            where: { snapshotId: { in: snapshotIds }, position: { lte: 100 } },
            orderBy: [
              { snapshotObservedAt: "desc" },
              { snapshotId: "asc" },
              { position: "asc" }
            ],
            select: {
              snapshotId: true,
              position: true,
              rankingUrl: true,
              faviconUrl: true,
              title: true,
              snippet: true
            }
          }),
      keywordIds.length === 0
        ? Promise.resolve([])
        : this.prisma.keywordTag.findMany({
            where: {
              projectId: scope.projectId,
              keywordId: { in: keywordIds },
              tag: { workspaceId: scope.workspaceId, status: "ACTIVE" }
            },
            orderBy: [{ createdAt: "asc" }, { tagId: "asc" }],
            select: { keywordId: true, tag: { select: { name: true } } }
          })
    ]);
    const resultsBySnapshot = new Map<string, typeof results>();
    for (const result of results) {
      const list = resultsBySnapshot.get(result.snapshotId) ?? [];
      list.push(result);
      resultsBySnapshot.set(result.snapshotId, list);
    }
    const snapshotsByKeyword = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) {
      const list = snapshotsByKeyword.get(snapshot.keywordId) ?? [];
      list.push(snapshot);
      snapshotsByKeyword.set(snapshot.keywordId, list);
    }
    const aiSnapshotsByKeyword = new Map<string, typeof aiSnapshots>();
    for (const snapshot of aiSnapshots) {
      const list = aiSnapshotsByKeyword.get(snapshot.keywordId) ?? [];
      list.push(snapshot);
      aiSnapshotsByKeyword.set(snapshot.keywordId, list);
    }
    const tagsByKeyword = new Map<string, string[]>();
    for (const tag of tags) {
      const list = tagsByKeyword.get(tag.keywordId) ?? [];
      list.push(tag.tag.name);
      tagsByKeyword.set(tag.keywordId, list);
    }
    return {
      dimensions,
      rows: pageRows.map((keyword) => ({
        keywordId: keyword.id,
        version: keyword.version,
        query: keyword.query,
        language: keyword.language,
        ...(keyword.groupPath === null ? {} : { groupPath: keyword.groupPath }),
        tags: tagsByKeyword.get(keyword.id) ?? [],
        ...(keyword.targetUrl === null ? {} : { targetUrl: keyword.targetUrl }),
        snapshots: (snapshotsByKeyword.get(keyword.id) ?? []).map((snapshot) => ({
          dimensionKey: snapshotDimensionKey(snapshot, dimensions),
          snapshotId: snapshot.snapshotId,
          observedAt: snapshot.observedAt.toISOString(),
          provider: storedSerpProvider(snapshot.provider),
          results: (resultsBySnapshot.get(snapshot.snapshotId) ?? []).map((result) => ({
            position: result.position,
            url: result.rankingUrl,
            ...(result.faviconUrl === null ? {} : { faviconUrl: result.faviconUrl }),
            ...(result.title === null ? {} : { title: result.title }),
            ...(result.snippet === null ? {} : { snippet: result.snippet })
          }))
        })),
        aiSnapshots: (aiSnapshotsByKeyword.get(keyword.id) ?? []).map((snapshot) => ({
          dimensionKey: snapshot.dimensionKey,
          snapshotId: snapshot.snapshotId,
          observedAt: snapshot.observedAt.toISOString(),
          provider: "ARSENKIN" as const,
          results: snapshot.sources.map((source) => ({
            position: source.position,
            url: source.url,
            ...(source.title === null ? {} : { title: source.title }),
            ...(source.description === null ? {} : { snippet: source.description })
          }))
        }))
      })),
      page: {
        hasNext,
        ...(hasNext
          ? { nextCursor: encodeOffsetCursor(offset + input.limit, filterHash) }
          : {}),
        ...(pageRows[0]
          ? { totalApprox: safeCount(pageRows[0].totalCount) }
          : {})
      }
    };
  }

  public async deleteDimensionHistory(
    scope: WriteScope,
    value: DeleteRankDimensionHistoryInput,
    idempotencyKey: string
  ): Promise<RankDimensionHistoryDeletion> {
    const input = parseInput(parseDeleteRankDimensionHistoryInput, value);
    const dimension = requiredDimension(input.dimensionKey);
    if (!/^[-A-Za-z0-9_:]{8,180}$/u.test(idempotencyKey)) {
      throw new BadRequestException("Invalid Idempotency-Key");
    }
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ projectId: scope.projectId, dimensionKey: dimension.key }))
      .digest();
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))
      `;
      const replay = await transaction.rankDimensionHistoryDeletion.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: scope.workspaceId,
            idempotencyKey
          }
        }
      });
      if (replay) {
        if (!Buffer.from(replay.requestHash).equals(requestHash)) {
          throw new ConflictException("Idempotency-Key was already used");
        }
        return deletionResult(replay, dimension, replay.affectedSnapshotCount);
      }
      const clockRows = await transaction.$queryRaw<readonly { now: Date }[]>(
        Prisma.sql`SELECT clock_timestamp() AS now`
      );
      const now = clockRows[0]?.now;
      if (!now) throw new Error("Database clock is unavailable");
      const sourceDimensions = await rankDimensionSources(
        transaction,
        scope,
        dimension
      );
      const [countRow] = await transaction.$queryRaw<readonly { count: bigint }[]>(
        Prisma.sql`
          SELECT count(*)::bigint AS count
          FROM rank_snapshots snapshot
          JOIN tracking_context_versions configuration
            ON configuration.workspace_id = snapshot.workspace_id
           AND configuration.project_id = snapshot.project_id
           AND configuration.context_id = snapshot.tracking_context_id
           AND configuration.configuration_version = snapshot.configuration_version
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
            AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.observed_at <= ${now}
            ${rankDimensionConfigurationPredicate(sourceDimensions)}
        `
      );
      const affectedSnapshotCount = safeCount(countRow?.count ?? 0n);
      const mergedSources = sourceDimensions.filter(
        ({ key }) => key !== dimension.key
      );
      if (mergedSources.length > 0) {
        await transaction.rankDimensionHistoryDeletion.createMany({
          data: mergedSources.map((source) => ({
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            searchEngine: source.searchEngine,
            countryCode: source.countryCode,
            regionCode: source.regionCode,
            language: source.language,
            device: source.device,
            excludedThrough: now,
            deletedBy: scope.actorId,
            idempotencyKey: `rank-delete:${createHash("sha256")
              .update(`${idempotencyKey}\0${source.key}`, "utf8")
              .digest("hex")}`,
            requestHash,
            affectedSnapshotCount: 0
          }))
        });
      }
      const created = await transaction.rankDimensionHistoryDeletion.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          searchEngine: dimension.searchEngine,
          countryCode: dimension.countryCode,
          regionCode: dimension.regionCode,
          language: dimension.language,
          device: dimension.device,
          excludedThrough: now,
          deletedBy: scope.actorId,
          idempotencyKey,
          requestHash,
          affectedSnapshotCount
        }
      });
      return deletionResult(created, dimension, created.affectedSnapshotCount);
    }, { isolationLevel: "Serializable" });
  }

  private positionKeywordPage(
    scope: ReadScope,
    input: RankPositionReportInput,
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[],
    offset: number
  ): Promise<PositionKeywordRow[]> {
    const filters = keywordFilters(scope, input);
    const order = positionOrder(input.sort);
    const regionCodes = [...new Set(sourceDimensions.map(({ regionCode }) => regionCode))];
    const dailyCandidates = input.mode === "AI"
      ? Prisma.sql`
          SELECT DISTINCT ON (
            snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date
          ) snapshot.keyword_id, snapshot.id, snapshot.observed_at,
            snapshot.site_found AS found, snapshot.position
          FROM ai_answer_snapshots snapshot
          JOIN scoped_keywords keyword ON keyword.id = snapshot.keyword_id
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
            AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.search_engine::text = ${dimension.searchEngine}
            AND snapshot.region_code IN (${Prisma.join(regionCodes)})
            AND snapshot.device::text = ${dimension.device}
            AND snapshot.position_tracking_enabled
            AND snapshot.observed_at >= ${new Date(input.observedFrom)}
            AND snapshot.observed_at < ${new Date(input.observedBefore)}
          ORDER BY snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date,
            snapshot.observed_at DESC, snapshot.id DESC
        `
      : Prisma.sql`
          SELECT DISTINCT ON (
            snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date
          ) snapshot.keyword_id, snapshot.id, snapshot.observed_at,
            snapshot.found, snapshot.position
          FROM rank_snapshots snapshot
          JOIN configurations configuration
            ON configuration.context_id = snapshot.tracking_context_id
           AND configuration.configuration_version = snapshot.configuration_version
          JOIN scoped_keywords keyword ON keyword.id = snapshot.keyword_id
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
            AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.position_tracking_enabled
            AND snapshot.observed_at >= ${new Date(input.observedFrom)}
            AND snapshot.observed_at < ${new Date(input.observedBefore)}
            ${visibleSnapshotPredicate(scope, dimension, "snapshot")}
          ORDER BY snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date,
            snapshot.observed_at DESC, snapshot.id DESC
        `;
    return this.prisma.$queryRaw<PositionKeywordRow[]>(Prisma.sql`
      WITH configurations AS MATERIALIZED (
        SELECT context_id, configuration_version
        FROM tracking_context_versions configuration
        WHERE configuration.workspace_id = ${scope.workspaceId}::uuid
          AND configuration.project_id = ${scope.projectId}::uuid
          ${rankDimensionConfigurationPredicate(sourceDimensions)}
      ), scoped_keywords AS MATERIALIZED (
        SELECT keyword.id, keyword.version, keyword.text_original AS query,
          keyword.text_normalized, keyword.language,
          keyword.created_at,
          keyword.target_page_id
        FROM keywords keyword
        WHERE ${Prisma.join(filters, " AND ")}
      ), daily_candidates AS MATERIALIZED (
        ${dailyCandidates}
      ), candidates AS MATERIALIZED (
        SELECT daily_candidates.*,
          row_number() OVER (
            PARTITION BY keyword_id
            ORDER BY observed_at DESC, id DESC
          ) AS sequence
        FROM daily_candidates
      ), projected AS (
        SELECT keyword.*, latest.id AS latest_snapshot_id,
          latest.found AS latest_found, latest.position AS latest_position,
          previous.id AS previous_snapshot_id,
          previous.position AS previous_position
        FROM scoped_keywords keyword
        LEFT JOIN candidates latest
          ON latest.keyword_id = keyword.id AND latest.sequence = 1
        LEFT JOIN candidates previous
          ON previous.keyword_id = keyword.id AND previous.sequence = 2
      ), paged AS MATERIALIZED (
        SELECT projected.*,
          count(*) OVER ()::bigint AS total_count,
          count(latest_snapshot_id) OVER ()::bigint AS measured_count,
          count(*) FILTER (WHERE latest_found) OVER ()::bigint AS found_count,
          count(*) FILTER (WHERE latest_snapshot_id IS NOT NULL AND NOT latest_found) OVER ()::bigint AS not_found_count,
          count(*) FILTER (WHERE latest_position < previous_position) OVER ()::bigint AS improved_count,
          count(*) FILTER (WHERE latest_position > previous_position) OVER ()::bigint AS declined_count,
          count(*) FILTER (WHERE latest_position = previous_position) OVER ()::bigint AS unchanged_count,
          count(*) FILTER (WHERE latest_position IS NOT NULL AND previous_position IS NULL) OVER ()::bigint AS new_count,
          count(*) FILTER (WHERE latest_position IS NULL AND previous_position IS NOT NULL) OVER ()::bigint AS lost_count,
          count(*) FILTER (WHERE latest_position <= 3) OVER ()::bigint AS top3_count,
          count(*) FILTER (WHERE latest_position <= 10) OVER ()::bigint AS top10_count,
          count(*) FILTER (WHERE latest_position <= 30) OVER ()::bigint AS top30_count,
          avg(latest_position) FILTER (WHERE latest_position IS NOT NULL) OVER ()::float8 AS average_position
        FROM projected
        ORDER BY ${order}
        OFFSET ${offset}
        LIMIT ${input.limit + 1}
      ), enriched AS (
        SELECT paged.*,
          target.url AS target_url,
          group_row.path AS group_path,
          frequency.base_value AS frequency_base,
          frequency.exact_value AS frequency_exact,
          frequency.fixed_value AS frequency_fixed
        FROM paged
        LEFT JOIN pages target
          ON target.workspace_id = ${scope.workspaceId}::uuid
         AND target.project_id = ${scope.projectId}::uuid
         AND target.id = paged.target_page_id
         AND target.status::text = 'ACTIVE'
        LEFT JOIN LATERAL (
          SELECT group_value.path
          FROM keyword_group_memberships membership
          JOIN keyword_groups group_value
            ON group_value.id = membership.group_id
           AND group_value.project_id = membership.project_id
          WHERE membership.project_id = ${scope.projectId}::uuid
            AND membership.keyword_id = paged.id
            AND group_value.status::text = 'ACTIVE'
            AND group_value.system_kind IS NULL
          ORDER BY membership.created_at ASC, group_value.id ASC
          LIMIT 1
        ) group_row ON true
        LEFT JOIN LATERAL (
          SELECT
            max(latest.value) FILTER (WHERE latest.type = 'BASE') AS base_value,
            max(latest.value) FILTER (WHERE latest.type = 'EXACT') AS exact_value,
            max(latest.value) FILTER (WHERE latest.type = 'FIXED') AS fixed_value
          FROM (
            SELECT DISTINCT ON (snapshot.type) snapshot.type, snapshot.value
            FROM frequency_snapshots snapshot
            WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
              AND snapshot.project_id = ${scope.projectId}::uuid
              AND snapshot.keyword_id = paged.id
              AND snapshot.type IN ('BASE', 'EXACT', 'FIXED')
            ORDER BY snapshot.type, snapshot.observed_at DESC, snapshot.id DESC
          ) latest
        ) frequency ON true
      )
      SELECT id, version, query, language, created_at AS "createdAt",
        group_path AS "groupPath", target_url AS "targetUrl",
        frequency_base AS "frequencyBase",
        frequency_exact AS "frequencyExact",
        frequency_fixed AS "frequencyFixed",
        latest_snapshot_id AS "latestSnapshotId",
        latest_found AS "latestFound", latest_position AS "latestPosition",
        previous_snapshot_id AS "previousSnapshotId",
        previous_position AS "previousPosition",
        total_count AS "totalCount", measured_count AS "measuredCount",
        found_count AS "foundCount", not_found_count AS "notFoundCount",
        improved_count AS "improvedCount", declined_count AS "declinedCount",
        unchanged_count AS "unchangedCount", new_count AS "newCount",
        lost_count AS "lostCount", top3_count AS "top3Count",
        top10_count AS "top10Count", top30_count AS "top30Count",
        average_position AS "averagePosition"
      FROM enriched
      ORDER BY ${order}
    `);
  }

  private dailyRanks(
    scope: ReadScope,
    input: RankPositionReportInput,
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[],
    keywordIds: readonly string[],
    dates: readonly string[]
  ): Promise<DailyRankRow[]> {
    return this.prisma.$queryRaw<DailyRankRow[]>(Prisma.sql`
      WITH configurations AS MATERIALIZED (
        SELECT context_id, configuration_version
        FROM tracking_context_versions configuration
        WHERE configuration.workspace_id = ${scope.workspaceId}::uuid
          AND configuration.project_id = ${scope.projectId}::uuid
          ${rankDimensionConfigurationPredicate(sourceDimensions)}
      ), latest_daily AS MATERIALIZED (
        SELECT DISTINCT ON (
          snapshot.keyword_id,
          (snapshot.observed_at AT TIME ZONE 'UTC')::date
        ) snapshot.keyword_id, snapshot.id, snapshot.observed_at,
          snapshot.manifest_id,
          (snapshot.observed_at AT TIME ZONE 'UTC')::date AS day,
          snapshot.found, snapshot.position, snapshot.ranking_url
        FROM rank_snapshots snapshot
        JOIN configurations configuration
          ON configuration.context_id = snapshot.tracking_context_id
         AND configuration.configuration_version = snapshot.configuration_version
        WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
          AND snapshot.project_id = ${scope.projectId}::uuid
          AND snapshot.keyword_id IN (${Prisma.join(keywordIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND snapshot.position_tracking_enabled
          AND snapshot.observed_at >= ${new Date(input.observedFrom)}
          AND snapshot.observed_at < ${new Date(input.observedBefore)}
          AND (snapshot.observed_at AT TIME ZONE 'UTC')::date IN (
            ${Prisma.join(dates.map((date) => Prisma.sql`${date}::date`))}
          )
          ${visibleSnapshotPredicate(scope, dimension, "snapshot")}
        ORDER BY snapshot.keyword_id,
          (snapshot.observed_at AT TIME ZONE 'UTC')::date,
          snapshot.observed_at DESC, snapshot.id DESC
      )
      SELECT latest_daily.keyword_id AS "keywordId", latest_daily.day,
        latest_daily.id AS "snapshotId",
        latest_daily.observed_at AS "observedAt", latest_daily.found,
        latest_daily.position,
        lag(latest_daily.position) OVER (
          PARTITION BY latest_daily.keyword_id
          ORDER BY latest_daily.day ASC, latest_daily.observed_at ASC,
            latest_daily.id ASC
        ) AS "previousPosition",
        latest_daily.ranking_url AS "rankingUrl",
        greatest(
          CASE
            WHEN latest_daily.found AND latest_daily.ranking_url IS NOT NULL
              THEN 1
            ELSE 0
          END,
          coalesce(site_results.result_count, 0)
        )::bigint AS "siteResultCount"
      FROM latest_daily
      JOIN rank_execution_manifests manifest
        ON manifest.id = latest_daily.manifest_id
       AND manifest.workspace_id = ${scope.workspaceId}::uuid
       AND manifest.project_id = ${scope.projectId}::uuid
      CROSS JOIN LATERAL (
        SELECT regexp_replace(
          lower(split_part(split_part(regexp_replace(manifest.project_domain, '^https?://', '', 'i'), '/', 1), ':', 1)),
          '^www\\.', ''
        ) AS host
      ) project_host
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT result.normalized_ranking_url)::bigint AS result_count
        FROM rank_serp_results result
        CROSS JOIN LATERAL (
          SELECT regexp_replace(
            lower(split_part(split_part(regexp_replace(result.ranking_url, '^https?://', '', 'i'), '/', 1), ':', 1)),
            '^www\\.', ''
          ) AS host
        ) result_host
        WHERE result.snapshot_id = latest_daily.id
          AND (
            result_host.host = project_host.host OR
            result_host.host LIKE '%.' || project_host.host
          )
      ) site_results ON true
      ORDER BY latest_daily.keyword_id ASC, latest_daily.day ASC
    `);
  }

  private dailyAiRanks(
    scope: ReadScope,
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[],
    keywordIds: readonly string[],
    dates: readonly string[]
  ): Promise<DailyAiRankRow[]> {
    const regionCodes = [...new Set(sourceDimensions.map(({ regionCode }) => regionCode))];
    return this.prisma.$queryRaw<DailyAiRankRow[]>(Prisma.sql`
      WITH daily AS MATERIALIZED (
        SELECT DISTINCT ON (
          snapshot.keyword_id,
          (snapshot.observed_at AT TIME ZONE 'UTC')::date
        ) snapshot.keyword_id, snapshot.id, snapshot.observed_at,
          (snapshot.observed_at AT TIME ZONE 'UTC')::date AS day,
          snapshot.answer_present, snapshot.site_found, snapshot.position,
          snapshot.ranking_url, snapshot.brand_found
        FROM ai_answer_snapshots snapshot
        WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
          AND snapshot.project_id = ${scope.projectId}::uuid
          AND snapshot.keyword_id IN (${Prisma.join(keywordIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND snapshot.search_engine::text = ${dimension.searchEngine}
          AND snapshot.region_code IN (${Prisma.join(regionCodes)})
          AND snapshot.device::text = ${dimension.device}
          AND snapshot.position_tracking_enabled
          AND (snapshot.observed_at AT TIME ZONE 'UTC')::date IN (
            ${Prisma.join(dates.map((date) => Prisma.sql`${date}::date`))}
          )
        ORDER BY snapshot.keyword_id,
          (snapshot.observed_at AT TIME ZONE 'UTC')::date,
          snapshot.observed_at DESC, snapshot.id DESC
      )
      SELECT daily.keyword_id AS "keywordId", daily.day,
        daily.id AS "snapshotId", daily.observed_at AS "observedAt",
        daily.answer_present AS "answerPresent",
        daily.site_found AS "siteFound", daily.position,
        lag(daily.position) OVER (
          PARTITION BY daily.keyword_id
          ORDER BY daily.day ASC, daily.observed_at ASC, daily.id ASC
        ) AS "previousPosition",
        daily.ranking_url AS "rankingUrl",
        daily.brand_found AS "brandFound"
      FROM daily
      ORDER BY daily.keyword_id, daily.day
    `);
  }

  private positionTrend(
    scope: ReadScope,
    input: RankPositionReportInput,
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[]
  ): Promise<TrendRow[]> {
    const filters = keywordFilters(scope, input);
    const regionCodes = [...new Set(sourceDimensions.map(({ regionCode }) => regionCode))];
    const latestDaily = input.mode === "AI"
      ? Prisma.sql`
          SELECT DISTINCT ON (
            snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date
          ) snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date AS day,
            snapshot.site_found AS found, snapshot.position
          FROM ai_answer_snapshots snapshot
          JOIN scoped_keywords keyword ON keyword.id = snapshot.keyword_id
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
            AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.search_engine::text = ${dimension.searchEngine}
            AND snapshot.region_code IN (${Prisma.join(regionCodes)})
            AND snapshot.device::text = ${dimension.device}
            AND snapshot.position_tracking_enabled
            AND snapshot.observed_at >= ${new Date(input.observedFrom)}
            AND snapshot.observed_at < ${new Date(input.observedBefore)}
          ORDER BY snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date,
            snapshot.observed_at DESC, snapshot.id DESC
        `
      : Prisma.sql`
          SELECT DISTINCT ON (
            snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date
          ) snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date AS day,
            snapshot.found, snapshot.position
          FROM rank_snapshots snapshot
          JOIN configurations configuration
            ON configuration.context_id = snapshot.tracking_context_id
           AND configuration.configuration_version = snapshot.configuration_version
          JOIN scoped_keywords keyword ON keyword.id = snapshot.keyword_id
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
            AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.position_tracking_enabled
            AND snapshot.observed_at >= ${new Date(input.observedFrom)}
            AND snapshot.observed_at < ${new Date(input.observedBefore)}
            ${visibleSnapshotPredicate(scope, dimension, "snapshot")}
          ORDER BY snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date,
            snapshot.observed_at DESC, snapshot.id DESC
        `;
    return this.prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      WITH configurations AS MATERIALIZED (
        SELECT context_id, configuration_version
        FROM tracking_context_versions configuration
        WHERE configuration.workspace_id = ${scope.workspaceId}::uuid
          AND configuration.project_id = ${scope.projectId}::uuid
          ${rankDimensionConfigurationPredicate(sourceDimensions)}
      ), scoped_keywords AS MATERIALIZED (
        SELECT keyword.id FROM keywords keyword
        WHERE ${Prisma.join(filters, " AND ")}
      ), latest_daily AS MATERIALIZED (
        ${latestDaily}
      )
      SELECT day, count(*)::bigint AS measured,
        count(*) FILTER (WHERE found)::bigint AS found,
        count(*) FILTER (WHERE position <= 3)::bigint AS top3,
        count(*) FILTER (WHERE position <= 10)::bigint AS top10,
        count(*) FILTER (WHERE position <= 30)::bigint AS top30,
        avg(position) FILTER (WHERE position IS NOT NULL)::float8 AS "averagePosition"
      FROM latest_daily
      GROUP BY day
      ORDER BY day ASC
    `);
  }

  private keywordPage(
    scope: ReadScope,
    input: SerpWorkbenchInput,
    offset: number
  ): Promise<KeywordPageRow[]> {
    const filters = keywordFilters(scope, input);
    return this.prisma.$queryRaw<KeywordPageRow[]>(Prisma.sql`
      SELECT keyword.id, keyword.version, keyword.text_original AS query,
        keyword.language, target.url AS "targetUrl",
        group_row.path AS "groupPath",
        count(*) OVER ()::bigint AS "totalCount"
      FROM keywords keyword
      LEFT JOIN pages target
        ON target.workspace_id = ${scope.workspaceId}::uuid
       AND target.project_id = ${scope.projectId}::uuid
       AND target.id = keyword.target_page_id
       AND target.status::text = 'ACTIVE'
      LEFT JOIN LATERAL (
        SELECT group_value.path
        FROM keyword_group_memberships membership
        JOIN keyword_groups group_value
          ON group_value.id = membership.group_id
         AND group_value.project_id = membership.project_id
        WHERE membership.project_id = ${scope.projectId}::uuid
          AND membership.keyword_id = keyword.id
          AND group_value.status::text = 'ACTIVE'
          AND group_value.system_kind IS NULL
        ORDER BY membership.created_at ASC, group_value.id ASC
        LIMIT 1
      ) group_row ON true
      WHERE ${Prisma.join(filters, " AND ")}
      ORDER BY keyword.text_normalized ASC, keyword.id ASC
      OFFSET ${offset}
      LIMIT ${input.limit + 1}
    `);
  }

  private latestSerpSnapshots(
    scope: ReadScope,
    keywordIds: readonly string[],
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[]
  ): Promise<(LatestSerpSnapshotRow & { readonly dimensionKey: string })[]> {
    return this.prisma.$queryRaw<LatestSerpSnapshotRow[]>(Prisma.sql`
      WITH configurations AS MATERIALIZED (
        SELECT context_id, configuration_version
        FROM tracking_context_versions configuration
        WHERE configuration.workspace_id = ${scope.workspaceId}::uuid
          AND configuration.project_id = ${scope.projectId}::uuid
          ${rankDimensionConfigurationPredicate(sourceDimensions)}
      )
      SELECT DISTINCT ON (snapshot.keyword_id)
        snapshot.keyword_id AS "keywordId", snapshot.id AS "snapshotId",
        snapshot.observed_at AS "observedAt", snapshot.provider
      FROM rank_snapshots snapshot
      JOIN configurations configuration
        ON configuration.context_id = snapshot.tracking_context_id
       AND configuration.configuration_version = snapshot.configuration_version
      WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
        AND snapshot.project_id = ${scope.projectId}::uuid
        AND snapshot.keyword_id IN (${Prisma.join(keywordIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND snapshot.provider IN ('ARSENKIN', 'XMLSTOCK', 'KEY_COLLECTOR')
        AND EXISTS (
          SELECT 1 FROM rank_serp_results result
          WHERE result.snapshot_id = snapshot.id
        )
        ${visibleSnapshotPredicate(scope, dimension, "snapshot")}
      ORDER BY snapshot.keyword_id, snapshot.observed_at DESC, snapshot.id DESC
    `).then((rows) => rows.map((row) => ({ ...row, dimensionKey: dimension.key })));
  }

  private latestAiSerpSnapshots(
    scope: ReadScope,
    keywordIds: readonly string[],
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[]
  ): Promise<LatestAiSerpSnapshotRow[]> {
    const regionCodes = [...new Set(sourceDimensions.map(({ regionCode }) => regionCode))];
    return this.prisma.aiAnswerSnapshot.findMany({
      where: {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        keywordId: { in: [...keywordIds] },
        searchEngine: dimension.searchEngine,
        regionCode: { in: regionCodes },
        device: dimension.device,
        sources: { some: {} }
      },
      orderBy: [
        { keywordId: "asc" },
        { observedAt: "desc" },
        { id: "desc" }
      ],
      distinct: ["keywordId"],
      select: {
        keywordId: true,
        id: true,
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
    }).then((rows) => rows.map((row) => ({
      keywordId: row.keywordId,
      dimensionKey: dimension.key,
      snapshotId: row.id,
      observedAt: row.observedAt,
      sources: row.sources
    })));
  }
}

function keywordFilters(
  scope: ReadScope,
  input: Readonly<{ groupIds?: readonly string[]; search?: string }>
): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [
    Prisma.sql`keyword.workspace_id = ${scope.workspaceId}::uuid`,
    Prisma.sql`keyword.project_id = ${scope.projectId}::uuid`,
    Prisma.sql`keyword.status::text = 'ACTIVE'`
  ];
  if (input.search) {
    filters.push(Prisma.sql`keyword.text_normalized ILIKE ${`%${input.search}%`}`);
  }
  if (input.groupIds && input.groupIds.length > 0) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1 FROM keyword_group_memberships selected_membership
      WHERE selected_membership.project_id = ${scope.projectId}::uuid
        AND selected_membership.keyword_id = keyword.id
        AND selected_membership.group_id IN (${Prisma.join(input.groupIds.map((id) => Prisma.sql`${id}::uuid`))})
    )`);
  }
  return filters;
}

function visibleSnapshotPredicate(
  scope: ReadScope,
  dimension: SemanticRankDimension,
  alias: "snapshot"
): Prisma.Sql {
  if (alias !== "snapshot") throw new TypeError("Invalid SQL alias");
  return Prisma.sql`
    AND NOT EXISTS (
      SELECT 1 FROM rank_dimension_history_deletions deletion
      WHERE deletion.workspace_id = ${scope.workspaceId}::uuid
        AND deletion.project_id = ${scope.projectId}::uuid
        AND deletion.search_engine = ${dimension.searchEngine}
        AND deletion.country_code = ${dimension.countryCode}
        AND deletion.region_code = ${dimension.regionCode}
        AND deletion.language = ${dimension.language}
        AND deletion.device = ${dimension.device}
        AND snapshot.observed_at <= deletion.excluded_through
    )
  `;
}

function positionOrder(sort: RankPositionReportInput["sort"]): Prisma.Sql {
  switch (sort) {
    case "POSITION_ASC":
      return Prisma.sql`latest_position ASC NULLS LAST, text_normalized ASC, id ASC`;
    case "POSITION_DESC":
      return Prisma.sql`latest_position DESC NULLS LAST, text_normalized ASC, id ASC`;
    case "CHANGE_ASC":
      return Prisma.sql`(previous_position - latest_position) ASC NULLS LAST, text_normalized ASC, id ASC`;
    case "CHANGE_DESC":
      return Prisma.sql`(previous_position - latest_position) DESC NULLS LAST, text_normalized ASC, id ASC`;
    default:
      return Prisma.sql`text_normalized ASC, id ASC`;
  }
}

function positionSummary(row: PositionKeywordRow): RankPositionReportSummary {
  return {
    keywordCount: safeCount(row.totalCount),
    measuredCount: safeCount(row.measuredCount),
    foundCount: safeCount(row.foundCount),
    notFoundCount: safeCount(row.notFoundCount),
    improvedCount: safeCount(row.improvedCount),
    declinedCount: safeCount(row.declinedCount),
    unchangedCount: safeCount(row.unchangedCount),
    newCount: safeCount(row.newCount),
    lostCount: safeCount(row.lostCount),
    top3Count: safeCount(row.top3Count),
    top10Count: safeCount(row.top10Count),
    top30Count: safeCount(row.top30Count),
    ...(row.averagePosition === null
      ? {}
      : { averagePosition: Number(row.averagePosition.toFixed(2)) })
  };
}

function positionTrendPoint(row: TrendRow): RankPositionReportTrendPoint {
  return {
    date: calendarDate(row.day),
    measured: safeCount(row.measured),
    found: safeCount(row.found),
    top3: safeCount(row.top3),
    top10: safeCount(row.top10),
    top30: safeCount(row.top30),
    ...(row.averagePosition === null
      ? {}
      : { averagePosition: Number(row.averagePosition.toFixed(2)) })
  };
}

function requiredDimension(value: string): SemanticRankDimension {
  const dimension = parseSemanticRankDimensionKey(value);
  if (!dimension) throw new BadRequestException("Invalid rank dimension");
  return dimension;
}

export function rankWorkbenchReportDates(
  limit: number,
  observedDays: readonly Date[]
): readonly string[] {
  const observed = [...new Set(observedDays.map(calendarDate))]
    .sort((left, right) => left.localeCompare(right));
  if (observed.length === 0) return [];
  if (observed.length <= limit) return observed.toReversed();
  if (limit === 1) return [observed.at(-1)!];

  const lastIndex = observed.length - 1;
  const selected = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    selected.add(Math.round(index * lastIndex / (limit - 1)));
  }
  return [...selected].map((index) => observed[index]!).reverse();
}

function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function positionFrequencies(
  row: Pick<PositionKeywordRow, "frequencyBase" | "frequencyExact" | "frequencyFixed">
): readonly Readonly<{ type: "BASE" | "EXACT" | "FIXED"; value: string }>[] {
  const result: Array<{ type: "BASE" | "EXACT" | "FIXED"; value: string }> = [];
  if (row.frequencyBase !== null) result.push({ type: "BASE", value: row.frequencyBase.toString() });
  if (row.frequencyExact !== null) result.push({ type: "EXACT", value: row.frequencyExact.toString() });
  if (row.frequencyFixed !== null) result.push({ type: "FIXED", value: row.frequencyFixed.toString() });
  return result;
}

function safeCount(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stored count is outside the safe range");
  }
  return Number(value);
}

function storedSerpProvider(value: string): SerpWorkbenchSnapshotProvider {
  if (serpWorkbenchSnapshotProviders.includes(value as SerpWorkbenchSnapshotProvider)) {
    return value as SerpWorkbenchSnapshotProvider;
  }
  throw new Error("Stored SERP provider is unsupported");
}

function snapshotDimensionKey(
  snapshot: Readonly<{ dimensionKey?: string }>,
  dimensions: readonly SemanticRankDimension[]
): string {
  if (snapshot.dimensionKey && dimensions.some(({ key }) => key === snapshot.dimensionKey)) {
    return snapshot.dimensionKey;
  }
  throw new Error("Stored SERP snapshot dimension is unavailable");
}

function deletionResult(
  row: Readonly<{
    id: string;
    excludedThrough: Date;
    createdAt: Date;
  }>,
  dimension: SemanticRankDimension,
  affectedSnapshots: number
): RankDimensionHistoryDeletion {
  return {
    id: row.id,
    dimension,
    excludedThrough: row.excludedThrough.toISOString(),
    affectedSnapshots,
    createdAt: row.createdAt.toISOString()
  };
}

function positionFilterHash(input: RankPositionReportInput): string {
  return filterHash({
    mode: input.mode,
    dimensionKey: input.dimensionKey,
    observedFrom: input.observedFrom,
    observedBefore: input.observedBefore,
    dateLimit: input.dateLimit,
    groupIds: input.groupIds ?? [],
    search: input.search ?? "",
    limit: input.limit,
    sort: input.sort
  });
}

function serpFilterHash(input: SerpWorkbenchInput): string {
  return filterHash({
    dimensionKeys: input.dimensionKeys,
    groupIds: input.groupIds ?? [],
    search: input.search ?? "",
    limit: input.limit
  });
}

function filterHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function encodeOffsetCursor(offset: number, hash: string): string {
  return Buffer.from(JSON.stringify({ offset, hash }), "utf8").toString("base64url");
}

function decodeOffsetCursor(value: string | undefined, hash: string): number {
  if (!value) return 0;
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("non-canonical");
    const payload = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
    if (
      Object.keys(payload).length !== 2 ||
      !Number.isSafeInteger(payload.offset) ||
      Number(payload.offset) < 0 ||
      Number(payload.offset) > 1_000_000 ||
      payload.hash !== hash
    ) throw new Error("invalid");
    return Number(payload.offset);
  } catch {
    throw new BadRequestException("Rank workbench cursor is invalid");
  }
}

function parseInput<Input, Value>(
  parser: (value: unknown) => Input,
  value: Value
): Input {
  try {
    return parser(value);
  } catch {
    throw new BadRequestException("Invalid rank workbench input");
  }
}

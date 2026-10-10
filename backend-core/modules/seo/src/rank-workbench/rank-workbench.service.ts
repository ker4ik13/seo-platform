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
import { decodeRankReadCursor, encodeRankReadCursor, rankReadPage, rankReadWindow, RankReadWindowCache } from "./rank-read-window.js";
import { historicalKeywordHasMultipleUrls } from "../rank-results/rank-site-url-filter.js";
import {
  rankDimensionConfigurationPredicate,
  rankDimensionSources
} from "../rank-results/rank-dimension-merge.js";

type ReadScope = Readonly<{ workspaceId: string; projectId: string }>;
type WriteScope = ReadScope & Readonly<{ actorId: string }>;

interface PositionKeywordRow {
  readonly isTracked: boolean;
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
  readonly top1Count: bigint;
  readonly top3Count: bigint;
  readonly top5Count: bigint;
  readonly top10Count: bigint;
  readonly top30Count: bigint;
  readonly top50Count: bigint;
  readonly top100Count: bigint;
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

type PositionStats = Pick<PositionKeywordRow,
  "totalCount" | "measuredCount" | "foundCount" | "notFoundCount" |
  "improvedCount" | "declinedCount" | "unchangedCount" | "newCount" | "lostCount" |
  "top1Count" | "top3Count" | "top5Count" | "top10Count" | "top30Count" | "top50Count" | "top100Count" | "averagePosition">;
type KeywordMetadataRow = Pick<PositionKeywordRow, "id" | "version" | "query" | "language" | "createdAt" | "isTracked" |
  "targetUrl" | "groupPath" | "frequencyBase" | "frequencyExact" | "frequencyFixed"> & {
    readonly groupPaths: readonly string[];
    readonly groupCount: bigint;
  };
type PositionReadWindowRow = PositionStats & { readonly keywordIds: readonly string[] };

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


@Injectable()
export class RankWorkbenchService {
  private readonly reads = new RankReadWindowCache();
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
    const hash = filterHash({ ...scope, input: positionFilterHash(input) });
    const cursor = decodeRankReadCursor(input.cursor, hash);
    const aiMode = input.mode === "AI";
    const prepared = await this.reads.read(`positions:${hash}:${cursor.asOf}`, async () => {
      const [projection, trendRows] = await Promise.all([
        this.positionReadWindow(scope, input, dimension, sourceDimensions, cursor.asOf),
        this.positionTrend(scope, input, dimension, sourceDimensions, cursor.asOf)
      ]);
      const summary = projection[0]!;
      const window = rankReadWindow(summary.keywordIds);
      return { value: { window, summary: positionSummary(summary), trendRows }, bytes: window.ids.length * 160 + trendRows.length * 160 + 4_096 };
    });
    const { trendRows } = prepared;
    const dates = rankWorkbenchReportDates(
      input.dateLimit,
      trendRows.map(({ day }) => day)
    );
    const page = rankReadPage(prepared.window, cursor.anchor, input.limit);
    const hasNext = page.hasNext;
    const keywordIds = page.ids;
    const metadata = keywordIds.length ? await this.keywordMetadata(scope, keywordIds, true) : [];
    const byId = new Map(metadata.map(row => [row.id, row]));
    const pageRows = keywordIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : []);
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
              dates,
              cursor.asOf
            )
          ] as const
        : [
            await this.dailyRanks(
              scope,
              input,
              dimension,
              sourceDimensions,
              keywordIds,
              dates,
              cursor.asOf
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
    return {
      dimension,
      dates,
      summary: prepared.summary,
      trend: trendRows
        .filter(({ day }) => dateSet.has(calendarDate(day)))
        .map(positionTrendPoint),
      rows: pageRows.map((row) => ({
        keywordId: row.id,
        version: row.version,
        query: row.query,
        language: row.language,
        createdAt: row.createdAt.toISOString(),
        isTracked: row.isTracked,
        ...(row.groupPath === null ? {} : { groupPath: row.groupPath }),
        groupPaths: row.groupPaths,
        groupCount: safeCount(row.groupCount),
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
              nextCursor: encodeRankReadCursor(keywordIds.at(-1)!, cursor.asOf, hash)
            }
          : {}),
        totalApprox: prepared.summary.keywordCount
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
    const hash = filterHash({ ...scope, input: serpFilterHash(input) });
    const cursor = decodeRankReadCursor(input.cursor, hash);
    const window = await this.reads.read(`serp:${hash}:${cursor.asOf}`, async () => {
      const [projection] = await this.keywordReadWindow(scope, input, cursor.asOf);
      const value = rankReadWindow(projection?.keywordIds ?? []);
      return { value, bytes: value.ids.length * 160 + 4_096 };
    });
    const page = rankReadPage(window, cursor.anchor, input.limit);
    const hasNext = page.hasNext;
    const keywordIds = page.ids;
    const metadata = keywordIds.length ? await this.keywordMetadata(scope, keywordIds, false) : [];
    const byId = new Map(metadata.map(row => [row.id, row]));
    const pageRows = keywordIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : []);
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
          ? { nextCursor: encodeRankReadCursor(keywordIds.at(-1)!, cursor.asOf, hash) }
          : {}),
        totalApprox: window.ids.length
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

  private positionReadWindow(
    scope: ReadScope,
    input: RankPositionReportInput,
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[],
    asOf: string
  ): Promise<PositionReadWindowRow[]> {
    const filters = [...keywordFilters(scope, input, sourceDimensions), Prisma.sql`keyword.created_at <= ${new Date(asOf)}`];
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
            AND snapshot.created_at <= ${new Date(asOf)}
            AND snapshot.observed_at <= ${new Date(asOf)}
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
            AND snapshot.created_at <= ${new Date(asOf)}
            AND snapshot.observed_at <= ${new Date(asOf)}
            AND snapshot.position_tracking_enabled
            AND snapshot.observed_at >= ${new Date(input.observedFrom)}
            AND snapshot.observed_at < ${new Date(input.observedBefore)}
            ${visibleSnapshotPredicate(scope, dimension, "snapshot")}
          ORDER BY snapshot.keyword_id,
            (snapshot.observed_at AT TIME ZONE 'UTC')::date,
            snapshot.observed_at DESC, snapshot.id DESC
        `;
    return this.prisma.$queryRaw<PositionReadWindowRow[]>(Prisma.sql`
      WITH configurations AS MATERIALIZED (
        SELECT context_id, configuration_version
        FROM tracking_context_versions configuration
        WHERE configuration.workspace_id = ${scope.workspaceId}::uuid
          AND configuration.project_id = ${scope.projectId}::uuid
          ${rankDimensionConfigurationPredicate(sourceDimensions)}
      ), scoped_keywords AS MATERIALIZED (
        SELECT keyword.id, keyword.version, keyword.text_original AS query,
          keyword.text_normalized, keyword.language,
          keyword.created_at, keyword.is_tracked,
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
          latest.observed_at AS latest_observed_at,
          CASE WHEN (latest.observed_at AT TIME ZONE 'UTC')::date =
            (SELECT MAX((observed_at AT TIME ZONE 'UTC')::date) FROM daily_candidates)
            THEN latest.position END AS latest_slice_position,
          previous.id AS previous_snapshot_id,
          previous.position AS previous_position,
          ${input.sort === "TARGET_URL_ASC" || input.sort === "TARGET_URL_DESC"
            ? Prisma.sql`sort_target.normalized_url`
            : Prisma.sql`NULL::text`} AS target_sort_url
        FROM scoped_keywords keyword
        LEFT JOIN candidates latest
          ON latest.keyword_id = keyword.id AND latest.sequence = 1
        LEFT JOIN candidates previous
          ON previous.keyword_id = keyword.id AND previous.sequence = 2
        ${input.sort === "TARGET_URL_ASC" || input.sort === "TARGET_URL_DESC" ? Prisma.sql`
          LEFT JOIN pages sort_target ON sort_target.workspace_id = ${scope.workspaceId}::uuid
            AND sort_target.project_id = ${scope.projectId}::uuid AND sort_target.id = keyword.target_page_id
        ` : Prisma.empty}
      )
      SELECT COALESCE(array_agg(id ORDER BY ${order}), ARRAY[]::uuid[]) AS "keywordIds",
        count(*)::bigint AS "totalCount",
        count(latest_snapshot_id)::bigint AS "measuredCount",
        count(*) FILTER (WHERE latest_found)::bigint AS "foundCount",
        count(*) FILTER (WHERE latest_snapshot_id IS NOT NULL AND NOT latest_found)::bigint AS "notFoundCount",
        count(*) FILTER (WHERE latest_position < previous_position)::bigint AS "improvedCount",
        count(*) FILTER (WHERE latest_position > previous_position)::bigint AS "declinedCount",
        count(*) FILTER (WHERE latest_position = previous_position)::bigint AS "unchangedCount",
        count(*) FILTER (WHERE latest_position IS NOT NULL AND previous_position IS NULL)::bigint AS "newCount",
        count(*) FILTER (WHERE latest_position IS NULL AND previous_position IS NOT NULL)::bigint AS "lostCount",
        count(*) FILTER (WHERE latest_position <= 1)::bigint AS "top1Count",
        count(*) FILTER (WHERE latest_position <= 3)::bigint AS "top3Count",
        count(*) FILTER (WHERE latest_position <= 5)::bigint AS "top5Count",
        count(*) FILTER (WHERE latest_position <= 10)::bigint AS "top10Count",
        count(*) FILTER (WHERE latest_position <= 30)::bigint AS "top30Count",
        count(*) FILTER (WHERE latest_position <= 50)::bigint AS "top50Count",
        count(*) FILTER (WHERE latest_position <= 100)::bigint AS "top100Count",
        avg(latest_position) FILTER (WHERE latest_position IS NOT NULL)::float8 AS "averagePosition"
      FROM projected
    `);
  }

  private keywordMetadata(scope: ReadScope, keywordIds: readonly string[], includeFrequencies: boolean): Promise<KeywordMetadataRow[]> {
    if (!keywordIds.length) return Promise.resolve([]);
    return this.prisma.$queryRaw<KeywordMetadataRow[]>(Prisma.sql`
      SELECT keyword.id, keyword.version, keyword.text_original AS query, keyword.language,
        keyword.created_at AS "createdAt", keyword.is_tracked AS "isTracked", target.url AS "targetUrl",
        (group_row.paths)[1] AS "groupPath", COALESCE(group_row.paths, ARRAY[]::text[]) AS "groupPaths",
        COALESCE(group_row.total, 0)::bigint AS "groupCount",
        ${includeFrequencies ? Prisma.sql`frequency.base_value` : Prisma.sql`NULL::bigint`} AS "frequencyBase",
        ${includeFrequencies ? Prisma.sql`frequency.exact_value` : Prisma.sql`NULL::bigint`} AS "frequencyExact",
        ${includeFrequencies ? Prisma.sql`frequency.fixed_value` : Prisma.sql`NULL::bigint`} AS "frequencyFixed"
      FROM keywords keyword
      LEFT JOIN pages target ON target.workspace_id = ${scope.workspaceId}::uuid
        AND target.project_id = ${scope.projectId}::uuid AND target.id = keyword.target_page_id AND target.status::text = 'ACTIVE'
      LEFT JOIN LATERAL (
        SELECT array_agg(selected.path ORDER BY selected.created_at, selected.id) AS paths, max(selected.total) AS total
        FROM (
          SELECT group_value.path, membership.created_at, group_value.id, count(*) OVER ()::bigint AS total
          FROM keyword_group_memberships membership
          JOIN keyword_groups group_value ON group_value.id = membership.group_id AND group_value.project_id = membership.project_id
          WHERE membership.project_id = ${scope.projectId}::uuid AND membership.keyword_id = keyword.id
            AND group_value.workspace_id = ${scope.workspaceId}::uuid AND group_value.status::text = 'ACTIVE' AND group_value.system_kind IS NULL
          ORDER BY membership.created_at, group_value.id LIMIT 5
        ) selected
      ) group_row ON true
      ${includeFrequencies ? Prisma.sql`LEFT JOIN LATERAL (
        SELECT max(latest.value) FILTER (WHERE latest.type = 'BASE') AS base_value,
          max(latest.value) FILTER (WHERE latest.type = 'EXACT') AS exact_value,
          max(latest.value) FILTER (WHERE latest.type = 'FIXED') AS fixed_value
        FROM (
          SELECT DISTINCT ON (snapshot.type) snapshot.type, snapshot.value
          FROM frequency_snapshots snapshot
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.keyword_id = keyword.id AND snapshot.type IN ('BASE', 'EXACT', 'FIXED')
          ORDER BY snapshot.type, snapshot.observed_at DESC, snapshot.id DESC
        ) latest
      ) frequency ON true` : Prisma.empty}
      WHERE keyword.workspace_id = ${scope.workspaceId}::uuid AND keyword.project_id = ${scope.projectId}::uuid
        AND keyword.id IN (${Prisma.join(keywordIds.map(id => Prisma.sql`${id}::uuid`))}) AND keyword.status::text = 'ACTIVE'
    `);
  }

  private dailyRanks(
    scope: ReadScope,
    input: RankPositionReportInput,
    dimension: SemanticRankDimension,
    sourceDimensions: readonly SemanticRankDimension[],
    keywordIds: readonly string[],
    dates: readonly string[],
    asOf: string
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
            AND snapshot.created_at <= ${new Date(asOf)}
            AND snapshot.observed_at <= ${new Date(asOf)}
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
    dates: readonly string[],
    asOf: string
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
            AND snapshot.created_at <= ${new Date(asOf)}
            AND snapshot.observed_at <= ${new Date(asOf)}
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
    sourceDimensions: readonly SemanticRankDimension[],
    asOf: string
  ): Promise<TrendRow[]> {
    const filters = [...keywordFilters(scope, input, sourceDimensions), Prisma.sql`keyword.created_at <= ${new Date(asOf)}`];
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
            AND snapshot.created_at <= ${new Date(asOf)}
            AND snapshot.observed_at <= ${new Date(asOf)}
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
            AND snapshot.created_at <= ${new Date(asOf)}
            AND snapshot.observed_at <= ${new Date(asOf)}
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

  private keywordReadWindow(scope: ReadScope, input: SerpWorkbenchInput, asOf: string): Promise<{ keywordIds: readonly string[] }[]> {
    const filters = [...keywordFilters(scope, input), Prisma.sql`keyword.created_at <= ${new Date(asOf)}`];
    return this.prisma.$queryRaw<{ keywordIds: readonly string[] }[]>(Prisma.sql`
      SELECT COALESCE(array_agg(keyword.id ORDER BY keyword.text_normalized ASC, keyword.id ASC), ARRAY[]::uuid[]) AS "keywordIds"
      FROM keywords keyword WHERE ${Prisma.join(filters, " AND ")}
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
  input: Readonly<{ groupIds?: readonly string[]; search?: string; includeUntracked?: boolean; targetUrlState?: "SET" | "EMPTY"; multipleUrlsState?: "MULTIPLE" | "NOT_MULTIPLE"; mode?: "SEO" | "AI"; observedFrom?: string; observedBefore?: string }>,
  sourceDimensions: readonly SemanticRankDimension[] = []
): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [
    Prisma.sql`keyword.workspace_id = ${scope.workspaceId}::uuid`,
    Prisma.sql`keyword.project_id = ${scope.projectId}::uuid`,
    Prisma.sql`keyword.status::text = 'ACTIVE'`
  ];
  if (input.includeUntracked === false) filters.push(Prisma.sql`keyword.is_tracked = TRUE`);
  if (input.targetUrlState === "SET") filters.push(Prisma.sql`keyword.target_page_id IS NOT NULL`);
  if (input.targetUrlState === "EMPTY") filters.push(Prisma.sql`keyword.target_page_id IS NULL`);
  if (input.multipleUrlsState) {
    if (input.mode !== "SEO" || !input.observedFrom || !input.observedBefore || sourceDimensions.length === 0) throw new TypeError("Invalid URL filter scope");
    const multiple = historicalKeywordHasMultipleUrls(scope, sourceDimensions, input.observedFrom, input.observedBefore);
    filters.push(input.multipleUrlsState === "MULTIPLE" ? multiple : Prisma.sql`NOT (${multiple})`);
  }
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
    case "TARGET_URL_ASC":
      return Prisma.sql`target_sort_url ASC NULLS LAST, text_normalized ASC, id ASC`;
    case "TARGET_URL_DESC":
      return Prisma.sql`target_sort_url DESC NULLS LAST, text_normalized ASC, id ASC`;
    case "TARGET_URL_SET_FIRST":
      return Prisma.sql`(target_page_id IS NOT NULL) DESC, text_normalized ASC, id ASC`;
    case "TARGET_URL_EMPTY_FIRST":
      return Prisma.sql`(target_page_id IS NOT NULL) ASC, text_normalized ASC, id ASC`;
    case "OBSERVED_DESC":
      return Prisma.sql`latest_observed_at DESC NULLS LAST, created_at DESC, text_normalized ASC, id ASC`;
    case "POSITION_ASC":
      return Prisma.sql`latest_slice_position ASC NULLS LAST, latest_observed_at DESC NULLS LAST, latest_position ASC NULLS LAST, text_normalized ASC, id ASC`;
    case "POSITION_DESC":
      return Prisma.sql`latest_slice_position DESC NULLS LAST, latest_observed_at DESC NULLS LAST, latest_position DESC NULLS LAST, text_normalized ASC, id ASC`;
    case "CHANGE_ASC":
      return Prisma.sql`(previous_position - latest_position) ASC NULLS LAST, text_normalized ASC, id ASC`;
    case "CHANGE_DESC":
      return Prisma.sql`(previous_position - latest_position) DESC NULLS LAST, text_normalized ASC, id ASC`;
    default:
      return Prisma.sql`text_normalized ASC, id ASC`;
  }
}

function positionSummary(row: PositionStats): RankPositionReportSummary {
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
    top1Count: safeCount(row.top1Count),
    top3Count: safeCount(row.top3Count),
    top5Count: safeCount(row.top5Count),
    top10Count: safeCount(row.top10Count),
    top30Count: safeCount(row.top30Count),
    top50Count: safeCount(row.top50Count),
    top100Count: safeCount(row.top100Count),
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
    includeUntracked: input.includeUntracked ?? true,
    ...(input.targetUrlState ? { targetUrlState: input.targetUrlState } : {}),
    ...(input.multipleUrlsState ? { multipleUrlsState: input.multipleUrlsState } : {}),
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

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  parseCreateRankDimensionMergeInput,
  parseSemanticRankComparisonInput,
  parseSemanticRankDimensionKey,
  type CreateRankDimensionMergeInput,
  type RankDimensionMergeSettings,
  type RankDimensionMergeSummary,
  type SemanticRankComparisonInput,
  type SemanticRankComparisonItem,
  type SemanticRankDimension,
  type SemanticRankDimensionCatalog
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { rankHistorySearchSource } from "../rank-results/rank-serp-projection.js";
import {
  mergedAiRankDimensionCatalog,
  mergedRankDimensionCatalog,
  rankDimensionConfigurationPredicate,
  rankDimensionSourcesFromMerges,
  rawRankDimensionCatalog,
  resolvedRankDimensionMergeTargets,
  storedRankDimensionMerge
} from "../rank-results/rank-dimension-merge.js";

const COMPARISON_DIMENSION_CONCURRENCY = 4;

interface StoredComparison {
  keywordId: string; snapshotId: string; trackingContextId: string;
  configurationVersion: number; jobId: string; observedAt: Date;
  found: boolean; position: number | null; previousPosition: number | null;
  rankingUrl: string | null;
  provider: string; depth: number; execution: Prisma.JsonValue;
  siteResultCount: bigint;
}
interface StoredAiComparison {
  keywordId: string;
  snapshotId: string;
  answerPresent: boolean;
  siteFound: boolean;
  position: number | null;
  previousPosition: number | null;
  rankingUrl: string | null;
  brandFound: boolean;
  observedAt: Date;
}
type Scope = Readonly<{ workspaceId: string; projectId: string }>;

/** Rank projection plus reversible display merges over immutable snapshots. */
@Injectable()
export class KeywordRankComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog(scope: Scope): Promise<SemanticRankDimensionCatalog> {
    const [seo, ai] = await Promise.all([
      mergedRankDimensionCatalog(this.prisma, scope),
      mergedAiRankDimensionCatalog(this.prisma, scope)
    ]);
    return {
      dimensions: seo.dimensions,
      aiDimensions: ai.dimensions,
      truncated: seo.truncated || ai.truncated
    };
  }

  async mergeSettings(scope: Scope): Promise<RankDimensionMergeSettings> {
    const [catalog, rows] = await Promise.all([
      rawRankDimensionCatalog(this.prisma, scope),
      this.prisma.rankDimensionMerge.findMany({
        where: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 2_000
      })
    ]);
    return {
      dimensions: catalog.dimensions,
      merges: rows.map(storedRankDimensionMerge)
    };
  }

  async createMerge(
    scope: Scope & Readonly<{ actorId: string }>,
    value: CreateRankDimensionMergeInput,
    idempotencyKey: string
  ): Promise<RankDimensionMergeSummary> {
    const input = parseCreateRankDimensionMergeInput(value);
    const requestHash = createHash("sha256")
      .update(`${input.sourceDimensionKey}\0${input.targetDimensionKey}`, "utf8")
      .digest();
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))
      `;
      const replay = await transaction.rankDimensionMerge.findFirst({
        where: { workspaceId: scope.workspaceId, idempotencyKey }
      });
      if (replay) {
        if (!Buffer.from(replay.requestHash).equals(requestHash)) {
          throw new ConflictException("Rank dimension merge idempotency conflict");
        }
        return storedRankDimensionMerge(replay);
      }
      const [catalog, merges] = await Promise.all([
        rawRankDimensionCatalog(transaction, scope),
        transaction.rankDimensionMerge.findMany({
          where: {
            workspaceId: scope.workspaceId,
            projectId: scope.projectId
          },
          take: 2_000
        })
      ]);
      if (catalog.truncated || merges.length >= 2_000) {
        throw new ConflictException("Rank dimension catalog is too large to merge safely");
      }
      const source = catalog.dimensions.find(
        ({ key }) => key === input.sourceDimensionKey
      );
      const target = catalog.dimensions.find(
        ({ key }) => key === input.targetDimensionKey
      );
      if (!source || !target) {
        throw new NotFoundException("Rank dimension is unavailable");
      }
      if (!compatibleMerge(source, target)) {
        throw new BadRequestException(
          "Only dimensions of the same engine, country, language and device can be merged"
        );
      }
      if (
        merges.some(({ sourceDimensionKey }) =>
          sourceDimensionKey === source.key || sourceDimensionKey === target.key
        ) ||
        merges.some(({ targetDimensionKey }) => targetDimensionKey === source.key)
      ) {
        throw new ConflictException("Rank dimension is already part of another merge");
      }
      const created = await transaction.rankDimensionMerge.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          sourceDimensionKey: source.key,
          sourceRegionLabel: source.regionLabel ?? null,
          targetDimensionKey: target.key,
          targetRegionLabel: target.regionLabel ?? null,
          createdBy: scope.actorId,
          idempotencyKey,
          requestHash
        }
      });
      return storedRankDimensionMerge(created);
    });
  }

  async removeMerge(
    scope: Scope,
    mergeId: string,
    version: number
  ): Promise<Readonly<{ id: string; removed: true }>> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))
      `;
      const removed = await transaction.rankDimensionMerge.deleteMany({
        where: {
          id: mergeId,
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          version
        }
      });
      if (removed.count !== 1) {
        throw new ConflictException("Rank dimension merge changed or is unavailable");
      }
      return { id: mergeId, removed: true };
    });
  }

  async compare(scope: Scope, value: SemanticRankComparisonInput): Promise<readonly SemanticRankComparisonItem[]> {
    let input: SemanticRankComparisonInput;
    try { input = parseSemanticRankComparisonInput(value); } catch { throw new BadRequestException("Invalid rank comparison scope"); }
    const [count, merges] = await Promise.all([
      this.prisma.keyword.count({ where: { workspaceId: scope.workspaceId, projectId: scope.projectId, id: { in: [...input.keywordIds] }, status: { in: ["ACTIVE", "DELETED"] } } }),
      this.prisma.rankDimensionMerge.findMany({
        where: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 2_000,
        select: {
          sourceDimensionKey: true,
          sourceRegionLabel: true,
          targetDimensionKey: true,
          targetRegionLabel: true
        }
      })
    ]);
    if (count !== input.keywordIds.length) throw new NotFoundException("Keyword selection unavailable");
    const mergeTargets = resolvedRankDimensionMergeTargets(merges);
    const result: SemanticRankComparisonItem[] = [];
    for (let offset = 0; offset < input.dimensionKeys.length; offset += COMPARISON_DIMENSION_CONCURRENCY) {
      const dimensions = input.dimensionKeys.slice(
        offset,
        offset + COMPARISON_DIMENSION_CONCURRENCY
      );
      const compared = await Promise.all(dimensions.map(async (key) => {
        const dimension = parseSemanticRankDimensionKey(key)!;
        const sources = rankDimensionSourcesFromMerges(
          merges,
          dimension,
          mergeTargets
        );
        const [rows, aiRows] = await Promise.all([
          this.readDimension(scope, input.keywordIds, dimension, sources),
          input.includeAi === false
            ? Promise.resolve([] as StoredAiComparison[])
            : this.readAiDimension(scope, input.keywordIds, dimension, sources)
        ]);
        const aiByKeyword = new Map(aiRows.map((row) => [row.keywordId, row]));
        return rows.map((row): SemanticRankComparisonItem => {
          const searchSource = rankHistorySearchSource(row.execution, dimension.searchEngine);
          const ai = aiByKeyword.get(row.keywordId);
          return {
            keywordId: row.keywordId, dimensionKey: key, searchEngine: dimension.searchEngine,
            snapshotId: row.snapshotId, trackingContextId: row.trackingContextId,
            configurationVersion: row.configurationVersion, jobId: row.jobId,
            observedAt: row.observedAt.toISOString(), found: row.found,
            ...(row.position === null ? {} : { position: row.position }),
            ...(row.previousPosition === null ? {} : { previousPosition: row.previousPosition }),
            ...(row.rankingUrl === null ? {} : { rankingUrl: row.rankingUrl }),
            provider: row.provider, depth: row.depth,
            siteResultCount: safeCount(row.siteResultCount),
            ...(searchSource ? { searchSource } : {}),
            ...(ai ? {
              aiAnswer: {
                snapshotId: ai.snapshotId,
                answerPresent: ai.answerPresent,
                siteFound: ai.siteFound,
                ...(ai.position === null ? {} : { position: ai.position }),
                ...(ai.previousPosition === null ? {} : { previousPosition: ai.previousPosition }),
                ...(ai.rankingUrl === null ? {} : { rankingUrl: ai.rankingUrl }),
                brandFound: ai.brandFound,
                observedAt: ai.observedAt.toISOString(),
                provider: "ARSENKIN" as const
              }
            } : {})
          };
        });
      }));
      for (const items of compared) {
        result.push(...items);
      }
    }
    return result;
  }

  private readDimension(
    scope: Scope,
    keywordIds: readonly string[],
    dimension: SemanticRankDimension,
    sources: readonly SemanticRankDimension[]
  ): Promise<StoredComparison[]> {
    // Each inner scan uses the existing (tenant, keyword, context, observed_at)
    // index. Immutable configuration filters keep old city/device results
    // available even after a profile is edited or archived.
    return this.prisma.$queryRaw<StoredComparison[]>(Prisma.sql`
      WITH configurations AS MATERIALIZED (
        SELECT context_id, configuration_version, depth
        FROM tracking_context_versions configuration
        WHERE configuration.workspace_id = ${scope.workspaceId}::uuid AND configuration.project_id = ${scope.projectId}::uuid
          ${rankDimensionConfigurationPredicate(sources)}
      ), selected_keywords AS (
        SELECT unnest(ARRAY[${Prisma.join(keywordIds.map(id => Prisma.sql`${id}::uuid`))}]) AS id
      ), keyword_identities AS MATERIALIZED (
        SELECT keyword.id AS target_id, keyword.id AS source_id
        FROM selected_keywords keyword
        UNION ALL
        SELECT keyword.id AS target_id, merge.source_keyword_id AS source_id
        FROM selected_keywords keyword
        JOIN keyword_merges merge
          ON merge.workspace_id = ${scope.workspaceId}::uuid
          AND merge.project_id = ${scope.projectId}::uuid
          AND merge.target_keyword_id = keyword.id
      )
      SELECT keyword.id AS "keywordId", latest.id AS "snapshotId", latest.tracking_context_id AS "trackingContextId",
        latest.configuration_version AS "configurationVersion", latest.job_id AS "jobId", latest.observed_at AS "observedAt",
        latest.found, latest.position, previous.position AS "previousPosition", latest.ranking_url AS "rankingUrl",
        latest.provider, latest.depth, manifest.execution,
        greatest(
          CASE WHEN latest.found THEN 1 ELSE 0 END,
          coalesce(site_results.result_count, 0)
        )::bigint AS "siteResultCount"
      FROM selected_keywords keyword
      CROSS JOIN LATERAL (
        SELECT candidate.*, configuration.depth
        FROM configurations configuration
        CROSS JOIN LATERAL (
          SELECT snapshot.* FROM rank_snapshots snapshot
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.keyword_id IN (
              SELECT identity.source_id FROM keyword_identities identity
              WHERE identity.target_id = keyword.id
            ) AND snapshot.tracking_context_id = configuration.context_id
            AND snapshot.configuration_version = configuration.configuration_version AND snapshot.position_tracking_enabled
            ${visibleSnapshot(scope, dimension)}
          ORDER BY snapshot.observed_at DESC, snapshot.id DESC LIMIT 1
        ) candidate
        ORDER BY candidate.observed_at DESC, candidate.id DESC LIMIT 1
      ) latest
      JOIN rank_execution_manifests manifest
        ON manifest.workspace_id = ${scope.workspaceId}::uuid AND manifest.project_id = ${scope.projectId}::uuid
          AND manifest.id = latest.manifest_id AND manifest.job_id = latest.job_id
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
        WHERE result.snapshot_id = latest.id
          AND (
            result_host.host = project_host.host OR
            result_host.host LIKE '%.' || project_host.host
          )
      ) site_results ON true
      LEFT JOIN LATERAL (
        SELECT candidate.position FROM configurations configuration
        CROSS JOIN LATERAL (
          SELECT
            CASE
              WHEN snapshot.found = TRUE AND snapshot.position IS NOT NULL
                THEN snapshot.position
              ELSE NULL
            END AS position,
            snapshot.observed_at,
            snapshot.id
          FROM rank_snapshots snapshot
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.keyword_id IN (
              SELECT identity.source_id FROM keyword_identities identity
              WHERE identity.target_id = keyword.id
            ) AND snapshot.tracking_context_id = configuration.context_id
            AND snapshot.configuration_version = configuration.configuration_version AND snapshot.position_tracking_enabled
            AND (snapshot.observed_at, snapshot.id) < (latest.observed_at, latest.id)
            ${visibleSnapshot(scope, dimension)}
          ORDER BY snapshot.observed_at DESC, snapshot.id DESC LIMIT 1
        ) candidate
        ORDER BY candidate.observed_at DESC, candidate.id DESC LIMIT 1
      ) previous ON true
      ORDER BY keyword.id
    `);
  }

  private readAiDimension(
    scope: Scope,
    keywordIds: readonly string[],
    dimension: SemanticRankDimension,
    sources: readonly SemanticRankDimension[]
  ): Promise<StoredAiComparison[]> {
    const regionCodes = [...new Set(sources.map(({ regionCode }) => regionCode))];
    return this.prisma.$queryRaw<StoredAiComparison[]>(Prisma.sql`
      WITH selected_keywords AS (
        SELECT unnest(ARRAY[${Prisma.join(keywordIds.map(id => Prisma.sql`${id}::uuid`))}]) AS id
      ), keyword_identities AS MATERIALIZED (
        SELECT keyword.id AS target_id, keyword.id AS source_id
        FROM selected_keywords keyword
        UNION ALL
        SELECT keyword.id AS target_id, merge.source_keyword_id AS source_id
        FROM selected_keywords keyword
        JOIN keyword_merges merge
          ON merge.workspace_id = ${scope.workspaceId}::uuid
          AND merge.project_id = ${scope.projectId}::uuid
          AND merge.target_keyword_id = keyword.id
      )
      SELECT
        keyword.id AS "keywordId",
        snapshot.id AS "snapshotId",
        snapshot.answer_present AS "answerPresent",
        snapshot.site_found AS "siteFound",
        snapshot.position,
        previous.position AS "previousPosition",
        snapshot.ranking_url AS "rankingUrl",
        snapshot.brand_found AS "brandFound",
        snapshot.observed_at AS "observedAt"
      FROM selected_keywords keyword
      CROSS JOIN LATERAL (
        SELECT candidate.*
        FROM ai_answer_snapshots candidate
        WHERE candidate.workspace_id = ${scope.workspaceId}::uuid
          AND candidate.project_id = ${scope.projectId}::uuid
          AND candidate.keyword_id IN (
            SELECT identity.source_id FROM keyword_identities identity
            WHERE identity.target_id = keyword.id
          )
          AND candidate.search_engine::text = ${dimension.searchEngine}
          AND candidate.region_code IN (${Prisma.join(regionCodes)})
          AND candidate.device::text = ${dimension.device}
          AND candidate.position_tracking_enabled
        ORDER BY candidate.observed_at DESC, candidate.id DESC
        LIMIT 1
      ) snapshot
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN candidate.site_found = TRUE AND candidate.position IS NOT NULL
              THEN candidate.position
            ELSE NULL
          END AS position
        FROM ai_answer_snapshots candidate
        WHERE candidate.workspace_id = snapshot.workspace_id
          AND candidate.project_id = snapshot.project_id
          AND candidate.keyword_id IN (
            SELECT identity.source_id FROM keyword_identities identity
            WHERE identity.target_id = keyword.id
          )
          AND candidate.search_engine = snapshot.search_engine
          AND candidate.region_code = snapshot.region_code
          AND candidate.device = snapshot.device
          AND candidate.position_tracking_enabled
          AND (candidate.observed_at, candidate.id) <
            (snapshot.observed_at, snapshot.id)
        ORDER BY candidate.observed_at DESC, candidate.id DESC
        LIMIT 1
      ) previous ON true
      ORDER BY keyword.id
    `);
  }
}

function safeCount(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 100) {
    throw new Error("Invalid site result count");
  }
  return number;
}

function visibleSnapshot(
  scope: Scope,
  dimension: SemanticRankDimension
): Prisma.Sql {
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

function compatibleMerge(
  source: SemanticRankDimension,
  target: SemanticRankDimension
): boolean {
  return source.searchEngine === target.searchEngine &&
    source.countryCode === target.countryCode &&
    source.language === target.language &&
    source.device === target.device;
}

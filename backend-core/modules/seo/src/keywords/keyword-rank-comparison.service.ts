import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  parseSemanticRankComparisonInput,
  parseSemanticRankDimensionKey,
  semanticRankDimensionKey,
  type SemanticRankComparisonInput,
  type SemanticRankComparisonItem,
  type SemanticRankDimension,
  type SemanticRankDimensionCatalog
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { rankHistorySearchSource } from "../rank-results/rank-serp-projection.js";

interface StoredComparison {
  keywordId: string; snapshotId: string; trackingContextId: string;
  configurationVersion: number; jobId: string; observedAt: Date;
  found: boolean; position: number | null; previousPosition: number | null;
  rankingUrl: string | null;
  provider: string; depth: number; execution: Prisma.JsonValue;
}
type Scope = Readonly<{ workspaceId: string; projectId: string }>;

/** Read-only projection over immutable snapshots; never writes another owner. */
@Injectable()
export class KeywordRankComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog(scope: Scope): Promise<SemanticRankDimensionCatalog> {
    const tenant = { workspaceId: scope.workspaceId, projectId: scope.projectId };
    const rows = await this.prisma.trackingContextVersion.groupBy({
      by: ["searchEngine", "countryCode", "regionCode", "regionLabel", "language", "device"],
      where: tenant,
      orderBy: [{ searchEngine: "asc" }, { countryCode: "asc" }, { regionCode: "asc" }, { device: "asc" }, { language: "asc" }, { regionLabel: "asc" }],
      take: 2_001
    });
    const dimensions = new Map<string, SemanticRankDimension>();
    for (const row of rows.slice(0, 2_000)) {
      const value = { searchEngine: row.searchEngine, countryCode: row.countryCode, regionCode: row.regionCode ?? row.countryCode, language: row.language, device: row.device, ...(row.regionLabel ? { regionLabel: row.regionLabel } : {}) };
      const key = semanticRankDimensionKey(value);
      if (!dimensions.has(key)) dimensions.set(key, { key, ...value });
    }
    return { dimensions: [...dimensions.values()], truncated: rows.length > 2_000 };
  }

  async compare(scope: Scope, value: SemanticRankComparisonInput): Promise<readonly SemanticRankComparisonItem[]> {
    let input: SemanticRankComparisonInput;
    try { input = parseSemanticRankComparisonInput(value); } catch { throw new BadRequestException("Invalid rank comparison scope"); }
    const count = await this.prisma.keyword.count({ where: { workspaceId: scope.workspaceId, projectId: scope.projectId, id: { in: [...input.keywordIds] }, status: { in: ["ACTIVE", "DELETED"] } } });
    if (count !== input.keywordIds.length) throw new NotFoundException("Keyword selection unavailable");
    const result: SemanticRankComparisonItem[] = [];
    for (const key of input.dimensionKeys) {
      const dimension = parseSemanticRankDimensionKey(key)!;
      const rows = await this.readDimension(scope, input.keywordIds, dimension);
      for (const row of rows) {
        const searchSource = rankHistorySearchSource(row.execution, dimension.searchEngine);
        result.push({
          keywordId: row.keywordId, dimensionKey: key, searchEngine: dimension.searchEngine,
          snapshotId: row.snapshotId, trackingContextId: row.trackingContextId,
          configurationVersion: row.configurationVersion, jobId: row.jobId,
          observedAt: row.observedAt.toISOString(), found: row.found,
          ...(row.position === null ? {} : { position: row.position }),
          ...(row.previousPosition === null ? {} : { previousPosition: row.previousPosition }),
          ...(row.rankingUrl === null ? {} : { rankingUrl: row.rankingUrl }),
          provider: row.provider, depth: row.depth, ...(searchSource ? { searchSource } : {})
        });
      }
    }
    return result;
  }

  private readDimension(scope: Scope, keywordIds: readonly string[], dimension: SemanticRankDimension): Promise<StoredComparison[]> {
    // Each inner scan uses the existing (tenant, keyword, context, observed_at)
    // index. Immutable configuration filters keep old city/device results
    // available even after a profile is edited or archived.
    return this.prisma.$queryRaw<StoredComparison[]>(Prisma.sql`
      WITH configurations AS MATERIALIZED (
        SELECT context_id, configuration_version, depth
        FROM tracking_context_versions
        WHERE workspace_id = ${scope.workspaceId}::uuid AND project_id = ${scope.projectId}::uuid
          AND search_engine::text = ${dimension.searchEngine} AND country_code = ${dimension.countryCode}
          AND COALESCE(region_code, country_code) = ${dimension.regionCode}
          AND language = ${dimension.language} AND device::text = ${dimension.device}
      ), selected_keywords AS (
        SELECT unnest(ARRAY[${Prisma.join(keywordIds.map(id => Prisma.sql`${id}::uuid`))}]) AS id
      )
      SELECT keyword.id AS "keywordId", latest.id AS "snapshotId", latest.tracking_context_id AS "trackingContextId",
        latest.configuration_version AS "configurationVersion", latest.job_id AS "jobId", latest.observed_at AS "observedAt",
        latest.found, latest.position, previous.position AS "previousPosition", latest.ranking_url AS "rankingUrl",
        latest.provider, latest.depth, manifest.execution
      FROM selected_keywords keyword
      CROSS JOIN LATERAL (
        SELECT candidate.*, configuration.depth
        FROM configurations configuration
        CROSS JOIN LATERAL (
          SELECT snapshot.* FROM rank_snapshots snapshot
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.keyword_id = keyword.id AND snapshot.tracking_context_id = configuration.context_id
            AND snapshot.configuration_version = configuration.configuration_version AND snapshot.position_tracking_enabled
          ORDER BY snapshot.observed_at DESC, snapshot.id DESC LIMIT 1
        ) candidate
        ORDER BY candidate.observed_at DESC, candidate.id DESC LIMIT 1
      ) latest
      JOIN rank_execution_manifests manifest
        ON manifest.workspace_id = ${scope.workspaceId}::uuid AND manifest.project_id = ${scope.projectId}::uuid
          AND manifest.id = latest.manifest_id AND manifest.job_id = latest.job_id
      LEFT JOIN LATERAL (
        SELECT candidate.position FROM configurations configuration
        CROSS JOIN LATERAL (
          SELECT snapshot.position, snapshot.observed_at, snapshot.id FROM rank_snapshots snapshot
          WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid
            AND snapshot.keyword_id = keyword.id AND snapshot.tracking_context_id = configuration.context_id
            AND snapshot.configuration_version = configuration.configuration_version AND snapshot.position_tracking_enabled AND snapshot.found
            AND (snapshot.observed_at, snapshot.id) < (latest.observed_at, latest.id)
          ORDER BY snapshot.observed_at DESC, snapshot.id DESC LIMIT 1
        ) candidate
        ORDER BY candidate.observed_at DESC, candidate.id DESC LIMIT 1
      ) previous ON true
      ORDER BY keyword.id
    `);
  }
}

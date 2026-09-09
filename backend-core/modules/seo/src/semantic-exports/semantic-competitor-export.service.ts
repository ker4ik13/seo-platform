import { parseSemanticRankDimensionKey, semanticRankDimensionKey } from "@seo-platform/contracts";
import { rankHistorySearchSource } from "../rank-results/rank-serp-projection.js";
import { Injectable } from "@nestjs/common";
import type {
  ApiCollectionResponse,
  KeywordListQuery,
  SemanticCompetitorExportItem,
  SemanticCompetitorExportKeyword,
  SemanticCompetitorExportOptions,
  SemanticCompetitorExportSource
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { KeywordService } from "../keywords/keyword.service.js";
import { projectUrlBelongsToDomain } from "../rank-results/rank-serp-projection.js";

interface StoredCompetitorCandidate {
  readonly keywordId: string;
  readonly source: SemanticCompetitorExportSource;
  readonly url: string;
  readonly normalizedUrl: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly projectDomain: string;
  readonly searchEngine?: "YANDEX" | "GOOGLE";
  readonly countryCode?: string | null; readonly regionCode?: string | null; readonly regionLabel?: string | null;
  readonly language?: string | null; readonly device?: "DESKTOP" | "MOBILE" | null;
  readonly position?: number; readonly observedAt?: Date; readonly provider?: string;
  readonly snapshotId?: string; readonly trackingContextId?: string; readonly configurationVersion?: number;
  readonly execution?: unknown;
}

@Injectable()
export class SemanticCompetitorExportService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly keywords: KeywordService
  ) {}

  public async list(
    context: Readonly<{ workspaceId: string; projectId: string }>,
    query: KeywordListQuery,
    options: SemanticCompetitorExportOptions,
    requestId: string
  ): Promise<ApiCollectionResponse<SemanticCompetitorExportKeyword>> {
    const keywordPage = await this.keywords.list(
      context.workspaceId,
      context.projectId,
      query,
      requestId
    );
    const keywordIds = keywordPage.data.map(({ id }) => id);
    const candidates = keywordIds.length === 0
      ? []
      : [
          ...(options.sources.includes("SERP")
            ? await this.latestSerpCandidates(context, keywordIds, options.dimensionKeys)
            : []),
          ...(options.sources.includes("AI")
            ? await this.latestAiCandidates(context, keywordIds)
            : [])
        ];
    const competitorsByKeyword = projectCandidates(candidates, keywordIds);
    return {
      data: keywordPage.data.map(({ id }) => ({
        keywordId: id,
        competitors: competitorsByKeyword.get(id) ?? []
      })),
      page: keywordPage.page,
      meta: keywordPage.meta
    };
  }

  private latestSerpCandidates(
    context: Readonly<{ workspaceId: string; projectId: string }>,
    keywordIds: readonly string[],
    dimensionKeys?: readonly string[]
  ): Promise<StoredCompetitorCandidate[]> {
    const ids = keywordSqlList(keywordIds);
    const dimensions = dimensionKeys?.map(key => {
      const dimension = parseSemanticRankDimensionKey(key);
      if (!dimension) throw new Error("Invalid competitor export dimension");
      return Prisma.sql`(configuration.search_engine::text = ${dimension.searchEngine} AND configuration.country_code = ${dimension.countryCode}
        AND COALESCE(configuration.region_code, configuration.country_code) = ${dimension.regionCode}
        AND configuration.language = ${dimension.language} AND configuration.device::text = ${dimension.device})`;
    });
    if (dimensions && (dimensions.length < 1 || dimensions.length > 4)) throw new Error("Invalid competitor dimension batch");
    return this.prisma.$queryRaw<StoredCompetitorCandidate[]>(Prisma.sql`
      WITH latest_snapshots AS (
        SELECT
          rs.keyword_id,
          rs.id AS snapshot_id,
          rs.observed_at AS snapshot_observed_at,
          configuration.search_engine, configuration.country_code, configuration.region_code, configuration.region_label,
          configuration.language, configuration.device, configuration.depth, rs.provider, rs.tracking_context_id, rs.configuration_version, manifest.execution,
          manifest.project_domain,
          ROW_NUMBER() OVER (
            PARTITION BY rs.keyword_id, configuration.search_engine, configuration.country_code,
              COALESCE(configuration.region_code, configuration.country_code), configuration.language, configuration.device
            ORDER BY rs.observed_at DESC, rs.id DESC
          ) AS latest_rank
        FROM rank_snapshots AS rs
        INNER JOIN rank_execution_manifests AS manifest
          ON manifest.workspace_id = rs.workspace_id
          AND manifest.project_id = rs.project_id
          AND manifest.id = rs.manifest_id
          AND manifest.job_id = rs.job_id
        INNER JOIN tracking_context_versions AS configuration
          ON configuration.workspace_id = rs.workspace_id
          AND configuration.project_id = rs.project_id
          AND configuration.context_id = rs.tracking_context_id
          AND configuration.configuration_version = rs.configuration_version
        WHERE rs.workspace_id = ${context.workspaceId}::uuid
          AND rs.project_id = ${context.projectId}::uuid
          AND rs.keyword_id IN (${ids})
          AND rs.provider IN ('ARSENKIN', 'XMLSTOCK')
          AND NOT EXISTS (
            SELECT 1 FROM rank_dimension_history_deletions deletion
            WHERE deletion.workspace_id = rs.workspace_id
              AND deletion.project_id = rs.project_id
              AND deletion.search_engine = configuration.search_engine::text
              AND deletion.country_code = configuration.country_code
              AND deletion.region_code = COALESCE(configuration.region_code, configuration.country_code)
              AND deletion.language = configuration.language
              AND deletion.device = configuration.device::text
              AND rs.observed_at <= deletion.excluded_through
          )
          ${dimensions ? Prisma.sql`AND (${Prisma.join(dimensions, ' OR ')})` : Prisma.empty}
          AND EXISTS (
            SELECT 1
            FROM rank_serp_results AS available_result
            WHERE available_result.snapshot_observed_at = rs.observed_at
              AND available_result.snapshot_id = rs.id
          )
      )
      SELECT
        latest.keyword_id AS "keywordId", latest.search_engine AS "searchEngine", latest.country_code AS "countryCode",
        COALESCE(latest.region_code, latest.country_code) AS "regionCode", latest.region_label AS "regionLabel", latest.language,
        latest.device, latest.provider, latest.snapshot_observed_at AS "observedAt", latest.snapshot_id AS "snapshotId",
        latest.tracking_context_id AS "trackingContextId", latest.configuration_version AS "configurationVersion", latest.execution,
        result.position,
        'SERP'::text AS "source",
        result.ranking_url AS "url",
        result.normalized_ranking_url AS "normalizedUrl",
        result.title AS "title",
        result.snippet AS "description",
        latest.project_domain AS "projectDomain"
      FROM latest_snapshots AS latest
      INNER JOIN rank_serp_results AS result
        ON result.snapshot_observed_at = latest.snapshot_observed_at
        AND result.snapshot_id = latest.snapshot_id
      WHERE latest.latest_rank = 1
        AND result.position <= latest.depth
      ORDER BY latest.keyword_id ASC, latest.search_engine ASC, result.position ASC
    `);
  }

  private latestAiCandidates(
    context: Readonly<{ workspaceId: string; projectId: string }>,
    keywordIds: readonly string[]
  ): Promise<StoredCompetitorCandidate[]> {
    const ids = keywordSqlList(keywordIds);
    return this.prisma.$queryRaw<StoredCompetitorCandidate[]>(Prisma.sql`
      WITH latest_snapshots AS (
        SELECT
          snapshot.id,
          snapshot.keyword_id,
          snapshot.host,
          snapshot.search_engine, snapshot.region_code, snapshot.device, snapshot.observed_at,
          ROW_NUMBER() OVER (
            PARTITION BY snapshot.keyword_id, snapshot.search_engine, snapshot.region_code, snapshot.device
            ORDER BY snapshot.observed_at DESC, snapshot.id DESC
          ) AS latest_rank
        FROM ai_answer_snapshots AS snapshot
        WHERE snapshot.workspace_id = ${context.workspaceId}::uuid
          AND snapshot.project_id = ${context.projectId}::uuid
          AND snapshot.keyword_id IN (${ids})
          AND EXISTS (
            SELECT 1
            FROM ai_answer_sources AS available_source
            WHERE available_source.snapshot_id = snapshot.id
          )
      )
      SELECT
        latest.keyword_id AS "keywordId", latest.search_engine AS "searchEngine", latest.region_code AS "regionCode",
        latest.device, latest.observed_at AS "observedAt", latest.id AS "snapshotId", 'ARSENKIN'::text AS provider, source.position,
        'AI'::text AS "source",
        source.url AS "url",
        NULL::text AS "normalizedUrl",
        source.title AS "title",
        source.description AS "description",
        latest.host AS "projectDomain"
      FROM latest_snapshots AS latest
      INNER JOIN ai_answer_sources AS source
        ON source.snapshot_id = latest.id
      WHERE latest.latest_rank = 1
      ORDER BY latest.keyword_id ASC, latest.search_engine ASC, source.position ASC
    `);
  }
}

function keywordSqlList(keywordIds: readonly string[]): Prisma.Sql {
  if (keywordIds.length < 1 || keywordIds.length > 250) {
    throw new Error("Competitor export keyword page is outside the bounded range");
  }
  return Prisma.join(
    keywordIds.map((keywordId) => Prisma.sql`${keywordId}::uuid`)
  );
}

function projectCandidates(
  candidates: readonly StoredCompetitorCandidate[],
  keywordIds: readonly string[]
): ReadonlyMap<string, readonly SemanticCompetitorExportItem[]> {
  const expectedKeywords = new Set(keywordIds);
  const seenByKeyword = new Map<string, Set<string>>();
  const competitors = new Map<string, SemanticCompetitorExportItem[]>();
  for (const candidate of candidates) {
    if (!expectedKeywords.has(candidate.keywordId)) {
      throw new Error("Competitor export returned a keyword outside its page");
    }
    const url = canonicalHttpUrl(candidate.url);
    const normalizedUrl = canonicalHttpUrl(candidate.normalizedUrl ?? url);
    if (projectUrlBelongsToDomain(url, candidate.projectDomain)) continue;
    const seen = seenByKeyword.get(candidate.keywordId) ?? new Set<string>();
    const identity = `${candidate.source}:${candidate.searchEngine ?? ""}:${candidate.countryCode ?? ""}:${candidate.regionCode ?? ""}:${candidate.language ?? ""}:${candidate.device ?? ""}:${normalizedUrl}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    seenByKeyword.set(candidate.keywordId, seen);
    const items = competitors.get(candidate.keywordId) ?? [];
    const title = optionalText(candidate.title);
    const description = optionalText(candidate.description);
    const dimension = candidate.searchEngine && candidate.countryCode && candidate.regionCode && candidate.language && candidate.device
      ? { searchEngine: candidate.searchEngine, countryCode: candidate.countryCode, regionCode: candidate.regionCode, language: candidate.language, device: candidate.device } : undefined;
    const searchSource = candidate.execution && candidate.searchEngine ? rankHistorySearchSource(candidate.execution, candidate.searchEngine) : undefined;
    items.push({
      source: candidate.source,
      ...(dimension ? { ...dimension, dimensionKey: semanticRankDimensionKey(dimension) } : {}),
      ...(candidate.searchEngine ? { searchEngine: candidate.searchEngine } : {}),
      ...(candidate.regionCode ? { regionCode: candidate.regionCode } : {}),
      ...(candidate.regionLabel ? { regionLabel: candidate.regionLabel } : {}),
      ...(candidate.device ? { device: candidate.device } : {}),
      ...(candidate.position === undefined ? {} : { position: candidate.position }),
      ...(candidate.observedAt ? { observedAt: candidate.observedAt.toISOString() } : {}),
      ...(candidate.provider ? { provider: candidate.provider } : {}),
      ...(candidate.snapshotId ? { snapshotId: candidate.snapshotId } : {}),
      ...(candidate.trackingContextId ? { trackingContextId: candidate.trackingContextId } : {}),
      ...(candidate.configurationVersion ? { configurationVersion: candidate.configurationVersion } : {}),
      ...(searchSource ? { searchSource } : {}),
      url,
      normalizedUrl,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description })
    });
    competitors.set(candidate.keywordId, items);
  }
  return competitors;
}

function canonicalHttpUrl(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192) {
    throw new Error("Competitor export contains an invalid URL");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Competitor export contains a non-HTTP URL");
  }
  parsed.hash = "";
  return parsed.toString();
}

function optionalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string" || value.length > 50_000) {
    throw new Error("Competitor export contains invalid SERP text");
  }
  return value || undefined;
}

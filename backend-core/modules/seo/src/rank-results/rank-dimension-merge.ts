import {
  parseSemanticRankDimensionKey,
  semanticRankDimensionKey,
  type RankDimensionMergeSummary,
  type SemanticRankDimension,
  type SemanticRankDimensionCatalog
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";

export type RankDimensionScope = Readonly<{
  workspaceId: string;
  projectId: string;
}>;

type RankDimensionDatabase = Pick<
  PrismaService,
  "$queryRaw" | "rankDimensionMerge"
>;

interface RawRankDimensionRow {
  readonly searchEngine: string;
  readonly countryCode: string;
  readonly regionCode: string | null;
  readonly regionLabel: string | null;
  readonly language: string;
  readonly device: string;
}

export async function rawRankDimensionCatalog(
  database: RankDimensionDatabase,
  scope: RankDimensionScope
): Promise<SemanticRankDimensionCatalog> {
  const rows = await database.$queryRaw<readonly RawRankDimensionRow[]>(Prisma.sql`
    SELECT DISTINCT configuration.search_engine::text AS "searchEngine",
      configuration.country_code AS "countryCode",
      configuration.region_code AS "regionCode",
      configuration.region_label AS "regionLabel",
      configuration.language,
      configuration.device::text AS device
    FROM rank_snapshots snapshot
    JOIN tracking_context_versions configuration
      ON configuration.workspace_id = snapshot.workspace_id
     AND configuration.project_id = snapshot.project_id
     AND configuration.context_id = snapshot.tracking_context_id
     AND configuration.configuration_version = snapshot.configuration_version
    WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
      AND snapshot.project_id = ${scope.projectId}::uuid
      AND (snapshot.position_tracking_enabled OR EXISTS (
        SELECT 1 FROM rank_serp_results result WHERE result.snapshot_id = snapshot.id
      ))
      AND NOT EXISTS (
        SELECT 1 FROM rank_dimension_history_deletions deletion
        WHERE deletion.workspace_id = ${scope.workspaceId}::uuid
          AND deletion.project_id = ${scope.projectId}::uuid
          AND deletion.search_engine = configuration.search_engine::text
          AND deletion.country_code = configuration.country_code
          AND deletion.region_code = COALESCE(configuration.region_code, configuration.country_code)
          AND deletion.language = configuration.language
          AND deletion.device = configuration.device::text
          AND snapshot.observed_at <= deletion.excluded_through
      )
    ORDER BY "searchEngine", "countryCode", "regionCode", device,
      language, "regionLabel"
    LIMIT 2001
  `);
  return rankDimensionCatalogFromRows(rows);
}

export async function rawAiRankDimensionCatalog(
  database: RankDimensionDatabase,
  scope: RankDimensionScope
): Promise<SemanticRankDimensionCatalog> {
  const rows = await database.$queryRaw<readonly RawRankDimensionRow[]>(Prisma.sql`
    SELECT DISTINCT snapshot.search_engine::text AS "searchEngine",
      'RU'::text AS "countryCode", snapshot.region_code AS "regionCode",
      NULL::text AS "regionLabel", 'ru'::text AS language,
      snapshot.device::text AS device
    FROM ai_answer_snapshots snapshot
    WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid
      AND snapshot.project_id = ${scope.projectId}::uuid
      AND snapshot.position_tracking_enabled
    ORDER BY "searchEngine", "regionCode", device
    LIMIT 2001
  `);
  return rankDimensionCatalogFromRows(rows);
}

export async function mergedRankDimensionCatalog(
  database: RankDimensionDatabase,
  scope: RankDimensionScope
): Promise<SemanticRankDimensionCatalog> {
  const [catalog, merges] = await Promise.all([
    rawRankDimensionCatalog(database, scope),
    database.rankDimensionMerge.findMany({
      where: {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2_000,
      select: {
        sourceDimensionKey: true,
        targetDimensionKey: true,
        targetRegionLabel: true
      }
    })
  ]);
  return applyDimensionMerges(catalog, merges);
}

export async function mergedAiRankDimensionCatalog(
  database: RankDimensionDatabase,
  scope: RankDimensionScope
): Promise<SemanticRankDimensionCatalog> {
  const [catalog, merges] = await Promise.all([
    rawAiRankDimensionCatalog(database, scope),
    database.rankDimensionMerge.findMany({
      where: {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2_000,
      select: {
        sourceDimensionKey: true,
        targetDimensionKey: true,
        targetRegionLabel: true
      }
    })
  ]);
  return applyDimensionMerges(catalog, merges);
}

export async function rankDimensionSources(
  database: Pick<RankDimensionDatabase, "rankDimensionMerge">,
  scope: RankDimensionScope,
  target: SemanticRankDimension
): Promise<readonly SemanticRankDimension[]> {
  const merges = await database.rankDimensionMerge.findMany({
    where: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      targetDimensionKey: target.key
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2_000,
    select: { sourceDimensionKey: true, sourceRegionLabel: true }
  });
  return [
    target,
    ...merges.map((merge) =>
      storedDimension(merge.sourceDimensionKey, merge.sourceRegionLabel)
    )
  ];
}

export function rankDimensionConfigurationPredicate(
  dimensions: readonly SemanticRankDimension[]
): Prisma.Sql {
  if (dimensions.length < 1 || dimensions.length > 2_001) {
    throw new TypeError("Rank dimension source count is invalid");
  }
  return Prisma.sql`AND (${Prisma.join(dimensions.map((dimension) => Prisma.sql`(
    configuration.search_engine::text = ${dimension.searchEngine}
    AND configuration.country_code = ${dimension.countryCode}
    AND COALESCE(configuration.region_code, configuration.country_code) = ${dimension.regionCode}
    AND configuration.language = ${dimension.language}
    AND configuration.device::text = ${dimension.device}
  )`), " OR ")})`;
}

export function rankDimensionConfigurationWhereAny(
  dimensions: readonly SemanticRankDimension[]
): Prisma.TrackingContextVersionWhereInput {
  return {
    OR: dimensions.map((dimension) => ({
      searchEngine: dimension.searchEngine,
      countryCode: dimension.countryCode,
      language: dimension.language,
      device: dimension.device,
      OR: [
        { regionCode: dimension.regionCode },
        ...(dimension.regionCode === dimension.countryCode
          ? [{ regionCode: null }]
          : [])
      ]
    }))
  };
}

export function storedRankDimensionMerge(
  row: Readonly<{
    id: string;
    sourceDimensionKey: string;
    sourceRegionLabel: string | null;
    targetDimensionKey: string;
    targetRegionLabel: string | null;
    version: number;
    createdAt: Date;
  }>
): RankDimensionMergeSummary {
  return {
    id: row.id,
    source: storedDimension(row.sourceDimensionKey, row.sourceRegionLabel),
    target: storedDimension(row.targetDimensionKey, row.targetRegionLabel),
    version: row.version,
    createdAt: row.createdAt.toISOString()
  };
}

function rankDimensionCatalogFromRows(
  rows: readonly RawRankDimensionRow[]
): SemanticRankDimensionCatalog {
  const dimensions = new Map<string, SemanticRankDimension>();
  for (const row of rows.slice(0, 2_000)) {
    if (
      (row.searchEngine !== "YANDEX" && row.searchEngine !== "GOOGLE") ||
      (row.device !== "DESKTOP" && row.device !== "MOBILE")
    ) throw new Error("Stored rank dimension is unsupported");
    const value = {
      searchEngine: row.searchEngine,
      countryCode: row.countryCode,
      regionCode: row.regionCode ?? row.countryCode,
      language: row.language,
      device: row.device,
      ...(row.regionLabel ? { regionLabel: row.regionLabel } : {})
    } satisfies Omit<SemanticRankDimension, "key">;
    const key = semanticRankDimensionKey(value);
    if (!dimensions.has(key)) dimensions.set(key, { key, ...value });
  }
  return { dimensions: [...dimensions.values()], truncated: rows.length > 2_000 };
}

function applyDimensionMerges(
  catalog: SemanticRankDimensionCatalog,
  merges: readonly Readonly<{
    sourceDimensionKey: string;
    targetDimensionKey: string;
    targetRegionLabel: string | null;
  }>[]
): SemanticRankDimensionCatalog {
  const mergeBySource = new Map(
    merges.map((merge) => [merge.sourceDimensionKey, merge] as const)
  );
  const dimensions = new Map<string, SemanticRankDimension>();
  for (const dimension of catalog.dimensions) {
    const merge = mergeBySource.get(dimension.key);
    const resolved = merge
      ? storedDimension(merge.targetDimensionKey, merge.targetRegionLabel)
      : dimension;
    if (!dimensions.has(resolved.key)) dimensions.set(resolved.key, resolved);
  }
  return { dimensions: [...dimensions.values()], truncated: catalog.truncated };
}

function storedDimension(key: string, regionLabel: string | null): SemanticRankDimension {
  const dimension = parseSemanticRankDimensionKey(key);
  if (!dimension) throw new Error("Stored rank dimension merge is invalid");
  return {
    ...dimension,
    ...(regionLabel ? { regionLabel } : {})
  };
}

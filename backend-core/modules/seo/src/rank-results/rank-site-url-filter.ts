import {
  parseSemanticRankDimensionKey,
  type SemanticRankDimension,
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { rankDimensionConfigurationPredicate } from "./rank-dimension-merge.js";

type Scope = Readonly<{ workspaceId: string; projectId: string }>;

/** Probe only until a second distinct page of this project's domain is found. */
export function snapshotHasMultipleProjectUrls(
  scope: Scope,
  snapshotId: Prisma.Sql,
  observedAt: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM rank_snapshots url_snapshot
    JOIN rank_execution_manifests url_manifest
      ON url_manifest.id = url_snapshot.manifest_id
      AND url_manifest.workspace_id = url_snapshot.workspace_id
      AND url_manifest.project_id = url_snapshot.project_id
      AND url_manifest.job_id = url_snapshot.job_id
    CROSS JOIN LATERAL (
      SELECT regexp_replace(lower(split_part(split_part(regexp_replace(url_manifest.project_domain, '^https?://', '', 'i'), '/', 1), ':', 1)), '^www[.]', '') AS host
    ) url_project_host
    CROSS JOIN LATERAL (
      SELECT DISTINCT url_result.normalized_ranking_url
      FROM rank_serp_results url_result
      CROSS JOIN LATERAL (
        SELECT regexp_replace(lower(split_part(split_part(regexp_replace(url_result.ranking_url, '^https?://', '', 'i'), '/', 1), ':', 1)), '^www[.]', '') AS host
      ) url_result_host
      WHERE url_result.snapshot_observed_at = url_snapshot.observed_at
        AND url_result.snapshot_id = url_snapshot.id
        AND (url_result_host.host = url_project_host.host OR url_result_host.host LIKE '%.' || url_project_host.host)
      LIMIT 2
    ) url_distinct_page
    WHERE url_snapshot.workspace_id = ${scope.workspaceId}::uuid
      AND url_snapshot.project_id = ${scope.projectId}::uuid
      AND url_snapshot.id = ${snapshotId}
      AND url_snapshot.observed_at = ${observedAt}
    HAVING count(*) > 1
  )`;
}

export function currentKeywordHasMultipleUrls(
  scope: Scope,
  mergeTargets: ReadonlyMap<string, SemanticRankDimension>,
  dimensionKey?: string,
): Prisma.Sql {
  const mergedDimensions = new Map<
    string,
    Readonly<{ source: SemanticRankDimension; target: SemanticRankDimension }>
  >();
  for (const [key, target] of mergeTargets) {
    const source = parseSemanticRankDimensionKey(key);
    if (!source) throw new TypeError("Invalid stored merge dimension");
    mergedDimensions.set(key, { source, target });
    mergedDimensions.set(target.key, { source: target, target });
  }
  const parsed = dimensionKey
    ? parseSemanticRankDimensionKey(dimensionKey)
    : undefined;
  const selected = parsed
    ? (mergeTargets.get(parsed.key) ?? parsed)
    : undefined;
  if (dimensionKey && !selected) throw new TypeError("Invalid rank dimension");
  const selectedSources = selected
    ? [
        ...new Map(
          [
            selected,
            ...[...mergedDimensions.values()]
              .filter(({ target }) => target.key === selected.key)
              .map(({ source }) => source),
          ].map((source) => [source.key, source]),
        ).values(),
      ]
    : undefined;
  const dimension = mergedDimensions.size
    ? Prisma.sql`CASE ${Prisma.join(
        [...mergedDimensions.values()].map(
          ({ source, target }) => Prisma.sql`
        WHEN configuration.search_engine::text = ${source.searchEngine}
          AND configuration.country_code = ${source.countryCode}
          AND COALESCE(configuration.region_code, configuration.country_code) = ${source.regionCode}
          AND configuration.language = ${source.language}
          AND configuration.device::text = ${source.device}
        THEN ${target.key}`,
        ),
        " ",
      )}
      ELSE concat_ws('|', configuration.search_engine, configuration.country_code, COALESCE(configuration.region_code, configuration.country_code), configuration.language, configuration.device) END`
    : Prisma.sql`concat_ws('|', configuration.search_engine, configuration.country_code, COALESCE(configuration.region_code, configuration.country_code), configuration.language, configuration.device)`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (resolved_dimension_key) current_url_rank.snapshot_id, current_url_rank.observed_at, ${dimension} AS resolved_dimension_key
      FROM current_ranks current_url_rank
      JOIN tracking_context_versions configuration
        ON configuration.workspace_id = current_url_rank.workspace_id
        AND configuration.project_id = current_url_rank.project_id
        AND configuration.context_id = current_url_rank.tracking_context_id
        AND configuration.configuration_version = current_url_rank.configuration_version
      WHERE current_url_rank.workspace_id = k.workspace_id
        AND current_url_rank.project_id = k.project_id
        AND (current_url_rank.keyword_id = k.id OR EXISTS (
          SELECT 1 FROM keyword_merges url_keyword_merge
          WHERE url_keyword_merge.workspace_id = k.workspace_id
            AND url_keyword_merge.project_id = k.project_id
            AND url_keyword_merge.target_keyword_id = k.id
            AND url_keyword_merge.source_keyword_id = current_url_rank.keyword_id
        ))
        ${selectedSources ? rankDimensionConfigurationPredicate(selectedSources) : Prisma.empty}
        AND NOT EXISTS (
          SELECT 1 FROM rank_dimension_history_deletions url_deletion
          WHERE url_deletion.workspace_id = current_url_rank.workspace_id
            AND url_deletion.project_id = current_url_rank.project_id
            AND url_deletion.search_engine = configuration.search_engine::text
            AND url_deletion.country_code = configuration.country_code
            AND url_deletion.region_code = COALESCE(configuration.region_code, configuration.country_code)
            AND url_deletion.language = configuration.language
            AND url_deletion.device = configuration.device::text
            AND current_url_rank.observed_at <= url_deletion.excluded_through
        )
      ORDER BY resolved_dimension_key, current_url_rank.observed_at DESC, current_url_rank.snapshot_id DESC, current_url_rank.tracking_context_id DESC
    ) latest_url_rank
    WHERE ${snapshotHasMultipleProjectUrls(scope, Prisma.sql`latest_url_rank.snapshot_id`, Prisma.sql`latest_url_rank.observed_at`)}
  )`;
}

export function historicalKeywordHasMultipleUrls(
  scope: Scope,
  sourceDimensions: readonly SemanticRankDimension[],
  observedFrom: string,
  observedBefore: string,
): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM (
      SELECT snapshot.id, snapshot.observed_at
      FROM rank_snapshots snapshot
      JOIN tracking_context_versions configuration
        ON configuration.workspace_id = snapshot.workspace_id
        AND configuration.project_id = snapshot.project_id
        AND configuration.context_id = snapshot.tracking_context_id
        AND configuration.configuration_version = snapshot.configuration_version
      WHERE snapshot.workspace_id = keyword.workspace_id
        AND snapshot.project_id = keyword.project_id
        AND snapshot.keyword_id = keyword.id
        AND snapshot.position_tracking_enabled
        AND snapshot.observed_at >= ${new Date(observedFrom)}
        AND snapshot.observed_at < ${new Date(observedBefore)}
        ${rankDimensionConfigurationPredicate(sourceDimensions)}
        AND NOT EXISTS (
          SELECT 1 FROM rank_dimension_history_deletions url_deletion
          WHERE url_deletion.workspace_id = snapshot.workspace_id
            AND url_deletion.project_id = snapshot.project_id
            AND url_deletion.search_engine = configuration.search_engine::text
            AND url_deletion.country_code = configuration.country_code
            AND url_deletion.region_code = COALESCE(configuration.region_code, configuration.country_code)
            AND url_deletion.language = configuration.language
            AND url_deletion.device = configuration.device::text
            AND snapshot.observed_at <= url_deletion.excluded_through
        )
      ORDER BY snapshot.observed_at DESC, snapshot.id DESC
      LIMIT 1
    ) latest_url_rank
    WHERE ${snapshotHasMultipleProjectUrls(scope, Prisma.sql`latest_url_rank.id`, Prisma.sql`latest_url_rank.observed_at`)}
  )`;
}

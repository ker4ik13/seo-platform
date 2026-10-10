import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { parseSemanticRankDimensionKey, parseProjectPageStatisticsCollection, parseProjectPagePanel, type ProjectPageStatisticsQuery, type ProjectPageStatisticsCollection, type ProjectPagePanelQuery, type ProjectPagePanel, type CrawlLinkEvidence } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { rankDimensionSources, rankDimensionConfigurationPredicate } from "../rank-results/rank-dimension-merge.js";

type Scope = Readonly<{ workspaceId: string; projectId: string }>;
interface StatRow {
  pageId: string; assigned: bigint; measured: bigint; matched: bigint;
  missing: bigint; different: bigint; top: bigint; average: number | null;
}
interface KeywordRow { id: string; query: string; isTracked: boolean; groupPaths: string[]; position: number | null; rankingUrl: string | null; observedAt: Date | null; matches: boolean | null; }

@Injectable()
export class PageInsightsService {
  private readonly statisticsCache = new Map<string, { expires: number; result: Promise<ProjectPageStatisticsCollection> }>();
  constructor(private readonly prisma: PrismaService) {}

  async statistics(scope: Scope, input: ProjectPageStatisticsQuery): Promise<ProjectPageStatisticsCollection> {
    scope = pageScope(scope);
    const key = createHash("sha256").update(JSON.stringify([scope, input.dimensionKey, input.date, [...input.pageIds].sort()])).digest("hex");
    const cached = this.statisticsCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = this.assertPages(scope, input.pageIds).then(async (pages) => this.readStatistics(scope, { ...input, date: await this.resolveDate(scope, input.dimensionKey, input.date) }, pages));
    this.statisticsCache.delete(key);
    if (this.statisticsCache.size >= 32) this.statisticsCache.delete(this.statisticsCache.keys().next().value!);
    const entry = { expires: Date.now() + 5_000, result };
    this.statisticsCache.set(key, entry);
    void result.catch(() => { if (this.statisticsCache.get(key) === entry) this.statisticsCache.delete(key); });
    return result;
  }

  async targetPageId(scope: Scope, keywordId: string): Promise<string | undefined> {
    scope = pageScope(scope);
    const keyword = await this.prisma.keyword.findFirst({ where: { ...scope, id: keywordId, status: "ACTIVE" }, select: { targetPageId: true } });
    if (!keyword) throw new NotFoundException("Keyword not found");
    return keyword.targetPageId ?? undefined;
  }

  async panel(scope: Scope, pageId: string, input: ProjectPagePanelQuery): Promise<ProjectPagePanel> {
    scope = pageScope(scope);
    await this.assertPages(scope, [pageId]);
    const cursor = decodeCursor(input.cursor, scope, pageId, input);
    if (input.section === "SEMANTICS") return this.keywords(scope, pageId, input, cursor);
    if (input.section === "HISTORY") return this.history(scope, pageId, input, cursor);
    return this.links(scope, pageId, input, cursor);
  }

  private async assertPages(scope: Scope, ids: readonly string[]) {
    const pages = await this.prisma.page.findMany({ where: { ...scope, id: { in: [...ids] } }, select: { id: true, title: true, httpStatus: true, indexability: true } });
    if (pages.length !== ids.length) throw new NotFoundException("Page not found");
    return pages;
  }

  async rankCte(scope: Scope, ids: readonly string[] | Prisma.Sql, dimensionKey: string, date: string, keywordLimit?: Prisma.Sql): Promise<Prisma.Sql> {
    const dimension = parseSemanticRankDimensionKey(dimensionKey);
    if (!dimension) throw new BadRequestException("Invalid rank dimension");
    const sources = await rankDimensionSources(this.prisma, scope, dimension);
    const from = new Date(`${date}T00:00:00.000Z`), before = new Date(from.getTime() + 86_400_000);
    return Prisma.sql`
      configurations AS MATERIALIZED (
        SELECT context_id, configuration_version, search_engine, country_code, COALESCE(region_code, country_code) AS region_code, language, device FROM tracking_context_versions configuration
        WHERE configuration.workspace_id = ${scope.workspaceId}::uuid AND configuration.project_id = ${scope.projectId}::uuid
        ${rankDimensionConfigurationPredicate(sources)}
      ), selected_pages AS MATERIALIZED (
        SELECT id, normalized_url FROM pages WHERE workspace_id = ${scope.workspaceId}::uuid AND project_id = ${scope.projectId}::uuid
          AND ${Array.isArray(ids) ? Prisma.sql`id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})` : ids as Prisma.Sql}
      ), page_keys AS MATERIALIZED (
        SELECT DISTINCT page_id, ${urlKey(Prisma.sql`url`)} AS url_key FROM (
          SELECT id AS page_id, normalized_url AS url FROM selected_pages
          UNION ALL SELECT alias.page_id, alias.normalized_url FROM page_aliases alias
          JOIN selected_pages page ON page.id = alias.page_id
          WHERE alias.workspace_id = ${scope.workspaceId}::uuid AND alias.project_id = ${scope.projectId}::uuid
        ) keys
      ), scoped_keywords AS MATERIALIZED (
        SELECT keyword.id, keyword.target_page_id, keyword.text_original, keyword.is_tracked
        FROM keywords keyword JOIN selected_pages page ON page.id = keyword.target_page_id
        WHERE keyword.workspace_id = ${scope.workspaceId}::uuid AND keyword.project_id = ${scope.projectId}::uuid AND keyword.status = 'ACTIVE'
        ${keywordLimit ?? Prisma.sql`AND keyword.is_tracked`}
      ), daily AS MATERIALIZED (
        SELECT DISTINCT ON (snapshot.keyword_id) snapshot.keyword_id, snapshot.id, snapshot.observed_at, snapshot.found, snapshot.position, snapshot.ranking_url, snapshot.normalized_ranking_url
        FROM rank_snapshots snapshot
        JOIN configurations configuration ON configuration.context_id = snapshot.tracking_context_id AND configuration.configuration_version = snapshot.configuration_version
        JOIN scoped_keywords keyword ON keyword.id = snapshot.keyword_id
        WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid
          AND snapshot.position_tracking_enabled AND snapshot.observed_at >= ${from} AND snapshot.observed_at < ${before}
          AND NOT EXISTS (SELECT 1 FROM rank_dimension_history_deletions deletion WHERE deletion.workspace_id = ${scope.workspaceId}::uuid AND deletion.project_id = ${scope.projectId}::uuid
            AND ((deletion.search_engine = ${dimension.searchEngine} AND deletion.country_code = ${dimension.countryCode} AND deletion.region_code = ${dimension.regionCode}
            AND deletion.language = ${dimension.language} AND deletion.device = ${dimension.device}) OR (deletion.search_engine = configuration.search_engine::text AND deletion.country_code = configuration.country_code AND deletion.region_code = configuration.region_code AND deletion.language = configuration.language AND deletion.device = configuration.device::text)) AND snapshot.observed_at <= deletion.excluded_through)
        ORDER BY snapshot.keyword_id, snapshot.observed_at DESC, snapshot.id DESC
      ), measured AS MATERIALIZED (
        SELECT keyword.*, daily.id AS snapshot_id, daily.observed_at, daily.found, daily.position, daily.ranking_url,
          matching_page.page_id IS NOT NULL AS matches
        FROM scoped_keywords keyword LEFT JOIN daily ON daily.keyword_id = keyword.id
        LEFT JOIN page_keys matching_page ON matching_page.page_id = keyword.target_page_id AND matching_page.url_key = ${urlKey(Prisma.sql`COALESCE(daily.normalized_ranking_url, daily.ranking_url, '')`)}
      )`;
  }

  private async readStatistics(scope: Scope, input: ProjectPageStatisticsQuery, pages: Awaited<ReturnType<PageInsightsService["assertPages"]>>): Promise<ProjectPageStatisticsCollection> {
    const cte = await this.rankCte(scope, input.pageIds, input.dimensionKey, input.date);
    const rows = await this.prisma.$queryRaw<StatRow[]>(Prisma.sql`WITH ${cte}
      SELECT page.id AS "pageId", count(measured.id)::bigint AS assigned,
        count(snapshot_id)::bigint AS measured, count(snapshot_id) FILTER (WHERE found AND matches AND position IS NOT NULL)::bigint AS matched,
        count(snapshot_id) FILTER (WHERE NOT found OR position IS NULL)::bigint AS missing,
        count(snapshot_id) FILTER (WHERE found AND position IS NOT NULL AND NOT matches)::bigint AS different,
        count(snapshot_id) FILTER (WHERE found AND matches AND position BETWEEN 1 AND 10)::bigint AS top,
        avg(position) FILTER (WHERE found AND matches)::float8 AS average
      FROM selected_pages page LEFT JOIN measured ON measured.target_page_id = page.id GROUP BY page.id ORDER BY page.id`);
    const metadata = new Map(pages.map((page) => [page.id, page]));
    return parseProjectPageStatisticsCollection({ date: input.date, dimensionKey: input.dimensionKey, pages: rows.map((row) => ({ pageId: row.pageId, assignedCount: Number(row.assigned), measuredCount: Number(row.measured), matchedCount: Number(row.matched), notFoundCount: Number(row.missing), differentPageCount: Number(row.different), top10Count: Number(row.top), ...(row.average === null ? {} : { averagePosition: Number(row.average.toFixed(2)) }), ...(metadata.get(row.pageId)?.title ? { title: metadata.get(row.pageId)!.title } : {}), ...(metadata.get(row.pageId)?.httpStatus ? { httpStatus: metadata.get(row.pageId)!.httpStatus } : {}), indexability: metadata.get(row.pageId)!.indexability })) });
  }

  private async keywords(scope: Scope, pageId: string, input: ProjectPagePanelQuery, cursor: string | undefined): Promise<ProjectPagePanel> {
    const constraint = Prisma.sql`${cursor ? Prisma.sql`AND keyword.id > ${cursor}::uuid` : Prisma.empty} ORDER BY keyword.id LIMIT ${input.limit + 1}`;
    let rows: KeywordRow[];
    if (input.dimensionKey && input.date) {
      const cte = await this.rankCte(scope, [pageId], input.dimensionKey, await this.resolveDate(scope, input.dimensionKey, input.date), constraint);
      rows = await this.prisma.$queryRaw<KeywordRow[]>(Prisma.sql`WITH ${cte} SELECT id, text_original AS query, is_tracked AS "isTracked", position, ranking_url AS "rankingUrl", observed_at AS "observedAt", CASE WHEN snapshot_id IS NULL THEN NULL ELSE matches END AS matches, ARRAY[]::text[] AS "groupPaths" FROM measured ORDER BY id`);
    } else {
      rows = await this.prisma.$queryRaw<KeywordRow[]>(Prisma.sql`SELECT keyword.id, keyword.text_original AS query, keyword.is_tracked AS "isTracked", NULL::int AS position, NULL::text AS "rankingUrl", NULL::timestamptz AS "observedAt", NULL::boolean AS matches, ARRAY[]::text[] AS "groupPaths" FROM keywords keyword WHERE keyword.workspace_id = ${scope.workspaceId}::uuid AND keyword.project_id = ${scope.projectId}::uuid AND keyword.target_page_id = ${pageId}::uuid AND keyword.status = 'ACTIVE' ${constraint}`);
    }
    const visible = rows.slice(0, input.limit);
    const memberships = visible.length ? await this.prisma.$queryRaw<{ keywordId: string; path: string }[]>(Prisma.sql`
      WITH groups AS (SELECT membership.keyword_id AS "keywordId", CASE WHEN groups.system_kind = 'UNGROUPED' THEN 'Без группы' WHEN groups.system_kind = 'TRASH' THEN 'Корзина' ELSE COALESCE(groups.path, groups.name) END AS path,
        row_number() OVER (PARTITION BY membership.keyword_id ORDER BY groups.id) AS ordinal
        FROM keyword_group_memberships membership JOIN keyword_groups groups ON groups.id = membership.group_id AND groups.project_id = membership.project_id
        WHERE membership.project_id = ${scope.projectId}::uuid AND groups.workspace_id = ${scope.workspaceId}::uuid AND groups.status = 'ACTIVE'
          AND membership.keyword_id IN (${Prisma.join(visible.map((row) => Prisma.sql`${row.id}::uuid`))}))
      SELECT "keywordId", path FROM groups WHERE ordinal <= 5`) : [];
    const groups = new Map<string, string[]>();
    for (const row of memberships) { const paths = groups.get(row.keywordId) ?? []; paths.push(row.path.slice(0, 2_000)); groups.set(row.keywordId, paths); }
    return parseProjectPagePanel({ pageId, section: input.section, keywords: visible.map((row) => ({ id: row.id, query: row.query, isTracked: row.isTracked, groupPaths: groups.get(row.id) ?? [], ...(row.position === null ? {} : { position: row.position }), ...(row.rankingUrl === null ? {} : { rankingUrl: row.rankingUrl }), ...(row.observedAt === null ? {} : { observedAt: row.observedAt.toISOString() }), ...(row.matches === null ? {} : { matchesTarget: row.matches }) })), ...(rows.length > input.limit ? { nextCursor: encodeCursor(visible.at(-1)!.id, scope, pageId, input) } : {}) });
  }

  async resolveDate(scope: Scope, dimensionKey: string, value: string): Promise<string> {
    if (value !== "latest") return value;
    const dimension = parseSemanticRankDimensionKey(dimensionKey);
    if (!dimension) throw new BadRequestException("Invalid rank dimension");
    const sources = await rankDimensionSources(this.prisma, scope, dimension);
    const rows = await this.prisma.$queryRaw<{ observedAt: Date }[]>(Prisma.sql`
      SELECT latest.observed_at AS "observedAt" FROM tracking_context_versions configuration
      CROSS JOIN LATERAL (
        SELECT snapshot.observed_at FROM rank_snapshots snapshot
        WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid AND snapshot.tracking_context_id = configuration.context_id AND snapshot.configuration_version = configuration.configuration_version AND snapshot.position_tracking_enabled
          AND EXISTS (SELECT 1 FROM keywords keyword WHERE keyword.workspace_id = ${scope.workspaceId}::uuid AND keyword.project_id = ${scope.projectId}::uuid AND keyword.id = snapshot.keyword_id AND keyword.status = 'ACTIVE' AND keyword.is_tracked)
          AND NOT EXISTS (SELECT 1 FROM rank_dimension_history_deletions deletion WHERE deletion.workspace_id = ${scope.workspaceId}::uuid AND deletion.project_id = ${scope.projectId}::uuid
            AND ((deletion.search_engine = ${dimension.searchEngine} AND deletion.country_code = ${dimension.countryCode} AND deletion.region_code = ${dimension.regionCode} AND deletion.language = ${dimension.language} AND deletion.device = ${dimension.device}) OR (deletion.search_engine = configuration.search_engine::text AND deletion.country_code = configuration.country_code AND deletion.region_code = COALESCE(configuration.region_code, configuration.country_code) AND deletion.language = configuration.language AND deletion.device = configuration.device::text)) AND snapshot.observed_at <= deletion.excluded_through)
        ORDER BY snapshot.observed_at DESC, snapshot.id DESC LIMIT 1
      ) latest WHERE configuration.workspace_id = ${scope.workspaceId}::uuid AND configuration.project_id = ${scope.projectId}::uuid
        ${rankDimensionConfigurationPredicate(sources)} ORDER BY latest.observed_at DESC LIMIT 1`);
    return (rows[0]?.observedAt ?? new Date()).toISOString().slice(0, 10);
  }

  private async history(scope: Scope, pageId: string, input: ProjectPagePanelQuery, cursor: string | undefined): Promise<ProjectPagePanel> {
    const rows = await this.prisma.crawlPageSnapshot.findMany({ where: { ...scope, pageId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: input.limit + 1,
      select: { id: true, crawlId: true, crawledAt: true, statusCode: true, indexability: true, title: true, canonicalUrl: true, robots: true, currentChanges: { select: { changedFields: true }, take: 1 } } });
    const visible = rows.slice(0, input.limit);
    return parseProjectPagePanel({ pageId, section: input.section, history: visible.map((row) => ({ id: row.id, crawlId: row.crawlId, crawledAt: row.crawledAt.toISOString(), statusCode: row.statusCode, indexability: row.indexability, ...(row.title ? { title: row.title } : {}), ...(row.canonicalUrl ? { canonicalUrl: row.canonicalUrl } : {}), ...(row.robots ? { robots: row.robots } : {}), changedFields: row.currentChanges[0]?.changedFields ?? [] })), ...(rows.length > input.limit ? { nextCursor: encodeCursor(visible.at(-1)!.id, scope, pageId, input) } : {}) });
  }

  private async links(scope: Scope, pageId: string, input: ProjectPagePanelQuery, cursor: string | undefined): Promise<ProjectPagePanel> {
    const direction = input.direction ?? "INTERNAL";
    if (direction === "INCOMING") return this.incoming(scope, pageId, input, cursor);
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5_000) throw new BadRequestException("Invalid links cursor");
    const rows = await this.prisma.$queryRaw<(CrawlLinkEvidence & { ordinal: bigint })[]>(Prisma.sql`
      WITH snapshot AS (SELECT link_details, internal_links, external_links FROM crawl_page_snapshots WHERE workspace_id = ${scope.workspaceId}::uuid AND project_id = ${scope.projectId}::uuid AND page_id = ${pageId}::uuid ORDER BY crawled_at DESC, id DESC LIMIT 1), links AS (
        SELECT value, ordinal FROM snapshot, jsonb_array_elements(CASE WHEN jsonb_array_length(link_details) > 0 THEN link_details ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object('url', value, 'anchor', '', 'rel', '[]'::jsonb, 'kind', ${direction}::text)), '[]'::jsonb) FROM jsonb_array_elements_text(CASE WHEN ${direction} = 'INTERNAL' THEN internal_links ELSE external_links END)) END) WITH ORDINALITY AS item(value, ordinal)
      ) SELECT value->>'url' AS url, value->>'anchor' AS anchor, value->'rel' AS rel, value->>'kind' AS kind, ordinal FROM links WHERE ordinal > ${offset} AND value->>'kind' = ${direction} ORDER BY ordinal LIMIT ${input.limit + 1}`);
    const visible = rows.slice(0, input.limit);
    return parseProjectPagePanel({ pageId, section: input.section, links: visible.map(({ ordinal: _ordinal, ...link }) => link), ...(rows.length > input.limit ? { nextCursor: encodeCursor(String(visible.at(-1)!.ordinal), scope, pageId, input) } : {}) });
  }

  private async incoming(scope: Scope, pageId: string, input: ProjectPagePanelQuery, cursor: string | undefined): Promise<ProjectPagePanel> {
    const page = await this.prisma.page.findFirstOrThrow({ where: { ...scope, id: pageId }, select: { normalizedUrl: true } });
    const rows = await this.prisma.$queryRaw<(CrawlLinkEvidence & { id: string })[]>(Prisma.sql`
      SELECT snapshot.id, snapshot.final_url AS url, COALESCE((SELECT value->>'anchor' FROM jsonb_array_elements(snapshot.link_details) value WHERE value->>'url' = ${page.normalizedUrl} LIMIT 1), '') AS anchor, '[]'::jsonb AS rel, 'INTERNAL' AS kind
      FROM crawl_page_snapshots snapshot JOIN pages page ON page.id = snapshot.page_id AND page.workspace_id = snapshot.workspace_id AND page.project_id = snapshot.project_id AND page.status = 'ACTIVE' AND page.included_in_map
      WHERE snapshot.workspace_id = ${scope.workspaceId}::uuid AND snapshot.project_id = ${scope.projectId}::uuid
        AND snapshot.crawl_id = (SELECT crawl_id FROM crawl_page_snapshots target WHERE target.workspace_id = ${scope.workspaceId}::uuid AND target.project_id = ${scope.projectId}::uuid AND target.page_id = ${pageId}::uuid ORDER BY target.crawled_at DESC, target.id DESC LIMIT 1)
        AND snapshot.internal_links @> ${JSON.stringify([page.normalizedUrl])}::jsonb
        ${cursor ? Prisma.sql`AND snapshot.id > ${cursor}::uuid` : Prisma.empty}
      ORDER BY snapshot.id LIMIT ${input.limit + 1}`);
    const visible = rows.slice(0, input.limit);
    return parseProjectPagePanel({ pageId, section: input.section, links: visible.map(({ id: _id, ...link }) => link), ...(rows.length > input.limit ? { nextCursor: encodeCursor(visible.at(-1)!.id, scope, pageId, input) } : {}) });
  }
}

function urlKey(value: Prisma.Sql): Prisma.Sql { return Prisma.sql`regexp_replace(split_part(${value}, '#', 1), '^([^?]+?)/(\\?.*)?$', '\\1\\2')`; }
function pageScope(value: Scope): Scope { return { workspaceId: value.workspaceId, projectId: value.projectId }; }
function cursorScope(scope: Scope, pageId: string, input: ProjectPagePanelQuery) { return createHash("sha256").update(JSON.stringify([scope, pageId, input.section, input.direction ?? "INTERNAL", input.dimensionKey ?? "", input.date ?? ""])).digest("hex"); }
function encodeCursor(value: string, scope: Scope, pageId: string, input: ProjectPagePanelQuery) { return Buffer.from(JSON.stringify({ value, scope: cursorScope(scope, pageId, input) })).toString("base64url"); }
function decodeCursor(value: string | undefined, scope: Scope, pageId: string, input: ProjectPagePanelQuery): string | undefined {
  if (!value) return undefined;
  try { const row: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(); const cursor = row as Record<string, unknown>; if (Object.keys(cursor).length !== 2 || cursor.scope !== cursorScope(scope, pageId, input) || typeof cursor.value !== "string" || !/^(?:[0-9]{1,4}|[0-9a-f-]{36})$/u.test(cursor.value)) throw new Error(); return cursor.value; } catch { throw new BadRequestException("Invalid page cursor"); }
}

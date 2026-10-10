import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import type { ProjectPageListQuery } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { PageInsightsService } from "./page-insights.service.js";

type Scope = Readonly<{ workspaceId: string; projectId: string }>;
interface SortRow { id: string; value: string | number | null; root: boolean; }
interface SortCursor extends SortRow { version: 2; hash: string; date?: string; }
export async function sortedPageIds(prisma: PrismaService, insights: PageInsightsService, scope: Scope, query: ProjectPageListQuery) {
  const hash = createHash("sha256").update(JSON.stringify([scope, query.search ?? "", query.pathPrefix ?? "", query.pageType ?? "", query.indexability ?? "", query.lifecycleStatus ?? "ACTIVE", query.sort, query.sortDirection ?? "ASC", query.dimensionKey ?? "", query.date ?? "latest"])).digest("hex");
  let cursor: SortCursor | undefined;
  if (query.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as SortCursor;
      const numeric = ["HTTP", "KEYWORDS", "AVERAGE_POSITION", "RESPONSE_TIME", "SIZE", "ISSUES", "UPDATED_AT"].includes(query.sort!);
      if (cursor.value !== null && typeof cursor.value !== (numeric ? "number" : "string")) throw new Error();
      if (cursor.version !== 2 || cursor.hash !== hash || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(cursor.id) || typeof cursor.root !== "boolean" || !(cursor.value === null || typeof cursor.value === "string" || typeof cursor.value === "number" && Number.isFinite(cursor.value)) || cursor.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(cursor.date)) throw new Error();
    } catch { throw new BadRequestException({ code: "INVALID_CURSOR", message: "Invalid page cursor" }); }
  }
  const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const prefix = query.pathPrefix?.replace(/\/$/u, "");
  const root = prefix ? Prisma.sql`page.normalized_url ~ ${`^https?://[^/?#]+${escapePattern(prefix)}/?$`}` : Prisma.sql`FALSE`;
  const search = query.search ? `%${query.search.replace(/[\\%_]/gu, "\\$&")}%` : undefined;
  const where = Prisma.sql`page.workspace_id=${scope.workspaceId}::uuid AND page.project_id=${scope.projectId}::uuid AND page.included_in_map AND page.status::text=${query.lifecycleStatus ?? "ACTIVE"}
    ${prefix ? Prisma.sql`AND page.normalized_url ~ ${`^https?://[^/?#]+${escapePattern(prefix)}(?:/|[?#]|$)`}` : Prisma.empty}
    ${query.pageType ? Prisma.sql`AND page.page_type::text=${query.pageType}` : Prisma.empty}
    ${query.indexability ? Prisma.sql`AND page.indexability::text=${query.indexability}` : Prisma.empty}
    ${search ? Prisma.sql`AND (page.normalized_url ILIKE ${search} OR page.title ILIKE ${search} OR page.h1 ILIKE ${search})` : Prisma.empty}`;
  let date: string | undefined, rank = Prisma.empty;
  if (query.sort === "AVERAGE_POSITION") {
    date = cursor?.date ?? await insights.resolveDate(scope, query.dimensionKey!, query.date ?? "latest");
    const cte = await insights.rankCte(scope, Prisma.sql`id IN (SELECT page.id FROM pages page WHERE ${where})`, query.dimensionKey!, date);
    rank = Prisma.sql`${cte}, ranked AS (SELECT target_page_id, ROUND((avg(position) FILTER(WHERE found AND matches))::numeric,2)::float8 AS average FROM measured GROUP BY target_page_id),`;
  }
  const latest = ["HTTP", "TITLE", "H1", "RESPONSE_TIME", "SIZE"].includes(query.sort!);
  const value = {
    URL: Prisma.sql`LOWER(page.normalized_url) COLLATE "C"`,
    HTTP: Prisma.sql`COALESCE(NULLIF(snapshot.status_code,0),page.http_status)::float8`,
    INDEXABILITY: Prisma.sql`page.indexability::text COLLATE "C"`,
    KEYWORDS: Prisma.sql`(SELECT count(*)::float8 FROM keywords keyword WHERE keyword.workspace_id=${scope.workspaceId}::uuid AND keyword.project_id=${scope.projectId}::uuid AND keyword.target_page_id=page.id AND keyword.status='ACTIVE')`,
    AVERAGE_POSITION: Prisma.sql`ranked.average`,
    TITLE: Prisma.sql`LOWER(NULLIF(COALESCE(snapshot.title,page.title),'')) COLLATE "C"`,
    H1: Prisma.sql`LOWER(NULLIF(COALESCE(snapshot.h1,page.h1),'')) COLLATE "C"`,
    RESPONSE_TIME: Prisma.sql`CASE WHEN snapshot.status_code>0 THEN snapshot.response_time_ms::float8 END`,
    SIZE: Prisma.sql`CASE WHEN snapshot.status_code>0 THEN snapshot.size_bytes::float8 END`,
    ISSUES: Prisma.sql`(SELECT count(*)::float8 FROM crawl_issues issue WHERE issue.workspace_id=${scope.workspaceId}::uuid AND issue.project_id=${scope.projectId}::uuid AND issue.page_id=page.id AND issue.resolved_at IS NULL)`,
    UPDATED_AT: Prisma.sql`EXTRACT(EPOCH FROM page.updated_at)::float8`
  }[query.sort!];
  const direction = query.sortDirection === "DESC" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const comparison = query.sortDirection === "DESC" ? Prisma.sql`<` : Prisma.sql`>`;
  const seek = cursor ? cursor.value === null ? Prisma.sql`value IS NULL AND id>${cursor.id}::uuid` : Prisma.sql`value IS NULL OR value ${comparison} ${cursor.value} OR (value=${cursor.value} AND id>${cursor.id}::uuid)` : Prisma.empty;
  const rows = await prisma.$queryRaw<SortRow[]>(Prisma.sql`WITH ${rank} page_metrics AS (
    SELECT page.id, (${root}) AS root, ${value} AS value FROM pages page
    ${latest ? Prisma.sql`LEFT JOIN LATERAL(SELECT status_code,title,h1,response_time_ms,size_bytes FROM crawl_page_snapshots snapshot WHERE snapshot.workspace_id=${scope.workspaceId}::uuid AND snapshot.project_id=${scope.projectId}::uuid AND snapshot.page_id=page.id ORDER BY crawled_at DESC,id DESC LIMIT 1) snapshot ON TRUE` : Prisma.empty}
    ${query.sort === "AVERAGE_POSITION" ? Prisma.sql`LEFT JOIN ranked ON ranked.target_page_id=page.id` : Prisma.empty}
    WHERE ${where}) SELECT id,root,value FROM page_metrics
    ${cursor ? Prisma.sql`WHERE root<${cursor.root} OR (root=${cursor.root} AND (${seek}))` : Prisma.empty}
    ORDER BY root DESC,value ${direction} NULLS LAST,id ASC LIMIT ${query.limit + 1}`);
  return { ids: rows.map(row => row.id), date, nextCursor: rows.length > query.limit ? Buffer.from(JSON.stringify({ ...rows[query.limit - 1]!, version: 2, hash, ...(date ? { date } : {}) })).toString("base64url") : undefined };
}

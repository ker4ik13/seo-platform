import { parseSemanticRankDimensionKey } from "./rank-dimensions.js";
import type { CrawlLinkEvidence } from "./crawls.js";
import { pageIndexabilities, type PageIndexability } from "./pages.js";

export interface ProjectPageStatisticsQuery {
  readonly pageIds: readonly string[];
  readonly dimensionKey: string;
  readonly date: string;
}
export interface ProjectPageStatistics {
  readonly pageId: string;
  readonly assignedCount: number;
  readonly measuredCount: number;
  readonly matchedCount: number;
  readonly notFoundCount: number;
  readonly differentPageCount: number;
  readonly top10Count: number;
  readonly averagePosition?: number;
  readonly title?: string;
  readonly httpStatus?: number;
  readonly indexability?: PageIndexability;
}
export interface ProjectPageStatisticsCollection {
  readonly date: string;
  readonly dimensionKey: string;
  readonly pages: readonly ProjectPageStatistics[];
}
export interface ProjectPagePanelQuery {
  readonly section: "SEMANTICS" | "LINKS" | "HISTORY";
  readonly limit: number;
  readonly cursor?: string;
  readonly direction?: "INTERNAL" | "EXTERNAL" | "INCOMING";
  readonly dimensionKey?: string;
  readonly date?: string;
}
export interface ProjectPageKeyword {
  readonly id: string;
  readonly query: string;
  readonly isTracked: boolean;
  readonly groupPaths: readonly string[];
  readonly position?: number;
  readonly rankingUrl?: string;
  readonly observedAt?: string;
  readonly matchesTarget?: boolean;
}
export interface ProjectPageHistoryPoint {
  readonly id: string;
  readonly crawlId: string;
  readonly crawledAt: string;
  readonly statusCode: number;
  readonly indexability: PageIndexability;
  readonly title?: string;
  readonly canonicalUrl?: string;
  readonly robots?: string;
  readonly changedFields: readonly string[];
}
export interface ProjectPagePanel {
  readonly pageId: string;
  readonly section: ProjectPagePanelQuery["section"];
  readonly keywords?: readonly ProjectPageKeyword[];
  readonly links?: readonly CrawlLinkEvidence[];
  readonly history?: readonly ProjectPageHistoryPoint[];
  readonly nextCursor?: string;
}

export function parseProjectPageStatisticsQuery(value: unknown): ProjectPageStatisticsQuery {
  const row = record(value, ["pageIds", "dimensionKey", "date"]);
  const pageIds = typeof row.pageIds === "string" ? row.pageIds.split(",") : row.pageIds;
  if (!Array.isArray(pageIds) || !pageIds.length || pageIds.length > 100) invalid();
  const ids = pageIds.map(uuid);
  if (new Set(ids).size !== ids.length) invalid();
  return { pageIds: ids, dimensionKey: dimension(row.dimensionKey), date: day(row.date, true) };
}
export function parseProjectPagePanelQuery(value: unknown): ProjectPagePanelQuery {
  const row = record(value, ["section", "limit", "cursor", "direction", "dimensionKey", "date"]);
  if (!["SEMANTICS", "LINKS", "HISTORY"].includes(String(row.section))) invalid();
  const limit = row.limit === undefined ? 50 : typeof row.limit === "string" ? Number(row.limit) : row.limit;
  count(limit, 100);
  if (limit === 0) invalid();
  if (row.direction !== undefined && (row.section !== "LINKS" || !["INTERNAL", "EXTERNAL", "INCOMING"].includes(String(row.direction)))) invalid();
  if ((row.dimensionKey === undefined) !== (row.date === undefined) || row.section !== "SEMANTICS" && row.dimensionKey !== undefined) invalid();
  return { section: row.section as ProjectPagePanelQuery["section"], limit: limit as number,
    ...(row.cursor === undefined ? {} : { cursor: text(row.cursor, 1_200) }),
    ...(row.direction === undefined ? {} : { direction: row.direction as NonNullable<ProjectPagePanelQuery["direction"]> }),
    ...(row.dimensionKey === undefined ? {} : { dimensionKey: dimension(row.dimensionKey), date: day(row.date, true) }) };
}
export function parseProjectPageStatisticsCollection(value: unknown): ProjectPageStatisticsCollection {
  const row = record(value, ["pages", "dimensionKey", "date"]);
  const pages = array(row.pages, 100).map((value): ProjectPageStatistics => {
    const p = record(value, ["pageId", "assignedCount", "measuredCount", "matchedCount", "notFoundCount", "differentPageCount", "top10Count", "averagePosition", "title", "httpStatus", "indexability"]);
    if (p.indexability !== undefined && !pageIndexabilities.includes(p.indexability as PageIndexability) || p.httpStatus !== undefined && (count(p.httpStatus, 599) < 100)) invalid();
    const assigned = count(p.assignedCount), measured = count(p.measuredCount), matched = count(p.matchedCount), missing = count(p.notFoundCount), different = count(p.differentPageCount), top = count(p.top10Count);
    if (measured > assigned || matched + missing + different !== measured || top > matched || (matched === 0) !== (p.averagePosition === undefined)) invalid();
    return { pageId: uuid(p.pageId), assignedCount: assigned, measuredCount: measured, matchedCount: matched, notFoundCount: missing, differentPageCount: different, top10Count: top,
      ...(p.averagePosition === undefined ? {} : { averagePosition: position(p.averagePosition) }), ...(p.title === undefined ? {} : { title: text(p.title, 1_000) }), ...(p.httpStatus === undefined ? {} : { httpStatus: p.httpStatus as number }), ...(p.indexability === undefined ? {} : { indexability: p.indexability as PageIndexability }) };
  });
  if (new Set(pages.map((page) => page.pageId)).size !== pages.length) invalid();
  return { pages, dimensionKey: dimension(row.dimensionKey), date: day(row.date) };
}
export function parseProjectPagePanel(value: unknown): ProjectPagePanel {
  const row = record(value, ["pageId", "section", "keywords", "links", "history", "nextCursor"]);
  if (!["SEMANTICS", "LINKS", "HISTORY"].includes(String(row.section))) invalid();
  const field = row.section === "SEMANTICS" ? "keywords" : row.section === "LINKS" ? "links" : "history";
  if (["keywords", "links", "history"].some((key) => key !== field && row[key] !== undefined)) invalid();
  const items = array(row[field], 100);
  const keywords = field === "keywords" ? items.map((value): ProjectPageKeyword => {
    const p = record(value, ["id", "query", "isTracked", "groupPaths", "position", "rankingUrl", "observedAt", "matchesTarget"]);
    if (typeof p.isTracked !== "boolean" || p.matchesTarget !== undefined && typeof p.matchesTarget !== "boolean") invalid();
    return { id: uuid(p.id), query: text(p.query, 2_000), isTracked: p.isTracked, groupPaths: array(p.groupPaths, 5).map((v) => text(v, 2_000)),
      ...(p.position === undefined ? {} : { position: position(p.position) }), ...(p.rankingUrl === undefined ? {} : { rankingUrl: text(p.rankingUrl, 20_000) }),
      ...(p.observedAt === undefined ? {} : { observedAt: timestamp(p.observedAt) }), ...(p.matchesTarget === undefined ? {} : { matchesTarget: p.matchesTarget }) };
  }) : undefined;
  const links = field === "links" ? items.map((value): CrawlLinkEvidence => {
    const p = record(value, ["url", "anchor", "rel", "kind"]);
    if (p.kind !== "INTERNAL" && p.kind !== "EXTERNAL") invalid();
    return { url: text(p.url, 4_096), anchor: text(p.anchor, 500), rel: array(p.rel, 20).map((v) => text(v, 64)), kind: p.kind as "INTERNAL" | "EXTERNAL" };
  }) : undefined;
  const history = field === "history" ? items.map((value): ProjectPageHistoryPoint => {
    const p = record(value, ["id", "crawlId", "crawledAt", "statusCode", "indexability", "title", "canonicalUrl", "robots", "changedFields"]);
    if (!pageIndexabilities.includes(p.indexability as PageIndexability) || p.statusCode === 0 && p.indexability !== "BLOCKED_ROBOTS") invalid();
    count(p.statusCode, 599);
    return { id: uuid(p.id), crawlId: uuid(p.crawlId), crawledAt: timestamp(p.crawledAt), statusCode: p.statusCode as number, indexability: p.indexability as PageIndexability,
      changedFields: array(p.changedFields, 30).map((v) => text(v, 64)), ...(p.title === undefined ? {} : { title: text(p.title, 4_000) }),
      ...(p.canonicalUrl === undefined ? {} : { canonicalUrl: text(p.canonicalUrl, 4_096) }), ...(p.robots === undefined ? {} : { robots: text(p.robots, 255) }) };
  }) : undefined;
  return { pageId: uuid(row.pageId), section: row.section as ProjectPagePanelQuery["section"], ...(keywords ? { keywords } : {}), ...(links ? { links } : {}), ...(history ? { history } : {}), ...(row.nextCursor === undefined ? {} : { nextCursor: text(row.nextCursor, 1_200) }) };
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid(); return value as Record<string, unknown>; }
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value; }
function text(value: unknown, max: number): string { if (typeof value !== "string" || value.length > max) invalid(); return value; }
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) invalid(); return value; }
function uuid(value: unknown): string { const s = text(value, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(s)) invalid(); return s.toLowerCase(); }
function position(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 1_000_000) invalid(); return value; }
function dimension(value: unknown): string { const s = text(value, 300); if (!parseSemanticRankDimensionKey(s)) invalid(); return s; }
function day(value: unknown, latest = false): string { const s = text(value, 10); if (latest && s === "latest") return s; if (!/^\d{4}-\d{2}-\d{2}$/u.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) invalid(); return s; }
function timestamp(value: unknown): string { const s = text(value, 40); if (!Number.isFinite(Date.parse(s))) invalid(); return s; }
function invalid(): never { throw new TypeError("Invalid page insights"); }

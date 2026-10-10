import type { PageStatusInput, PageStatusBatchResult } from "@seo-platform/contracts";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  pageContentStatuses,
  parseCrawlTechnicalDetails,
  type InternalChangeProjectPageStatusInput,
  type InternalCreateProjectPageInput,
  type InternalUpdateProjectPageInput,
  type PageContentStatus,
  type ProjectPageCollection,
  type ProjectPageListQuery,
  type ProjectPageSummary
} from "@seo-platform/contracts";
import { PageInsightsService } from "./page-insights.service.js";
import { sortedPageIds } from "./page-list-sort.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { normalizePageUrl, type NormalizedPageUrl } from "./page-url.js";

const CONTENT_STATUSES = new Set<string>(pageContentStatuses);
const CRAWL_SUMMARY_SELECT = {
  crawlId: true,
  requestedUrl: true,
  finalUrl: true,
  statusCode: true,
  responseTimeMs: true,
  sizeBytes: true,
  contentType: true,
  title: true,
  description: true,
  h1: true,
  h1Count: true,
  canonicalUrl: true,
  robots: true,
  language: true,
  imageCount: true,
  imagesMissingAlt: true,
  structuredDataTypes: true,
  wordCount: true,
  redirectChain: true,
  inSitemap: true,
  depth: true,
  indexability: true,
  crawledAt: true
} as const satisfies Prisma.CrawlPageSnapshotSelect;

const PAGE_LIST_INCLUDE = {
  aliases: {
    orderBy: [{ firstSeenAt: "asc" as const }, { id: "asc" as const }]
  },
  sources: {
    orderBy: { source: "asc" as const }
  },
  crawlSnapshots: {
    orderBy: [
      { crawledAt: "desc" as const },
      { id: "desc" as const }
    ],
    take: 1,
    select: CRAWL_SUMMARY_SELECT
  },
  _count: {
    select: {
      targetKeywords: { where: { status: "ACTIVE" as const } },
      primaryClusters: { where: { status: "ACTIVE" as const } },
      crawlIssues: { where: { resolvedAt: null } }
    }
  }
} satisfies Prisma.PageInclude;

const PAGE_INCLUDE = {
  ...PAGE_LIST_INCLUDE,
  crawlSnapshots: {
    ...PAGE_LIST_INCLUDE.crawlSnapshots,
    select: { ...CRAWL_SUMMARY_SELECT, metaTags: true, headings: true, hreflang: true, technicalDetails: true }
  }
} satisfies Prisma.PageInclude;

type PageAggregate = Prisma.PageGetPayload<{
  include: typeof PAGE_INCLUDE;
}>;
type PageListAggregate = Prisma.PageGetPayload<{
  include: typeof PAGE_LIST_INCLUDE;
}>;

interface PageCursor {
  readonly version: 1;
  readonly filterHash: string;
  readonly updatedAt: string;
  readonly id: string;
  readonly sectionRoot?: boolean;
}

@Injectable()
export class PageService {
  public constructor(private readonly prisma: PrismaService, private readonly insights: PageInsightsService) {}

  public async list(
    workspaceId: string,
    projectId: string,
    query: ProjectPageListQuery
  ): Promise<ProjectPageCollection> {
    const filterHash = pageFilterHash(query);
    const cursor = query.cursor && !query.sort
      ? decodeCursor(query.cursor, filterHash)
      : undefined;
    const sorted = query.sort ? await sortedPageIds(this.prisma, this.insights, { workspaceId, projectId }, query) : undefined;
    const prefixIds = sorted?.ids ?? (query.pathPrefix ? await this.prefixPageIds(workspaceId, projectId, query, cursor) : undefined);
    const [rows, structure] = await Promise.all([
      this.prisma.page.findMany({
        where: {
          workspaceId,
          projectId,
          includedInMap: true,
          ...(prefixIds ? { id: { in: prefixIds } } : {}),
          status: query.lifecycleStatus ?? "ACTIVE",
          ...(query.pageType ? { pageType: query.pageType } : {}),
          ...(query.indexability
            ? { indexability: query.indexability }
            : {}),
          AND: [
            ...(query.search
              ? [{
                  OR: [
                    {
                      normalizedUrl: {
                        contains: query.search,
                        mode: "insensitive" as const
                      }
                    },
                    {
                      title: {
                        contains: query.search,
                        mode: "insensitive" as const
                      }
                    },
                    {
                      h1: {
                        contains: query.search,
                        mode: "insensitive" as const
                      }
                    }
                  ]
                }]
              : []),
            ...(cursor && !query.pathPrefix
              ? [{
                  OR: [
                    { updatedAt: { lt: new Date(cursor.updatedAt) } },
                    {
                      updatedAt: new Date(cursor.updatedAt),
                      id: { lt: cursor.id }
                    }
                  ]
                }]
              : [])
          ]
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        include: scopedPageRows(workspaceId, projectId)
      }),
      query.cursor || query.includeStructure === false
        ? Promise.resolve(undefined)
        : this.prisma.page.findMany({
            where: {
              workspaceId,
              projectId,
              includedInMap: true,
              status: query.lifecycleStatus ?? "ACTIVE"
            },
            select: { normalizedUrl: true, id: true },
            orderBy: [{ normalizedUrl: "asc" }, { id: "asc" }],
            take: 5_001
          })
    ]);
    if (prefixIds) {
      const order = new Map(prefixIds.map((id, index) => [id, index]));
      rows.sort((left, right) => order.get(left.id)! - order.get(right.id)!);
    }
    const counts = await pageCounts(this.prisma, workspaceId, projectId, rows.slice(0, query.limit).map(row => row.id));
    const hasNext = rows.length > query.limit;
    const visible = rows.slice(0, query.limit);
    const last = visible.at(-1);
    return {
      pages: visible.map(row => pageSummary({ ...row, _count: counts.get(row.id) ?? { targetKeywords: 0, primaryClusters: 0, crawlIssues: 0 } })),
      ...(sorted?.date ? { rankDate: sorted.date } : {}),
      ...(structure
        ? { structureUrls: structure.slice(0, 5_000).map(({ normalizedUrl }) => normalizedUrl), structurePageIds: structure.slice(0, 5_000).map(({ id }) => id), structureTruncated: structure.length > 5_000 }
        : {}),
      ...(hasNext && last
        ? {
            nextCursor: sorted?.nextCursor ?? encodeCursor({
              version: 1,
              filterHash,
              updatedAt: last.updatedAt.toISOString(),
              id: last.id,
              ...(query.pathPrefix ? { sectionRoot: isSectionRootPage(last.normalizedUrl, query.pathPrefix) } : {})
            })
          }
        : {})
    };
  }

  public async get(
    workspaceId: string,
    projectId: string,
    pageId: string
  ): Promise<ProjectPageSummary> {
    return pageSummary(
      await this.requiredPage(this.prisma, workspaceId, projectId, pageId)
    );
  }

  private async prefixPageIds(workspaceId: string, projectId: string, query: ProjectPageListQuery, cursor: PageCursor | undefined): Promise<string[]> {
    const prefix = query.pathPrefix!.replace(/\/$/u, "");
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = `^https?://[^/?#]+${escaped}(?:/|[?#]|$)`;
    const rootPattern = `^https?://[^/?#]+${escaped}/?$`;
    const search = query.search ? `%${query.search.replace(/[\\%_]/gu, "\\$&")}%` : undefined;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM pages WHERE workspace_id = ${workspaceId}::uuid AND project_id = ${projectId}::uuid AND included_in_map AND status::text = ${query.lifecycleStatus ?? "ACTIVE"}
        AND normalized_url ~ ${pattern}
        ${query.pageType ? Prisma.sql`AND page_type::text = ${query.pageType}` : Prisma.empty}
        ${query.indexability ? Prisma.sql`AND indexability::text = ${query.indexability}` : Prisma.empty}
        ${search ? Prisma.sql`AND (normalized_url ILIKE ${search} OR title ILIKE ${search} OR h1 ILIKE ${search})` : Prisma.empty}
        ${cursor ? Prisma.sql`AND ((normalized_url ~ ${rootPattern}) < ${cursor.sectionRoot ?? false}
          OR ((normalized_url ~ ${rootPattern}) = ${cursor.sectionRoot ?? false} AND (updated_at, id) < (${new Date(cursor.updatedAt)}, ${cursor.id}::uuid)))` : Prisma.empty}
      ORDER BY (normalized_url ~ ${rootPattern}) DESC, updated_at DESC, id DESC LIMIT ${query.limit + 1}`);
    return rows.map((row) => row.id);
  }

  public async create(
    input: InternalCreateProjectPageInput
  ): Promise<ProjectPageSummary> {
    const identity = pageIdentity(input.url, input.aliases);
    const requestHash = pageRequestHash(input, identity);
    const existing = await this.findReceipt(input);
    if (existing) return replayReceipt(existing, requestHash);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`${input.projectId}:${identity.canonical.hash}`},
              0
            )
          )
        `;
        const concurrent =
          await transaction.pageCreateReceipt.findUnique({
            where: receiptWhere(input)
          });
        if (concurrent) return replayReceipt(concurrent, requestHash);
        const hidden = await transaction.page.findUnique({
          where: {
            projectId_urlHash: {
              projectId: input.projectId,
              urlHash: identity.canonical.hash
            }
          },
          select: { id: true, includedInMap: true, status: true }
        });
        const manualData = {
          pageType: input.pageType,
          indexability: input.indexability,
          ...(input.httpStatus === undefined
            ? {}
            : { httpStatus: input.httpStatus }),
          ...(input.canonicalTarget
            ? { canonicalTarget: input.canonicalTarget }
            : {}),
          ...(input.robots ? { robots: input.robots } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.h1 ? { h1: input.h1 } : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(input.template ? { template: input.template } : {}),
          ...(input.contentStatus
            ? { contentStatus: input.contentStatus }
            : {}),
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          priority: input.priority,
          ...(input.publishedAt
            ? { publishedAt: new Date(input.publishedAt) }
            : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          createdBy: input.actorId,
          updatedBy: input.actorId,
          aliases: {
            create: identity.aliases.map((alias) => ({
              url: alias.original,
              normalizedUrl: alias.normalized,
              urlHash: alias.hash,
              source: "MANUAL" as const
            }))
          }
        };
        let pageId: string;
        if (hidden && !hidden.includedInMap && hidden.status === "ACTIVE") {
          await transaction.page.update({
            where: { id: hidden.id },
            data: {
              ...manualData,
              includedInMap: true,
              version: { increment: 1 }
            }
          });
          await transaction.pageSource.upsert({
            where: {
              pageId_source: { pageId: hidden.id, source: "MANUAL" }
            },
            create: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              pageId: hidden.id,
              source: "MANUAL"
            },
            update: { lastSeenAt: new Date() }
          });
          pageId = hidden.id;
        } else {
          const created = await transaction.page.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              url: identity.canonical.original,
              normalizedUrl: identity.canonical.normalized,
              urlHash: identity.canonical.hash,
              ...manualData,
              sources: {
                create: {
                  source: "MANUAL"
                }
              }
            },
            select: { id: true }
          });
          pageId = created.id;
        }
        const summary = pageSummary(
          await this.requiredPage(
            transaction,
            input.workspaceId,
            input.projectId,
            pageId
          )
        );
        await transaction.pageCreateReceipt.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            pageId,
            responseSnapshot: json(summary)
          }
        });
        return summary;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.findReceipt(input);
      if (winner) return replayReceipt(winner, requestHash);
      conflict("Page URL or alias already belongs to another page");
    }
  }

  public async update(
    pageId: string,
    input: InternalUpdateProjectPageInput
  ): Promise<ProjectPageSummary> {
    const identity = pageIdentity(input.url, input.aliases);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockPage(transaction, input.workspaceId, input.projectId, pageId);
        const current = await this.requiredPage(
          transaction,
          input.workspaceId,
          input.projectId,
          pageId
        );
        assertVersion(current.version, input.version);
        if (current.status !== "ACTIVE") {
          conflict("Only active pages can be edited");
        }
        const aliases = identity.canonical.hash === current.urlHash
          ? identity.aliases
          : deduplicateUrls([
              ...identity.aliases,
              normalizePageUrl(current.url, "url")
            ], identity.canonical.hash);

        await transaction.pageAlias.deleteMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            pageId
          }
        });
        await transaction.page.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: pageId
            }
          },
          data: {
            url: identity.canonical.original,
            normalizedUrl: identity.canonical.normalized,
            urlHash: identity.canonical.hash,
            pageType: input.pageType,
            indexability: input.indexability,
            httpStatus: input.httpStatus ?? null,
            canonicalTarget: input.canonicalTarget ?? null,
            robots: input.robots ?? null,
            title: input.title ?? null,
            description: input.description ?? null,
            h1: input.h1 ?? null,
            language: input.language ?? null,
            template: input.template ?? null,
            contentStatus: input.contentStatus ?? null,
            ownerId: input.ownerId ?? null,
            priority: input.priority,
            publishedAt: input.publishedAt
              ? new Date(input.publishedAt)
              : null,
            notes: input.notes ?? null,
            updatedBy: input.actorId,
            version: { increment: 1 },
            aliases: {
              create: aliases.map((alias) => ({
                url: alias.original,
                normalizedUrl: alias.normalized,
                urlHash: alias.hash,
                source: "MANUAL"
              }))
            },
            sources: {
              upsert: {
                where: {
                  pageId_source: { pageId, source: "MANUAL" }
                },
                create: {
                  source: "MANUAL"
                },
                update: { lastSeenAt: new Date() }
              }
            }
          }
        });
        return pageSummary(
          await this.requiredPage(
            transaction,
            input.workspaceId,
            input.projectId,
            pageId
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        conflict("Page URL or alias already belongs to another page");
      }
      throw error;
    }
  }

  public async prepareStatus(scope: { workspaceId: string; projectId: string; input: PageStatusInput }): Promise<readonly string[]> {
    const { input } = scope;
    if (input.pageIds) {
      const pages = await this.prisma.page.findMany({ where: { workspaceId: scope.workspaceId, projectId: scope.projectId, id: { in: [...input.pageIds] }, includedInMap: true, status: { not: "DELETED" } }, select: { id: true, status: true } });
      if (pages.length !== input.pageIds.length) throw new NotFoundException("Page selection not found");
      return pages.filter(page => page.status === (input.operation === "archive" ? "ACTIVE" : "ARCHIVED")).map(page => page.id).sort();
    }
    const prefix = input.pathPrefix === "/" ? "" : input.pathPrefix!.replace(/\/$/u, "");
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), pattern = prefix ? `^https?://[^/?#]+${escaped}(?:/|[?#]|$)` : "^https?://";
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM pages WHERE workspace_id=${scope.workspaceId}::uuid AND project_id=${scope.projectId}::uuid AND included_in_map AND status::text=${input.operation === "archive" ? "ACTIVE" : "ARCHIVED"} AND normalized_url ~ ${pattern} ORDER BY id LIMIT 50001`;
    if (rows.length > 50000) throw new BadRequestException("Page action limit exceeded");
    return rows.map(page => page.id);
  }

  public async applyStatus(scope: { workspaceId: string; projectId: string; actorId: string; input: PageStatusInput }): Promise<PageStatusBatchResult> {
    const ids = scope.input.pageIds;
    if (!ids?.length || ids.length > 200) throw new BadRequestException("Invalid page action batch");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM pages WHERE workspace_id=${scope.workspaceId}::uuid AND project_id=${scope.projectId}::uuid AND id=ANY(${[...ids]}::uuid[]) ORDER BY id FOR UPDATE`;
      const pages = await tx.page.findMany({ where: { workspaceId: scope.workspaceId, projectId: scope.projectId, id: { in: [...ids] }, includedInMap: true, status: { not: "DELETED" } }, select: { id: true, status: true, _count: { select: { primaryClusters: true } } } });
      if (pages.length !== ids.length) throw new NotFoundException("Page selection not found");
      const status = scope.input.operation === "archive" ? "ARCHIVED" : "ACTIVE";
      const allowed = pages.filter(page => status === "ACTIVE" || page.status === "ARCHIVED" || page._count.primaryClusters === 0);
      await tx.page.updateMany({ where: { workspaceId: scope.workspaceId, projectId: scope.projectId, id: { in: allowed.map(page => page.id) }, status: { not: status } }, data: { status, updatedBy: scope.actorId, version: { increment: 1 }, ...(status === "ARCHIVED" ? { archivedBy: scope.actorId, archivedAt: new Date() } : { archivedBy: null, archivedAt: null }) } });
      return { changed: allowed.length, blocked: pages.length - allowed.length };
    });
  }

  public archive(
    pageId: string,
    input: InternalChangeProjectPageStatusInput
  ): Promise<ProjectPageSummary> {
    return this.changeStatus(pageId, input, "ARCHIVED");
  }

  public restore(
    pageId: string,
    input: InternalChangeProjectPageStatusInput
  ): Promise<ProjectPageSummary> {
    return this.changeStatus(pageId, input, "ACTIVE");
  }

  private async changeStatus(
    pageId: string,
    input: InternalChangeProjectPageStatusInput,
    status: "ACTIVE" | "ARCHIVED"
  ): Promise<ProjectPageSummary> {
    return this.prisma.$transaction(async (transaction) => {
      await lockPage(transaction, input.workspaceId, input.projectId, pageId);
      const current = await this.requiredPage(
        transaction,
        input.workspaceId,
        input.projectId,
        pageId
      );
      assertVersion(current.version, input.version);
      if (current.status === status) {
        conflict(
          status === "ACTIVE"
            ? "Page is already active"
            : "Page is already archived"
        );
      }
      if (status === "ARCHIVED" && current._count.primaryClusters > 0) {
        conflict(
          "Move primary clusters to another page before archiving this page"
        );
      }
      const now = new Date();
      await transaction.page.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: pageId
          }
        },
        data: {
          status,
          updatedBy: input.actorId,
          version: { increment: 1 },
          ...(status === "ARCHIVED"
            ? { archivedBy: input.actorId, archivedAt: now }
            : { archivedBy: null, archivedAt: null })
        }
      });
      return pageSummary(
        await this.requiredPage(
          transaction,
          input.workspaceId,
          input.projectId,
          pageId
        )
      );
    });
  }

  private async requiredPage(
    client: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    pageId: string
  ): Promise<PageAggregate> {
    const page = await client.page.findFirst({
      where: {
        workspaceId,
        projectId,
        id: pageId,
        includedInMap: true,
        status: { not: "DELETED" }
      },
      include: scopedPageInclude(PAGE_INCLUDE, workspaceId, projectId)
    });
    if (!page) {
      throw new NotFoundException({
        code: "PAGE_NOT_FOUND",
        message: "Page not found"
      });
    }
    return page;
  }

  private findReceipt(input: InternalCreateProjectPageInput) {
    return this.prisma.pageCreateReceipt.findUnique({
      where: receiptWhere(input)
    });
  }
}

function pageSummary(
  page: PageAggregate | PageListAggregate
): ProjectPageSummary {
  const contentStatus =
    page.contentStatus && CONTENT_STATUSES.has(page.contentStatus)
      ? (page.contentStatus as PageContentStatus)
      : undefined;
  const latestCrawl = page.crawlSnapshots[0];
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    projectId: page.projectId,
    url: page.url,
    normalizedUrl: page.normalizedUrl,
    aliases: page.aliases.map((alias) => ({
      id: alias.id,
      url: alias.url,
      normalizedUrl: alias.normalizedUrl,
      source: alias.source,
      firstSeenAt: alias.firstSeenAt.toISOString(),
      lastSeenAt: alias.lastSeenAt.toISOString()
    })),
    sources: page.sources.map((source) => ({
      source: source.source,
      firstSeenAt: source.firstSeenAt.toISOString(),
      lastSeenAt: source.lastSeenAt.toISOString()
    })),
    pageType: page.pageType,
    indexability: page.indexability,
    ...(page.httpStatus === null || page.httpStatus === 0 ? {} : { httpStatus: page.httpStatus }),
    ...(page.canonicalTarget
      ? { canonicalTarget: page.canonicalTarget }
      : {}),
    ...(page.robots ? { robots: page.robots } : {}),
    ...(page.title ? { title: page.title } : {}),
    ...(page.description ? { description: page.description } : {}),
    ...(page.h1 ? { h1: page.h1 } : {}),
    ...(page.language ? { language: page.language } : {}),
    ...(page.template ? { template: page.template } : {}),
    ...(contentStatus ? { contentStatus } : {}),
    ...(page.ownerId ? { ownerId: page.ownerId } : {}),
    priority: page.priority,
    ...(page.publishedAt
      ? { publishedAt: page.publishedAt.toISOString() }
      : {}),
    ...(page.crawledAt ? { crawledAt: page.crawledAt.toISOString() } : {}),
    analyticsMetrics: numericMetrics(page.analyticsMetrics),
    ...(page.notes ? { notes: page.notes } : {}),
    assignedKeywordCount: page._count.targetKeywords,
    assignedClusterCount: page._count.primaryClusters,
    openIssueCount: page._count.crawlIssues,
    ...(latestCrawl
      ? {
          latestCrawl: {
            crawlId: latestCrawl.crawlId,
            requestedUrl: latestCrawl.requestedUrl,
            finalUrl: latestCrawl.finalUrl,
            statusCode: latestCrawl.statusCode,
            responseTimeMs: latestCrawl.responseTimeMs,
            sizeBytes: latestCrawl.sizeBytes,
            contentType: latestCrawl.contentType,
            ...(latestCrawl.title ? { title: latestCrawl.title } : {}),
            ...(latestCrawl.description
              ? { description: latestCrawl.description }
              : {}),
            ...(latestCrawl.h1 ? { h1: latestCrawl.h1 } : {}),
            h1Count: latestCrawl.h1Count,
            ...(latestCrawl.canonicalUrl
              ? { canonicalUrl: latestCrawl.canonicalUrl }
              : {}),
            ...(latestCrawl.robots ? { robots: latestCrawl.robots } : {}),
            ...(latestCrawl.language
              ? { language: latestCrawl.language }
              : {}),
            metaTags:
              "metaTags" in latestCrawl
                ? storedMetaTags(latestCrawl.metaTags)
                : [],
            ...("headings" in latestCrawl ? { headings: latestCrawl.headings as unknown as NonNullable<NonNullable<ProjectPageSummary["latestCrawl"]>["headings"]> } : {}),
            ...("hreflang" in latestCrawl ? { hreflang: latestCrawl.hreflang as unknown as NonNullable<NonNullable<ProjectPageSummary["latestCrawl"]>["hreflang"]> } : {}),
            ...("technicalDetails" in latestCrawl ? { technicalDetails: publicTechnicalDetails(latestCrawl.technicalDetails) } : {}),
            imageCount: latestCrawl.imageCount,
            imagesMissingAlt: latestCrawl.imagesMissingAlt,
            structuredDataTypes: storedStringArray(
              latestCrawl.structuredDataTypes
            ),
            wordCount: latestCrawl.wordCount,
            redirectChain: storedStringArray(latestCrawl.redirectChain),
            inSitemap: latestCrawl.inSitemap,
            depth: latestCrawl.depth,
            indexability: latestCrawl.indexability,
            crawledAt: latestCrawl.crawledAt.toISOString()
          }
        }
      : {}),
    lifecycleStatus: page.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    version: page.version,
    ...(page.createdBy ? { createdBy: page.createdBy } : {}),
    ...(page.updatedBy ? { updatedBy: page.updatedBy } : {}),
    ...(page.archivedBy ? { archivedBy: page.archivedBy } : {}),
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    ...(page.archivedAt
      ? { archivedAt: page.archivedAt.toISOString() }
      : {})
  };
}

function storedStringArray(value: Prisma.JsonValue): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function storedMetaTags(
  value: Prisma.JsonValue
): NonNullable<ProjectPageSummary["latestCrawl"]>["metaTags"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof candidate.content !== "string"
    ) {
      return [];
    }
    const name = typeof candidate.name === "string" ? candidate.name : undefined;
    const property = typeof candidate.property === "string"
      ? candidate.property
      : undefined;
    const httpEquiv = typeof candidate.httpEquiv === "string"
      ? candidate.httpEquiv
      : undefined;
    if (!name && !property && !httpEquiv) return [];
    return [{
      ...(name ? { name } : {}),
      ...(property ? { property } : {}),
      ...(httpEquiv ? { httpEquiv } : {}),
      ...(candidate.source === "HTML" || candidate.source === "HTTP" ? { source: candidate.source } : {}),
      content: candidate.content
    }];
  });
}

function publicTechnicalDetails(value: Prisma.JsonValue) {
  const { links: _links, ...facts } = parseCrawlTechnicalDetails(value);
  return facts;
}

function pageIdentity(
  url: string,
  aliases: readonly string[]
): {
  readonly canonical: NormalizedPageUrl;
  readonly aliases: readonly NormalizedPageUrl[];
} {
  const canonical = normalizePageUrl(url);
  return {
    canonical,
    aliases: deduplicateUrls(
      aliases.map((alias, index) =>
        normalizePageUrl(alias, `aliases.${index}`)
      ),
      canonical.hash
    )
  };
}

function deduplicateUrls(
  values: readonly NormalizedPageUrl[],
  canonicalHash: string
): readonly NormalizedPageUrl[] {
  const unique = new Map<string, NormalizedPageUrl>();
  for (const value of values) {
    if (value.hash !== canonicalHash) unique.set(value.hash, value);
  }
  return [...unique.values()];
}

function numericMetrics(value: Prisma.JsonValue): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1])
    )
  );
}

function pageRequestHash(
  input: InternalCreateProjectPageInput,
  identity: ReturnType<typeof pageIdentity>
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        url: identity.canonical.normalized,
        aliases: identity.aliases.map(({ normalized }) => normalized)
      }),
      "utf8"
    )
    .digest("hex");
}

function receiptWhere(input: InternalCreateProjectPageInput) {
  return {
    workspaceId_projectId_actorId_idempotencyKey: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey
    }
  };
}

function replayReceipt(
  receipt: { readonly requestHash: string; readonly responseSnapshot: Prisma.JsonValue },
  requestHash: string
): ProjectPageSummary {
  if (receipt.requestHash !== requestHash) {
    conflict("Idempotency key was already used for another page command");
  }
  return receipt.responseSnapshot as unknown as ProjectPageSummary;
}

async function lockPage(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  pageId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "pages"
    WHERE "workspace_id" = ${workspaceId}::uuid
      AND "project_id" = ${projectId}::uuid
      AND "id" = ${pageId}::uuid
    FOR UPDATE
  `;
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new HttpException(
      {
        code: "VERSION_CONFLICT",
        message: "Page version does not match",
        details: { currentVersion: actual }
      },
      HttpStatus.CONFLICT
    );
  }
}

function pageFilterHash(query: ProjectPageListQuery): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        search: query.search ?? "",
        pathPrefix: query.pathPrefix ?? "",
        pageType: query.pageType ?? "",
        indexability: query.indexability ?? "",
        lifecycleStatus: query.lifecycleStatus ?? "ACTIVE"
      }),
      "utf8"
    )
    .digest("hex");
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string, filterHash: string): PageCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    invalidCursor();
  }
  const cursor = parsed as Readonly<Record<string, unknown>>;
  if (
    cursor.version !== 1 ||
    cursor.filterHash !== filterHash ||
    typeof cursor.updatedAt !== "string" ||
    !Number.isFinite(new Date(cursor.updatedAt).getTime()) ||
    typeof cursor.id !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(cursor.id)
    || cursor.sectionRoot !== undefined && typeof cursor.sectionRoot !== "boolean"
  ) {
    invalidCursor();
  }
  return cursor as unknown as PageCursor;
}

function invalidCursor(): never {
  throw new HttpException(
    { code: "INVALID_CURSOR", message: "Invalid page cursor" },
    HttpStatus.BAD_REQUEST
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function conflict(message: string): never {
  throw new ConflictException({
    code: "PAGE_CONFLICT",
    message
  });
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isSectionRootPage(value: string, prefix: string): boolean {
  const url = new URL(value);
  return !url.search && url.pathname.replace(/\/$/u, "") === prefix.replace(/\/$/u, "");
}

function scopedPageInclude<T extends typeof PAGE_LIST_INCLUDE>(include: T, workspaceId: string, projectId: string) {
  const scope = { workspaceId, projectId };
  return { ...include, aliases: { ...include.aliases, where: scope }, sources: { ...include.sources, where: scope },
    crawlSnapshots: { ...include.crawlSnapshots, where: scope }, _count: { select: {
      targetKeywords: { where: { ...scope, status: "ACTIVE" as const } }, primaryClusters: { where: { ...scope, status: "ACTIVE" as const } }, crawlIssues: { where: { ...scope, resolvedAt: null } }
    } } };
}

function scopedPageRows(workspaceId: string, projectId: string) {
  const { aliases, sources, crawlSnapshots } = scopedPageInclude(PAGE_LIST_INCLUDE, workspaceId, projectId);
  return { aliases, sources, crawlSnapshots };
}
async function pageCounts(prisma: PrismaService, workspaceId: string, projectId: string, ids: readonly string[]) {
  if (!ids.length) return new Map<string, { targetKeywords: number; primaryClusters: number; crawlIssues: number }>();
  const rows = await prisma.$queryRaw<{ pageId: string; kind: "targetKeywords" | "primaryClusters" | "crawlIssues"; count: number }[]>`
    SELECT target_page_id AS "pageId", 'targetKeywords' AS kind, count(*)::int AS count FROM keywords
      WHERE workspace_id=${workspaceId}::uuid AND project_id=${projectId}::uuid AND status='ACTIVE' AND target_page_id=ANY(${[...ids]}::uuid[]) GROUP BY target_page_id
    UNION ALL SELECT primary_page_id, 'primaryClusters', count(*)::int FROM clusters
      WHERE workspace_id=${workspaceId}::uuid AND project_id=${projectId}::uuid AND status='ACTIVE' AND primary_page_id=ANY(${[...ids]}::uuid[]) GROUP BY primary_page_id
    UNION ALL SELECT page_id, 'crawlIssues', count(*)::int FROM crawl_issues
      WHERE workspace_id=${workspaceId}::uuid AND project_id=${projectId}::uuid AND resolved_at IS NULL AND page_id=ANY(${[...ids]}::uuid[]) GROUP BY page_id`;
  const counts = new Map<string, { targetKeywords: number; primaryClusters: number; crawlIssues: number }>();
  for (const row of rows) { const value = counts.get(row.pageId) ?? { targetKeywords: 0, primaryClusters: 0, crawlIssues: 0 }; value[row.kind] = row.count; counts.set(row.pageId, value); }
  return counts;
}

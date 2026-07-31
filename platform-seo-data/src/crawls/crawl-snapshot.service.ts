import { Injectable } from "@nestjs/common";
import {
  crawlPageChangeFields,
  type CrawlPageChangeField,
  type InternalFinalizeCrawlSnapshotInput,
  type InternalPersistCrawlPageInput,
  type InternalPersistCrawlPageReceipt,
  type ProjectCrawlPageChangeCollection,
  type ProjectCrawlIssueCollection
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { normalizePageUrl } from "../pages/page-url.js";
import {
  crawlChangeSnapshotSelect,
  detectCrawlPageChange
} from "./crawl-change.js";

@Injectable()
export class CrawlSnapshotService {
  public constructor(private readonly prisma: PrismaService) {}

  public async persistPage(
    input: InternalPersistCrawlPageInput
  ): Promise<InternalPersistCrawlPageReceipt> {
    const identity = normalizePageUrl(input.finalUrl);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${input.projectId}:${identity.hash}`}, 0)
        )
      `;
      const existing = await transaction.crawlPageSnapshot.findUnique({
        where: {
          crawlId_sequence: {
            crawlId: input.crawlId,
            sequence: input.sequence
          }
        },
        select: {
          workspaceId: true,
          projectId: true,
          statusCode: true,
          _count: { select: { issueOccurrences: true } }
        }
      });
      if (existing) {
        if (
          existing.workspaceId !== input.workspaceId ||
          existing.projectId !== input.projectId
        ) {
          throw new TypeError("Crawl snapshot scope does not match");
        }
        return {
          accepted: true,
          issueCount: existing._count.issueOccurrences,
          success: existing.statusCode < 400
        };
      }
      const alias = await transaction.pageAlias.findUnique({
        where: {
          projectId_urlHash: {
            projectId: input.projectId,
            urlHash: identity.hash
          }
        },
        select: { pageId: true }
      });
      const current = alias
        ? await transaction.page.findFirst({
            where: {
              id: alias.pageId,
              workspaceId: input.workspaceId,
              projectId: input.projectId
            }
          })
        : await transaction.page.findUnique({
            where: {
              projectId_urlHash: {
                projectId: input.projectId,
                urlHash: identity.hash
              }
            }
          });
      const page = current
        ? await transaction.page.update({
            where: { id: current.id },
            data: {
              ...pageProjection(input),
              version: { increment: 1 }
            }
          })
        : await transaction.page.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              url: identity.original,
              normalizedUrl: identity.normalized,
              urlHash: identity.hash,
              pageType: "EXISTING",
              priority: 0,
              ...pageProjection(input)
            }
          });
      await transaction.pageSource.upsert({
        where: { pageId_source: { pageId: page.id, source: "CRAWL" } },
        create: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          pageId: page.id,
          source: "CRAWL",
          metadata: { crawlId: input.crawlId }
        },
        update: {
          metadata: { crawlId: input.crawlId },
          lastSeenAt: new Date(input.crawledAt)
        }
      });
      if (input.inSitemap) {
        await transaction.pageSource.upsert({
          where: {
            pageId_source: { pageId: page.id, source: "SITEMAP" }
          },
          create: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            pageId: page.id,
            source: "SITEMAP",
            metadata: { crawlId: input.crawlId }
          },
          update: {
            metadata: { crawlId: input.crawlId },
            lastSeenAt: new Date(input.crawledAt)
          }
        });
      }
      const previousSnapshot =
        await transaction.crawlPageSnapshot.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            pageId: page.id,
            NOT: { crawlId: input.crawlId }
          },
          select: crawlChangeSnapshotSelect,
          orderBy: [{ crawledAt: "desc" }, { id: "desc" }]
        });
      const snapshot = await transaction.crawlPageSnapshot.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          crawlId: input.crawlId,
          sequence: input.sequence,
          pageId: page.id,
          requestedUrl: input.requestedUrl,
          finalUrl: input.finalUrl,
          finalUrlHash: identity.hash,
          redirectChain: input.redirectChain as Prisma.InputJsonValue,
          inSitemap: input.inSitemap,
          depth: input.depth,
          statusCode: input.statusCode,
          responseTimeMs: input.responseTimeMs,
          sizeBytes: input.sizeBytes,
          contentType: input.contentType,
          ...(input.title ? { title: input.title } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.h1 ? { h1: input.h1 } : {}),
          h1Count: input.h1Count,
          ...(input.canonicalUrl ? { canonicalUrl: input.canonicalUrl } : {}),
          ...(input.robots ? { robots: input.robots } : {}),
          ...(input.language ? { language: input.language } : {}),
          headings: input.headings as Prisma.InputJsonValue,
          hreflang: input.hreflang as Prisma.InputJsonValue,
          internalLinks: input.internalLinks as Prisma.InputJsonValue,
          externalLinks: input.externalLinks as Prisma.InputJsonValue,
          imageCount: input.imageCount,
          imagesMissingAlt: input.imagesMissingAlt,
          structuredDataTypes:
            input.structuredDataTypes as Prisma.InputJsonValue,
          wordCount: input.wordCount,
          contentHash: input.contentHash,
          indexability: input.indexability,
          crawledAt: new Date(input.crawledAt)
        }
      });
      if (previousSnapshot) {
        const change = detectCrawlPageChange(previousSnapshot, input);
        if (change) {
          await transaction.crawlPageChange.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              pageId: page.id,
              crawlId: input.crawlId,
              previousSnapshotId: previousSnapshot.id,
              currentSnapshotId: snapshot.id,
              severity: change.severity,
              changedFields: [...change.changedFields],
              beforeHash: change.beforeHash,
              afterHash: change.afterHash,
              diffHash: change.diffHash,
              diff: change.diff as Prisma.InputJsonValue
            }
          });
        }
      }
      for (const issue of input.issues) {
        await transaction.crawlIssueOccurrence.create({
          data: {
            snapshotId: snapshot.id,
            code: issue.code,
            severity: issue.severity,
            title: issue.title,
            details: issue.details as Prisma.InputJsonValue
          }
        });
        await transaction.crawlIssue.upsert({
          where: {
            projectId_pageId_code: {
              projectId: input.projectId,
              pageId: page.id,
              code: issue.code
            }
          },
          create: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            pageId: page.id,
            code: issue.code,
            severity: issue.severity,
            title: issue.title,
            details: issue.details as Prisma.InputJsonValue,
            firstCrawlId: input.crawlId,
            lastCrawlId: input.crawlId,
            firstSeenAt: new Date(input.crawledAt),
            lastSeenAt: new Date(input.crawledAt)
          },
          update: {
            severity: issue.severity,
            title: issue.title,
            details: issue.details as Prisma.InputJsonValue,
            lastCrawlId: input.crawlId,
            lastSeenAt: new Date(input.crawledAt),
            resolvedAt: null,
            occurrences: { increment: 1 },
            version: { increment: 1 }
          }
        });
      }
      return {
        accepted: true,
        issueCount: input.issues.length,
        success: input.statusCode < 400
      };
    });
  }

  public async finalize(
    input: InternalFinalizeCrawlSnapshotInput
  ): Promise<{ readonly accepted: true }> {
    if (input.status === "COMPLETED") {
      await this.prisma.crawlIssue.updateMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          resolvedAt: null,
          NOT: { lastCrawlId: input.crawlId },
          page: {
            crawlSnapshots: {
              some: { crawlId: input.crawlId }
            }
          }
        },
        data: {
          resolvedAt: new Date(),
          version: { increment: 1 }
        }
      });
    }
    return { accepted: true };
  }

  public async listIssues(
    workspaceId: string,
    projectId: string
  ): Promise<ProjectCrawlIssueCollection> {
    const issues = await this.prisma.crawlIssue.findMany({
      where: { workspaceId, projectId, resolvedAt: null },
      include: { page: { select: { url: true } } },
      orderBy: [
        { severity: "desc" },
        { lastSeenAt: "desc" },
        { id: "desc" }
      ],
      take: 500
    });
    return {
      issues: issues.map((issue) => ({
        id: issue.id,
        crawlId: issue.lastCrawlId,
        pageId: issue.pageId,
        url: issue.page.url,
        code: issue.code,
        severity: issue.severity,
        title: issue.title,
        details: issue.details as Readonly<
          Record<string, string | number | boolean>
        >,
        firstSeenAt: issue.firstSeenAt.toISOString(),
        lastSeenAt: issue.lastSeenAt.toISOString(),
        occurrences: issue.occurrences,
        ...(issue.resolvedAt
          ? { resolvedAt: issue.resolvedAt.toISOString() }
          : {})
      }))
    };
  }

  public async listChanges(
    workspaceId: string,
    projectId: string
  ): Promise<ProjectCrawlPageChangeCollection> {
    const changes = await this.prisma.crawlPageChange.findMany({
      where: { workspaceId, projectId },
      include: {
        page: { select: { url: true } },
        previousSnapshot: { select: { crawledAt: true } },
        currentSnapshot: { select: { crawledAt: true } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500
    });
    return {
      changes: changes.map((change) => ({
        id: change.id,
        crawlId: change.crawlId,
        pageId: change.pageId,
        url: change.page.url,
        severity: change.severity,
        changedFields: storedChangeFields(change.changedFields),
        previousCrawledAt:
          change.previousSnapshot.crawledAt.toISOString(),
        currentCrawledAt: change.currentSnapshot.crawledAt.toISOString(),
        createdAt: change.createdAt.toISOString()
      }))
    };
  }
}

function pageProjection(
  input: InternalPersistCrawlPageInput
) {
  return {
    indexability: input.indexability,
    httpStatus: input.statusCode,
    canonicalTarget: input.canonicalUrl ?? null,
    robots: input.robots ?? null,
    title: input.title ?? null,
    description: input.description ?? null,
    h1: input.h1 ?? null,
    language: input.language ?? null,
    crawledAt: new Date(input.crawledAt)
  } as const;
}

function storedChangeFields(
  values: readonly string[]
): readonly CrawlPageChangeField[] {
  const allowed = new Set<string>(crawlPageChangeFields);
  if (
    values.length < 1 ||
    values.length > crawlPageChangeFields.length ||
    new Set(values).size !== values.length ||
    values.some((value) => !allowed.has(value))
  ) {
    throw new TypeError("Stored crawl page change fields are invalid");
  }
  return values as readonly CrawlPageChangeField[];
}

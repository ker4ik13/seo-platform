import { Injectable } from "@nestjs/common";
import {
  crawlPageChangeFields,
  type CrawlPageChangeField,
  type InternalCrawlPageValidator,
  type InternalFinalizeCrawlSnapshotInput,
  type InternalFinalizeCrawlSnapshotReceipt,
  type InternalGetCrawlPageValidatorInput,
  type InternalPersistCrawlPageInput,
  type InternalPersistCrawlPageReceipt,
  type InternalReuseCrawlPageInput,
  type ProjectCrawlAbsentPageCollection,
  type ProjectCrawlDuplicateGroupCollection,
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
import {
  detectCrawlDuplicateGroups,
  duplicateIssue
} from "./crawl-duplicates.js";

const finalizationSnapshotSelect = {
  id: true,
  pageId: true,
  sequence: true,
  finalUrl: true,
  statusCode: true,
  contentType: true,
  title: true,
  description: true,
  h1: true,
  wordCount: true,
  contentHash: true,
  inSitemap: true,
  crawledAt: true
} as const satisfies Prisma.CrawlPageSnapshotSelect;

type FinalizationSnapshot = Prisma.CrawlPageSnapshotGetPayload<{
  select: typeof finalizationSnapshotSelect;
}>;

@Injectable()
export class CrawlSnapshotService {
  public constructor(private readonly prisma: PrismaService) {}

  public async validator(
    input: InternalGetCrawlPageValidatorInput
  ): Promise<InternalCrawlPageValidator | null> {
    const identity = normalizePageUrl(input.url);
    const snapshot = await this.prisma.crawlPageSnapshot.findFirst({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        finalUrlHash: identity.hash
      },
      select: {
        id: true,
        etag: true,
        lastModified: true,
        internalLinks: true
      },
      orderBy: [{ crawledAt: "desc" }, { id: "desc" }]
    });
    if (!snapshot || (!snapshot.etag && !snapshot.lastModified)) {
      return null;
    }
    const internalLinks = storedUrlArray(snapshot.internalLinks);
    if (!validatorLinksFitResponse(internalLinks)) return null;
    return {
      sourceSnapshotId: snapshot.id,
      ...(snapshot.etag ? { etag: snapshot.etag } : {}),
      ...(snapshot.lastModified
        ? { lastModified: snapshot.lastModified }
        : {}),
      internalLinks
    };
  }

  public async persistPage(
    input: InternalPersistCrawlPageInput
  ): Promise<InternalPersistCrawlPageReceipt> {
    const httpStatusOnly = input.purpose === "HTTP_STATUS_CHECK";
    const identity = normalizePageUrl(
      httpStatusOnly ? input.requestedUrl : input.finalUrl
    );
    const issues = httpStatusOnly ? [] : input.issues;
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
          metadata: { crawlId: input.crawlId },
          firstSeenAt: new Date(input.crawledAt),
          lastSeenAt: new Date(input.crawledAt)
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
            metadata: { crawlId: input.crawlId },
            firstSeenAt: new Date(input.crawledAt),
            lastSeenAt: new Date(input.crawledAt)
          },
          update: {
            metadata: { crawlId: input.crawlId },
            lastSeenAt: new Date(input.crawledAt)
          }
        });
      }
      const previousSnapshot = httpStatusOnly
        ? null
        : await transaction.crawlPageSnapshot.findFirst({
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
          ...(input.etag ? { etag: input.etag } : {}),
          ...(input.lastModified
            ? { lastModified: input.lastModified }
            : {}),
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
      for (const issue of issues) {
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
        issueCount: issues.length,
        success: input.statusCode < 400
      };
    });
  }

  public async reusePage(
    input: InternalReuseCrawlPageInput
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
      const source =
        await transaction.crawlPageSnapshot.findFirst({
          where: {
            id: input.sourceSnapshotId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            finalUrlHash: identity.hash,
            NOT: { crawlId: input.crawlId },
            OR: [
              { etag: { not: null } },
              { lastModified: { not: null } }
            ]
          },
          include: { issueOccurrences: true }
        });
      if (!source || (!source.etag && !source.lastModified)) {
        throw new TypeError("Conditional crawl source is unavailable");
      }
      const page = await transaction.page.update({
        where: { id: source.pageId },
        data: {
          indexability: source.indexability,
          httpStatus: source.statusCode,
          canonicalTarget: source.canonicalUrl,
          robots: source.robots,
          title: source.title,
          description: source.description,
          h1: source.h1,
          language: source.language,
          crawledAt: new Date(input.crawledAt),
          version: { increment: 1 }
        }
      });
      await transaction.pageSource.upsert({
        where: { pageId_source: { pageId: page.id, source: "CRAWL" } },
        create: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          pageId: page.id,
          source: "CRAWL",
          metadata: { crawlId: input.crawlId },
          firstSeenAt: new Date(input.crawledAt),
          lastSeenAt: new Date(input.crawledAt)
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
            metadata: { crawlId: input.crawlId },
            firstSeenAt: new Date(input.crawledAt),
            lastSeenAt: new Date(input.crawledAt)
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
      const copiedInput = reusedPageInput(input, source);
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
          statusCode: source.statusCode,
          responseTimeMs: source.responseTimeMs,
          sizeBytes: source.sizeBytes,
          contentType: source.contentType,
          title: source.title,
          description: source.description,
          h1: source.h1,
          h1Count: source.h1Count,
          canonicalUrl: source.canonicalUrl,
          robots: source.robots,
          language: source.language,
          headings: source.headings as Prisma.InputJsonValue,
          hreflang: source.hreflang as Prisma.InputJsonValue,
          internalLinks: source.internalLinks as Prisma.InputJsonValue,
          externalLinks: source.externalLinks as Prisma.InputJsonValue,
          imageCount: source.imageCount,
          imagesMissingAlt: source.imagesMissingAlt,
          structuredDataTypes:
            source.structuredDataTypes as Prisma.InputJsonValue,
          wordCount: source.wordCount,
          contentHash: source.contentHash,
          etag: source.etag,
          lastModified: source.lastModified,
          notModified: true,
          reusedFromSnapshotId: source.id,
          indexability: source.indexability,
          crawledAt: new Date(input.crawledAt)
        }
      });
      if (previousSnapshot) {
        const change = detectCrawlPageChange(
          previousSnapshot,
          copiedInput
        );
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
      for (const issue of source.issueOccurrences) {
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
        issueCount: source.issueOccurrences.length,
        success: source.statusCode < 400
      };
    });
  }

  public async finalize(
    input: InternalFinalizeCrawlSnapshotInput
  ): Promise<InternalFinalizeCrawlSnapshotReceipt> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`crawl-finalization:${input.workspaceId}:${input.projectId}`},
            0
          )
        )
      `;
      if (input.purpose === "HTTP_STATUS_CHECK") {
        const snapshotCount = await transaction.crawlPageSnapshot.count({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            crawlId: input.crawlId
          }
        });
        if (snapshotCount !== input.processedUrls) {
          throw new TypeError(
            "HTTP status check snapshot count does not match"
          );
        }
        return { accepted: true, issueCount: 0 };
      }
      const [existingDuplicates, existingMembership] = await Promise.all([
        transaction.crawlDuplicateAnalysis.findUnique({
          where: {
            workspaceId_projectId_crawlId: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              crawlId: input.crawlId
            }
          },
          select: { issueCount: true }
        }),
        transaction.crawlMembershipAnalysis.findUnique({
          where: {
            workspaceId_projectId_crawlId: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              crawlId: input.crawlId
            }
          },
          select: { missingCount: true, scopeHash: true }
        })
      ]);
      if (
        existingMembership &&
        existingMembership.scopeHash !== input.scopeHash
      ) {
        throw new TypeError("Crawl membership scope hash changed");
      }
      if (existingDuplicates && existingMembership) {
        return {
          accepted: true,
          issueCount:
            existingDuplicates.issueCount +
            existingMembership.missingCount
        };
      }
      const snapshots = await transaction.crawlPageSnapshot.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          crawlId: input.crawlId
        },
        select: finalizationSnapshotSelect,
        orderBy: { sequence: "asc" },
        take: 1_001
      });
      if (
        snapshots.length > 1_000 ||
        snapshots.length !== input.processedUrls
      ) {
        throw new TypeError(
          "Crawl finalization snapshot count does not match"
        );
      }
      const duplicateIssueCount =
        existingDuplicates?.issueCount ??
        await this.persistDuplicateAnalysis(
          transaction,
          input,
          snapshots
        );
      const missingIssueCount =
        existingMembership?.missingCount ??
        await this.persistMembershipAnalysis(
          transaction,
          input,
          snapshots
        );
      if (input.status === "COMPLETED") {
        await transaction.$executeRaw`
          UPDATE "crawl_issues" AS issue
          SET
            "resolved_at" = CURRENT_TIMESTAMP,
            "version" = issue."version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE
            issue."workspace_id" = ${input.workspaceId}::uuid
            AND issue."project_id" = ${input.projectId}::uuid
            AND issue."resolved_at" IS NULL
            AND issue."last_crawl_id" <> ${input.crawlId}::uuid
            AND EXISTS (
              SELECT 1
              FROM "crawl_page_snapshots" AS snapshot
              WHERE
                snapshot."workspace_id" = issue."workspace_id"
                AND snapshot."project_id" = issue."project_id"
                AND snapshot."page_id" = issue."page_id"
                AND snapshot."crawl_id" = ${input.crawlId}::uuid
            )
        `;
      }
      return {
        accepted: true,
        issueCount: duplicateIssueCount + missingIssueCount
      };
    });
  }

  private async persistDuplicateAnalysis(
    transaction: Prisma.TransactionClient,
    input: InternalFinalizeCrawlSnapshotInput,
    snapshots: readonly FinalizationSnapshot[]
  ): Promise<number> {
      const groups =
        input.status === "CANCELLED"
          ? []
          : detectCrawlDuplicateGroups(snapshots);
      const issueCount = groups.reduce(
        (total, group) => total + group.members.length,
        0
      );
      await transaction.crawlDuplicateAnalysis.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          crawlId: input.crawlId,
          snapshotCount: snapshots.length,
          groupCount: groups.length,
          issueCount
        }
      });
      if (groups.length > 0) {
        const identifiers = await transaction.$queryRaw<
          readonly { readonly id: string; readonly position: number }[]
        >`
          SELECT uuidv7()::text AS id, position::integer AS position
          FROM generate_series(0, ${groups.length - 1}) AS position
          ORDER BY position
        `;
        if (identifiers.length !== groups.length) {
          throw new TypeError(
            "Crawl duplicate group identifiers are unavailable"
          );
        }
        const storedGroups = groups.map((group, index) => {
          const id = identifiers[index]?.id;
          if (!id) {
            throw new TypeError(
              "Crawl duplicate group identifier is unavailable"
            );
          }
          return { ...group, id };
        });
        await transaction.crawlDuplicateGroup.createMany({
          data: storedGroups.map((group) => ({
            id: group.id,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            crawlId: input.crawlId,
            kind: group.kind,
            signatureHash: group.signatureHash,
            memberCount: group.members.length
          }))
        });
        await transaction.crawlDuplicateGroupMember.createMany({
          data: storedGroups.flatMap((group) =>
            group.members.map((member) => ({
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              crawlId: input.crawlId,
              groupId: group.id,
              snapshotId: member.id,
              pageId: member.pageId
            }))
          )
        });
        const issueRows = storedGroups.flatMap((group) => {
          const evidence = duplicateIssue(group.kind);
          return group.members.map((member) => ({
            snapshotId: member.id,
            pageId: member.pageId,
            code: evidence.code,
            severity: evidence.severity,
            title: evidence.title,
            details: {
              duplicateKind: group.kind,
              groupId: group.id,
              groupSize: group.members.length
            },
            seenAt: member.crawledAt.toISOString()
          }));
        });
        await transaction.crawlIssueOccurrence.createMany({
          data: issueRows.map((row) => ({
            snapshotId: row.snapshotId,
            code: row.code,
            severity: row.severity,
            title: row.title,
            details: row.details
          }))
        });
        await transaction.$executeRaw`
          INSERT INTO "crawl_issues" (
            "id",
            "workspace_id",
            "project_id",
            "page_id",
            "code",
            "severity",
            "title",
            "details",
            "first_crawl_id",
            "last_crawl_id",
            "first_seen_at",
            "last_seen_at"
          )
          SELECT
            uuidv7(),
            ${input.workspaceId}::uuid,
            ${input.projectId}::uuid,
            row."pageId"::uuid,
            row."code",
            row."severity"::"CrawlIssueSeverity",
            row."title",
            row."details",
            ${input.crawlId}::uuid,
            ${input.crawlId}::uuid,
            row."seenAt"::timestamptz,
            row."seenAt"::timestamptz
          FROM jsonb_to_recordset(${JSON.stringify(issueRows)}::jsonb)
            AS row(
              "snapshotId" text,
              "pageId" text,
              "code" text,
              "severity" text,
              "title" text,
              "details" jsonb,
              "seenAt" text
            )
          ON CONFLICT ("project_id", "page_id", "code")
          DO UPDATE SET
            "severity" = EXCLUDED."severity",
            "title" = EXCLUDED."title",
            "details" = EXCLUDED."details",
            "last_crawl_id" = EXCLUDED."last_crawl_id",
            "last_seen_at" = EXCLUDED."last_seen_at",
            "resolved_at" = NULL,
            "occurrences" = "crawl_issues"."occurrences" + 1,
            "version" = "crawl_issues"."version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
        `;
      }
      return issueCount;
  }

  private async persistMembershipAnalysis(
    transaction: Prisma.TransactionClient,
    input: InternalFinalizeCrawlSnapshotInput,
    snapshots: readonly FinalizationSnapshot[]
  ): Promise<number> {
    const previous =
      input.status === "COMPLETED"
        ? await transaction.crawlMembershipAnalysis.findFirst({
            where: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              status: "COMPLETED",
              scopeHash: input.scopeHash
            },
            select: { crawlId: true },
            orderBy: [{ createdAt: "desc" }, { crawlId: "desc" }]
          })
        : null;
    const previousSnapshots = previous
      ? await transaction.crawlPageSnapshot.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            crawlId: previous.crawlId
          },
          select: {
            id: true,
            pageId: true,
            inSitemap: true,
            crawledAt: true
          },
          orderBy: { sequence: "asc" },
          take: 1_001
        })
      : [];
    if (previousSnapshots.length > 1_000) {
      throw new TypeError("Previous crawl membership exceeds limit");
    }
    const currentPageIds = new Set(
      snapshots.map((snapshot) => snapshot.pageId)
    );
    const missing =
      input.status === "COMPLETED"
        ? previousSnapshots.filter(
            (snapshot) => !currentPageIds.has(snapshot.pageId)
          )
        : [];
    const [clock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now || Number.isNaN(clock.now.getTime())) {
      throw new TypeError("Crawl membership database clock is unavailable");
    }
    await transaction.crawlMembershipAnalysis.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        crawlId: input.crawlId,
        status: input.status,
        scopeHash: input.scopeHash,
        previousCrawlId: previous?.crawlId ?? null,
        snapshotCount: snapshots.length,
        missingCount: missing.length,
        createdAt: clock.now
      }
    });
    if (!previous || missing.length === 0) return 0;
    await transaction.crawlPageAbsence.createMany({
      data: missing.map((snapshot) => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        crawlId: input.crawlId,
        pageId: snapshot.pageId,
        previousCrawlId: previous.crawlId,
        previousSnapshotId: snapshot.id,
        detectedAt: clock.now
      }))
    });
    const issueRows = missing.map((snapshot) => ({
      pageId: snapshot.pageId,
      code: "URL_DISAPPEARED_FROM_CRAWL",
      severity: "WARNING",
      title: "Страница исчезла из полного обхода",
      details: {
        previousCrawlId: previous.crawlId,
        previousSnapshotId: snapshot.id,
        wasInSitemap: snapshot.inSitemap
      },
      seenAt: clock.now.toISOString()
    }));
    await transaction.$executeRaw`
      INSERT INTO "crawl_issues" (
        "id",
        "workspace_id",
        "project_id",
        "page_id",
        "code",
        "severity",
        "title",
        "details",
        "first_crawl_id",
        "last_crawl_id",
        "first_seen_at",
        "last_seen_at"
      )
      SELECT
        uuidv7(),
        ${input.workspaceId}::uuid,
        ${input.projectId}::uuid,
        row."pageId"::uuid,
        row."code",
        row."severity"::"CrawlIssueSeverity",
        row."title",
        row."details",
        ${input.crawlId}::uuid,
        ${input.crawlId}::uuid,
        row."seenAt"::timestamptz,
        row."seenAt"::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(issueRows)}::jsonb)
        AS row(
          "pageId" text,
          "code" text,
          "severity" text,
          "title" text,
          "details" jsonb,
          "seenAt" text
        )
      ON CONFLICT ("project_id", "page_id", "code")
      DO UPDATE SET
        "severity" = EXCLUDED."severity",
        "title" = EXCLUDED."title",
        "details" = EXCLUDED."details",
        "last_crawl_id" = EXCLUDED."last_crawl_id",
        "last_seen_at" = EXCLUDED."last_seen_at",
        "resolved_at" = NULL,
        "occurrences" = "crawl_issues"."occurrences" + 1,
        "version" = "crawl_issues"."version" + 1,
        "updated_at" = CURRENT_TIMESTAMP
    `;
    return missing.length;
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

  public async listDuplicateGroups(
    workspaceId: string,
    projectId: string,
    crawlId: string
  ): Promise<ProjectCrawlDuplicateGroupCollection> {
    const groups = await this.prisma.crawlDuplicateGroup.findMany({
      where: { workspaceId, projectId, crawlId },
      include: {
        members: {
          include: {
            page: { select: { url: true } },
            snapshot: { select: { sequence: true } }
          }
        }
      },
      orderBy: [
        { kind: "asc" },
        { memberCount: "desc" },
        { id: "asc" }
      ],
      take: 2_000
    });
    return {
      groups: groups.map((group) => ({
        id: group.id,
        crawlId: group.crawlId,
        kind: group.kind,
        memberCount: group.memberCount,
        members: [...group.members]
          .sort(
            (left, right) =>
              left.snapshot.sequence - right.snapshot.sequence
          )
          .map((member) => ({
            pageId: member.pageId,
            url: member.page.url
          })),
        createdAt: group.createdAt.toISOString()
      }))
    };
  }

  public async listAbsentPages(
    workspaceId: string,
    projectId: string,
    crawlId: string
  ): Promise<ProjectCrawlAbsentPageCollection> {
    const pages = await this.prisma.crawlPageAbsence.findMany({
      where: { workspaceId, projectId, crawlId },
      include: {
        page: { select: { url: true } },
        previousSnapshot: {
          select: { inSitemap: true, crawledAt: true }
        }
      },
      orderBy: [{ detectedAt: "desc" }, { pageId: "asc" }],
      take: 1_000
    });
    return {
      crawlId,
      pages: pages.map((absence) => ({
        pageId: absence.pageId,
        url: absence.page.url,
        previousCrawlId: absence.previousCrawlId,
        previousSnapshotId: absence.previousSnapshotId,
        wasInSitemap: absence.previousSnapshot.inSitemap,
        lastSeenAt: absence.previousSnapshot.crawledAt.toISOString(),
        detectedAt: absence.detectedAt.toISOString()
      }))
    };
  }
}

function pageProjection(
  input: InternalPersistCrawlPageInput
) {
  if (input.purpose === "HTTP_STATUS_CHECK") {
    return {
      httpStatus: input.statusCode,
      crawledAt: new Date(input.crawledAt)
    } as const;
  }
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

function reusedPageInput(
  input: InternalReuseCrawlPageInput,
  source: Prisma.CrawlPageSnapshotGetPayload<{
    include: { issueOccurrences: true };
  }>
): InternalPersistCrawlPageInput {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    crawlId: input.crawlId,
    sequence: input.sequence,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    redirectChain: input.redirectChain,
    inSitemap: input.inSitemap,
    depth: input.depth,
    statusCode: source.statusCode,
    responseTimeMs: source.responseTimeMs,
    sizeBytes: source.sizeBytes,
    contentType: source.contentType,
    ...(source.title ? { title: source.title } : {}),
    ...(source.description
      ? { description: source.description }
      : {}),
    ...(source.h1 ? { h1: source.h1 } : {}),
    h1Count: source.h1Count,
    ...(source.canonicalUrl
      ? { canonicalUrl: source.canonicalUrl }
      : {}),
    ...(source.robots ? { robots: source.robots } : {}),
    ...(source.language ? { language: source.language } : {}),
    headings:
      source.headings as unknown as InternalPersistCrawlPageInput["headings"],
    hreflang:
      source.hreflang as unknown as InternalPersistCrawlPageInput["hreflang"],
    internalLinks:
      source.internalLinks as unknown as InternalPersistCrawlPageInput["internalLinks"],
    externalLinks:
      source.externalLinks as unknown as InternalPersistCrawlPageInput["externalLinks"],
    imageCount: source.imageCount,
    imagesMissingAlt: source.imagesMissingAlt,
    structuredDataTypes:
      source.structuredDataTypes as unknown as InternalPersistCrawlPageInput["structuredDataTypes"],
    wordCount: source.wordCount,
    contentHash: source.contentHash,
    ...(source.etag ? { etag: source.etag } : {}),
    ...(source.lastModified
      ? { lastModified: source.lastModified }
      : {}),
    indexability:
      source.indexability as InternalPersistCrawlPageInput["indexability"],
    issues: source.issueOccurrences.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      title: issue.title,
      details:
        issue.details as Readonly<
          Record<string, string | number | boolean>
        >
    })),
    crawledAt: input.crawledAt
  };
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

function storedUrlArray(value: Prisma.JsonValue): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 5_000 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.length < 1 ||
        item.length > 4_096
    )
  ) {
    throw new TypeError("Stored crawl link array is invalid");
  }
  return value.map((item) => normalizePageUrl(item as string).normalized);
}

function validatorLinksFitResponse(links: readonly string[]): boolean {
  let bytes = 2;
  for (const link of links) {
    bytes += Buffer.byteLength(JSON.stringify(link), "utf8") + 1;
    if (bytes > 3_500_000) return false;
  }
  return true;
}

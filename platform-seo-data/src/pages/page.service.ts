import { createHash } from "node:crypto";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  pageContentStatuses,
  type InternalChangeProjectPageStatusInput,
  type InternalCreateProjectPageInput,
  type InternalUpdateProjectPageInput,
  type PageContentStatus,
  type ProjectPageCollection,
  type ProjectPageListQuery,
  type ProjectPageSummary
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { normalizePageUrl, type NormalizedPageUrl } from "./page-url.js";

const CONTENT_STATUSES = new Set<string>(pageContentStatuses);
const PAGE_INCLUDE = {
  aliases: {
    orderBy: [{ firstSeenAt: "asc" as const }, { id: "asc" as const }]
  },
  sources: {
    orderBy: { source: "asc" as const }
  },
  _count: {
    select: {
      targetKeywords: { where: { status: "ACTIVE" as const } },
      primaryClusters: { where: { status: "ACTIVE" as const } }
    }
  }
} satisfies Prisma.PageInclude;

type PageAggregate = Prisma.PageGetPayload<{
  include: typeof PAGE_INCLUDE;
}>;

interface PageCursor {
  readonly version: 1;
  readonly filterHash: string;
  readonly updatedAt: string;
  readonly id: string;
}

@Injectable()
export class PageService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string,
    query: ProjectPageListQuery
  ): Promise<ProjectPageCollection> {
    const filterHash = pageFilterHash(query);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, filterHash)
      : undefined;
    const rows = await this.prisma.page.findMany({
      where: {
        workspaceId,
        projectId,
        status: query.lifecycleStatus ?? "ACTIVE",
        ...(query.pageType ? { pageType: query.pageType } : {}),
        ...(query.indexability
          ? { indexability: query.indexability }
          : {}),
        ...(query.search
          ? {
              OR: [
                {
                  normalizedUrl: {
                    contains: query.search,
                    mode: "insensitive"
                  }
                },
                {
                  title: {
                    contains: query.search,
                    mode: "insensitive"
                  }
                },
                {
                  h1: {
                    contains: query.search,
                    mode: "insensitive"
                  }
                }
              ]
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: new Date(cursor.updatedAt) } },
                {
                  updatedAt: new Date(cursor.updatedAt),
                  id: { lt: cursor.id }
                }
              ]
            }
          : {})
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      include: PAGE_INCLUDE
    });
    const hasNext = rows.length > query.limit;
    const visible = rows.slice(0, query.limit);
    const last = visible.at(-1);
    return {
      pages: visible.map(pageSummary),
      ...(hasNext && last
        ? {
            nextCursor: encodeCursor({
              version: 1,
              filterHash,
              updatedAt: last.updatedAt.toISOString(),
              id: last.id
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

  public async create(
    input: InternalCreateProjectPageInput
  ): Promise<ProjectPageSummary> {
    const identity = pageIdentity(input.url, input.aliases);
    const requestHash = pageRequestHash(input, identity);
    const existing = await this.findReceipt(input);
    if (existing) return replayReceipt(existing, requestHash);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const concurrent =
          await transaction.pageCreateReceipt.findUnique({
            where: receiptWhere(input)
          });
        if (concurrent) return replayReceipt(concurrent, requestHash);
        const created = await transaction.page.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            url: identity.canonical.original,
            normalizedUrl: identity.canonical.normalized,
            urlHash: identity.canonical.hash,
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
            ...(input.description
              ? { description: input.description }
              : {}),
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
                source: "MANUAL"
              }))
            },
            sources: {
              create: {
                source: "MANUAL"
              }
            }
          },
          include: PAGE_INCLUDE
        });
        const summary = pageSummary(created);
        await transaction.pageCreateReceipt.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            pageId: created.id,
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
        status: { not: "DELETED" }
      },
      include: PAGE_INCLUDE
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

function pageSummary(page: PageAggregate): ProjectPageSummary {
  const contentStatus =
    page.contentStatus && CONTENT_STATUSES.has(page.contentStatus)
      ? (page.contentStatus as PageContentStatus)
      : undefined;
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
    ...(page.httpStatus === null ? {} : { httpStatus: page.httpStatus }),
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

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  InternalCreateSemanticKeywordInput,
  InternalDeleteSemanticKeywordInput,
  InternalSemanticKeywordBulkInput,
  InternalUpdateSemanticKeywordInput,
  KeywordListQuery,
  SemanticKeywordBulkResult,
  SemanticKeywordIntent,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { normalizeKeywordText } from "./keyword-normalization.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface KeywordCursor {
  readonly version: 1;
  readonly createdAt: string;
  readonly id: string;
  readonly search: string;
}

const KEYWORD_INCLUDE = {
  memberships: {
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: {
      group: {
        select: { id: true, path: true, name: true }
      }
    }
  },
  tags: {
    orderBy: { createdAt: "asc" as const },
    take: 51,
    select: {
      tag: {
        select: { name: true }
      }
    }
  }
} satisfies Prisma.KeywordInclude;

type KeywordAggregate = Prisma.KeywordGetPayload<{
  include: typeof KEYWORD_INCLUDE;
}>;

@Injectable()
export class KeywordService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string,
    query: KeywordListQuery,
    requestId: string
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const search = normalizeKeywordText(query.search);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, search)
      : undefined;
    const baseWhere: Prisma.KeywordWhereInput = {
      workspaceId,
      projectId,
      status: "ACTIVE",
      ...(search
        ? {
            textNormalized: {
              contains: search
            }
          }
        : {})
    };
    const where: Prisma.KeywordWhereInput = {
      ...baseWhere,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              {
                createdAt: new Date(cursor.createdAt),
                id: { lt: cursor.id }
              }
            ]
          }
        : {})
    };
    const [rows, totalApprox] = await Promise.all([
      this.prisma.keyword.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        include: KEYWORD_INCLUDE
      }),
      cursor
        ? Promise.resolve(undefined)
        : this.prisma.keyword.count({ where: baseWhere })
    ]);
    const hasNext = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const pageIds = [
      ...new Set(
        pageRows.flatMap(({ targetPageId }) =>
          targetPageId ? [targetPageId] : []
        )
      )
    ];
    const keywordIds = pageRows.map(({ id }) => id);
    const [pages, activeTrackingAssignments] = await Promise.all([
      pageIds.length === 0
        ? Promise.resolve([])
        : this.prisma.page.findMany({
            where: {
              workspaceId,
              projectId,
              id: { in: pageIds },
              status: "ACTIVE"
            },
            select: { id: true, url: true }
          }),
      keywordIds.length === 0
        ? Promise.resolve([])
        : this.prisma.trackingContextKeywordAssignment.findMany({
            where: {
              workspaceId,
              projectId,
              keywordId: { in: keywordIds },
              removedAt: null,
              context: { status: "ACTIVE" }
            },
            select: { keywordId: true },
            distinct: ["keywordId"]
          })
    ]);
    const pageUrlById = new Map(pages.map(({ id, url }) => [id, url]));
    const trackedKeywordIds = new Set(
      activeTrackingAssignments.map(({ keywordId }) => keywordId)
    );
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) =>
        keywordItem(
          row,
          row.targetPageId
            ? pageUrlById.get(row.targetPageId)
            : undefined,
          trackedKeywordIds.has(row.id)
        )
      ),
      page: {
        hasNext,
        ...(totalApprox === undefined ? {} : { totalApprox }),
        ...(hasNext && last
          ? {
              nextCursor: encodeCursor({
                version: 1,
                createdAt: last.createdAt.toISOString(),
                id: last.id,
                search
              })
            }
          : {})
      },
      meta: { requestId }
    };
  }

  public async create(
    input: InternalCreateSemanticKeywordInput
  ): Promise<SemanticKeywordListItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (input.groupId) {
          await lockKeywordGroupTree(transaction, input.projectId);
        }
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          input.groupId
        );
        const pageId = input.targetUrl
          ? await resolvePage(
              transaction,
              input.workspaceId,
              input.projectId,
              input.targetUrl
            )
          : undefined;
        const tags = await resolveTags(
          transaction,
          input.workspaceId,
          input.projectId,
          input.tagNames
        );
        const normalized = normalizeRequiredKeyword(input.text);
        const created = await transaction.keyword.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            textOriginal: input.text,
            textNormalized: normalized,
            normalizedHash: sha256(normalized),
            language: input.language,
            priority: input.priority,
            isFavorite: input.isFavorite,
            ...(input.intent ? { intent: input.intent } : {}),
            ...(pageId ? { targetPageId: pageId } : {}),
            sourceMode: "MANUAL",
            createdBy: input.actorId,
            updatedBy: input.actorId
          }
        });
        if (input.groupId) {
          await transaction.keywordGroupMembership.create({
            data: {
              projectId: input.projectId,
              keywordId: created.id,
              groupId: input.groupId
            }
          });
        }
        if (tags.length > 0) {
          await transaction.keywordTag.createMany({
            data: tags.map((tag) => ({
              projectId: input.projectId,
              keywordId: created.id,
              tagId: tag.id
            }))
          });
        }
        return keywordItem(
          await requiredKeyword(
            transaction,
            input.workspaceId,
            input.projectId,
            created.id
          ),
          input.targetUrl,
          false
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateKeyword();
      throw error;
    }
  }

  public async update(
    keywordId: string,
    input: InternalUpdateSemanticKeywordInput
  ): Promise<SemanticKeywordListItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockKeyword(transaction, input.projectId, keywordId);
        if (input.groupId) {
          await lockKeywordGroupTree(transaction, input.projectId);
        }
        const current = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId
        );
        assertKeywordVersion(current.version, input.version);
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          input.groupId
        );
        const pageId =
          input.targetUrl === undefined
            ? undefined
            : input.targetUrl === null
              ? null
              : await resolvePage(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  input.targetUrl
                );
        const tags =
          input.tagNames === undefined
            ? undefined
            : await resolveTags(
                transaction,
                input.workspaceId,
                input.projectId,
                input.tagNames
              );
        const normalized =
          input.text === undefined
            ? undefined
            : normalizeRequiredKeyword(input.text);
        await transaction.keyword.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: keywordId
            }
          },
          data: {
            ...(input.text === undefined
              ? {}
              : {
                  textOriginal: input.text,
                  textNormalized: normalized!,
                  normalizedHash: sha256(normalized!)
                }),
            ...(input.language === undefined
              ? {}
              : { language: input.language }),
            ...(input.priority === undefined
              ? {}
              : { priority: input.priority }),
            ...(input.isFavorite === undefined
              ? {}
              : { isFavorite: input.isFavorite }),
            ...(input.intent === undefined ? {} : { intent: input.intent }),
            ...(pageId === undefined ? {} : { targetPageId: pageId }),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        if (input.groupId !== undefined) {
          await transaction.keywordGroupMembership.deleteMany({
            where: { projectId: input.projectId, keywordId }
          });
          if (input.groupId) {
            await transaction.keywordGroupMembership.create({
              data: {
                projectId: input.projectId,
                keywordId,
                groupId: input.groupId
              }
            });
          }
        }
        if (tags !== undefined) {
          await transaction.keywordTag.deleteMany({
            where: { projectId: input.projectId, keywordId }
          });
          if (tags.length > 0) {
            await transaction.keywordTag.createMany({
              data: tags.map((tag) => ({
                projectId: input.projectId,
                keywordId,
                tagId: tag.id
              }))
            });
          }
        }
        const result = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId
        );
        const targetUrl =
          input.targetUrl === undefined
            ? await targetUrlFor(
                transaction,
                input.workspaceId,
                input.projectId,
                result.targetPageId
              )
            : (input.targetUrl ?? undefined);
        return keywordItem(
          result,
          targetUrl,
          await isKeywordTracked(
            transaction,
            input.workspaceId,
            input.projectId,
            keywordId
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateKeyword();
      throw error;
    }
  }

  public async delete(
    keywordId: string,
    input: InternalDeleteSemanticKeywordInput
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockKeyword(transaction, input.projectId, keywordId);
      const current = await requiredKeyword(
        transaction,
        input.workspaceId,
        input.projectId,
        keywordId
      );
      assertKeywordVersion(current.version, input.version);
      await transaction.keyword.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: keywordId
          }
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
    });
  }

  public async bulkUpdate(
    input: InternalSemanticKeywordBulkInput
  ): Promise<SemanticKeywordBulkResult> {
    const updatedItems: SemanticKeywordListItem[] = [];
    const conflictedIds: string[] = [];
    const skippedIds: string[] = [];
    const failedIds: string[] = [];
    for (const item of input.items) {
      try {
        updatedItems.push(
          await this.update(item.id, {
            ...input.patch,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            version: item.version
          })
        );
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const status = error.getStatus();
        if (status === HttpStatus.PRECONDITION_FAILED) {
          conflictedIds.push(item.id);
        } else if (status === HttpStatus.NOT_FOUND) {
          skippedIds.push(item.id);
        } else if (
          status === HttpStatus.BAD_REQUEST ||
          status === HttpStatus.CONFLICT
        ) {
          failedIds.push(item.id);
        } else {
          throw error;
        }
      }
    }
    return {
      selected: input.items.length,
      changed: updatedItems.length,
      skipped: skippedIds.length,
      failed: failedIds.length,
      conflicted: conflictedIds.length,
      updatedItems,
      conflictedIds,
      skippedIds,
      failedIds
    };
  }
}

async function isKeywordTracked(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  keywordId: string
): Promise<boolean> {
  const assignment =
    await transaction.trackingContextKeywordAssignment.findFirst({
      where: {
        workspaceId,
        projectId,
        keywordId,
        removedAt: null,
        context: { status: "ACTIVE" }
      },
      select: { id: true }
    });
  return Boolean(assignment);
}

async function requiredKeyword(
  transaction: Prisma.TransactionClient | PrismaService,
  workspaceId: string,
  projectId: string,
  keywordId: string
): Promise<KeywordAggregate> {
  const keyword = await transaction.keyword.findUnique({
    where: {
      workspaceId_projectId_id: { workspaceId, projectId, id: keywordId }
    },
    include: KEYWORD_INCLUDE
  });
  if (!keyword || keyword.status !== "ACTIVE") {
    throw new HttpException(
      { code: "NOT_FOUND", message: "Semantic keyword not found" },
      HttpStatus.NOT_FOUND
    );
  }
  return keyword;
}

async function assertGroup(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  groupId: string | null | undefined
): Promise<void> {
  if (!groupId) return;
  const group = await transaction.keywordGroup.findFirst({
    where: { id: groupId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true }
  });
  if (!group) {
    throw new BadRequestException("Keyword group does not belong to project");
  }
}

async function resolveTags(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  names: readonly string[]
): Promise<readonly { readonly id: string }[]> {
  const result: { id: string }[] = [];
  for (const name of names) {
    const normalizedName = normalizeTagName(name);
    const tag = await transaction.tag.upsert({
      where: {
        projectId_normalizedName: { projectId, normalizedName }
      },
      create: {
        workspaceId,
        projectId,
        name,
        normalizedName
      },
      update: {
        name,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    result.push(tag);
  }
  return result;
}

async function resolvePage(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  source: string
): Promise<string> {
  const url = normalizeTargetUrl(source);
  const urlHash = sha256(url);
  const page = await transaction.page.upsert({
    where: { projectId_urlHash: { projectId, urlHash } },
    create: {
      workspaceId,
      projectId,
      url,
      normalizedUrl: url,
      urlHash
    },
    update: {
      url,
      normalizedUrl: url,
      status: "ACTIVE"
    },
    select: { id: true }
  });
  return page.id;
}

async function targetUrlFor(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  pageId: string | null
): Promise<string | undefined> {
  if (!pageId) return undefined;
  const page = await transaction.page.findFirst({
    where: {
      id: pageId,
      workspaceId,
      projectId,
      status: "ACTIVE"
    },
    select: { url: true }
  });
  return page?.url;
}

async function lockKeyword(
  transaction: Prisma.TransactionClient,
  projectId: string,
  keywordId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "keywords"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${keywordId}::uuid
    FOR UPDATE
  `;
}

async function lockKeywordGroupTree(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-group-tree:${projectId}`}, 0)
    )
  `;
}

function keywordItem(
  row: KeywordAggregate,
  targetUrl: string | undefined,
  isTracked: boolean
): SemanticKeywordListItem {
  const tags = row.tags.slice(0, 50).map(({ tag }) => tag.name);
  const group = row.memberships[0]?.group;
  return {
    id: row.id,
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    isTracked,
    ...(row.intent
      ? {
          intent: row.intent as SemanticKeywordIntent
        }
      : {}),
    ...(group ? { groupId: group.id, groupPath: group.path ?? group.name } : {}),
    ...(row.targetPageId ? { targetPageId: row.targetPageId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tags,
    tagsTruncated: row.tags.length > 50,
    sourceMode: row.sourceMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version
  };
}

function assertKeywordVersion(current: number, expected: number): void {
  if (current === expected) return;
  throw new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic keyword version conflict",
      currentVersion: current
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function duplicateKeyword(): HttpException {
  return new HttpException(
    {
      code: "DUPLICATE",
      message: "This keyword already exists in the project"
    },
    HttpStatus.CONFLICT
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

function normalizeRequiredKeyword(value: string): string {
  const normalized = normalizeKeywordText(value);
  if (!normalized) throw new BadRequestException("Keyword text is empty");
  return normalized;
}

function normalizeTagName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function normalizeTargetUrl(value: string): string {
  const url = new URL(value);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  return url.toString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeCursor(value: KeywordCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string, search: string): KeywordCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw invalidCursor();
  }
  const cursor = parsed as Readonly<Record<string, unknown>>;
  const createdAt =
    typeof cursor.createdAt === "string"
      ? new Date(cursor.createdAt)
      : new Date(Number.NaN);
  if (
    cursor.version !== 1 ||
    typeof cursor.id !== "string" ||
    !UUID_PATTERN.test(cursor.id) ||
    typeof cursor.search !== "string" ||
    cursor.search !== search ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw invalidCursor();
  }
  return {
    version: 1,
    createdAt: createdAt.toISOString(),
    id: cursor.id,
    search: cursor.search
  };
}

function invalidCursor(): BadRequestException {
  return new BadRequestException(
    "Keyword cursor is invalid for the current query"
  );
}

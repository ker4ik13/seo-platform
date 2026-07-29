import { Buffer } from "node:buffer";
import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  ApiCollectionResponse,
  KeywordListQuery,
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
        include: {
          memberships: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              group: {
                select: { path: true, name: true }
              }
            }
          },
          tags: {
            orderBy: { createdAt: "asc" },
            take: 11,
            select: {
              tag: {
                select: { name: true }
              }
            }
          }
        }
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
      data: pageRows.map((row) => {
        const tags = row.tags.slice(0, 10).map(({ tag }) => tag.name);
        const group = row.memberships[0]?.group;
        const targetUrl = row.targetPageId
          ? pageUrlById.get(row.targetPageId)
          : undefined;
        return {
          id: row.id,
          textOriginal: row.textOriginal,
          textNormalized: row.textNormalized,
          language: row.language,
          priority: row.priority,
          isTracked: trackedKeywordIds.has(row.id),
          ...(group ? { groupPath: group.path ?? group.name } : {}),
          ...(targetUrl ? { targetUrl } : {}),
          tags,
          tagsTruncated: row.tags.length > 10,
          sourceMode: row.sourceMode,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          version: row.version
        };
      }),
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

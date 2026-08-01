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
  InternalSemanticKeywordCleaningInput,
  InternalUpdateSemanticKeywordInput,
  KeywordListQuery,
  SemanticKeywordBulkResult,
  SemanticKeywordCleaningPreview,
  SemanticKeywordCleaningPreviewChange,
  SemanticKeywordCleaningResult,
  SemanticKeywordIntent,
  SemanticKeywordListItem,
  SemanticKeywordSort
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertStoredKeywordCapacity,
  lockStoredKeywordCapacity
} from "../internal/semantic-capacity.js";
import {
  lockSemanticKeywordWrites,
  SemanticVersionService,
  type SemanticKeywordVersionState,
  type SemanticVersionIdentity
} from "../semantic-versions/semantic-version.service.js";
import { normalizeKeywordText } from "./keyword-normalization.js";
import { cleanKeywordText } from "./keyword-cleaning.js";
import { normalizePageUrl } from "../pages/page-url.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface KeywordCursor {
  readonly version: 2;
  readonly id: string;
  readonly sort: SemanticKeywordSort;
  readonly sortValue: string | number;
  readonly filterHash: string;
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
    select: {
      tag: {
        select: { id: true, name: true }
      }
    }
  },
  typedCustomValues: {
    where: { column: { status: "ACTIVE" as const } },
    orderBy: { columnId: "asc" as const },
    take: 500,
    include: { column: { select: { type: true } } }
  }
} satisfies Prisma.KeywordInclude;

type KeywordAggregate = Prisma.KeywordGetPayload<{
  include: typeof KEYWORD_INCLUDE;
}>;

@Injectable()
export class KeywordService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly semanticVersions: SemanticVersionService
  ) {}

  public async list(
    workspaceId: string,
    projectId: string,
    query: KeywordListQuery,
    requestId: string
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const search = normalizeKeywordText(query.search);
    const sort = query.sort ?? "CREATED_DESC";
    const filterHash = keywordFilterHash(query, search);
    const cursor = query.cursor
      ? decodeCursor(query.cursor, sort, filterHash)
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
        : {}),
      ...(query.intent ? { intent: query.intent } : {}),
      ...(query.isFavorite === undefined
        ? {}
        : { isFavorite: query.isFavorite }),
      ...(query.priorityMin === undefined &&
      query.priorityMax === undefined
        ? {}
        : {
            priority: {
              ...(query.priorityMin === undefined
                ? {}
                : { gte: query.priorityMin }),
              ...(query.priorityMax === undefined
                ? {}
                : { lte: query.priorityMax })
            }
          }),
      ...(query.groupId
        ? {
            memberships: {
              some: { projectId, groupId: query.groupId }
            }
          }
        : {}),
      ...(query.clusterId ? { clusterId: query.clusterId } : {}),
      ...(query.isTracked === undefined
        ? {}
        : {
            trackingAssignments: query.isTracked
              ? {
                  some: {
                    workspaceId,
                    projectId,
                    removedAt: null,
                    context: { status: "ACTIVE" }
                  }
                }
              : {
                  none: {
                    workspaceId,
                    projectId,
                    removedAt: null,
                    context: { status: "ACTIVE" }
                  }
                }
          })
    };
    const where: Prisma.KeywordWhereInput = {
      ...baseWhere,
      ...(cursor ? cursorWhere(cursor) : {})
    };
    const [rows, totalApprox] = await Promise.all([
      this.prisma.keyword.findMany({
        where,
        orderBy: keywordOrderBy(sort),
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
    const clusterIds = [
      ...new Set(
        pageRows.flatMap(({ clusterId }) => (clusterId ? [clusterId] : []))
      )
    ];
    const [pages, activeTrackingAssignments, clusters] = await Promise.all([
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
          }),
      clusterIds.length === 0
        ? Promise.resolve([])
        : this.prisma.cluster.findMany({
            where: {
              workspaceId,
              projectId,
              id: { in: clusterIds },
              status: "ACTIVE"
            },
            select: { id: true, name: true }
          })
    ]);
    const pageUrlById = new Map(pages.map(({ id, url }) => [id, url]));
    const trackedKeywordIds = new Set(
      activeTrackingAssignments.map(({ keywordId }) => keywordId)
    );
    const clusterNameById = new Map(
      clusters.map(({ id, name }) => [id, name])
    );
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) =>
        keywordItem(
          row,
          row.targetPageId
            ? pageUrlById.get(row.targetPageId)
            : undefined,
          trackedKeywordIds.has(row.id),
          row.clusterId ? clusterNameById.get(row.clusterId) : undefined
        )
      ),
      page: {
        hasNext,
        ...(totalApprox === undefined ? {} : { totalApprox }),
        ...(hasNext && last
          ? {
              nextCursor: encodeCursor({
                version: 2,
                id: last.id,
                sort,
                sortValue: cursorValue(last, sort),
                filterHash
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
        await lockStoredKeywordCapacity(
          transaction,
          input.workspaceId
        );
        await lockSemanticKeywordWrites(transaction, input.projectId);
        await assertStoredKeywordCapacity(
          transaction,
          input.workspaceId,
          input.projectId,
          1n,
          input.entitlement
        );
        if (input.groupId) {
          await lockKeywordGroupTree(transaction, input.projectId);
        }
        if (input.clusterId) {
          await lockSemanticClusterSet(transaction, input.projectId);
        }
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          input.groupId
        );
        await assertCluster(
          transaction,
          input.workspaceId,
          input.projectId,
          input.clusterId
        );
        const pageId = input.targetUrl
          ? await resolvePage(
              transaction,
              input.workspaceId,
              input.projectId,
              input.actorId,
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
            ...(input.clusterId ? { clusterId: input.clusterId } : {}),
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
        const result = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          created.id
        );
        await this.semanticVersions.createWithKeywordChange(
          transaction,
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            reason: "KEYWORD_CREATE",
            summary: "Добавлен поисковый запрос"
          },
          {
            entityId: result.id,
            operation: "CREATE",
            beforeState: null,
            afterState: keywordVersionState(result),
            beforeVersion: null,
            afterVersion: result.version
          }
        );
        return keywordItem(
          result,
          input.targetUrl,
          false,
          await clusterNameFor(
            transaction,
            input.workspaceId,
            input.projectId,
            result.clusterId
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateKeyword();
      throw error;
    }
  }

  public async update(
    keywordId: string,
    input: InternalUpdateSemanticKeywordInput,
    semanticVersion?: SemanticVersionIdentity
  ): Promise<SemanticKeywordListItem> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockSemanticKeywordWrites(transaction, input.projectId);
        await lockKeyword(transaction, input.projectId, keywordId);
        if (input.groupId) {
          await lockKeywordGroupTree(transaction, input.projectId);
        }
        if (input.clusterId !== undefined) {
          await lockSemanticClusterSet(transaction, input.projectId);
        }
        const current = await requiredKeyword(
          transaction,
          input.workspaceId,
          input.projectId,
          keywordId
        );
        const beforeState = keywordVersionState(current);
        assertKeywordVersion(current.version, input.version);
        await assertGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          input.groupId
        );
        await assertCluster(
          transaction,
          input.workspaceId,
          input.projectId,
          input.clusterId
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
                  input.actorId,
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
            ...(input.clusterId === undefined
              ? {}
              : { clusterId: input.clusterId }),
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
        const change = {
          entityId: result.id,
          operation: "UPDATE" as const,
          beforeState,
          afterState: keywordVersionState(result),
          beforeVersion: current.version,
          afterVersion: result.version
        };
        if (semanticVersion) {
          await this.semanticVersions.appendBulkKeywordChange(
            transaction,
            semanticVersion,
            change
          );
        } else {
          await this.semanticVersions.createWithKeywordChange(
            transaction,
            {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              actorId: input.actorId,
              reason: "KEYWORD_UPDATE",
              summary: "Изменён поисковый запрос"
            },
            change
          );
        }
        return keywordItem(
          result,
          targetUrl,
          await isKeywordTracked(
            transaction,
            input.workspaceId,
            input.projectId,
            keywordId
          ),
          await clusterNameFor(
            transaction,
            input.workspaceId,
            input.projectId,
            result.clusterId
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
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await lockKeyword(transaction, input.projectId, keywordId);
      const current = await requiredKeyword(
        transaction,
        input.workspaceId,
        input.projectId,
        keywordId
      );
      const beforeState = keywordVersionState(current);
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
      await this.semanticVersions.createWithKeywordChange(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "KEYWORD_DELETE",
          summary: "Удалён поисковый запрос"
        },
        {
          entityId: current.id,
          operation: "DELETE",
          beforeState,
          afterState: { ...beforeState, status: "DELETED" },
          beforeVersion: current.version,
          afterVersion: current.version + 1
        }
      );
    });
  }

  public async bulkUpdate(
    input: InternalSemanticKeywordBulkInput
  ): Promise<SemanticKeywordBulkResult> {
    const semanticVersion =
      await this.semanticVersions.createOpenBulkVersion({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        reason: "BULK_UPDATE",
        summary: `Массовое изменение ${input.items.length} запросов`
      });
    const updatedItems: SemanticKeywordListItem[] = [];
    const conflictedIds: string[] = [];
    const skippedIds: string[] = [];
    const failedIds: string[] = [];
    try {
      for (const item of input.items) {
        try {
          updatedItems.push(
            await this.update(
              item.id,
              {
                ...input.patch,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                version: item.version
              },
              semanticVersion
            )
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
    } catch (error) {
      await this.semanticVersions.finalizeBulkVersion(semanticVersion);
      throw error;
    }
    await this.semanticVersions.finalizeBulkVersion(semanticVersion);
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

  public async previewCleaning(
    input: InternalSemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningPreview> {
    const rows = await this.prisma.keyword.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        id: { in: input.items.map(({ id }) => id) }
      },
      select: {
        id: true,
        textOriginal: true,
        language: true,
        version: true
      }
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const candidates: CleaningCandidate[] = input.items.map((item) => {
      const row = byId.get(item.id);
      if (!row) {
        return {
          keywordId: item.id,
          state: "UNAVAILABLE",
          expectedVersion: item.version
        };
      }
      const afterText = cleanKeywordText(row.textOriginal, input.rules);
      const change = {
        keywordId: item.id,
        expectedVersion: item.version,
        currentVersion: row.version,
        beforeText: row.textOriginal,
        afterText
      } as const;
      if (row.version !== item.version) {
        return { ...change, state: "CONFLICTED" };
      }
      const normalized = normalizeKeywordText(afterText);
      if (!normalized || Buffer.byteLength(afterText, "utf8") > 2_000) {
        return { ...change, state: "INVALID" };
      }
      if (afterText === row.textOriginal) {
        return { ...change, state: "UNCHANGED" };
      }
      return {
        ...change,
        state: "APPLICABLE",
        language: row.language,
        normalizedHash: sha256(normalized)
      };
    });
    const applicable = candidates.filter(
      (candidate): candidate is ApplicableCleaningCandidate =>
        candidate.state === "APPLICABLE"
    );
    const occupants = applicable.length === 0
      ? []
      : await this.prisma.keyword.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            OR: applicable.map(({ language, normalizedHash }) => ({
              language,
              normalizedHash
            }))
          },
          select: { id: true, language: true, normalizedHash: true }
        });
    const targetCounts = new Map<string, number>();
    for (const candidate of applicable) {
      const key = cleaningKey(candidate.language, candidate.normalizedHash);
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }
    const changes = candidates.map((candidate) => {
      if (!isApplicableCleaningCandidate(candidate)) {
        return publicCleaningChange(candidate);
      }
      const key = cleaningKey(candidate.language, candidate.normalizedHash);
      const duplicate =
        (targetCounts.get(key) ?? 0) > 1 ||
        occupants.some(
          (occupant) =>
            occupant.id !== candidate.keywordId &&
            cleaningKey(occupant.language, occupant.normalizedHash) === key
        );
      return publicCleaningChange(
        duplicate ? { ...candidate, state: "DUPLICATE" } : candidate
      );
    });
    return cleaningPreview(changes);
  }

  public async clean(
    input: InternalSemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningResult> {
    const preview = await this.previewCleaning(input);
    const updatedItems: SemanticKeywordListItem[] = [];
    const unchangedIds: string[] = [];
    const conflictedIds: string[] = [];
    const failedIds: string[] = [];
    const semanticVersion = preview.applicable > 0
      ? await this.semanticVersions.createOpenBulkVersion({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLEANING",
          summary: `Очистка ${input.items.length} запросов`
        })
      : undefined;
    try {
      for (const change of preview.changes) {
        if (change.state === "UNCHANGED") {
          unchangedIds.push(change.keywordId);
          continue;
        }
        if (change.state === "CONFLICTED") {
          conflictedIds.push(change.keywordId);
          continue;
        }
        if (change.state !== "APPLICABLE" || !semanticVersion) {
          failedIds.push(change.keywordId);
          continue;
        }
        try {
          updatedItems.push(
            await this.update(
              change.keywordId,
              {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                version: change.expectedVersion,
                text: change.afterText!
              },
              semanticVersion
            )
          );
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          if (error.getStatus() === HttpStatus.PRECONDITION_FAILED) {
            conflictedIds.push(change.keywordId);
          } else if (
            error.getStatus() === HttpStatus.NOT_FOUND ||
            error.getStatus() === HttpStatus.BAD_REQUEST ||
            error.getStatus() === HttpStatus.CONFLICT
          ) {
            failedIds.push(change.keywordId);
          } else {
            throw error;
          }
        }
      }
    } finally {
      if (semanticVersion) {
        await this.semanticVersions.finalizeBulkVersion(semanticVersion);
      }
    }
    return {
      selected: input.items.length,
      changed: updatedItems.length,
      unchanged: unchangedIds.length,
      conflicted: conflictedIds.length,
      failed: failedIds.length,
      updatedItems,
      unchangedIds,
      conflictedIds,
      failedIds
    };
  }
}

type CleaningCandidate = SemanticKeywordCleaningPreviewChange &
  Readonly<{ language?: string; normalizedHash?: string }>;

type ApplicableCleaningCandidate = CleaningCandidate &
  Readonly<{
    state: "APPLICABLE";
    language: string;
    normalizedHash: string;
  }>;

function isApplicableCleaningCandidate(
  candidate: CleaningCandidate
): candidate is ApplicableCleaningCandidate {
  return (
    candidate.state === "APPLICABLE" &&
    candidate.language !== undefined &&
    candidate.normalizedHash !== undefined
  );
}

function publicCleaningChange(
  candidate: CleaningCandidate
): SemanticKeywordCleaningPreviewChange {
  return {
    keywordId: candidate.keywordId,
    state: candidate.state,
    expectedVersion: candidate.expectedVersion,
    ...(candidate.currentVersion === undefined
      ? {}
      : { currentVersion: candidate.currentVersion }),
    ...(candidate.beforeText === undefined
      ? {}
      : { beforeText: candidate.beforeText }),
    ...(candidate.afterText === undefined
      ? {}
      : { afterText: candidate.afterText })
  };
}

function cleaningPreview(
  changes: readonly SemanticKeywordCleaningPreviewChange[]
): SemanticKeywordCleaningPreview {
  return {
    selected: changes.length,
    applicable: changes.filter(({ state }) => state === "APPLICABLE").length,
    unchanged: changes.filter(({ state }) => state === "UNCHANGED").length,
    conflicted: changes.filter(({ state }) => state === "CONFLICTED").length,
    failed: changes.filter(({ state }) =>
      ["UNAVAILABLE", "DUPLICATE", "INVALID"].includes(state)
    ).length,
    changes
  };
}

function cleaningKey(language: string, normalizedHash: string): string {
  return `${language}\u0000${normalizedHash}`;
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

async function assertCluster(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string | null | undefined
): Promise<void> {
  if (!clusterId) return;
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true }
  });
  if (!cluster) {
    throw new BadRequestException("Semantic cluster does not belong to project");
  }
}

async function clusterNameFor(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string | null
): Promise<string | undefined> {
  if (!clusterId) return undefined;
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" },
    select: { name: true }
  });
  return cluster?.name;
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
  actorId: string,
  source: string
): Promise<string> {
  const normalized = normalizePageUrl(source, "targetUrl");
  const existing = await transaction.page.findUnique({
    where: {
      projectId_urlHash: { projectId, urlHash: normalized.hash }
    },
    select: { id: true, workspaceId: true, status: true }
  });
  if (
    existing &&
    (existing.workspaceId !== workspaceId || existing.status !== "ACTIVE")
  ) {
    throw new HttpException(
      {
        code: "RESOURCE_STATE_CONFLICT",
        message: "Target page is not an active page in this workspace"
      },
      HttpStatus.CONFLICT
    );
  }
  const page = await transaction.page.upsert({
    where: {
      projectId_urlHash: { projectId, urlHash: normalized.hash }
    },
    create: {
      workspaceId,
      projectId,
      url: normalized.original,
      normalizedUrl: normalized.normalized,
      urlHash: normalized.hash,
      createdBy: actorId,
      updatedBy: actorId
    },
    update: {
      // Page identity and lifecycle are owned by the Page Map. Assigning the
      // same URL to another keyword must not create an invisible page edit.
    },
    select: { id: true }
  });
  await transaction.pageSource.upsert({
    where: {
      pageId_source: { pageId: page.id, source: "MANUAL" }
    },
    create: {
      workspaceId,
      projectId,
      pageId: page.id,
      source: "MANUAL"
    },
    update: { lastSeenAt: new Date() }
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

async function lockSemanticClusterSet(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-cluster-set:${projectId}`}, 0)
    )
  `;
}

function keywordItem(
  row: KeywordAggregate,
  targetUrl: string | undefined,
  isTracked: boolean,
  clusterName?: string
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
    ...(row.clusterId ? { clusterId: row.clusterId } : {}),
    ...(clusterName ? { clusterName } : {}),
    ...(row.targetPageId ? { targetPageId: row.targetPageId } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    tags,
    tagsTruncated: row.tags.length > 50,
    customValues: (row.typedCustomValues ?? []).map(keywordCustomValue),
    sourceMode: row.sourceMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version
  };
}

function keywordVersionState(
  row: KeywordAggregate
): SemanticKeywordVersionState {
  return {
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    normalizedHash: row.normalizedHash,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    intent: row.intent,
    status: row.status === "DELETED" ? "DELETED" : "ACTIVE",
    clusterId: row.clusterId,
    targetPageId: row.targetPageId,
    groupId: row.memberships[0]?.group.id ?? null,
    tagIds: row.tags.map(({ tag }) => tag.id)
  };
}

function keywordCustomValue(
  row: KeywordAggregate["typedCustomValues"][number]
) {
  return {
    columnId: row.columnId,
    value: keywordCustomValueData(row),
    version: row.version,
    updatedAt: row.updatedAt.toISOString()
  };
}

function keywordCustomValueData(
  row: KeywordAggregate["typedCustomValues"][number]
) {
  switch (row.column.type) {
    case "TEXT":
    case "LONG_TEXT":
    case "SELECT":
    case "STATUS":
    case "URL":
      return row.textValue!;
    case "INTEGER":
      return Number(row.integerValue!);
    case "DECIMAL":
      return row.decimalValue!.toString();
    case "BOOLEAN":
      return row.booleanValue!;
    case "DATE":
      return row.dateValue!.toISOString().slice(0, 10);
    case "DATETIME":
      return row.datetimeValue!.toISOString();
    case "MULTI_SELECT":
      return row.stringArrayValue;
    case "USER":
      return row.userId!;
  }
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeCursor(value: KeywordCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  sort: SemanticKeywordSort,
  filterHash: string
): KeywordCursor {
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
  if (
    cursor.version !== 2 ||
    typeof cursor.id !== "string" ||
    !UUID_PATTERN.test(cursor.id) ||
    cursor.sort !== sort ||
    cursor.filterHash !== filterHash ||
    (typeof cursor.sortValue !== "string" &&
      typeof cursor.sortValue !== "number")
  ) {
    throw invalidCursor();
  }
  return {
    version: 2,
    id: cursor.id,
    sort,
    sortValue: cursor.sortValue,
    filterHash
  };
}

function keywordFilterHash(
  query: KeywordListQuery,
  normalizedSearch: string
): string {
  return sha256(
    JSON.stringify({
      search: normalizedSearch,
      intent: query.intent ?? null,
      groupId: query.groupId ?? null,
      clusterId: query.clusterId ?? null,
      isFavorite: query.isFavorite ?? null,
      isTracked: query.isTracked ?? null,
      priorityMin: query.priorityMin ?? null,
      priorityMax: query.priorityMax ?? null
    })
  );
}

function keywordOrderBy(
  sort: SemanticKeywordSort
): Prisma.KeywordOrderByWithRelationInput[] {
  switch (sort) {
    case "CREATED_ASC":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "UPDATED_DESC":
      return [{ updatedAt: "desc" }, { id: "desc" }];
    case "TEXT_ASC":
      return [{ textNormalized: "asc" }, { id: "asc" }];
    case "PRIORITY_DESC":
      return [{ priority: "desc" }, { id: "desc" }];
    case "CREATED_DESC":
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

function cursorValue(
  row: KeywordAggregate,
  sort: SemanticKeywordSort
): string | number {
  switch (sort) {
    case "CREATED_ASC":
    case "CREATED_DESC":
      return row.createdAt.toISOString();
    case "UPDATED_DESC":
      return row.updatedAt.toISOString();
    case "TEXT_ASC":
      return row.textNormalized;
    case "PRIORITY_DESC":
      return row.priority;
  }
}

function cursorWhere(cursor: KeywordCursor): Prisma.KeywordWhereInput {
  const idDirection =
    cursor.sort === "CREATED_ASC" || cursor.sort === "TEXT_ASC"
      ? "gt"
      : "lt";
  const comparison =
    cursor.sort === "CREATED_ASC" || cursor.sort === "TEXT_ASC"
      ? "gt"
      : "lt";
  const field =
    cursor.sort === "UPDATED_DESC"
      ? "updatedAt"
      : cursor.sort === "TEXT_ASC"
        ? "textNormalized"
        : cursor.sort === "PRIORITY_DESC"
          ? "priority"
          : "createdAt";
  const value =
    field === "priority"
      ? requiredCursorNumber(cursor.sortValue)
      : field === "textNormalized"
        ? requiredCursorString(cursor.sortValue)
        : requiredCursorDate(cursor.sortValue);
  return {
    OR: [
      { [field]: { [comparison]: value } },
      {
        [field]: value,
        id: { [idDirection]: cursor.id }
      }
    ]
  };
}

function requiredCursorNumber(value: string | number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidCursor();
  }
  return value;
}

function requiredCursorString(value: string | number): string {
  if (typeof value !== "string") throw invalidCursor();
  return value;
}

function requiredCursorDate(value: string | number): Date {
  if (typeof value !== "string") throw invalidCursor();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidCursor();
  return date;
}

function invalidCursor(): BadRequestException {
  return new BadRequestException(
    "Keyword cursor is invalid for the current query"
  );
}

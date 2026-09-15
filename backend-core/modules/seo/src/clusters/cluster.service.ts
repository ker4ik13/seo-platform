import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  InternalCreateSemanticClusterInput,
  InternalDeleteSemanticClusterInput,
  InternalSemanticClusterMergeInput,
  InternalSemanticClusterSplitInput,
  InternalUpdateSemanticClusterInput,
  InternalSemanticClusterPageBulkInput,
  SemanticCluster,
  SemanticClusterMergePreview,
  SemanticClusterMergeResult,
  SemanticClusterSplitPreview,
  SemanticClusterSplitResult,
  SemanticClusterPageBulkPreview,
  SemanticClusterPageBulkPreviewChange,
  SemanticClusterPageBulkResult,
  SemanticClusterMethod,
  SemanticClusterPageSource
} from "@seo-platform/contracts";
import {
  semanticClusterMethods,
  semanticClusterPageSources
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  lockSemanticKeywordWrites,
  SemanticVersionService,
  type SemanticClusterChange,
  type SemanticClusterVersionState,
  type SemanticKeywordChange,
  type SemanticKeywordVersionState
} from "../semantic-versions/semantic-version.service.js";

const SYNCHRONOUS_MERGE_KEYWORD_LIMIT = 450;
const SYNCHRONOUS_SPLIT_KEYWORD_LIMIT = 450;

const CLUSTER_INCLUDE = {
  primaryPage: {
    select: {
      id: true,
      url: true,
      normalizedUrl: true,
      pageType: true,
      indexability: true,
      status: true
    }
  }
} satisfies Prisma.ClusterInclude;

type ClusterRow = Prisma.ClusterGetPayload<{
  include: typeof CLUSTER_INCLUDE;
}>;

const MERGE_KEYWORD_INCLUDE = {
  memberships: {
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: { group: { select: { id: true } } }
  },
  tags: {
    orderBy: { createdAt: "asc" as const },
    select: { tag: { select: { id: true } } }
  }
} satisfies Prisma.KeywordInclude;

type MergeKeywordRow = Prisma.KeywordGetPayload<{
  include: typeof MERGE_KEYWORD_INCLUDE;
}>;

interface KeywordPageStats {
  keywordCount: number;
  mappedKeywordCount: number;
  unmappedKeywordCount: number;
  pageIds: Set<string>;
}

const PAGE_MAPPING_SOURCES = new Set<string>(semanticClusterPageSources);

@Injectable()
export class ClusterService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly semanticVersions: SemanticVersionService
  ) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticCluster[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.cluster.findMany({
        where: { workspaceId, projectId, status: "ACTIVE" },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 2_000,
        include: CLUSTER_INCLUDE
      }),
      this.prisma.keyword.groupBy({
        by: ["clusterId", "targetPageId"],
        where: {
          workspaceId,
          projectId,
          status: "ACTIVE",
          clusterId: { not: null }
        },
        _count: { _all: true }
      })
    ]);
    const stats = keywordPageStats(counts);
    return rows.map((row) => clusterItem(row, stats.get(row.id)));
  }

  public async create(
    input: InternalCreateSemanticClusterInput
  ): Promise<SemanticCluster> {
    return this.prisma.$transaction(async (transaction) => {
      await lockClusterSet(transaction, input.projectId);
      await assertUniqueName(
        transaction,
        input.workspaceId,
        input.projectId,
        input.name
      );
      if (input.primaryPageId) {
        await assertPrimaryPage(
          transaction,
          input.workspaceId,
          input.projectId,
          input.primaryPageId
        );
      }
      const row = await transaction.cluster.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name: input.name,
          method: "MANUAL",
          evidence: { source: "MANUAL", actorId: input.actorId },
          isLocked: input.isLocked ?? false,
          excludeFromReclustering: input.excludeFromReclustering ?? false,
          ...(input.primaryPageId
            ? {
                primaryPageId: input.primaryPageId,
                pageMappingSource: input.pageMappingSource ?? "MANUAL",
                ...(input.pageMappingConfidence === undefined
                  ? {}
                  : { pageMappingConfidence: input.pageMappingConfidence }),
                ...(input.pageMappingRationale
                  ? { pageMappingRationale: input.pageMappingRationale }
                  : {})
              }
            : {})
        },
        include: CLUSTER_INCLUDE
      });
      await this.semanticVersions.createWithClusterChange(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLUSTER_CREATE",
          summary: `Создан кластер «${input.name}»`
        },
        {
          entityId: row.id,
          operation: "CREATE",
          beforeState: null,
          afterState: clusterVersionState(row),
          beforeVersion: null,
          afterVersion: row.version
        }
      );
      return clusterItem(row);
    });
  }

  public async update(
    clusterId: string,
    input: InternalUpdateSemanticClusterInput
  ): Promise<SemanticCluster> {
    return this.prisma.$transaction(async (transaction) => {
      await lockClusterSet(transaction, input.projectId);
      await lockCluster(transaction, input.projectId, clusterId);
      const current = await requiredCluster(
        transaction,
        input.workspaceId,
        input.projectId,
        clusterId
      );
      assertVersion(current.version, input.version);
      await assertUniqueName(
        transaction,
        input.workspaceId,
        input.projectId,
        input.name,
        clusterId
      );
      if (input.primaryPageId) {
        await assertPrimaryPage(
          transaction,
          input.workspaceId,
          input.projectId,
          input.primaryPageId
        );
      }
      const pageChanged =
        input.primaryPageId !== undefined &&
        input.primaryPageId !== current.primaryPageId;
      const mappingCleared = input.primaryPageId === null;
      const row = await transaction.cluster.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: clusterId
          }
        },
        data: {
          name: input.name,
          ...(input.isLocked === undefined ? {} : { isLocked: input.isLocked }),
          ...(input.excludeFromReclustering === undefined
            ? {}
            : { excludeFromReclustering: input.excludeFromReclustering }),
          ...(input.primaryPageId === undefined
            ? {}
            : { primaryPageId: input.primaryPageId }),
          ...(mappingCleared
            ? {
                pageMappingSource: null,
                pageMappingConfidence: null,
                pageMappingRationale: null
              }
            : {
                ...(input.pageMappingSource === undefined
                  ? pageChanged
                    ? { pageMappingSource: "MANUAL" }
                    : {}
                  : { pageMappingSource: input.pageMappingSource }),
                ...(input.pageMappingConfidence === undefined
                  ? pageChanged
                    ? { pageMappingConfidence: null }
                    : {}
                  : { pageMappingConfidence: input.pageMappingConfidence }),
                ...(input.pageMappingRationale === undefined
                  ? pageChanged
                    ? { pageMappingRationale: null }
                    : {}
                  : { pageMappingRationale: input.pageMappingRationale })
              }),
          version: { increment: 1 }
        },
        include: CLUSTER_INCLUDE
      });
      const counts = await transaction.keyword.groupBy({
        by: ["clusterId", "targetPageId"],
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          clusterId,
          status: "ACTIVE"
        },
        _count: { _all: true }
      });
      await this.semanticVersions.createWithClusterChange(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLUSTER_UPDATE",
          summary: `Изменён кластер «${row.name}»`
        },
        {
          entityId: row.id,
          operation: "UPDATE",
          beforeState: clusterVersionState(current),
          afterState: clusterVersionState(row),
          beforeVersion: current.version,
          afterVersion: row.version
        }
      );
      return clusterItem(row, keywordPageStats(counts).get(clusterId));
    });
  }

  public async delete(
    clusterId: string,
    input: InternalDeleteSemanticClusterInput
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockClusterSet(transaction, input.projectId);
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await lockCluster(transaction, input.projectId, clusterId);
      const current = await requiredCluster(
        transaction,
        input.workspaceId,
        input.projectId,
        clusterId
      );
      assertVersion(current.version, input.version);
      const keywordCount = await transaction.keyword.count({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          clusterId
        }
      });
      if (keywordCount > 0) {
        await transaction.keyword.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            clusterId
          },
          data: {
            clusterId: null,
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      }
      const deleted = await transaction.cluster.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: clusterId
          }
        },
        data: { status: "DELETED", version: { increment: 1 } },
        include: CLUSTER_INCLUDE
      });
      await this.semanticVersions.createIrreversibleVersion(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLUSTER_DELETE",
          summary: `Удалён кластер «${current.name}» и снят с ${keywordCount} запросов`
        },
        keywordCount + 1,
        { action: "CLUSTER_DELETE", clusterId: deleted.id }
      );
    });
  }

  public async previewPageMapping(
    input: InternalSemanticClusterPageBulkInput
  ): Promise<SemanticClusterPageBulkPreview> {
    if (input.primaryPageId) {
      const page = await this.prisma.page.findFirst({
        where: {
          id: input.primaryPageId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE"
        },
        select: { id: true }
      });
      if (!page) throw unavailablePrimaryPage();
    }
    const rows = await this.prisma.cluster.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        id: { in: input.items.map(({ id }) => id) }
      },
      include: CLUSTER_INCLUDE
    });
    return pageMappingPreview(input, rows);
  }

  public async bulkUpdatePageMapping(
    input: InternalSemanticClusterPageBulkInput
  ): Promise<SemanticClusterPageBulkResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockClusterSet(transaction, input.projectId);
      if (input.primaryPageId) {
        await assertPrimaryPage(
          transaction,
          input.workspaceId,
          input.projectId,
          input.primaryPageId
        );
      }
      const rows = await transaction.cluster.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          id: { in: input.items.map(({ id }) => id) }
        },
        include: CLUSTER_INCLUDE
      });
      const preview = pageMappingPreview(input, rows);
      const applicableIds = new Set(
        preview.changes.flatMap((change) =>
          change.state === "APPLICABLE" ? [change.clusterId] : []
        )
      );
      const currentById = new Map(rows.map((row) => [row.id, row]));
      const updatedRows: ClusterRow[] = [];
      const historyChanges: Array<{
        entityId: string;
        operation: "UPDATE";
        beforeState: SemanticClusterVersionState;
        afterState: SemanticClusterVersionState;
        beforeVersion: number;
        afterVersion: number;
      }> = [];
      for (const item of input.items) {
        if (!applicableIds.has(item.id)) continue;
        const current = currentById.get(item.id);
        if (!current) continue;
        const updated = await transaction.cluster.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: current.id
            }
          },
          data: {
            ...pageMappingData(input),
            version: { increment: 1 }
          },
          include: CLUSTER_INCLUDE
        });
        updatedRows.push(updated);
        historyChanges.push({
          entityId: updated.id,
          operation: "UPDATE",
          beforeState: clusterVersionState(current),
          afterState: clusterVersionState(updated),
          beforeVersion: current.version,
          afterVersion: updated.version
        });
      }
      await this.semanticVersions.createWithClusterChanges(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLUSTER_BULK_UPDATE",
          summary: `Назначены посадочные для кластеров: ${updatedRows.length}`
        },
        historyChanges
      );
      const counts = updatedRows.length === 0
        ? []
        : await transaction.keyword.groupBy({
            by: ["clusterId", "targetPageId"],
            where: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              status: "ACTIVE",
              clusterId: { in: updatedRows.map(({ id }) => id) }
            },
            _count: { _all: true }
          });
      const stats = keywordPageStats(counts);
      return {
        selected: preview.selected,
        changed: updatedRows.length,
        skipped: preview.skipped,
        conflicted: preview.conflicted,
        updatedClusters: updatedRows.map((row) =>
          clusterItem(row, stats.get(row.id))
        ),
        skippedIds: preview.changes.flatMap((change) =>
          change.state === "UNCHANGED" ? [change.clusterId] : []
        ),
        conflictedIds: preview.changes.flatMap((change) =>
          ["CONFLICTED", "UNAVAILABLE"].includes(change.state)
            ? [change.clusterId]
            : []
        )
      };
    });
  }

  public async previewMerge(
    input: InternalSemanticClusterMergeInput
  ): Promise<SemanticClusterMergePreview> {
    const rows = await this.prisma.cluster.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        id: { in: input.items.map(({ id }) => id) }
      },
      include: CLUSTER_INCLUDE
    });
    const sourceIds = input.items
      .map(({ id }) => id)
      .filter((id) => id !== input.targetClusterId);
    const movedKeywordCount = await this.prisma.keyword.count({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        clusterId: { in: sourceIds }
      }
    });
    return mergePreview(input, rows, movedKeywordCount);
  }

  public async merge(
    input: InternalSemanticClusterMergeInput
  ): Promise<SemanticClusterMergeResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await lockClusterSet(transaction, input.projectId);
      for (const clusterId of input.items.map(({ id }) => id).sort()) {
        await lockCluster(transaction, input.projectId, clusterId);
      }
      const rows = await transaction.cluster.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          id: { in: input.items.map(({ id }) => id) }
        },
        include: CLUSTER_INCLUDE
      });
      const sourceIds = input.items
        .map(({ id }) => id)
        .filter((id) => id !== input.targetClusterId);
      const keywords = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          clusterId: { in: sourceIds }
        },
        orderBy: { id: "asc" },
        take: SYNCHRONOUS_MERGE_KEYWORD_LIMIT + 1,
        include: MERGE_KEYWORD_INCLUDE
      });
      const preview = mergePreview(input, rows, keywords.length);
      assertMergeReady(preview);
      const target = rows.find(({ id }) => id === input.targetClusterId)!;
      const keywordChanges: SemanticKeywordChange[] = keywords.map((keyword) => {
        const beforeState = mergeKeywordVersionState(keyword);
        return {
          entityId: keyword.id,
          operation: "UPDATE",
          beforeState,
          afterState: { ...beforeState, clusterId: target.id },
          beforeVersion: keyword.version,
          afterVersion: keyword.version + 1
        };
      });
      if (keywords.length > 0) {
        const updated = await transaction.keyword.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: { in: keywords.map(({ id }) => id) },
            status: "ACTIVE"
          },
          data: {
            clusterId: target.id,
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        if (updated.count !== keywords.length) throw mergeStateChanged();
      }
      const sourceRows = rows.filter(({ id }) => id !== target.id);
      if (sourceRows.length > 0) {
        const deleted = await transaction.cluster.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: { in: sourceRows.map(({ id }) => id) },
            status: "ACTIVE"
          },
          data: { status: "DELETED", version: { increment: 1 } }
        });
        if (deleted.count !== sourceRows.length) throw mergeStateChanged();
      }
      await this.semanticVersions.createWithChanges(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLUSTER_MERGE",
          summary: `Объединены кластеры в «${target.name}»: ${sourceRows.length}`
        },
        keywordChanges,
        sourceRows.map((source) => {
          const beforeState = clusterVersionState(source);
          return {
            entityId: source.id,
            operation: "DELETE" as const,
            beforeState,
            afterState: { ...beforeState, status: "DELETED" as const },
            beforeVersion: source.version,
            afterVersion: source.version + 1
          };
        })
      );
      const counts = await transaction.keyword.groupBy({
        by: ["clusterId", "targetPageId"],
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          clusterId: target.id,
          status: "ACTIVE"
        },
        _count: { _all: true }
      });
      return {
        targetCluster: clusterItem(
          target,
          keywordPageStats(counts).get(target.id)
        ),
        mergedClusterIds: sourceRows.map(({ id }) => id),
        movedKeywordCount: keywords.length
      };
    });
  }

  public async previewSplit(
    input: InternalSemanticClusterSplitInput
  ): Promise<SemanticClusterSplitPreview> {
    const [source, keywords, sourceKeywordCount, duplicate] = await Promise.all([
      this.prisma.cluster.findFirst({
        where: {
          id: input.sourceCluster.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE"
        },
        include: CLUSTER_INCLUDE
      }),
      this.prisma.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          id: { in: input.keywordItems.map(({ id }) => id) }
        },
        include: MERGE_KEYWORD_INCLUDE
      }),
      this.prisma.keyword.count({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          clusterId: input.sourceCluster.id
        }
      }),
      this.prisma.cluster.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          name: { equals: input.newClusterName, mode: "insensitive" }
        },
        select: { id: true }
      })
    ]);
    return splitPreview(
      input,
      source,
      keywords,
      sourceKeywordCount,
      duplicate !== null
    );
  }

  public async split(
    input: InternalSemanticClusterSplitInput
  ): Promise<SemanticClusterSplitResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await lockClusterSet(transaction, input.projectId);
      await lockCluster(transaction, input.projectId, input.sourceCluster.id);
      const [source, keywords, sourceKeywordCount, duplicate] = await Promise.all([
        transaction.cluster.findFirst({
          where: {
            id: input.sourceCluster.id,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            status: "ACTIVE"
          },
          include: CLUSTER_INCLUDE
        }),
        transaction.keyword.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            status: "ACTIVE",
            id: { in: input.keywordItems.map(({ id }) => id) }
          },
          orderBy: { id: "asc" },
          include: MERGE_KEYWORD_INCLUDE
        }),
        transaction.keyword.count({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            status: "ACTIVE",
            clusterId: input.sourceCluster.id
          }
        }),
        transaction.cluster.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            status: "ACTIVE",
            name: { equals: input.newClusterName, mode: "insensitive" }
          },
          select: { id: true }
        })
      ]);
      const preview = splitPreview(
        input,
        source,
        keywords,
        sourceKeywordCount,
        duplicate !== null
      );
      assertSplitReady(preview);
      const currentSource = source!;
      const created = await transaction.cluster.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name: input.newClusterName,
          method: "MANUAL",
          evidence: {
            source: "MANUAL_SPLIT",
            sourceClusterId: currentSource.id,
            actorId: input.actorId
          },
          isLocked: input.isLocked ?? false,
          excludeFromReclustering: input.excludeFromReclustering ?? false
        },
        include: CLUSTER_INCLUDE
      });
      const keywordChanges: SemanticKeywordChange[] = keywords.map((keyword) => {
        const beforeState = mergeKeywordVersionState(keyword);
        return {
          entityId: keyword.id,
          operation: "UPDATE",
          beforeState,
          afterState: { ...beforeState, clusterId: created.id },
          beforeVersion: keyword.version,
          afterVersion: keyword.version + 1
        };
      });
      const moved = await transaction.keyword.updateMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          clusterId: currentSource.id,
          id: { in: keywords.map(({ id }) => id) }
        },
        data: {
          clusterId: created.id,
          updatedBy: input.actorId,
          version: { increment: 1 }
        }
      });
      if (moved.count !== keywords.length) throw splitStateChanged();
      const updatedSource = await transaction.cluster.update({
        where: {
          workspaceId_projectId_id: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: currentSource.id
          }
        },
        data: { version: { increment: 1 } },
        include: CLUSTER_INCLUDE
      });
      const sourceBefore = clusterVersionState(currentSource);
      const createdState = clusterVersionState(created);
      const clusterChanges: SemanticClusterChange[] = [
        {
          entityId: currentSource.id,
          operation: "UPDATE",
          beforeState: sourceBefore,
          afterState: sourceBefore,
          beforeVersion: currentSource.version,
          afterVersion: currentSource.version + 1
        },
        {
          entityId: created.id,
          operation: "CREATE",
          beforeState: null,
          afterState: createdState,
          beforeVersion: null,
          afterVersion: created.version
        }
      ];
      await this.semanticVersions.createWithChanges(
        transaction,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          reason: "CLUSTER_SPLIT",
          summary: `Выделен кластер «${created.name}»: ${keywords.length} запросов`
        },
        keywordChanges,
        clusterChanges
      );
      const counts = await transaction.keyword.groupBy({
        by: ["clusterId", "targetPageId"],
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          clusterId: { in: [updatedSource.id, created.id] }
        },
        _count: { _all: true }
      });
      const stats = keywordPageStats(counts);
      return {
        sourceCluster: clusterItem(updatedSource, stats.get(updatedSource.id)),
        createdCluster: clusterItem(created, stats.get(created.id)),
        movedKeywordCount: keywords.length
      };
    });
  }
}

function pageMappingPreview(
  input: InternalSemanticClusterPageBulkInput,
  rows: readonly ClusterRow[]
): SemanticClusterPageBulkPreview {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const changes: SemanticClusterPageBulkPreviewChange[] = input.items.map(
    (item) => {
      const current = rowById.get(item.id);
      if (!current) {
        return {
          clusterId: item.id,
          state: "UNAVAILABLE",
          expectedVersion: item.version,
          ...(input.primaryPageId
            ? { targetPrimaryPageId: input.primaryPageId }
            : {})
        };
      }
      const common = {
        clusterId: item.id,
        expectedVersion: item.version,
        currentVersion: current.version,
        ...(current.primaryPageId
          ? { currentPrimaryPageId: current.primaryPageId }
          : {}),
        ...(input.primaryPageId
          ? { targetPrimaryPageId: input.primaryPageId }
          : {})
      };
      if (current.version !== item.version) {
        return { ...common, state: "CONFLICTED" };
      }
      return {
        ...common,
        state: samePageMapping(current, input) ? "UNCHANGED" : "APPLICABLE"
      };
    }
  );
  return {
    selected: changes.length,
    applicable: changes.filter(({ state }) => state === "APPLICABLE").length,
    skipped: changes.filter(({ state }) => state === "UNCHANGED").length,
    conflicted: changes.filter(({ state }) =>
      ["CONFLICTED", "UNAVAILABLE"].includes(state)
    ).length,
    changes
  };
}

function mergePreview(
  input: InternalSemanticClusterMergeInput,
  rows: readonly ClusterRow[],
  movedKeywordCount: number
): SemanticClusterMergePreview {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const target = rowById.get(input.targetClusterId);
  const unavailableIds = input.items.flatMap(({ id }) =>
    rowById.has(id) ? [] : [id]
  );
  const conflictedIds = input.items.flatMap(({ id, version }) => {
    const row = rowById.get(id);
    return row && row.version !== version ? [id] : [];
  });
  const sourceRows = rows.filter(({ id }) => id !== input.targetClusterId);
  const hasConflict =
    !target || unavailableIds.length > 0 || conflictedIds.length > 0;
  return {
    readiness: hasConflict
      ? "CONFLICTED"
      : movedKeywordCount > SYNCHRONOUS_MERGE_KEYWORD_LIMIT
        ? "BACKGROUND_REQUIRED"
        : "READY",
    selectedClusterCount: input.items.length,
    sourceClusterCount: input.items.length - 1,
    movedKeywordCount,
    sourcePageConflictCount: target
      ? sourceRows.filter(
          ({ primaryPageId }) =>
            primaryPageId !== null && primaryPageId !== target.primaryPageId
        ).length
      : 0,
    lockedClusterCount: rows.filter(({ isLocked }) => isLocked).length,
    conflictedIds,
    unavailableIds,
    synchronousKeywordLimit: SYNCHRONOUS_MERGE_KEYWORD_LIMIT
  };
}

function assertMergeReady(preview: SemanticClusterMergePreview): void {
  if (preview.readiness === "READY") return;
  if (preview.readiness === "BACKGROUND_REQUIRED") {
    throw new HttpException(
      {
        code: "BACKGROUND_OPERATION_REQUIRED",
        message: "This cluster merge exceeds the synchronous safety limit",
        limit: preview.synchronousKeywordLimit
      },
      HttpStatus.UNPROCESSABLE_ENTITY
    );
  }
  throw new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "One or more semantic clusters changed after preview",
      conflictedIds: preview.conflictedIds,
      unavailableIds: preview.unavailableIds
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function splitPreview(
  input: InternalSemanticClusterSplitInput,
  source: ClusterRow | null,
  keywords: readonly MergeKeywordRow[],
  sourceKeywordCount: number,
  duplicateName: boolean
): SemanticClusterSplitPreview {
  const rowById = new Map(keywords.map((row) => [row.id, row]));
  const unavailableKeywordIds = input.keywordItems.flatMap(({ id }) =>
    rowById.has(id) ? [] : [id]
  );
  const conflictedKeywordIds = input.keywordItems.flatMap(({ id, version }) => {
    const row = rowById.get(id);
    return row && (row.version !== version || row.clusterId !== input.sourceCluster.id)
      ? [id]
      : [];
  });
  const sourceClusterState = !source
    ? "UNAVAILABLE" as const
    : source.version !== input.sourceCluster.version
      ? "CONFLICTED" as const
      : "READY" as const;
  const movableKeywordCount = input.keywordItems.length
    - unavailableKeywordIds.length
    - conflictedKeywordIds.length;
  const sourceWouldBeEmpty =
    sourceClusterState === "READY" &&
    unavailableKeywordIds.length === 0 &&
    conflictedKeywordIds.length === 0 &&
    movableKeywordCount >= sourceKeywordCount;
  const conflicted =
    sourceClusterState !== "READY" ||
    duplicateName ||
    sourceWouldBeEmpty ||
    unavailableKeywordIds.length > 0 ||
    conflictedKeywordIds.length > 0;
  return {
    readiness: conflicted
      ? "CONFLICTED"
      : input.keywordItems.length > SYNCHRONOUS_SPLIT_KEYWORD_LIMIT
        ? "BACKGROUND_REQUIRED"
        : "READY",
    sourceClusterState,
    selectedKeywordCount: input.keywordItems.length,
    movableKeywordCount,
    sourceKeywordCount,
    sourceWouldBeEmpty,
    duplicateName,
    sourceLocked: source?.isLocked ?? false,
    conflictedKeywordIds,
    unavailableKeywordIds,
    synchronousKeywordLimit: SYNCHRONOUS_SPLIT_KEYWORD_LIMIT
  };
}

function assertSplitReady(preview: SemanticClusterSplitPreview): void {
  if (preview.readiness === "READY") return;
  if (preview.readiness === "BACKGROUND_REQUIRED") {
    throw new HttpException(
      {
        code: "BACKGROUND_OPERATION_REQUIRED",
        message: "This cluster split exceeds the synchronous safety limit",
        limit: preview.synchronousKeywordLimit
      },
      HttpStatus.UNPROCESSABLE_ENTITY
    );
  }
  throw new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Cluster split preview contains conflicts",
      sourceClusterState: preview.sourceClusterState,
      duplicateName: preview.duplicateName,
      sourceWouldBeEmpty: preview.sourceWouldBeEmpty,
      conflictedKeywordIds: preview.conflictedKeywordIds,
      unavailableKeywordIds: preview.unavailableKeywordIds
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function mergeStateChanged(): HttpException {
  return new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Cluster merge scope changed while applying the operation"
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function splitStateChanged(): HttpException {
  return new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Cluster split scope changed while applying the operation"
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function samePageMapping(
  row: ClusterRow,
  input: InternalSemanticClusterPageBulkInput
): boolean {
  const target = pageMappingTarget(input);
  return (
    row.primaryPageId === target.primaryPageId &&
    row.pageMappingSource === target.pageMappingSource &&
    row.pageMappingConfidence === target.pageMappingConfidence &&
    row.pageMappingRationale === target.pageMappingRationale
  );
}

function pageMappingTarget(input: InternalSemanticClusterPageBulkInput) {
  return input.primaryPageId === null
    ? {
        primaryPageId: null,
        pageMappingSource: null,
        pageMappingConfidence: null,
        pageMappingRationale: null
      }
    : {
        primaryPageId: input.primaryPageId,
        pageMappingSource: input.pageMappingSource ?? "MANUAL",
        pageMappingConfidence: input.pageMappingConfidence ?? null,
        pageMappingRationale: input.pageMappingRationale ?? null
      };
}

function pageMappingData(
  input: InternalSemanticClusterPageBulkInput
): Readonly<{
  primaryPageId: string | null;
  pageMappingSource: SemanticClusterPageSource | null;
  pageMappingConfidence: number | null;
  pageMappingRationale: string | null;
}> {
  return pageMappingTarget(input);
}

async function requiredCluster(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string
): Promise<ClusterRow> {
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" },
    include: CLUSTER_INCLUDE
  });
  if (!cluster) {
    throw new HttpException(
      { code: "NOT_FOUND", message: "Semantic cluster not found" },
      HttpStatus.NOT_FOUND
    );
  }
  return cluster;
}

async function assertPrimaryPage(
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
    FOR KEY SHARE
  `;
  const page = await transaction.page.findFirst({
    where: { id: pageId, workspaceId, projectId, status: "ACTIVE" },
    select: { id: true }
  });
  if (!page) {
    throw unavailablePrimaryPage();
  }
}

function unavailablePrimaryPage(): HttpException {
  return new HttpException(
    { code: "PAGE_UNAVAILABLE", message: "Primary page is not active in this project" },
    HttpStatus.CONFLICT
  );
}

async function assertUniqueName(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const duplicate = await transaction.cluster.findFirst({
    where: {
      workspaceId,
      projectId,
      status: "ACTIVE",
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {})
    },
    select: { id: true }
  });
  if (duplicate) {
    throw new HttpException(
      { code: "DUPLICATE", message: "A cluster with this name already exists" },
      HttpStatus.CONFLICT
    );
  }
}

async function lockClusterSet(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-cluster-set:${projectId}`}, 0)
    )
  `;
}

async function lockCluster(
  transaction: Prisma.TransactionClient,
  projectId: string,
  clusterId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "clusters"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${clusterId}::uuid
    FOR UPDATE
  `;
}

function clusterItem(
  row: ClusterRow,
  stats: KeywordPageStats = emptyKeywordPageStats()
): SemanticCluster {
  if (!semanticClusterMethods.includes(row.method as SemanticClusterMethod)) {
    throw new HttpException(
      { code: "INVALID_UPSTREAM_RESPONSE", message: "Unsupported cluster method" },
      HttpStatus.BAD_GATEWAY
    );
  }
  if (
    row.pageMappingSource !== null &&
    !PAGE_MAPPING_SOURCES.has(row.pageMappingSource)
  ) {
    throw new HttpException(
      { code: "INVALID_UPSTREAM_RESPONSE", message: "Unsupported page mapping source" },
      HttpStatus.BAD_GATEWAY
    );
  }
  const primaryPage = row.primaryPage?.status === "ACTIVE"
    ? {
        id: row.primaryPage.id,
        url: row.primaryPage.url,
        normalizedUrl: row.primaryPage.normalizedUrl,
        pageType: row.primaryPage.pageType,
        indexability: row.primaryPage.indexability
      }
    : undefined;
  const competingPageCount = primaryPage
    ? [...stats.pageIds].filter((pageId) => pageId !== primaryPage.id).length
    : stats.pageIds.size;
  return {
    id: row.id,
    name: row.name,
    method: row.method as SemanticClusterMethod,
    keywordCount: stats.keywordCount,
    isLocked: row.isLocked,
    excludeFromReclustering: row.excludeFromReclustering,
    ...(primaryPage ? { primaryPage } : {}),
    ...(row.pageMappingSource
      ? { pageMappingSource: row.pageMappingSource as SemanticClusterPageSource }
      : {}),
    ...(row.pageMappingConfidence === null
      ? {}
      : { pageMappingConfidence: row.pageMappingConfidence }),
    ...(row.pageMappingRationale
      ? { pageMappingRationale: row.pageMappingRationale }
      : {}),
    pageDiagnostics: {
      mappedKeywordCount: stats.mappedKeywordCount,
      unmappedKeywordCount: stats.unmappedKeywordCount,
      competingPageCount,
      hasCannibalization: primaryPage
        ? competingPageCount > 0
        : stats.pageIds.size > 1,
      hasMissingLanding: stats.keywordCount > 0 && !primaryPage
    },
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function keywordPageStats(
  counts: readonly Readonly<{
    clusterId: string | null;
    targetPageId: string | null;
    _count: Readonly<{ _all: number }>;
  }>[]
): Map<string, KeywordPageStats> {
  const result = new Map<string, KeywordPageStats>();
  for (const count of counts) {
    if (!count.clusterId) continue;
    const current = result.get(count.clusterId) ?? emptyKeywordPageStats();
    current.keywordCount += count._count._all;
    if (count.targetPageId) {
      current.mappedKeywordCount += count._count._all;
      current.pageIds.add(count.targetPageId);
    } else {
      current.unmappedKeywordCount += count._count._all;
    }
    result.set(count.clusterId, current);
  }
  return result;
}

function emptyKeywordPageStats(): KeywordPageStats {
  return {
    keywordCount: 0,
    mappedKeywordCount: 0,
    unmappedKeywordCount: 0,
    pageIds: new Set<string>()
  };
}

function clusterVersionState(row: ClusterRow): SemanticClusterVersionState {
  if (!semanticClusterMethods.includes(row.method as SemanticClusterMethod)) {
    throw new HttpException(
      { code: "INVALID_CLUSTER_STATE", message: "Unsupported cluster method" },
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
  if (
    row.pageMappingSource !== null &&
    !PAGE_MAPPING_SOURCES.has(row.pageMappingSource)
  ) {
    throw new HttpException(
      { code: "INVALID_CLUSTER_STATE", message: "Unsupported page mapping source" },
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
  return {
    name: row.name,
    method: row.method as SemanticClusterMethod,
    status: row.status === "DELETED" ? "DELETED" : "ACTIVE",
    primaryPageId: row.primaryPageId,
    pageMappingSource: row.pageMappingSource as SemanticClusterPageSource | null,
    pageMappingConfidence: row.pageMappingConfidence,
    pageMappingRationale: row.pageMappingRationale,
    isLocked: row.isLocked,
    excludeFromReclustering: row.excludeFromReclustering
  };
}

function mergeKeywordVersionState(
  row: MergeKeywordRow
): SemanticKeywordVersionState {
  return {
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    normalizedHash: row.normalizedHash,
    language: row.language,
    priority: row.priority,
    isFavorite: row.isFavorite,
    isTracked: row.isTracked,
    intent: row.intent,
    status: row.status === "DELETED" ? "DELETED" : "ACTIVE",
    clusterId: row.clusterId,
    targetPageId: row.targetPageId,
    groupId: row.memberships[0]?.group.id ?? null,
    tagIds: row.tags.map(({ tag }) => tag.id)
  };
}

function assertVersion(current: number, expected: number): void {
  if (current === expected) return;
  throw new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic cluster version conflict",
      currentVersion: current
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

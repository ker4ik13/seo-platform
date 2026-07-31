import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  SemanticCapacityEntitlement,
  SemanticClusterPageSource,
  SemanticVersionChangePreview,
  SemanticVersionListItem,
  SemanticVersionReason,
  SemanticVersionUndoPreview,
  SemanticVersionUndoResult
} from "@seo-platform/contracts";
import { semanticClusterPageSources } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { SemanticVersion } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertStoredKeywordCapacity,
  lockStoredKeywordCapacity
} from "../internal/semantic-capacity.js";

const MAX_UNDO_CHANGES = 500;

export interface SemanticKeywordVersionState {
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly normalizedHash: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly intent: string | null;
  readonly status: "ACTIVE" | "DELETED";
  readonly clusterId: string | null;
  readonly targetPageId: string | null;
  readonly groupId: string | null;
  readonly tagIds: readonly string[];
}

export interface SemanticKeywordChange {
  readonly entityId: string;
  readonly operation: "CREATE" | "UPDATE" | "DELETE";
  readonly beforeState: SemanticKeywordVersionState | null;
  readonly afterState: SemanticKeywordVersionState;
  readonly beforeVersion: number | null;
  readonly afterVersion: number;
}

export interface SemanticClusterVersionState {
  readonly name: string;
  readonly method: "MANUAL";
  readonly status: "ACTIVE" | "DELETED";
  readonly primaryPageId: string | null;
  readonly pageMappingSource: SemanticClusterPageSource | null;
  readonly pageMappingConfidence: number | null;
  readonly pageMappingRationale: string | null;
  readonly isLocked: boolean;
  readonly excludeFromReclustering: boolean;
}

export interface SemanticClusterChange {
  readonly entityId: string;
  readonly operation: "CREATE" | "UPDATE" | "DELETE";
  readonly beforeState: SemanticClusterVersionState | null;
  readonly afterState: SemanticClusterVersionState;
  readonly beforeVersion: number | null;
  readonly afterVersion: number;
}

export interface SemanticVersionIdentity {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

interface CreateVersionInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly reason: Exclude<SemanticVersionReason, "IMPORT" | "LEGACY">;
  readonly summary: string;
}

@Injectable()
export class SemanticVersionService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticVersionListItem[]> {
    const rows = await this.prisma.semanticVersion.findMany({
      where: { workspaceId, projectId },
      orderBy: [{ number: "desc" }, { id: "desc" }],
      take: 100
    });
    return rows.map(versionItem);
  }

  public async createWithKeywordChange(
    transaction: Prisma.TransactionClient,
    input: CreateVersionInput,
    change: SemanticKeywordChange
  ): Promise<SemanticVersionListItem> {
    const version = await this.createVersion(transaction, input, true);
    await this.appendKeywordChange(transaction, version, change);
    const finalized = await transaction.semanticVersion.update({
      where: { id: version.id },
      data: {
        affectedCount: 1,
        reversible: true,
        manifest: { schemaVersion: 1, state: "FINALIZED" },
        finalizedAt: new Date()
      }
    });
    return versionItem(finalized);
  }

  public async createWithClusterChange(
    transaction: Prisma.TransactionClient,
    input: CreateVersionInput,
    change: SemanticClusterChange
  ): Promise<SemanticVersionListItem> {
    const version = await this.createVersion(transaction, input, true);
    await this.appendClusterChange(transaction, version, change);
    const finalized = await transaction.semanticVersion.update({
      where: { id: version.id },
      data: {
        affectedCount: 1,
        reversible: true,
        manifest: { schemaVersion: 1, state: "FINALIZED" },
        finalizedAt: new Date()
      }
    });
    return versionItem(finalized);
  }

  public async createWithClusterChanges(
    transaction: Prisma.TransactionClient,
    input: CreateVersionInput,
    changes: readonly SemanticClusterChange[]
  ): Promise<SemanticVersionListItem | undefined> {
    if (changes.length === 0) return undefined;
    if (changes.length > MAX_UNDO_CHANGES) throw undoTooLarge();
    const version = await this.createVersion(transaction, input, false);
    for (const change of changes) {
      await this.appendClusterChange(transaction, version, change);
    }
    const finalized = await transaction.semanticVersion.update({
      where: { id: version.id },
      data: {
        affectedCount: changes.length,
        reversible: true,
        manifest: { schemaVersion: 1, state: "FINALIZED" },
        finalizedAt: new Date()
      }
    });
    return versionItem(finalized);
  }

  public async createWithChanges(
    transaction: Prisma.TransactionClient,
    input: CreateVersionInput,
    keywordChanges: readonly SemanticKeywordChange[],
    clusterChanges: readonly SemanticClusterChange[]
  ): Promise<SemanticVersionListItem | undefined> {
    const affectedCount = keywordChanges.length + clusterChanges.length;
    if (affectedCount === 0) return undefined;
    if (affectedCount > MAX_UNDO_CHANGES) throw undoTooLarge();
    const version = await this.createVersion(transaction, input, false);
    // Cluster restores must be evaluated and applied before keywords that may
    // depend on those clusters. Persisting them first makes that order stable.
    for (const change of clusterChanges) {
      await this.appendClusterChange(transaction, version, change);
    }
    for (const change of keywordChanges) {
      await this.appendKeywordChange(transaction, version, change);
    }
    const finalized = await transaction.semanticVersion.update({
      where: { id: version.id },
      data: {
        affectedCount,
        reversible: true,
        manifest: { schemaVersion: 1, state: "FINALIZED" },
        finalizedAt: new Date()
      }
    });
    return versionItem(finalized);
  }

  public async createOpenBulkVersion(
    input: CreateVersionInput
  ): Promise<SemanticVersionIdentity> {
    return this.prisma.$transaction(async (transaction) =>
      this.createVersion(transaction, input, false)
    );
  }

  public async appendBulkKeywordChange(
    transaction: Prisma.TransactionClient,
    version: SemanticVersionIdentity,
    change: SemanticKeywordChange
  ): Promise<void> {
    const current = await transaction.semanticVersion.findFirst({
      where: {
        id: version.id,
        workspaceId: version.workspaceId,
        projectId: version.projectId,
        finalizedAt: null
      },
      select: { id: true }
    });
    if (!current) {
      throw new Error("Open semantic version is unavailable");
    }
    await this.appendKeywordChange(transaction, version, change);
    await transaction.semanticVersion.update({
      where: { id: version.id },
      data: { affectedCount: { increment: 1 } }
    });
  }

  public async finalizeBulkVersion(
    version: SemanticVersionIdentity
  ): Promise<SemanticVersionListItem> {
    return versionItem(
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.semanticVersion.findFirst({
          where: {
            id: version.id,
            workspaceId: version.workspaceId,
            projectId: version.projectId
          }
        });
        if (!current) {
          throw new Error("Semantic version is unavailable");
        }
        if (current.finalizedAt) return current;
        return transaction.semanticVersion.update({
          where: { id: current.id },
          data: {
            reversible: current.affectedCount > 0,
            manifest: { schemaVersion: 1, state: "FINALIZED" },
            finalizedAt: new Date()
          }
        });
      })
    );
  }

  public async previewUndo(
    workspaceId: string,
    projectId: string,
    versionId: string
  ): Promise<SemanticVersionUndoPreview> {
    const version = await this.requiredVersion(
      this.prisma,
      workspaceId,
      projectId,
      versionId
    );
    const changes = await this.prisma.semanticEntityChange.findMany({
      where: {
        workspaceId,
        projectId,
        semanticVersionId: version.id
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_UNDO_CHANGES + 1
    });
    if (changes.length > MAX_UNDO_CHANGES) {
      throw undoTooLarge();
    }
    const previews = await previewChanges(
      this.prisma,
      workspaceId,
      projectId,
      version,
      changes
    );
    return undoPreview(version, previews);
  }

  public async undo(
    workspaceId: string,
    projectId: string,
    actorId: string,
    versionId: string,
    idempotencyKey: string,
    entitlement: SemanticCapacityEntitlement
  ): Promise<SemanticVersionUndoResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockStoredKeywordCapacity(transaction, workspaceId);
      await lockSemanticKeywordWrites(transaction, projectId);
      await lockSemanticGroupTree(transaction, projectId);
      await lockSemanticClusterSet(transaction, projectId);
      const receipt = await transaction.semanticUndoReceipt.findUnique({
        where: {
          workspaceId_projectId_actorId_idempotencyKey: {
            workspaceId,
            projectId,
            actorId,
            idempotencyKey
          }
        }
      });
      if (receipt) {
        if (receipt.sourceVersionId !== versionId) {
          throw undoIdempotencyConflict();
        }
        const createdVersion = receipt.createdVersionId
          ? await this.requiredVersion(
              transaction,
              workspaceId,
              projectId,
              receipt.createdVersionId
            )
          : undefined;
        return {
          sourceVersionId: receipt.sourceVersionId,
          ...(createdVersion
            ? { createdVersion: versionItem(createdVersion) }
            : {}),
          applied: receipt.applied,
          conflicted: receipt.conflicted,
          unsupported: receipt.unsupported,
          changes: storedChangePreviews(receipt.changes)
        };
      }
      const version = await this.requiredVersion(
        transaction,
        workspaceId,
        projectId,
        versionId
      );
      const changes = await transaction.semanticEntityChange.findMany({
        where: {
          workspaceId,
          projectId,
          semanticVersionId: version.id
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_UNDO_CHANGES + 1
      });
      if (changes.length > MAX_UNDO_CHANGES) throw undoTooLarge();
      const initial = await previewChanges(
        transaction,
        workspaceId,
        projectId,
        version,
        changes
      );
      const applicable = initial.filter(
        ({ state }) => state === "APPLICABLE"
      );
      const conflicted = initial.filter(
        ({ state }) => state === "CONFLICTED"
      ).length;
      const unsupported = initial.filter(
        ({ state }) => state === "UNSUPPORTED"
      ).length;
      if (applicable.length === 0) {
        const result = {
          sourceVersionId: version.id,
          applied: 0,
          conflicted,
          unsupported,
          changes: initial
        } satisfies SemanticVersionUndoResult;
        await createUndoReceipt(
          transaction,
          workspaceId,
          projectId,
          actorId,
          idempotencyKey,
          result
        );
        return result;
      }
      const restoredKeywordCount = applicable.filter(
        ({ entityType, operation }) =>
          entityType === "KEYWORD" && operation === "DELETE"
      ).length;
      if (restoredKeywordCount > 0) {
        await assertStoredKeywordCapacity(
          transaction,
          workspaceId,
          projectId,
          BigInt(restoredKeywordCount),
          entitlement
        );
      }
      const undoVersion = await this.createVersion(
        transaction,
        {
          workspaceId,
          projectId,
          actorId,
          reason: "UNDO",
          summary: `Откат версии №${version.number}`
        },
        false
      );
      const previewByEntity = new Map(
        applicable.map((item) => [changeKey(item.entityType, item.entityId), item])
      );
      let applied = 0;
      const orderedChanges = [...changes].sort((left, right) =>
        left.entityType === right.entityType
          ? 0
          : left.entityType === "CLUSTER"
            ? -1
            : 1
      );
      for (const change of orderedChanges) {
        if (!previewByEntity.has(changeKey(change.entityType, change.entityId))) {
          continue;
        }
        if (change.entityType === "KEYWORD") {
          const current = await transaction.keyword.findFirstOrThrow({
            where: { id: change.entityId, workspaceId, projectId }
          });
          const target = nullableKeywordState(change.beforeState);
          const before = requiredKeywordState(change.afterState);
          const afterVersion = current.version + 1;
          if (target === null) {
            await transaction.keyword.update({
              where: {
                workspaceId_projectId_id: {
                  workspaceId,
                  projectId,
                  id: current.id
                }
              },
              data: {
                status: "DELETED",
                deletedAt: new Date(),
                updatedBy: actorId,
                version: { increment: 1 }
              }
            });
          } else {
            await restoreKeyword(
              transaction,
              workspaceId,
              projectId,
              actorId,
              current.id,
              target
            );
          }
          await this.appendKeywordChange(transaction, undoVersion, {
            entityId: current.id,
            operation:
              target === null || target.status === "DELETED"
                ? "DELETE"
                : "UPDATE",
            beforeState: before,
            afterState:
              target ??
              ({
                ...before,
                status: "DELETED"
              } satisfies SemanticKeywordVersionState),
            beforeVersion: current.version,
            afterVersion
          });
          applied += 1;
          continue;
        }
        if (change.entityType === "CLUSTER") {
          const current = await transaction.cluster.findFirstOrThrow({
            where: { id: change.entityId, workspaceId, projectId }
          });
          const target = nullableClusterState(change.beforeState);
          const before = requiredClusterState(change.afterState);
          const afterVersion = current.version + 1;
          await restoreCluster(
            transaction,
            workspaceId,
            projectId,
            current.id,
            target ?? { ...before, status: "DELETED" }
          );
          await this.appendClusterChange(transaction, undoVersion, {
            entityId: current.id,
            operation:
              target === null || target.status === "DELETED"
                ? "DELETE"
                : "UPDATE",
            beforeState: before,
            afterState: target ?? { ...before, status: "DELETED" },
            beforeVersion: current.version,
            afterVersion
          });
          applied += 1;
        }
      }
      const finalized = await transaction.semanticVersion.update({
        where: { id: undoVersion.id },
        data: {
          affectedCount: applied,
          reversible: applied > 0,
          manifest: { schemaVersion: 1, state: "FINALIZED" },
          finalizedAt: new Date()
        }
      });
      const result = {
        sourceVersionId: version.id,
        createdVersion: versionItem(finalized),
        applied,
        conflicted,
        unsupported,
        changes: initial
      } satisfies SemanticVersionUndoResult;
      await createUndoReceipt(
        transaction,
        workspaceId,
        projectId,
        actorId,
        idempotencyKey,
        result
      );
      return result;
    });
  }

  private async createVersion(
    transaction: Prisma.TransactionClient,
    input: CreateVersionInput,
    finalized: boolean
  ): Promise<SemanticVersion> {
    await lockSemanticVersionSequence(transaction, input.projectId);
    const latest = await transaction.semanticVersion.findFirst({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId
      },
      orderBy: { number: "desc" },
      select: { id: true, number: true }
    });
    return transaction.semanticVersion.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        number: (latest?.number ?? 0) + 1,
        reason: input.reason,
        actorId: input.actorId,
        ...(latest ? { parentVersionId: latest.id } : {}),
        summary: input.summary,
        affectedCount: 0,
        reversible: false,
        manifest: {
          schemaVersion: 1,
          state: finalized ? "FINALIZING" : "BUILDING"
        },
        ...(finalized ? { finalizedAt: new Date() } : {})
      }
    });
  }

  private async appendKeywordChange(
    transaction: Prisma.TransactionClient,
    version: SemanticVersionIdentity,
    change: SemanticKeywordChange
  ): Promise<void> {
    await transaction.semanticEntityChange.create({
      data: {
        workspaceId: version.workspaceId,
        projectId: version.projectId,
        semanticVersionId: version.id,
        entityType: "KEYWORD",
        entityId: change.entityId,
        operation: change.operation,
        ...(change.beforeState
          ? { beforeState: keywordStateJson(change.beforeState) }
          : {}),
        afterState: keywordStateJson(change.afterState),
        ...(change.beforeVersion === null
          ? {}
          : { beforeVersion: change.beforeVersion }),
        afterVersion: change.afterVersion
      }
    });
  }

  private async appendClusterChange(
    transaction: Prisma.TransactionClient,
    version: SemanticVersionIdentity,
    change: SemanticClusterChange
  ): Promise<void> {
    await transaction.semanticEntityChange.create({
      data: {
        workspaceId: version.workspaceId,
        projectId: version.projectId,
        semanticVersionId: version.id,
        entityType: "CLUSTER",
        entityId: change.entityId,
        operation: change.operation,
        ...(change.beforeState
          ? { beforeState: clusterStateJson(change.beforeState) }
          : {}),
        afterState: clusterStateJson(change.afterState),
        ...(change.beforeVersion === null
          ? {}
          : { beforeVersion: change.beforeVersion }),
        afterVersion: change.afterVersion
      }
    });
  }

  private async requiredVersion(
    client: PrismaService | Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    versionId: string
  ): Promise<SemanticVersion> {
    const version = await client.semanticVersion.findFirst({
      where: { id: versionId, workspaceId, projectId }
    });
    if (!version) throw new NotFoundException("Semantic version not found");
    return version;
  }
}

export async function lockSemanticKeywordWrites(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-keyword-write:${projectId}`}, 0)
    )
  `;
}

async function lockSemanticVersionSequence(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-version:${projectId}`}, 0)
    )
  `;
}

async function lockSemanticGroupTree(
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

async function previewChanges(
  client: PrismaService | Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  version: SemanticVersion,
  changes: readonly Readonly<{
    entityType: string;
    entityId: string;
    operation: string;
    beforeState: Prisma.JsonValue | null;
    afterState: Prisma.JsonValue;
    afterVersion: number;
  }>[]
): Promise<readonly SemanticVersionChangePreview[]> {
  if (!version.reversible || !version.finalizedAt) {
    return changes.map((change) => unsupportedPreview(change));
  }
  const keywordIds = changes.flatMap((change) =>
    change.entityType === "KEYWORD" ? [change.entityId] : []
  );
  const clusterIds = changes.flatMap((change) =>
    change.entityType === "CLUSTER" ? [change.entityId] : []
  );
  const [currentKeywords, currentClusters] = await Promise.all([
    keywordIds.length === 0
      ? Promise.resolve([])
      : client.keyword.findMany({
          where: { workspaceId, projectId, id: { in: keywordIds } },
          select: { id: true, version: true, status: true }
        }),
    clusterIds.length === 0
      ? Promise.resolve([])
      : client.cluster.findMany({
          where: { workspaceId, projectId, id: { in: clusterIds } },
          select: { id: true, version: true, status: true }
        })
  ]);
  const currentByEntity = new Map([
    ...currentKeywords.map((row) => [changeKey("KEYWORD", row.id), row] as const),
    ...currentClusters.map((row) => [changeKey("CLUSTER", row.id), row] as const)
  ]);
  const restoredClusterIds = new Set<string>();
  for (const change of changes) {
    if (change.entityType !== "CLUSTER") continue;
    const state = nullableClusterState(change.beforeState);
    const current = currentByEntity.get(changeKey("CLUSTER", change.entityId));
    if (
      state?.status === "ACTIVE" &&
      current?.version === change.afterVersion &&
      current.status === requiredClusterState(change.afterState).status &&
      !(await clusterRestoreConflict(
        client,
        workspaceId,
        projectId,
        change.entityId,
        state
      ))
    ) {
      restoredClusterIds.add(change.entityId);
    }
  }
  const restorableKeywordIds = new Set<string>();
  for (const change of changes) {
    if (
      change.entityType !== "KEYWORD" ||
      !["CREATE", "UPDATE", "DELETE"].includes(change.operation)
    ) continue;
    const current = currentByEntity.get(changeKey("KEYWORD", change.entityId));
    const after = requiredKeywordState(change.afterState);
    if (
      current?.version === change.afterVersion &&
      current.status === after.status &&
      !(await keywordRestoreConflict(
        client,
        workspaceId,
        projectId,
        change.entityId,
        nullableKeywordState(change.beforeState),
        restoredClusterIds
      ))
    ) {
      restorableKeywordIds.add(change.entityId);
    }
  }
  const detachedKeywordIdsByCluster = new Map<string, string[]>();
  for (const change of changes) {
    if (
      change.entityType !== "KEYWORD" ||
      !restorableKeywordIds.has(change.entityId)
    ) continue;
    const before = nullableKeywordState(change.beforeState);
    const after = requiredKeywordState(change.afterState);
    if (!after.clusterId || before?.clusterId === after.clusterId) continue;
    const ids = detachedKeywordIdsByCluster.get(after.clusterId) ?? [];
    ids.push(change.entityId);
    detachedKeywordIdsByCluster.set(after.clusterId, ids);
  }
  const result: SemanticVersionChangePreview[] = [];
  for (const change of changes) {
    if (
      !["KEYWORD", "CLUSTER"].includes(change.entityType) ||
      !["CREATE", "UPDATE", "DELETE"].includes(change.operation)
    ) {
      result.push(unsupportedPreview(change));
      continue;
    }
    const entityType = change.entityType as "KEYWORD" | "CLUSTER";
    const current = currentByEntity.get(changeKey(entityType, change.entityId));
    const after = entityType === "KEYWORD"
      ? requiredKeywordState(change.afterState)
      : requiredClusterState(change.afterState);
    if (
      !current ||
      current.version !== change.afterVersion ||
      current.status !== after.status
    ) {
      result.push({
        entityType,
        entityId: change.entityId,
        operation: change.operation as "CREATE" | "UPDATE" | "DELETE",
        state: "CONFLICTED",
        expectedCurrentVersion: change.afterVersion,
        ...(current ? { currentVersion: current.version } : {}),
        conflictCode: current ? "NEWER_CHANGE" : "ENTITY_UNAVAILABLE"
      });
      continue;
    }
    const dependencyConflict = entityType === "KEYWORD"
      ? await keywordRestoreConflict(
          client,
          workspaceId,
          projectId,
          change.entityId,
          nullableKeywordState(change.beforeState),
          restoredClusterIds
        )
      : await clusterRestoreConflict(
          client,
          workspaceId,
          projectId,
          change.entityId,
          nullableClusterState(change.beforeState),
          detachedKeywordIdsByCluster.get(change.entityId) ?? []
        );
    result.push({
      entityType,
      entityId: change.entityId,
      operation: change.operation as "CREATE" | "UPDATE" | "DELETE",
      state: dependencyConflict ? "CONFLICTED" : "APPLICABLE",
      expectedCurrentVersion: change.afterVersion,
      currentVersion: current.version,
      ...(dependencyConflict ? { conflictCode: dependencyConflict } : {})
    });
  }
  return result;
}

async function keywordRestoreConflict(
  client: PrismaService | Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  keywordId: string,
  state: SemanticKeywordVersionState | null,
  restoredClusterIds: ReadonlySet<string> = new Set()
): Promise<string | undefined> {
  if (state === null) return undefined;
  if (state.status === "DELETED") return undefined;
  const [duplicate, group, cluster, page, tagCount] = await Promise.all([
    client.keyword.findFirst({
      where: {
        workspaceId,
        projectId,
        status: "ACTIVE",
        language: state.language,
        normalizedHash: state.normalizedHash,
        id: { not: keywordId }
      },
      select: { id: true }
    }),
    state.groupId
      ? client.keywordGroup.findFirst({
          where: {
            id: state.groupId,
            workspaceId,
            projectId,
            status: "ACTIVE"
          },
          select: { id: true }
        })
      : Promise.resolve({ id: "" }),
    state.clusterId && !restoredClusterIds.has(state.clusterId)
      ? client.cluster.findFirst({
          where: {
            id: state.clusterId,
            workspaceId,
            projectId,
            status: "ACTIVE"
          },
          select: { id: true }
        })
      : Promise.resolve({ id: "" }),
    state.targetPageId
      ? client.page.findFirst({
          where: {
            id: state.targetPageId,
            workspaceId,
            projectId,
            status: "ACTIVE"
          },
          select: { id: true }
        })
      : Promise.resolve({ id: "" }),
    state.tagIds.length === 0
      ? Promise.resolve(0)
      : client.tag.count({
          where: {
            id: { in: [...state.tagIds] },
            workspaceId,
            projectId,
            status: "ACTIVE"
          }
        })
  ]);
  if (duplicate) return "DUPLICATE_KEYWORD";
  if (!group) return "GROUP_UNAVAILABLE";
  if (!cluster) return "CLUSTER_UNAVAILABLE";
  if (!page) return "TARGET_PAGE_UNAVAILABLE";
  if (tagCount !== state.tagIds.length) return "TAG_UNAVAILABLE";
  return undefined;
}

async function clusterRestoreConflict(
  client: PrismaService | Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string,
  state: SemanticClusterVersionState | null,
  detachedKeywordIds: readonly string[] = []
): Promise<string | undefined> {
  if (state === null || state.status === "DELETED") {
    const keywordCount = await client.keyword.count({
      where: {
        workspaceId,
        projectId,
        clusterId,
        status: "ACTIVE",
        ...(detachedKeywordIds.length === 0
          ? {}
          : { id: { notIn: [...detachedKeywordIds] } })
      }
    });
    return keywordCount > 0 ? "CLUSTER_NOT_EMPTY" : undefined;
  }
  const [duplicate, page] = await Promise.all([
    client.cluster.findFirst({
      where: {
        workspaceId,
        projectId,
        status: "ACTIVE",
        name: { equals: state.name, mode: "insensitive" },
        id: { not: clusterId }
      },
      select: { id: true }
    }),
    state.primaryPageId
      ? client.page.findFirst({
          where: {
            id: state.primaryPageId,
            workspaceId,
            projectId,
            status: "ACTIVE"
          },
          select: { id: true }
        })
      : Promise.resolve({ id: "" })
  ]);
  if (duplicate) return "DUPLICATE_CLUSTER";
  if (!page) return "PRIMARY_PAGE_UNAVAILABLE";
  return undefined;
}

async function restoreKeyword(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  actorId: string,
  keywordId: string,
  state: SemanticKeywordVersionState
): Promise<void> {
  await transaction.keyword.update({
    where: {
      workspaceId_projectId_id: { workspaceId, projectId, id: keywordId }
    },
    data: {
      textOriginal: state.textOriginal,
      textNormalized: state.textNormalized,
      normalizedHash: state.normalizedHash,
      language: state.language,
      priority: state.priority,
      isFavorite: state.isFavorite,
      intent: state.intent,
      status: state.status,
      clusterId: state.clusterId,
      targetPageId: state.targetPageId,
      deletedAt: state.status === "DELETED" ? new Date() : null,
      updatedBy: actorId,
      version: { increment: 1 }
    }
  });
  await transaction.keywordGroupMembership.deleteMany({
    where: { projectId, keywordId }
  });
  if (state.status === "ACTIVE" && state.groupId) {
    await transaction.keywordGroupMembership.create({
      data: { projectId, keywordId, groupId: state.groupId }
    });
  }
  await transaction.keywordTag.deleteMany({
    where: { projectId, keywordId }
  });
  if (state.status === "ACTIVE" && state.tagIds.length > 0) {
    await transaction.keywordTag.createMany({
      data: state.tagIds.map((tagId) => ({
        projectId,
        keywordId,
        tagId
      }))
    });
  }
}

async function restoreCluster(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string,
  state: SemanticClusterVersionState
): Promise<void> {
  if (state.status === "ACTIVE" && state.primaryPageId) {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "pages"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "project_id" = ${projectId}::uuid
        AND "id" = ${state.primaryPageId}::uuid
      FOR KEY SHARE
    `;
    const page = await transaction.page.findFirst({
      where: {
        id: state.primaryPageId,
        workspaceId,
        projectId,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (!page) {
      throw new HttpException(
        {
          code: "UNDO_DEPENDENCY_CONFLICT",
          message: "Primary page became unavailable during semantic undo"
        },
        HttpStatus.CONFLICT
      );
    }
  }
  await transaction.cluster.update({
    where: {
      workspaceId_projectId_id: { workspaceId, projectId, id: clusterId }
    },
    data: {
      name: state.name,
      method: state.method,
      status: state.status,
      primaryPageId: state.primaryPageId,
      pageMappingSource: state.pageMappingSource,
      pageMappingConfidence: state.pageMappingConfidence,
      pageMappingRationale: state.pageMappingRationale,
      isLocked: state.isLocked,
      excludeFromReclustering: state.excludeFromReclustering,
      version: { increment: 1 }
    }
  });
}

async function createUndoReceipt(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  result: SemanticVersionUndoResult
): Promise<void> {
  await transaction.semanticUndoReceipt.create({
    data: {
      workspaceId,
      projectId,
      actorId,
      idempotencyKey,
      sourceVersionId: result.sourceVersionId,
      ...(result.createdVersion
        ? { createdVersionId: result.createdVersion.id }
        : {}),
      applied: result.applied,
      conflicted: result.conflicted,
      unsupported: result.unsupported,
      changes: JSON.parse(
        JSON.stringify(result.changes)
      ) as Prisma.InputJsonArray
    }
  });
}

function undoPreview(
  version: SemanticVersion,
  changes: readonly SemanticVersionChangePreview[]
): SemanticVersionUndoPreview {
  return {
    version: versionItem(version),
    applicable: changes.filter(({ state }) => state === "APPLICABLE").length,
    conflicted: changes.filter(({ state }) => state === "CONFLICTED").length,
    unsupported: changes.filter(({ state }) => state === "UNSUPPORTED").length,
    changes
  };
}

function storedChangePreviews(
  value: Prisma.JsonValue
): readonly SemanticVersionChangePreview[] {
  if (!Array.isArray(value) || value.length > MAX_UNDO_CHANGES) {
    throw corruptedVersion();
  }
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item)
    ) {
      throw corruptedVersion();
    }
    const change = item as Readonly<Record<string, Prisma.JsonValue>>;
    const requiredKeys = [
      "entityType",
      "entityId",
      "operation",
      "state",
      "expectedCurrentVersion"
    ];
    const optionalKeys = ["currentVersion", "conflictCode"];
    if (
      Object.keys(change).some(
        (key) =>
          !requiredKeys.includes(key) && !optionalKeys.includes(key)
      ) ||
      requiredKeys.some((key) => !(key in change)) ||
      !["KEYWORD", "CLUSTER"].includes(String(change.entityType)) ||
      typeof change.entityId !== "string" ||
      !uuid(change.entityId) ||
      !["CREATE", "UPDATE", "DELETE"].includes(
        String(change.operation)
      ) ||
      !["APPLICABLE", "CONFLICTED", "UNSUPPORTED"].includes(
        String(change.state)
      ) ||
      !positiveInteger(change.expectedCurrentVersion) ||
      (change.currentVersion !== undefined &&
        !positiveInteger(change.currentVersion)) ||
      (change.conflictCode !== undefined &&
        (typeof change.conflictCode !== "string" ||
          !/^[A-Z0-9_]{1,100}$/u.test(change.conflictCode)))
    ) {
      throw corruptedVersion();
    }
    return {
      entityType: change.entityType as "KEYWORD" | "CLUSTER",
      entityId: change.entityId,
      operation: change.operation as "CREATE" | "UPDATE" | "DELETE",
      state: change.state as
        | "APPLICABLE"
        | "CONFLICTED"
        | "UNSUPPORTED",
      expectedCurrentVersion: Number(change.expectedCurrentVersion),
      ...(typeof change.currentVersion === "number"
        ? { currentVersion: change.currentVersion }
        : {}),
      ...(typeof change.conflictCode === "string"
        ? { conflictCode: change.conflictCode }
        : {})
    };
  });
}

function unsupportedPreview(change: {
  readonly entityType?: string;
  readonly entityId: string;
  readonly operation: string;
  readonly afterVersion: number;
}): SemanticVersionChangePreview {
  return {
    entityType: change.entityType === "CLUSTER" ? "CLUSTER" : "KEYWORD",
    entityId: change.entityId,
    operation: ["CREATE", "UPDATE", "DELETE"].includes(change.operation)
      ? (change.operation as "CREATE" | "UPDATE" | "DELETE")
      : "UPDATE",
    state: "UNSUPPORTED",
    expectedCurrentVersion: change.afterVersion,
    conflictCode: "VERSION_NOT_REVERSIBLE"
  };
}

function versionItem(row: SemanticVersion): SemanticVersionListItem {
  return {
    id: row.id,
    number: row.number,
    reason: versionReason(row.reason),
    actorId: row.actorId,
    ...(row.sourceJobId ? { sourceJobId: row.sourceJobId } : {}),
    ...(row.parentVersionId
      ? { parentVersionId: row.parentVersionId }
      : {}),
    summary: row.summary || row.reason,
    affectedCount: row.affectedCount,
    reversible: row.reversible && Boolean(row.finalizedAt),
    ...(row.finalizedAt
      ? { finalizedAt: row.finalizedAt.toISOString() }
      : {}),
    createdAt: row.createdAt.toISOString()
  };
}

function versionReason(value: string): SemanticVersionReason {
  if (
    [
      "KEYWORD_CREATE",
      "KEYWORD_UPDATE",
      "KEYWORD_DELETE",
      "CLUSTER_CREATE",
      "CLUSTER_UPDATE",
      "CLUSTER_DELETE",
      "CLUSTER_BULK_UPDATE",
      "CLUSTER_MERGE",
      "BULK_UPDATE",
      "UNDO"
    ].includes(value)
  ) {
    return value as SemanticVersionReason;
  }
  if (value === "IMPORT" || value === "semantic_import") return "IMPORT";
  return "LEGACY";
}

function keywordStateJson(
  state: SemanticKeywordVersionState
): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(state)) as Prisma.InputJsonObject;
}

function clusterStateJson(
  state: SemanticClusterVersionState
): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(state)) as Prisma.InputJsonObject;
}

function nullableClusterState(
  value: Prisma.JsonValue | null
): SemanticClusterVersionState | null {
  return value === null ? null : requiredClusterState(value);
}

function requiredClusterState(
  value: Prisma.JsonValue
): SemanticClusterVersionState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw corruptedVersion();
  }
  const state = value as Readonly<Record<string, Prisma.JsonValue>>;
  const keys = [
    "name",
    "method",
    "status",
    "primaryPageId",
    "pageMappingSource",
    "pageMappingConfidence",
    "pageMappingRationale",
    "isLocked",
    "excludeFromReclustering"
  ];
  const legacyKeys = keys.slice(0, 7);
  if (
    ![legacyKeys.length, keys.length].includes(Object.keys(state).length) ||
    legacyKeys.some((key) => !(key in state)) ||
    Object.keys(state).some((key) => !keys.includes(key)) ||
    typeof state.name !== "string" ||
    state.name.length < 1 ||
    state.name.length > 255 ||
    state.method !== "MANUAL" ||
    !["ACTIVE", "DELETED"].includes(String(state.status)) ||
    !nullableUuid(state.primaryPageId) ||
    (state.pageMappingSource !== null &&
      (typeof state.pageMappingSource !== "string" ||
        !semanticClusterPageSources.some(
          (source) => source === state.pageMappingSource
        ))) ||
    (state.pageMappingConfidence !== null &&
      (typeof state.pageMappingConfidence !== "number" ||
        !Number.isFinite(state.pageMappingConfidence) ||
        state.pageMappingConfidence < 0 ||
        state.pageMappingConfidence > 1)) ||
    (state.pageMappingRationale !== null &&
      (typeof state.pageMappingRationale !== "string" ||
        state.pageMappingRationale.length < 1 ||
        state.pageMappingRationale.length > 2_000)) ||
    (state.primaryPageId === null &&
      (state.pageMappingSource !== null ||
        state.pageMappingConfidence !== null ||
        state.pageMappingRationale !== null)) ||
    (state.isLocked !== undefined && typeof state.isLocked !== "boolean") ||
    (state.excludeFromReclustering !== undefined &&
      typeof state.excludeFromReclustering !== "boolean")
  ) {
    throw corruptedVersion();
  }
  return {
    name: state.name,
    method: "MANUAL",
    status: state.status as "ACTIVE" | "DELETED",
    primaryPageId: state.primaryPageId as string | null,
    pageMappingSource: state.pageMappingSource as SemanticClusterPageSource | null,
    pageMappingConfidence: state.pageMappingConfidence as number | null,
    pageMappingRationale: state.pageMappingRationale as string | null,
    isLocked: (state.isLocked as boolean | undefined) ?? false,
    excludeFromReclustering:
      (state.excludeFromReclustering as boolean | undefined) ?? false
  };
}

function changeKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function nullableKeywordState(
  value: Prisma.JsonValue | null
): SemanticKeywordVersionState | null {
  return value === null ? null : requiredKeywordState(value);
}

function requiredKeywordState(value: Prisma.JsonValue): SemanticKeywordVersionState {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw corruptedVersion();
  }
  const state = value as Readonly<Record<string, Prisma.JsonValue>>;
  const keys = [
    "textOriginal",
    "textNormalized",
    "normalizedHash",
    "language",
    "priority",
    "isFavorite",
    "intent",
    "status",
    "clusterId",
    "targetPageId",
    "groupId",
    "tagIds"
  ];
  if (
    Object.keys(state).length !== keys.length ||
    keys.some((key) => !(key in state)) ||
    typeof state.textOriginal !== "string" ||
    typeof state.textNormalized !== "string" ||
    typeof state.normalizedHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(state.normalizedHash) ||
    typeof state.language !== "string" ||
    !Number.isSafeInteger(state.priority) ||
    typeof state.isFavorite !== "boolean" ||
    (state.intent !== null && typeof state.intent !== "string") ||
    (state.status !== "ACTIVE" && state.status !== "DELETED") ||
    !nullableUuid(state.clusterId) ||
    !nullableUuid(state.targetPageId) ||
    !nullableUuid(state.groupId) ||
    !Array.isArray(state.tagIds) ||
    !state.tagIds.every((id) => typeof id === "string" && uuid(id))
  ) {
    throw corruptedVersion();
  }
  return {
    textOriginal: state.textOriginal,
    textNormalized: state.textNormalized,
    normalizedHash: state.normalizedHash,
    language: state.language,
    priority: Number(state.priority),
    isFavorite: state.isFavorite,
    intent: state.intent as string | null,
    status: state.status,
    clusterId: state.clusterId as string | null,
    targetPageId: state.targetPageId as string | null,
    groupId: state.groupId as string | null,
    tagIds: state.tagIds as string[]
  };
}

function nullableUuid(value: Prisma.JsonValue | undefined): boolean {
  return value === null || (typeof value === "string" && uuid(value));
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    value
  );
}

function positiveInteger(value: Prisma.JsonValue | undefined): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
  );
}

function corruptedVersion(): Error {
  return new Error("Semantic version change state is corrupted");
}

function undoTooLarge(): HttpException {
  return new HttpException(
    {
      code: "FEATURE_NOT_AVAILABLE",
      message: "This semantic version requires background undo",
      limit: MAX_UNDO_CHANGES
    },
    HttpStatus.UNPROCESSABLE_ENTITY
  );
}

function undoIdempotencyConflict(): HttpException {
  return new HttpException(
    {
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "Semantic undo idempotency key is already used for another version"
      }
    },
    HttpStatus.CONFLICT
  );
}

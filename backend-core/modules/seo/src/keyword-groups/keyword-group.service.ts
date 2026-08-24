import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  InternalCreateSemanticKeywordGroupInput,
  InternalCreateSemanticKeywordGroupsInput,
  InternalDeleteSemanticKeywordGroupInput,
  InternalDuplicateSemanticKeywordGroupInput,
  InternalUpdateSemanticKeywordGroupInput,
  SemanticKeywordGroup
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { ensureKeywordSystemGroupIds } from "./semantic-system-groups.js";

const GROUP_INCLUDE = {
  _count: {
    select: { memberships: true }
  }
} satisfies Prisma.KeywordGroupInclude;

type GroupAggregate = Prisma.KeywordGroupGetPayload<{
  include: typeof GROUP_INCLUDE;
}>;

@Injectable()
export class KeywordGroupService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticKeywordGroup[]> {
    return this.prisma.$transaction(async (transaction) => {
      await lockGroupTree(transaction, projectId);
      await ensureSystemGroups(transaction, workspaceId, projectId);
      const rows = await transaction.keywordGroup.findMany({
        where: { workspaceId, projectId, status: "ACTIVE" },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: GROUP_INCLUDE
      });
      return rows.map(groupItem);
    });
  }

  public async create(
    input: InternalCreateSemanticKeywordGroupInput
  ): Promise<SemanticKeywordGroup> {
    const { name, ...sharedInput } = input;
    const created = await this.createMany({ ...sharedInput, names: [name] });
    const group = created[0];
    if (!group) throw groupConflict("Created group was not returned");
    return group;
  }

  public async createMany(
    input: InternalCreateSemanticKeywordGroupsInput
  ): Promise<readonly SemanticKeywordGroup[]> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockGroupTree(transaction, input.projectId);
        await ensureSystemGroups(
          transaction,
          input.workspaceId,
          input.projectId
        );
        await assertFolderCapacity(
          transaction,
          input.workspaceId,
          input.projectId,
          input.names.length,
          input.entitlement.foldersPerProject,
          input.entitlement.planCode,
          input.entitlement.planVersion
        );
        const parent = input.parentId
          ? await requiredGroup(
              transaction,
              input.workspaceId,
              input.projectId,
              input.parentId
            )
          : undefined;
        assertRegularParent(parent);
        const parentPath = parent?.path ?? parent?.name;
        const siblings = await transaction.keywordGroup.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            parentId: input.parentId ?? null,
            status: "ACTIVE",
            systemKind: null
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true, position: true }
        });
        const targetPosition = Math.min(
          input.position ?? siblings.length,
          siblings.length
        );
        const createdIds: string[] = [];
        for (const [offset, name] of input.names.entries()) {
          const path = groupPath(parentPath, name);
          const created = await transaction.keywordGroup.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              ...(input.parentId ? { parentId: input.parentId } : {}),
              name,
              path,
              pathHash: sha256(path),
              ...(input.color ? { color: input.color } : {}),
              position: targetPosition + offset
            }
          });
          createdIds.push(created.id);
        }
        const orderedSiblingIds = siblings.map(({ id }) => id);
        orderedSiblingIds.splice(targetPosition, 0, ...createdIds);
        const createdIdSet = new Set(createdIds);
        const siblingById = new Map(
          siblings.map((sibling) => [sibling.id, sibling])
        );
        for (const [position, siblingId] of orderedSiblingIds.entries()) {
          if (createdIdSet.has(siblingId)) continue;
          const sibling = siblingById.get(siblingId);
          if (sibling?.position === position) continue;
          await transaction.keywordGroup.update({
            where: { id: siblingId },
            data: { position, version: { increment: 1 } }
          });
        }
        return Promise.all(
          createdIds.map(async (groupId) =>
            groupItem(
              await requiredGroup(
                transaction,
                input.workspaceId,
                input.projectId,
                groupId
              )
            )
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateGroup();
      throw error;
    }
  }

  public async duplicate(
    groupId: string,
    input: InternalDuplicateSemanticKeywordGroupInput
  ): Promise<SemanticKeywordGroup> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockGroupTree(transaction, input.projectId);
        await lockGroup(transaction, input.projectId, groupId);
        await ensureSystemGroups(
          transaction,
          input.workspaceId,
          input.projectId
        );
        const source = await requiredGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          groupId
        );
        assertMutableGroup(source);
        assertVersion(source.version, input.version);
        const parent = input.parentId
          ? await requiredGroup(
              transaction,
              input.workspaceId,
              input.projectId,
              input.parentId
            )
          : undefined;
        assertRegularParent(parent);

        const sourcePath = source.path ?? source.name;
        const sourceGroups = input.includeDescendants
          ? await transaction.keywordGroup.findMany({
              where: {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                status: "ACTIVE",
                systemKind: null,
                OR: [
                  { id: source.id },
                  { path: { startsWith: `${sourcePath} / ` } }
                ]
              },
              include: GROUP_INCLUDE
            })
          : [source];
        sourceGroups.sort(compareGroupDepth);

        const lastSibling = await transaction.keywordGroup.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            parentId: input.parentId ?? null,
            status: "ACTIVE",
            systemKind: null
          },
          orderBy: { position: "desc" },
          select: { position: true }
        });
        const createdBySource = new Map<
          string,
          Readonly<{ id: string; path: string }>
        >();
        let duplicatedRootId: string | undefined;

        for (const sourceGroup of sourceGroups) {
          const isRoot = sourceGroup.id === source.id;
          const createdParent = isRoot
            ? parent
              ? { id: parent.id, path: parent.path ?? parent.name }
              : undefined
            : sourceGroup.parentId
              ? createdBySource.get(sourceGroup.parentId)
              : undefined;
          if (!isRoot && !createdParent) {
            throw groupConflict("Duplicated group tree is inconsistent");
          }
          const name = isRoot ? input.name : sourceGroup.name;
          const path = groupPath(createdParent?.path, name);
          const color = isRoot
            ? input.color ?? sourceGroup.color
            : sourceGroup.color;
          const created = await transaction.keywordGroup.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              ...(createdParent ? { parentId: createdParent.id } : {}),
              name,
              path,
              pathHash: sha256(path),
              ...(color ? { color } : {}),
              position: isRoot
                ? (lastSibling?.position ?? -1) + 1
                : sourceGroup.position
            }
          });
          createdBySource.set(sourceGroup.id, { id: created.id, path });
          if (isRoot) duplicatedRootId = created.id;
        }

        if (input.includeKeywords) {
          for (const sourceGroup of sourceGroups) {
            const created = createdBySource.get(sourceGroup.id);
            if (!created) continue;
            await transaction.$executeRaw`
              INSERT INTO "keyword_group_memberships" (
                "project_id",
                "keyword_id",
                "group_id"
              )
              SELECT
                "project_id",
                "keyword_id",
                ${created.id}::uuid
              FROM "keyword_group_memberships"
              WHERE "project_id" = ${input.projectId}::uuid
                AND "group_id" = ${sourceGroup.id}::uuid
              ON CONFLICT ("keyword_id", "group_id") DO NOTHING
            `;
          }
        }

        if (!duplicatedRootId) {
          throw groupConflict("Duplicated group was not created");
        }
        return groupItem(
          await requiredGroup(
            transaction,
            input.workspaceId,
            input.projectId,
            duplicatedRootId
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateGroup();
      throw error;
    }
  }

  public async update(
    groupId: string,
    input: InternalUpdateSemanticKeywordGroupInput
  ): Promise<SemanticKeywordGroup> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockGroupTree(transaction, input.projectId);
        await lockGroup(transaction, input.projectId, groupId);
        const current = await requiredGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          groupId
        );
        assertMutableGroup(current);
        const currentPath = current.path ?? current.name;
        assertVersion(current.version, input.version);
        if (input.parentId === groupId) {
          throw groupConflict("A group cannot be its own parent");
        }
        const parent =
          input.parentId === undefined
            ? current.parentId
              ? await requiredGroup(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  current.parentId
                )
              : undefined
            : input.parentId === null
              ? undefined
              : await requiredGroup(
                  transaction,
                  input.workspaceId,
                  input.projectId,
                  input.parentId
                );
        assertRegularParent(parent);
        const parentPath = parent?.path ?? parent?.name;
        if (
          parentPath === currentPath ||
          parentPath?.startsWith(`${currentPath} / `)
        ) {
          throw groupConflict("A group cannot be moved under its descendant");
        }
        const nextPath = groupPath(parentPath, input.name);
        const targetParentId = parent?.id ?? null;
        const siblings = await transaction.keywordGroup.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            parentId: targetParentId,
            status: "ACTIVE",
            systemKind: null,
            id: { not: groupId }
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true, position: true }
        });
        const currentSiblingIndex = siblings.filter(
          ({ position, id }) =>
            position < current.position ||
            (position === current.position && id < current.id)
        ).length;
        const targetPosition = Math.min(
          input.position ??
            (targetParentId === current.parentId
              ? currentSiblingIndex
              : siblings.length),
          siblings.length
        );
        const descendants =
          nextPath === currentPath
            ? []
            : await transaction.keywordGroup.findMany({
                where: {
                  workspaceId: input.workspaceId,
                  projectId: input.projectId,
                  status: "ACTIVE",
                  path: { startsWith: `${currentPath} / ` }
                },
                orderBy: { path: "asc" },
                select: { id: true, path: true }
              });
        await transaction.keywordGroup.update({
          where: { id: groupId },
          data: {
            name: input.name,
            parentId:
              input.parentId === undefined
                ? current.parentId
                : input.parentId,
            color:
              input.color === undefined ? current.color : input.color,
            position: targetPosition,
            path: nextPath,
            pathHash: sha256(nextPath),
            version: { increment: 1 }
          }
        });
        const orderedSiblingIds = siblings.map(({ id }) => id);
        orderedSiblingIds.splice(targetPosition, 0, groupId);
        for (const [position, siblingId] of orderedSiblingIds.entries()) {
          if (siblingId === groupId) continue;
          const sibling = siblings.find(({ id }) => id === siblingId);
          if (sibling?.position === position) continue;
          await transaction.keywordGroup.update({
            where: { id: siblingId },
            data: { position, version: { increment: 1 } }
          });
        }
        for (const descendant of descendants) {
          const descendantPath = descendant.path ?? "";
          const path = `${nextPath}${descendantPath.slice(currentPath.length)}`;
          await transaction.keywordGroup.update({
            where: { id: descendant.id },
            data: {
              path,
              pathHash: sha256(path),
              version: { increment: 1 }
            }
          });
        }
        return groupItem(
          await requiredGroup(
            transaction,
            input.workspaceId,
            input.projectId,
            groupId
          )
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateGroup();
      throw error;
    }
  }

  public async delete(
    groupId: string,
    input: InternalDeleteSemanticKeywordGroupInput
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        await lockGroupTree(transaction, input.projectId);
        await lockGroup(transaction, input.projectId, groupId);
        const current = await requiredGroup(
          transaction,
          input.workspaceId,
          input.projectId,
          groupId
        );
        assertMutableGroup(current);
        assertVersion(current.version, input.version);
        const systemGroups = await ensureSystemGroups(
          transaction,
          input.workspaceId,
          input.projectId
        );
        const currentPath = current.path ?? current.name;
        const subtree = await transaction.keywordGroup.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            status: "ACTIVE",
            systemKind: null,
            OR: [{ id: groupId }, { path: { startsWith: `${currentPath} / ` } }]
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: {
            id: true,
            parentId: true,
            name: true,
            path: true,
            position: true
          }
        });
        const deletedGroupIds = input.promoteChildren
          ? [groupId]
          : subtree.map(({ id }) => id);
        if (input.deleteKeywords) {
          if (input.promoteChildren) {
            await moveOrphanedDeletedGroupKeywordsToTrash(
              transaction,
              input.projectId,
              deletedGroupIds,
              systemGroups.TRASH.id,
              input.actorId
            );
          } else {
            await moveSubtreeKeywordsToTrash(
              transaction,
              input.projectId,
              deletedGroupIds,
              systemGroups.TRASH.id,
              input.actorId
            );
          }
        } else {
          await moveOrphanedSubtreeKeywordsToUngrouped(
            transaction,
            input.projectId,
            deletedGroupIds,
            systemGroups.UNGROUPED.id
          );
        }
        if (input.promoteChildren) {
          await markGroupsDeleted(transaction, deletedGroupIds);
          await promoteDirectChildren(
            transaction,
            input.workspaceId,
            input.projectId,
            current,
            subtree
          );
        } else {
          await markGroupsDeleted(transaction, deletedGroupIds);
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateGroup();
      throw error;
    }
  }
}

async function markGroupsDeleted(
  transaction: Prisma.TransactionClient,
  groupIds: readonly string[]
): Promise<void> {
  await transaction.keywordGroup.updateMany({
    where: { id: { in: [...groupIds] } },
    data: {
      status: "DELETED",
      parentId: null,
      path: null,
      pathHash: null,
      version: { increment: 1 }
    }
  });
}

async function requiredGroup(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  groupId: string
): Promise<GroupAggregate> {
  const group = await transaction.keywordGroup.findFirst({
    where: {
      id: groupId,
      workspaceId,
      projectId,
      status: "ACTIVE"
    },
    include: GROUP_INCLUDE
  });
  if (!group) {
    throw new HttpException(
      { code: "NOT_FOUND", message: "Semantic group not found" },
      HttpStatus.NOT_FOUND
    );
  }
  return group;
}

async function lockGroup(
  transaction: Prisma.TransactionClient,
  projectId: string,
  groupId: string
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "keyword_groups"
    WHERE "project_id" = ${projectId}::uuid
      AND "id" = ${groupId}::uuid
    FOR UPDATE
  `;
}

async function lockGroupTree(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-group-tree:${projectId}`}, 0)
    )
  `;
}

async function assertFolderCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  additional: number,
  limit: number,
  planCode: string,
  planVersion: number
): Promise<void> {
  if (limit === 0) return;
  const current = await transaction.keywordGroup.count({
    where: { workspaceId, projectId, status: "ACTIVE", systemKind: null }
  });
  if (current + additional <= limit) return;
  throw new HttpException(
    {
      error: {
        code: "QUOTA_EXCEEDED",
        message: "The foldersPerProject limit for the current plan would be exceeded",
        details: {
          resource: "foldersPerProject",
          current,
          additional,
          limit,
          planCode,
          planVersion
        }
      }
    },
    HttpStatus.CONFLICT
  );
}

function groupItem(group: GroupAggregate): SemanticKeywordGroup {
  return {
    id: group.id,
    ...(group.parentId ? { parentId: group.parentId } : {}),
    name: group.name,
    path: group.systemKind ? group.name : (group.path ?? group.name),
    ...(group.color ? { color: group.color } : {}),
    position: group.position,
    keywordCount: group._count.memberships,
    ...(group.systemKind ? { systemKind: group.systemKind } : {}),
    version: group.version,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString()
  };
}

function compareGroupDepth(left: GroupAggregate, right: GroupAggregate): number {
  const depthDifference = groupDepth(left.path) - groupDepth(right.path);
  if (depthDifference !== 0) return depthDifference;
  if (left.position !== right.position) return left.position - right.position;
  return left.id.localeCompare(right.id);
}

function groupDepth(path: string | null): number {
  return path ? path.split(" / ").length : 0;
}

async function promoteDirectChildren(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  current: GroupAggregate,
  subtree: readonly Readonly<{
    id: string;
    parentId: string | null;
    name: string;
    path: string | null;
    position: number;
  }>[]
): Promise<void> {
  const directChildren = subtree
    .filter(({ parentId }) => parentId === current.id)
    .sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id)
    );
  if (directChildren.length === 0) return;
  const parent = current.parentId
    ? await requiredGroup(transaction, workspaceId, projectId, current.parentId)
    : undefined;
  assertRegularParent(parent);
  const parentPath = parent?.path ?? parent?.name;
  const destinationSiblings = await transaction.keywordGroup.findMany({
    where: {
      workspaceId,
      projectId,
      parentId: current.parentId,
      status: "ACTIVE",
      systemKind: null,
      id: { not: current.id }
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, position: true }
  });
  const insertionPosition = destinationSiblings.filter(
    ({ id, position }) =>
      position < current.position ||
      (position === current.position && id < current.id)
  ).length;
  const directChildIds = new Set(directChildren.map(({ id }) => id));
  const orderedDestinationIds = destinationSiblings.map(({ id }) => id);
  orderedDestinationIds.splice(
    insertionPosition,
    0,
    ...directChildren.map(({ id }) => id)
  );
  const destinationPositionById = new Map(
    orderedDestinationIds.map((id, position) => [id, position])
  );
  const currentPath = current.path ?? current.name;
  const currentPrefix = `${currentPath} / `;
  const promotedRows = subtree
    .filter(({ id }) => id !== current.id)
    .sort((left, right) => {
      const depthDifference = groupDepth(left.path) - groupDepth(right.path);
      if (depthDifference !== 0) return depthDifference;
      return left.position - right.position || left.id.localeCompare(right.id);
    });

  for (const row of promotedRows) {
    if (!row.path?.startsWith(currentPrefix)) {
      throw groupConflict("Promoted group tree is inconsistent");
    }
    const relativePath = row.path.slice(currentPrefix.length);
    const path = groupPath(parentPath, relativePath);
    const directChild = directChildIds.has(row.id);
    await transaction.keywordGroup.update({
      where: { id: row.id },
      data: {
        ...(directChild
          ? {
              parentId: current.parentId,
              position: destinationPositionById.get(row.id) ?? 0
            }
          : {}),
        path,
        pathHash: sha256(path),
        version: { increment: 1 }
      }
    });
  }
  for (const sibling of destinationSiblings) {
    const position = destinationPositionById.get(sibling.id);
    if (position === undefined || sibling.position === position) continue;
    await transaction.keywordGroup.update({
      where: { id: sibling.id },
      data: { position, version: { increment: 1 } }
    });
  }
}

async function ensureSystemGroups(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string
): Promise<Readonly<Record<"UNGROUPED" | "TRASH", GroupAggregate>>> {
  const ids = await ensureKeywordSystemGroupIds(
    transaction,
    workspaceId,
    projectId
  );
  return {
    UNGROUPED: await requiredGroup(
      transaction,
      workspaceId,
      projectId,
      ids.UNGROUPED
    ),
    TRASH: await requiredGroup(
      transaction,
      workspaceId,
      projectId,
      ids.TRASH
    )
  };
}

function assertMutableGroup(group: GroupAggregate): void {
  if (group.systemKind) {
    throw groupConflict("System groups cannot be changed or deleted");
  }
}

function assertRegularParent(group: GroupAggregate | undefined): void {
  if (group?.systemKind) {
    throw groupConflict("Groups cannot be created inside a system group");
  }
}

async function moveSubtreeKeywordsToTrash(
  transaction: Prisma.TransactionClient,
  projectId: string,
  groupIds: readonly string[],
  trashGroupId: string,
  actorId: string
): Promise<void> {
  if (groupIds.length === 0) return;
  const targetRows = await transaction.keywordGroupMembership.findMany({
    where: { projectId, groupId: { in: [...groupIds] } },
    select: { keywordId: true },
    distinct: ["keywordId"]
  });
  const keywordIds = targetRows.map(({ keywordId }) => keywordId);
  if (keywordIds.length === 0) return;
  await transaction.keyword.updateMany({
    where: { projectId, id: { in: keywordIds }, status: "ACTIVE" },
    data: {
      status: "DELETED",
      deletedAt: new Date(),
      updatedBy: actorId,
      version: { increment: 1 }
    }
  });
  await transaction.keywordGroupMembership.deleteMany({
    where: { projectId, keywordId: { in: keywordIds } }
  });
  await transaction.keywordGroupMembership.createMany({
    data: keywordIds.map((keywordId) => ({
      projectId,
      keywordId,
      groupId: trashGroupId
    })),
    skipDuplicates: true
  });
}

async function moveOrphanedDeletedGroupKeywordsToTrash(
  transaction: Prisma.TransactionClient,
  projectId: string,
  groupIds: readonly string[],
  trashGroupId: string,
  actorId: string
): Promise<void> {
  if (groupIds.length === 0) return;
  const targetRows = await transaction.keywordGroupMembership.findMany({
    where: { projectId, groupId: { in: [...groupIds] } },
    select: { keywordId: true },
    distinct: ["keywordId"]
  });
  const keywordIds = targetRows.map(({ keywordId }) => keywordId);
  if (keywordIds.length === 0) return;
  const outsideRows = await transaction.keywordGroupMembership.findMany({
    where: {
      projectId,
      keywordId: { in: keywordIds },
      groupId: { notIn: [...groupIds] }
    },
    select: { keywordId: true },
    distinct: ["keywordId"]
  });
  const assignedOutside = new Set(outsideRows.map(({ keywordId }) => keywordId));
  const orphanedIds = keywordIds.filter((id) => !assignedOutside.has(id));
  await transaction.keywordGroupMembership.deleteMany({
    where: { projectId, groupId: { in: [...groupIds] } }
  });
  if (orphanedIds.length === 0) return;
  await transaction.keyword.updateMany({
    where: { projectId, id: { in: orphanedIds }, status: "ACTIVE" },
    data: {
      status: "DELETED",
      deletedAt: new Date(),
      updatedBy: actorId,
      version: { increment: 1 }
    }
  });
  await transaction.keywordGroupMembership.deleteMany({
    where: { projectId, keywordId: { in: orphanedIds } }
  });
  await transaction.keywordGroupMembership.createMany({
    data: orphanedIds.map((keywordId) => ({
      projectId,
      keywordId,
      groupId: trashGroupId
    })),
    skipDuplicates: true
  });
}

async function moveOrphanedSubtreeKeywordsToUngrouped(
  transaction: Prisma.TransactionClient,
  projectId: string,
  groupIds: readonly string[],
  ungroupedGroupId: string
): Promise<void> {
  if (groupIds.length === 0) return;
  const targetRows = await transaction.keywordGroupMembership.findMany({
    where: { projectId, groupId: { in: [...groupIds] } },
    select: { keywordId: true },
    distinct: ["keywordId"]
  });
  const keywordIds = targetRows.map(({ keywordId }) => keywordId);
  if (keywordIds.length === 0) return;
  const outsideRows = await transaction.keywordGroupMembership.findMany({
    where: {
      projectId,
      keywordId: { in: keywordIds },
      groupId: { notIn: [...groupIds] }
    },
    select: { keywordId: true },
    distinct: ["keywordId"]
  });
  const assignedOutside = new Set(outsideRows.map(({ keywordId }) => keywordId));
  await transaction.keywordGroupMembership.deleteMany({
    where: { projectId, groupId: { in: [...groupIds] } }
  });
  const orphanedIds = keywordIds.filter((id) => !assignedOutside.has(id));
  if (orphanedIds.length > 0) {
    await transaction.keywordGroupMembership.createMany({
      data: orphanedIds.map((keywordId) => ({
        projectId,
        keywordId,
        groupId: ungroupedGroupId
      })),
      skipDuplicates: true
    });
  }
}

function groupPath(parentPath: string | null | undefined, name: string): string {
  return parentPath ? `${parentPath} / ${name}` : name;
}

function assertVersion(current: number, expected: number): void {
  if (current === expected) return;
  throw new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic group version conflict",
      currentVersion: current
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function duplicateGroup(): HttpException {
  return new HttpException(
    {
      code: "DUPLICATE",
      message: "A group with this path already exists"
    },
    HttpStatus.CONFLICT
  );
}

function groupConflict(message: string): HttpException {
  return new HttpException(
    { code: "RESOURCE_STATE_CONFLICT", message },
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

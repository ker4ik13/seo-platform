import { createHash } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type {
  InternalCreateSemanticKeywordGroupInput,
  InternalDeleteSemanticKeywordGroupInput,
  InternalUpdateSemanticKeywordGroupInput,
  SemanticKeywordGroup
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

const GROUP_INCLUDE = {
  _count: {
    select: {
      memberships: {
        where: { keyword: { status: "ACTIVE" as const } }
      }
    }
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
    const rows = await this.prisma.keywordGroup.findMany({
      where: { workspaceId, projectId, status: "ACTIVE" },
      orderBy: [{ path: "asc" }, { position: "asc" }, { id: "asc" }],
      take: 2_000,
      include: GROUP_INCLUDE
    });
    return rows.map(groupItem);
  }

  public async create(
    input: InternalCreateSemanticKeywordGroupInput
  ): Promise<SemanticKeywordGroup> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockGroupTree(transaction, input.projectId);
        const parent = input.parentId
          ? await requiredGroup(
              transaction,
              input.workspaceId,
              input.projectId,
              input.parentId
            )
          : undefined;
        const path = groupPath(parent?.path ?? parent?.name, input.name);
        const lastSibling = await transaction.keywordGroup.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            parentId: input.parentId ?? null,
            status: "ACTIVE"
          },
          orderBy: { position: "desc" },
          select: { position: true }
        });
        const created = await transaction.keywordGroup.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            ...(input.parentId ? { parentId: input.parentId } : {}),
            name: input.name,
            path,
            pathHash: sha256(path),
            ...(input.color ? { color: input.color } : {}),
            position: (lastSibling?.position ?? -1) + 1
          }
        });
        return groupItem(
          await requiredGroup(
            transaction,
            input.workspaceId,
            input.projectId,
            created.id
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
        const parentPath = parent?.path ?? parent?.name;
        if (
          parentPath === currentPath ||
          parentPath?.startsWith(`${currentPath} / `)
        ) {
          throw groupConflict("A group cannot be moved under its descendant");
        }
        const nextPath = groupPath(parentPath, input.name);
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
            path: nextPath,
            pathHash: sha256(nextPath),
            version: { increment: 1 }
          }
        });
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
    await this.prisma.$transaction(async (transaction) => {
      await lockGroupTree(transaction, input.projectId);
      await lockGroup(transaction, input.projectId, groupId);
      const current = await requiredGroup(
        transaction,
        input.workspaceId,
        input.projectId,
        groupId
      );
      assertVersion(current.version, input.version);
      const [childCount, membershipCount] = await Promise.all([
        transaction.keywordGroup.count({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            parentId: groupId,
            status: "ACTIVE"
          }
        }),
        transaction.keywordGroupMembership.count({
          where: {
            projectId: input.projectId,
            groupId,
            keyword: { status: "ACTIVE" }
          }
        })
      ]);
      if (childCount > 0 || membershipCount > 0) {
        throw groupConflict(
          "Move nested groups and keywords before deleting this group"
        );
      }
      const tombstonePath = `${current.path ?? current.name} [deleted ${groupId}]`;
      await transaction.keywordGroup.update({
        where: { id: groupId },
        data: {
          status: "DELETED",
          path: tombstonePath,
          pathHash: sha256(tombstonePath),
          version: { increment: 1 }
        }
      });
    });
  }
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

function groupItem(group: GroupAggregate): SemanticKeywordGroup {
  return {
    id: group.id,
    ...(group.parentId ? { parentId: group.parentId } : {}),
    name: group.name,
    path: group.path ?? group.name,
    ...(group.color ? { color: group.color } : {}),
    position: group.position,
    keywordCount: group._count.memberships,
    version: group.version,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString()
  };
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

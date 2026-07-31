import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  InternalCreateSemanticClusterInput,
  InternalDeleteSemanticClusterInput,
  InternalUpdateSemanticClusterInput,
  SemanticCluster
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

type ClusterRow = Prisma.ClusterGetPayload<Record<string, never>>;

@Injectable()
export class ClusterService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly SemanticCluster[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.cluster.findMany({
        where: { workspaceId, projectId, status: "ACTIVE" },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 2_000
      }),
      this.prisma.keyword.groupBy({
        by: ["clusterId"],
        where: {
          workspaceId,
          projectId,
          status: "ACTIVE",
          clusterId: { not: null }
        },
        _count: { _all: true }
      })
    ]);
    const countById = new Map(
      counts.flatMap((count) =>
        count.clusterId ? [[count.clusterId, count._count._all] as const] : []
      )
    );
    return rows.map((row) => clusterItem(row, countById.get(row.id) ?? 0));
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
      const row = await transaction.cluster.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name: input.name,
          method: "MANUAL",
          evidence: { source: "MANUAL", actorId: input.actorId }
        }
      });
      return clusterItem(row, 0);
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
      const row = await transaction.cluster.update({
        where: { id: clusterId },
        data: { name: input.name, version: { increment: 1 } }
      });
      const keywordCount = await transaction.keyword.count({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          clusterId,
          status: "ACTIVE"
        }
      });
      return clusterItem(row, keywordCount);
    });
  }

  public async delete(
    clusterId: string,
    input: InternalDeleteSemanticClusterInput
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockClusterSet(transaction, input.projectId);
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
          clusterId,
          status: "ACTIVE"
        }
      });
      if (keywordCount > 0) {
        throw clusterConflict(
          "Move keywords to another cluster before deleting this cluster"
        );
      }
      await transaction.cluster.update({
        where: { id: clusterId },
        data: { status: "DELETED", version: { increment: 1 } }
      });
    });
  }
}

async function requiredCluster(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  clusterId: string
): Promise<ClusterRow> {
  const cluster = await transaction.cluster.findFirst({
    where: { id: clusterId, workspaceId, projectId, status: "ACTIVE" }
  });
  if (!cluster) {
    throw new HttpException(
      { code: "NOT_FOUND", message: "Semantic cluster not found" },
      HttpStatus.NOT_FOUND
    );
  }
  return cluster;
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

function clusterItem(row: ClusterRow, keywordCount: number): SemanticCluster {
  if (row.method !== "MANUAL") {
    throw new HttpException(
      { code: "INVALID_UPSTREAM_RESPONSE", message: "Unsupported cluster method" },
      HttpStatus.BAD_GATEWAY
    );
  }
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    keywordCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
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

function clusterConflict(message: string): HttpException {
  return new HttpException(
    { code: "RESOURCE_STATE_CONFLICT", message },
    HttpStatus.CONFLICT
  );
}

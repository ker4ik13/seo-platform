import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  InternalCreateSemanticClusterInput,
  InternalDeleteSemanticClusterInput,
  InternalUpdateSemanticClusterInput,
  SemanticCluster,
  SemanticClusterPageSource
} from "@seo-platform/contracts";
import { semanticClusterPageSources } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

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

interface KeywordPageStats {
  keywordCount: number;
  mappedKeywordCount: number;
  unmappedKeywordCount: number;
  pageIds: Set<string>;
}

const PAGE_MAPPING_SOURCES = new Set<string>(semanticClusterPageSources);

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
      return clusterItem(row, keywordPageStats(counts).get(clusterId));
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
    throw new HttpException(
      { code: "PAGE_UNAVAILABLE", message: "Primary page is not active in this project" },
      HttpStatus.CONFLICT
    );
  }
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
  if (row.method !== "MANUAL") {
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
    method: row.method,
    keywordCount: stats.keywordCount,
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

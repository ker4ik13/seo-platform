import { Injectable } from "@nestjs/common";
import type { AdminProjectSemanticCounts, InternalSeoOverview } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class PlatformAdminReadService {
  public constructor(private readonly prisma: PrismaService) {}

  public async overview(): Promise<InternalSeoOverview> {
    const [activeKeywords, trashedKeywords, activeFolders, activated] = await Promise.all([
      this.prisma.keyword.count({ where: { status: "ACTIVE", deletedAt: null } }),
      this.prisma.keyword.count({ where: { status: "DELETED" } }),
      this.prisma.keywordGroup.count({ where: { status: "ACTIVE", systemKind: null } }),
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT count(DISTINCT workspace_id)::bigint AS count FROM keywords WHERE status = 'ACTIVE' AND deleted_at IS NULL`
    ]);
    return { activeKeywords, trashedKeywords, activeFolders, activatedWorkspaces: Number(activated[0]?.count ?? 0n) };
  }

  public async projectCounts(
    projectIds: readonly string[]
  ): Promise<readonly AdminProjectSemanticCounts[]> {
    const [keywords, folders] = await Promise.all([
      this.prisma.keyword.groupBy({
        by: ["projectId"],
        where: {
          projectId: { in: [...projectIds] },
          status: "ACTIVE",
          deletedAt: null
        },
        _count: { _all: true }
      }),
      this.prisma.keywordGroup.groupBy({
        by: ["projectId"],
        where: {
          projectId: { in: [...projectIds] },
          status: "ACTIVE",
          systemKind: null
        },
        _count: { _all: true }
      })
    ]);
    const keywordCount = new Map(
      keywords.map((item) => [item.projectId, item._count._all])
    );
    const folderCount = new Map(
      folders.map((item) => [item.projectId, item._count._all])
    );
    return projectIds.map((projectId) => ({
      projectId,
      keywordCount: keywordCount.get(projectId) ?? 0,
      folderCount: folderCount.get(projectId) ?? 0
    }));
  }
}

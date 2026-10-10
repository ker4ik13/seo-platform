import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { ProjectSummary } from "@seo-platform/contracts";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import type { RequestContext } from "../identity/identity.types.js";

@Injectable()
export class ProjectOnboardingService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly seoData: SeoDataClient,
  ) {}
  public async initialize(
    userId: string,
    project: ProjectSummary,
    request: RequestContext,
  ): Promise<void> {
    if (!project.onboarding) return;
    const receipt = await this.prisma.projectCreationReceipt.findUnique({
      where: { projectId: project.id },
    });
    if (
      !receipt ||
      receipt.actorId !== userId ||
      receipt.workspaceId !== project.workspaceId
    )
      throw new ServiceUnavailableException(
        "Project initialization receipt is unavailable",
      );
    if (receipt.provisionedAt) return;
    const tenant = await this.authorization.forProject(
      userId,
      project.id,
      "ranking.configure",
    );
    await this.seoData.initializeProjectOnboarding(
      { tenant, actorId: userId, requestId: request.requestId },
      project.onboarding,
    );
    await this.prisma.projectCreationReceipt.updateMany({
      where: {
        projectId: project.id,
        actorId: userId,
        workspaceId: project.workspaceId,
        provisionedAt: null,
      },
      data: { provisionedAt: new Date() },
    });
  }
}

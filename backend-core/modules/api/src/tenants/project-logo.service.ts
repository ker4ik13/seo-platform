import { Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  projectLogoContentTypes,
  type ProjectLogoContentType,
  type ProjectSummary
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import {
  DomainError,
  isUniqueConstraintError
} from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { RequestContext } from "../identity/identity.types.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { discoverProjectLogo } from "./project-logo-discovery.js";
import type { ProjectLogoInput } from "./tenant-input.js";
import { toProjectSummary } from "./tenant.mapper.js";

const DISCOVERY_FAILURE_TTL_MS = 15 * 60 * 1_000;

export interface ProjectLogoImage {
  readonly contentType: ProjectLogoContentType;
  readonly data: Buffer;
  readonly updatedAt: Date;
}

@Injectable()
export class ProjectLogoService {
  private readonly discoveries = new Map<
    string,
    Promise<ProjectLogoImage>
  >();

  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService
  ) {}

  public async get(projectId: string): Promise<ProjectLogoImage> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        domain: true,
        status: true,
        logo: true
      }
    });
    if (!project || ["DELETING", "DELETED"].includes(project.status)) {
      throw notFound();
    }
    const cached = storedLogo(project.logo, project.domain);
    if (cached) return cached;
    if (
      project.logo?.source === null &&
      project.logo.sourceDomain === project.domain &&
      project.logo.discoveryAttemptedAt &&
      Date.now() - project.logo.discoveryAttemptedAt.getTime() <
        DISCOVERY_FAILURE_TTL_MS
    ) {
      throw notFound();
    }
    const key = `${project.id}:${project.domain}`;
    const active = this.discoveries.get(key);
    if (active) return active;
    const discovery = this.discoverAndStore(project.id, project.domain).finally(
      () => this.discoveries.delete(key)
    );
    this.discoveries.set(key, discovery);
    return discovery;
  }

  public async update(
    userId: string,
    projectId: string,
    version: number,
    input: ProjectLogoInput,
    context: RequestContext
  ): Promise<ProjectSummary> {
    return this.setCustomLogo(userId, projectId, version, input, context);
  }

  public async delete(
    userId: string,
    projectId: string,
    version: number,
    context: RequestContext
  ): Promise<ProjectSummary> {
    return this.setCustomLogo(userId, projectId, version, undefined, context);
  }

  private async setCustomLogo(
    userId: string,
    projectId: string,
    version: number,
    logo: ProjectLogoInput | undefined,
    context: RequestContext
  ): Promise<ProjectSummary> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.project.updateMany({
        where: {
          id: projectId,
          version,
          status: { in: ["DRAFT", "ACTIVE"] }
        },
        data: { version: { increment: 1 } }
      });
      if (updated.count !== 1) throw versionConflict();
      if (logo) {
        const imageUpdatedAt = new Date();
        await transaction.projectLogo.upsert({
          where: { projectId },
          create: {
            projectId,
            source: "CUSTOM",
            contentType: logo.contentType,
            data: prismaBytes(logo.data),
            imageUpdatedAt
          },
          update: {
            source: "CUSTOM",
            sourceDomain: null,
            contentType: logo.contentType,
            data: prismaBytes(logo.data),
            imageUpdatedAt,
            discoveryAttemptedAt: null
          }
        });
      } else {
        await transaction.projectLogo.deleteMany({ where: { projectId } });
      }
      const project = await transaction.project.findUniqueOrThrow({
        where: { id: projectId },
        include: {
          logo: {
            select: { source: true, imageUpdatedAt: true }
          }
        }
      });
      await this.audit.record(
        {
          actorId: userId,
          workspaceId: project.workspaceId,
          projectId,
          action: logo ? "project.logo.updated" : "project.logo.deleted",
          resourceType: "project",
          resourceId: projectId,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.projectUpdated,
        aggregateType: "project",
        aggregateId: projectId,
        aggregateVersion: project.version,
        workspaceId: project.workspaceId,
        projectId,
        payload: { projectId, workspaceId: project.workspaceId },
        requestId: context.requestId
      });
      return toProjectSummary(project, undefined, project.logo);
    });
  }

  private async discoverAndStore(
    projectId: string,
    domain: string
  ): Promise<ProjectLogoImage> {
    const discovered = await discoverProjectLogo(domain);
    const attemptedAt = new Date();
    if (!discovered) {
      const stored = await this.writeDiscoveredCache(projectId, {
        source: null,
        sourceDomain: domain,
        contentType: null,
        data: null,
        imageUpdatedAt: null,
        discoveryAttemptedAt: attemptedAt
      });
      const concurrentCustomLogo = storedLogo(stored, domain);
      if (concurrentCustomLogo) return concurrentCustomLogo;
      throw notFound();
    }
    const stored = await this.writeDiscoveredCache(projectId, {
      source: "DISCOVERED",
      sourceDomain: domain,
      contentType: discovered.contentType,
      data: prismaBytes(discovered.data),
      imageUpdatedAt: attemptedAt,
      discoveryAttemptedAt: attemptedAt
    });
    const result = storedLogo(stored, domain);
    if (!result) throw notFound();
    return result;
  }

  private async writeDiscoveredCache(
    projectId: string,
    data: Readonly<{
      source: "DISCOVERED" | null;
      sourceDomain: string;
      contentType: ProjectLogoContentType | null;
      data: Uint8Array<ArrayBuffer> | null;
      imageUpdatedAt: Date | null;
      discoveryAttemptedAt: Date;
    }>
  ) {
    const updated = await this.prisma.projectLogo.updateMany({
      where: {
        projectId,
        OR: [{ source: null }, { source: "DISCOVERED" }]
      },
      data
    });
    if (updated.count === 0) {
      try {
        await this.prisma.projectLogo.create({
          data: { projectId, ...data }
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
    return this.prisma.projectLogo.findUnique({ where: { projectId } });
  }
}

function storedLogo(
  logo: Readonly<{
    source: string | null;
    sourceDomain: string | null;
    contentType: string | null;
    data: Uint8Array | null;
    imageUpdatedAt: Date | null;
  }> | null,
  domain: string
): ProjectLogoImage | undefined {
  if (
    !logo ||
    (logo.source !== "CUSTOM" && logo.source !== "DISCOVERED") ||
    (logo.source === "DISCOVERED" && logo.sourceDomain !== domain) ||
    !logo.contentType ||
    !isProjectLogoContentType(logo.contentType) ||
    !logo.data ||
    !logo.imageUpdatedAt
  ) {
    return undefined;
  }
  return {
    contentType: logo.contentType,
    data: Buffer.from(logo.data),
    updatedAt: logo.imageUpdatedAt
  };
}

function isProjectLogoContentType(
  value: string
): value is ProjectLogoContentType {
  return projectLogoContentTypes.some((contentType) => contentType === value);
}

function versionConflict(): DomainError {
  return new DomainError({
    statusCode: 412,
    code: "VERSION_CONFLICT",
    message: "Resource was changed by another user"
  });
}

function notFound(): DomainError {
  return new DomainError({
    statusCode: 404,
    code: "NOT_FOUND",
    message: "Project logo was not found"
  });
}

function prismaBytes(data: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return bytes;
}

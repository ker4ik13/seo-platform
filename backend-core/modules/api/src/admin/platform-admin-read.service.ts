import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type {
  AdminOperationSearchResult,
  AdminOperationSummary,
  AdminProjectSearchResult,
  AdminProjectSummary,
  AdminWorkspaceOwnerSummary,
  InternalAdminOperationSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import type {
  AdminOperationQuery,
  AdminProjectQuery
} from "./platform-admin-read-input.js";

const PROJECT_SEARCH_LIMIT = 50;

@Injectable()
export class PlatformAdminReadService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly seoData: SeoDataClient,
    private readonly jobs: JobsClient,
    private readonly audit: AuditService
  ) {}

  public async projects(
    query: AdminProjectQuery,
    actorId: string,
    requestId: string
  ): Promise<AdminProjectSearchResult> {
    const userIds = query.search
      ? await this.matchingUserIds(query.search)
      : [];
    const idQuery = UUID_PATTERN.test(query.search)
      ? query.search.toLowerCase()
      : undefined;
    const searchWhere: Prisma.ProjectWhereInput = query.search
      ? {
          OR: [
            ...(idQuery ? [{ id: idQuery }, { workspaceId: idQuery }] : []),
            { name: { contains: query.search, mode: "insensitive" } },
            { slug: { contains: query.search, mode: "insensitive" } },
            { domain: { contains: query.search, mode: "insensitive" } },
            {
              workspace: {
                is: {
                  OR: [
                    { name: { contains: query.search, mode: "insensitive" } },
                    { slug: { contains: query.search, mode: "insensitive" } }
                  ]
                }
              }
            },
            ...(userIds.length > 0
              ? [
                  { ownerUserId: { in: userIds } },
                  { createdBy: { in: userIds } }
                ]
              : [])
          ]
        }
      : {};
    const projects = await this.prisma.project.findMany({
      where: {
        ...searchWhere,
        ...(query.status ? { status: query.status } : {})
      },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        slug: true,
        domain: true,
        status: true,
        createdBy: true,
        ownerUserId: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        workspace: {
          select: { id: true, name: true, slug: true, status: true }
        }
      },
      orderBy: query.sort === "NAME_ASC" ? [{ name: "asc" }, { id: "asc" }] : query.sort === "NAME_DESC" ? [{ name: "desc" }, { id: "desc" }] : query.sort === "CREATED_ASC" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
      take: PROJECT_SEARCH_LIMIT + 1
    });
    const page = projects.slice(0, PROJECT_SEARCH_LIMIT);
    const people = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              page.flatMap((project) => [project.ownerUserId, project.createdBy])
            )
          ]
        }
      },
      select: {
        id: true,
        emailDisplay: true,
        displayName: true,
        status: true
        , version: true
      }
    });
    const personById = new Map(people.map((person) => [person.id, person]));
    let semanticCountsAvailable = true;
    let counts = new Map<string, { keywordCount: number; folderCount: number }>();
    if (page.length > 0) {
      try {
        const values = await this.seoData.adminProjectCounts(
          page.map((project) => project.id),
          actorId,
          requestId
        );
        counts = new Map(
          values.map((value) => [
            value.projectId,
            {
              keywordCount: value.keywordCount,
              folderCount: value.folderCount
            }
          ])
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        semanticCountsAvailable = false;
      }
    }
    return {
      data: page.map((project) => {
        const projectCounts = counts.get(project.id);
        return {
          id: project.id,
          workspaceId: project.workspaceId,
          name: project.name,
          slug: project.slug,
          domain: project.domain,
          status: project.status,
          workspace: project.workspace,
          owner: personSummary(personById.get(project.ownerUserId), project.ownerUserId),
          author: personSummary(personById.get(project.createdBy), project.createdBy),
          keywordCount: projectCounts?.keywordCount ?? null,
          folderCount: projectCounts?.folderCount ?? null,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString()
        } satisfies AdminProjectSummary;
      }),
      truncated: projects.length > PROJECT_SEARCH_LIMIT,
      semanticCountsAvailable
    };
  }

  public async operations(
    query: AdminOperationQuery,
    actorId: string,
    requestId: string
  ): Promise<AdminOperationSearchResult> {
    const result = await this.jobs.listAdminOperations(actorId, requestId, query);
    return {
      ...result,
      data: await this.enrichOperations(result.data)
    };
  }

  public async operation(
    operationId: string,
    actorId: string,
    requestId: string
  ): Promise<AdminOperationSummary> {
    const operation = await this.jobs.getAdminOperation(
      actorId,
      requestId,
      operationId
    );
    const [enriched] = await this.enrichOperations([operation]);
    if (!enriched) {
      throw new DomainError({
        statusCode: 502,
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Operation detail is unavailable"
      });
    }
    return enriched;
  }

  public async cancelOperation(operationId: string, actorId: string, requestId: string, reason: string): Promise<AdminOperationSummary> {
    const current = await this.operation(operationId, actorId, requestId);
    await this.audit.record({ actorId, workspaceId: current.workspaceId, ...(current.projectId ? { projectId: current.projectId } : {}), action: "platform_admin.operation.cancel_requested", resourceType: "job", resourceId: operationId, reason, outcome: "REQUESTED", requestId });
    await this.jobs.cancelAdminOperation(actorId, requestId, operationId);
    await this.audit.record({ actorId, workspaceId: current.workspaceId, action: "platform_admin.operation.cancel_resolved", resourceType: "job", resourceId: operationId, reason, requestId });
    return this.operation(operationId, actorId, requestId);
  }

  private async enrichOperations(
    operations: readonly InternalAdminOperationSummary[]
  ): Promise<AdminOperationSummary[]> {
    const workspaceIds = [...new Set(operations.map((item) => item.workspaceId))];
    const projectIds = [
      ...new Set(operations.flatMap((item) => item.projectId ? [item.projectId] : []))
    ];
    const actorIds = [
      ...new Set(operations.flatMap((item) => item.actorId ? [item.actorId] : []))
    ];
    const [workspaces, projects, actors] = await Promise.all([
      this.prisma.workspace.findMany({
        where: { id: { in: workspaceIds } },
        select: { id: true, name: true }
      }),
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, domain: true }
      }),
      this.prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, displayName: true, emailDisplay: true }
      })
    ]);
    const workspaceById = new Map(workspaces.map((item) => [item.id, item]));
    const projectById = new Map(projects.map((item) => [item.id, item]));
    const actorById = new Map(actors.map((item) => [item.id, item]));
    return operations.map((item) => {
        const actor = item.actorId ? actorById.get(item.actorId) : undefined;
        return {
          ...item,
          workspace: workspaceById.get(item.workspaceId) ?? null,
          project: item.projectId ? projectById.get(item.projectId) ?? null : null,
          actor: actor
            ? {
                id: actor.id,
                displayName: actor.displayName,
                email: actor.emailDisplay
              }
            : null
        };
      });
  }

  private async matchingUserIds(query: string): Promise<string[]> {
    const people = await this.prisma.user.findMany({
      where: {
        OR: [
          { emailNormalized: { contains: query.toLowerCase() } },
          { emailDisplay: { contains: query, mode: "insensitive" } },
          { displayName: { contains: query, mode: "insensitive" } }
        ]
      },
      select: { id: true },
      take: PROJECT_SEARCH_LIMIT + 1
    });
    return people.map((person) => person.id);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function personSummary(
  person:
    | {
        readonly id: string;
        readonly emailDisplay: string;
        readonly displayName: string;
        readonly status: AdminWorkspaceOwnerSummary["status"];
        readonly version?: number;
      }
    | undefined,
  userId: string
): AdminWorkspaceOwnerSummary {
  return person
    ? {
        userId: person.id,
        email: person.emailDisplay,
        displayName: person.displayName,
        status: person.status,
        ...(person.version ? { version: person.version } : {})
      }
    : {
        userId,
        email: "",
        displayName: "Пользователь не найден",
        status: "DELETED"
      };
}

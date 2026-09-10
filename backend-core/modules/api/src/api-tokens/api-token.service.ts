import { Injectable, Logger } from "@nestjs/common";
import {
  apiTokenScopes,
  type ApiTokenAccessDiscovery,
  type ApiTokenCollection,
  type ApiTokenScope,
  type ApiTokenSummary,
  type CreateApiTokenInput,
  type IssuedApiToken,
  type UpdateApiTokenInput
} from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { AuditService } from "../audit/audit.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { hasSystemPermission } from "../authorization/permissions.js";
import { DomainError } from "../common/domain-error.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthCryptoService } from "../identity/auth-crypto.service.js";
import type {
  ApiTokenAuthorization,
  RequestContext
} from "../identity/identity.types.js";

type StoredApiToken = Prisma.ApiTokenGetPayload<{
  include: { projectAccesses: { select: { projectId: true } } };
}>;

const MINIMUM_EXPIRY_LEAD_MS = 5 * 60 * 1_000;
const MAXIMUM_EXPIRY_LEAD_MS = 10 * 365 * 24 * 60 * 60 * 1_000;
const ROTATION_GRACE_MS = 10 * 60 * 1_000;

@Injectable()
export class ApiTokenService {
  private readonly logger = new Logger(ApiTokenService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService
  ) {}

  public async list(
    workspaceId: string,
    actorId: string
  ): Promise<ApiTokenCollection> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { workspaceId, createdBy: actorId, revokedAt: null },
      include: {
        projectAccesses: {
          where: {
            project: {
              workspaceId,
              status: { notIn: ["DELETING", "DELETED"] },
              deletedAt: null
            }
          },
          orderBy: { projectId: "asc" },
          select: { projectId: true }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return { tokens: tokens.map(toApiTokenSummary) };
  }

  public async discover(
    actorId: string,
    token: ApiTokenAuthorization
  ): Promise<ApiTokenAccessDiscovery> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: token.workspaceId,
          userId: actorId
        }
      },
      select: {
        id: true,
        status: true,
        roleCode: true,
        allProjects: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true
          }
        }
      }
    });
    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      ["DELETING", "DELETED"].includes(membership.workspace.status)
    ) {
      discoveryNotFound();
    }
    if (membership.workspace.status === "SUSPENDED") {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Workspace access is suspended"
      });
    }
    if (
      !["ACTIVE", "READ_ONLY"].includes(membership.workspace.status) ||
      !hasSystemPermission(membership.roleCode, "project.view")
    ) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Project access is unavailable"
      });
    }

    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId: token.workspaceId,
        status: { notIn: ["DELETING", "DELETED"] },
        ...(membership.allProjects
          ? {
              memberAccesses: {
                none: { memberId: membership.id, level: "NONE" }
              }
            }
          : {
              memberAccesses: {
                some: {
                  memberId: membership.id,
                  level: { not: "NONE" }
                }
              }
            })
      },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        slug: true,
        domain: true,
        status: true,
        memberAccesses: {
          where: { memberId: membership.id },
          select: { level: true },
          take: 1
        }
      },
      orderBy: [
        { displayOrder: "asc" },
        { createdAt: "asc" },
        { id: "asc" }
      ]
    });
    const tokenProjectIds = new Set(token.projectIds);
    const visibleProjects = token.allProjects
      ? projects
      : projects.filter(({ id }) => tokenProjectIds.has(id));
    const workspaceStatus = membership.workspace.status;
    if (workspaceStatus !== "ACTIVE" && workspaceStatus !== "READ_ONLY") {
      throw new Error("Unexpected workspace status after discovery checks");
    }

    return {
      apiVersion: "v1",
      token: {
        id: token.tokenId,
        name: token.name,
        scopes: token.scopes,
        allProjects: token.allProjects
      },
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        status: workspaceStatus
      },
      projects: visibleProjects.map(({ memberAccesses, ...project }) => {
        const accessLevel = memberAccesses[0]?.level;
        return {
          ...project,
          status: discoveredProjectStatus(project.status),
          ...(accessLevel && accessLevel !== "NONE"
            ? { accessLevel }
            : {})
        };
      })
    };
  }

  public async create(
    workspaceId: string,
    actorId: string,
    input: CreateApiTokenInput,
    context: RequestContext
  ): Promise<IssuedApiToken> {
    const expiresAt = validatedExpiry(input.expiresAt);
    await this.assertProjectAccess(
      workspaceId,
      actorId,
      input.allProjects,
      input.projectIds
    );
    await this.audit.record({
      actorId,
      workspaceId,
      action: "api_token.create_requested",
      resourceType: "api_token",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const issued = issueToken(this.crypto);
    const token = await this.prisma.apiToken.create({
      data: {
        workspaceId,
        createdBy: actorId,
        name: input.name,
        prefix: issued.prefix,
        tokenHash: this.crypto.hashOpaqueToken(issued.token),
        scopes: scopesJson(input.scopes),
        allProjects: input.allProjects,
        ...(expiresAt ? { expiresAt } : {}),
        ...(input.allProjects
          ? {}
          : {
              projectAccesses: {
                createMany: {
                  data: input.projectIds.map((projectId) => ({
                    projectId
                  }))
                }
              }
            })
      },
      include: {
        projectAccesses: {
          orderBy: { projectId: "asc" },
          select: { projectId: true }
        }
      }
    });
    await recordCommittedAudit(this.audit, this.logger, {
      actorId,
      workspaceId,
      action: "api_token.created",
      resourceType: "api_token",
      resourceId: token.id,
      outcome: "SUCCESS",
      redactedChanges: {
        scopes: [...input.scopes],
        allProjects: input.allProjects,
        projectCount: input.projectIds.length,
        expiresAt: input.expiresAt
      },
      requestId: context.requestId
    });
    return { ...toApiTokenSummary(token), token: issued.token };
  }

  public async update(
    workspaceId: string,
    actorId: string,
    tokenId: string,
    expectedVersion: number,
    input: UpdateApiTokenInput,
    context: RequestContext
  ): Promise<ApiTokenSummary> {
    const expiresAt = validatedExpiry(input.expiresAt);
    await this.assertProjectAccess(
      workspaceId,
      actorId,
      input.allProjects,
      input.projectIds
    );
    await this.audit.record({
      actorId,
      workspaceId,
      action: "api_token.update_requested",
      resourceType: "api_token",
      resourceId: tokenId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const token = await this.prisma.$transaction(async (transaction) => {
      await assertOwnedToken(
        transaction,
        workspaceId,
        actorId,
        tokenId,
        expectedVersion
      );
      const changed = await transaction.apiToken.updateMany({
        where: {
          id: tokenId,
          workspaceId,
          createdBy: actorId,
          version: expectedVersion
        },
        data: {
          name: input.name,
          scopes: scopesJson(input.scopes),
          allProjects: input.allProjects,
          expiresAt,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) versionConflict();
      await transaction.apiTokenProjectAccess.deleteMany({
        where: { apiTokenId: tokenId, workspaceId }
      });
      if (!input.allProjects) {
        await transaction.apiTokenProjectAccess.createMany({
          data: input.projectIds.map((projectId) => ({
            apiTokenId: tokenId,
            workspaceId,
            projectId
          }))
        });
      }
      return requiredToken(transaction, workspaceId, actorId, tokenId);
    });
    await recordCommittedAudit(this.audit, this.logger, {
      actorId,
      workspaceId,
      action: "api_token.updated",
      resourceType: "api_token",
      resourceId: token.id,
      outcome: "SUCCESS",
      redactedChanges: {
        scopes: [...input.scopes],
        allProjects: input.allProjects,
        projectCount: input.projectIds.length,
        expiresAt: input.expiresAt
      },
      requestId: context.requestId
    });
    return toApiTokenSummary(token);
  }

  public async rotate(
    workspaceId: string,
    actorId: string,
    tokenId: string,
    expectedVersion: number,
    context: RequestContext
  ): Promise<IssuedApiToken> {
    await this.audit.record({
      actorId,
      workspaceId,
      action: "api_token.rotate_requested",
      resourceType: "api_token",
      resourceId: tokenId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const issued = issueToken(this.crypto);
    const token = await this.prisma.$transaction(async (transaction) => {
      const current = await assertOwnedToken(
        transaction,
        workspaceId,
        actorId,
        tokenId,
        expectedVersion
      );
      if (
        current.revokedAt !== null ||
        (current.expiresAt !== null && current.expiresAt <= new Date())
      ) {
        throw new DomainError({
          statusCode: 409,
          code: "RESOURCE_STATE_CONFLICT",
          message: "Only an active API token can be rotated"
        });
      }
      const changed = await transaction.apiToken.updateMany({
        where: {
          id: tokenId,
          workspaceId,
          createdBy: actorId,
          version: expectedVersion,
          revokedAt: null
        },
        data: {
          previousTokenHash: current.tokenHash,
          previousTokenValidUntil: new Date(Date.now() + ROTATION_GRACE_MS),
          prefix: issued.prefix,
          tokenHash: this.crypto.hashOpaqueToken(issued.token),
          lastUsedAt: null,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) versionConflict();
      return requiredToken(transaction, workspaceId, actorId, tokenId);
    });
    await recordCommittedAudit(this.audit, this.logger, {
      actorId,
      workspaceId,
      action: "api_token.rotated",
      resourceType: "api_token",
      resourceId: token.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return { ...toApiTokenSummary(token), token: issued.token };
  }

  public async revoke(
    workspaceId: string,
    actorId: string,
    tokenId: string,
    expectedVersion: number,
    context: RequestContext
  ): Promise<ApiTokenSummary> {
    await this.audit.record({
      actorId,
      workspaceId,
      action: "api_token.revoke_requested",
      resourceType: "api_token",
      resourceId: tokenId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const token = await this.prisma.$transaction(async (transaction) => {
      const current = await assertOwnedToken(
        transaction,
        workspaceId,
        actorId,
        tokenId,
        expectedVersion
      );
      if (current.revokedAt !== null) return current;
      const changed = await transaction.apiToken.updateMany({
        where: {
          id: tokenId,
          workspaceId,
          createdBy: actorId,
          version: expectedVersion,
          revokedAt: null
        },
        data: {
          revokedAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) versionConflict();
      return requiredToken(transaction, workspaceId, actorId, tokenId);
    });
    await recordCommittedAudit(this.audit, this.logger, {
      actorId,
      workspaceId,
      action: "api_token.revoked",
      resourceType: "api_token",
      resourceId: token.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return toApiTokenSummary(token);
  }

  private async assertProjectAccess(
    workspaceId: string,
    actorId: string,
    allProjects: boolean,
    projectIds: readonly string[]
  ): Promise<void> {
    if (allProjects) return;
    const tenants = await Promise.all(
      projectIds.map((projectId) =>
        this.authorization.forProject(actorId, projectId, "project.view")
      )
    );
    if (tenants.some((tenant) => tenant.workspaceId !== workspaceId)) {
      throw new DomainError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Project not found"
      });
    }
  }
}

async function assertOwnedToken(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  tokenId: string,
  expectedVersion: number
): Promise<StoredApiToken> {
  const token = await transaction.apiToken.findFirst({
    where: { id: tokenId, workspaceId, createdBy: actorId },
    include: {
      projectAccesses: {
        orderBy: { projectId: "asc" },
        select: { projectId: true }
      }
    }
  });
  if (!token) {
    throw new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "API token not found"
    });
  }
  if (token.version !== expectedVersion) versionConflict(token.version);
  return token;
}

async function requiredToken(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  tokenId: string
): Promise<StoredApiToken> {
  const token = await transaction.apiToken.findFirst({
    where: { id: tokenId, workspaceId, createdBy: actorId },
    include: {
      projectAccesses: {
        orderBy: { projectId: "asc" },
        select: { projectId: true }
      }
    }
  });
  if (!token) throw new Error("Committed API token is missing");
  return token;
}

function issueToken(crypto: AuthCryptoService): {
  readonly token: string;
  readonly prefix: string;
} {
  const token = `seo_pat_${crypto.randomToken()}`;
  return { token, prefix: token.slice(0, 20) };
}

function validatedExpiry(value: string | null): Date | null {
  if (value === null) return null;
  const expiresAt = new Date(value);
  const lead = expiresAt.getTime() - Date.now();
  if (
    Number.isNaN(expiresAt.getTime()) ||
    lead < MINIMUM_EXPIRY_LEAD_MS ||
    lead > MAXIMUM_EXPIRY_LEAD_MS
  ) {
    throw new DomainError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "API token expiration must be between five minutes and ten years"
    });
  }
  return expiresAt;
}

function scopesJson(scopes: readonly ApiTokenScope[]): Prisma.InputJsonValue {
  return [...scopes] as Prisma.InputJsonValue;
}

function toApiTokenSummary(token: StoredApiToken): ApiTokenSummary {
  const now = Date.now();
  return {
    id: token.id,
    workspaceId: token.workspaceId,
    name: token.name,
    prefix: token.prefix,
    scopes: storedScopes(token.scopes),
    allProjects: token.allProjects,
    projectIds: token.projectAccesses.map(({ projectId }) => projectId),
    status:
      token.revokedAt !== null
        ? "REVOKED"
        : token.expiresAt !== null && token.expiresAt.getTime() <= now
          ? "EXPIRED"
          : "ACTIVE",
    ...(token.expiresAt
      ? { expiresAt: token.expiresAt.toISOString() }
      : {}),
    ...(token.lastUsedAt
      ? { lastUsedAt: token.lastUsedAt.toISOString() }
      : {}),
    ...(token.revokedAt
      ? { revokedAt: token.revokedAt.toISOString() }
      : {}),
    ...(token.previousTokenValidUntil
      ? {
          previousTokenValidUntil:
            token.previousTokenValidUntil.toISOString()
        }
      : {}),
    version: token.version,
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString()
  };
}

function storedScopes(value: unknown): readonly ApiTokenScope[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > apiTokenScopes.length ||
    value.some(
      (scope) =>
        typeof scope !== "string" ||
        !(apiTokenScopes as readonly string[]).includes(scope)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Invalid stored API token scopes");
  }
  const scopes = new Set(value);
  return apiTokenScopes.filter((scope) => scopes.has(scope));
}

function versionConflict(currentVersion?: number): never {
  throw new DomainError({
    statusCode: 412,
    code: "VERSION_CONFLICT",
    message: "API token version conflict",
    ...(currentVersion === undefined
      ? {}
      : { details: { currentVersion } })
  });
}

function discoveryNotFound(): never {
  throw new DomainError({
    statusCode: 404,
    code: "NOT_FOUND",
    message: "API token access is unavailable"
  });
}

function discoveredProjectStatus(
  status: string
): "DRAFT" | "ACTIVE" | "ARCHIVED" {
  if (status === "DRAFT" || status === "ACTIVE" || status === "ARCHIVED") {
    return status;
  }
  throw new Error("Unexpected project status after discovery checks");
}

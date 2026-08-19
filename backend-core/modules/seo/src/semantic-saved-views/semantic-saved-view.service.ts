import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type {
  InternalCreateSemanticSavedViewInput,
  InternalDeleteSemanticSavedViewInput,
  InternalUpdateSemanticSavedViewInput,
  SemanticSavedView,
  SemanticSavedViewConfig
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

type SavedViewRow = Prisma.SemanticSavedViewGetPayload<Record<string, never>>;

@Injectable()
export class SemanticSavedViewService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(
    workspaceId: string,
    projectId: string,
    actorId: string
  ): Promise<readonly SemanticSavedView[]> {
    const rows = await this.prisma.semanticSavedView.findMany({
      where: {
        workspaceId,
        projectId,
        status: "ACTIVE",
        OR: [{ scope: "PROJECT_SHARED" }, { ownerId: actorId }]
      },
      orderBy: [
        { scope: "asc" },
        { normalizedName: "asc" },
        { id: "asc" }
      ],
      take: 500
    });
    return rows.map(savedView);
  }

  public async create(
    input: InternalCreateSemanticSavedViewInput
  ): Promise<SemanticSavedView> {
    if (input.scope === "PROJECT_SHARED" && !input.canManageShared) {
      throw sharedViewForbidden();
    }
    try {
      return savedView(
        await this.prisma.semanticSavedView.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            ownerId: input.actorId,
            scope: input.scope,
            name: input.name,
            normalizedName: normalizeViewName(input.name),
            config: jsonConfig(input.config)
          }
        })
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateView();
      throw error;
    }
  }

  public async update(
    viewId: string,
    input: InternalUpdateSemanticSavedViewInput
  ): Promise<SemanticSavedView> {
    await this.requiredAccessibleView(viewId, input);
    try {
      const result = await this.prisma.semanticSavedView.updateMany({
        where: {
          id: viewId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "ACTIVE",
          version: input.version,
          OR: mutableViewWhere(input)
        },
        data: {
          ...(input.name === undefined
            ? {}
            : {
                name: input.name,
                normalizedName: normalizeViewName(input.name)
              }),
          ...(input.config === undefined
            ? {}
            : { config: jsonConfig(input.config) }),
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) {
        await this.throwCurrentState(viewId, input);
      }
      return savedView(
        await this.prisma.semanticSavedView.findUniqueOrThrow({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: viewId
            }
          }
        })
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateView();
      throw error;
    }
  }

  public async delete(
    viewId: string,
    input: InternalDeleteSemanticSavedViewInput
  ): Promise<void> {
    await this.requiredAccessibleView(viewId, input);
    const result = await this.prisma.semanticSavedView.updateMany({
      where: {
        id: viewId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        version: input.version,
        OR: mutableViewWhere(input)
      },
      data: {
        status: "DELETED",
        normalizedName: `${viewId}:deleted`,
        deletedAt: new Date(),
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) {
      await this.throwCurrentState(viewId, input);
    }
  }

  private async requiredAccessibleView(
    viewId: string,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly canManageShared: boolean;
    }
  ): Promise<SavedViewRow> {
    const row = await this.prisma.semanticSavedView.findFirst({
      where: {
        id: viewId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: "ACTIVE",
        OR: mutableViewWhere(input)
      }
    });
    if (!row) throw viewNotFound();
    return row;
  }

  private async throwCurrentState(
    viewId: string,
    input: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly canManageShared: boolean;
      readonly version: number;
    }
  ): Promise<never> {
    const current = await this.requiredAccessibleView(viewId, input);
    throw new HttpException(
      {
        code: "VERSION_CONFLICT",
        message: "Semantic saved view version conflict",
        currentVersion: current.version
      },
      HttpStatus.PRECONDITION_FAILED
    );
  }
}

function savedView(row: SavedViewRow): SemanticSavedView {
  return {
    id: row.id,
    ownerId: row.ownerId,
    scope: row.scope,
    name: row.name,
    config: row.config as unknown as SemanticSavedViewConfig,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function jsonConfig(config: SemanticSavedViewConfig): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(config)) as Prisma.InputJsonObject;
}

function normalizeViewName(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

function viewNotFound(): HttpException {
  return new HttpException(
    { code: "NOT_FOUND", message: "Semantic saved view not found" },
    HttpStatus.NOT_FOUND
  );
}

function duplicateView(): HttpException {
  return new HttpException(
    {
      code: "DUPLICATE",
      message: "A saved view with this name already exists"
    },
    HttpStatus.CONFLICT
  );
}

function mutableViewWhere(input: {
  readonly actorId: string;
  readonly canManageShared: boolean;
}): (
  | { readonly ownerId: string; readonly scope: "PRIVATE" }
  | { readonly scope: "PROJECT_SHARED" }
)[] {
  return input.canManageShared
    ? [
        { ownerId: input.actorId, scope: "PRIVATE" },
        { scope: "PROJECT_SHARED" }
      ]
    : [{ ownerId: input.actorId, scope: "PRIVATE" }];
}

function sharedViewForbidden(): HttpException {
  return new HttpException(
    {
      code: "FORBIDDEN",
      message: "Only workspace administrators can manage shared views"
    },
    HttpStatus.FORBIDDEN
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

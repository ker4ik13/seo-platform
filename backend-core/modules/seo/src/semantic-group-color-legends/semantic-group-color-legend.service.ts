import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type {
  InternalMarkSemanticGroupColorLegendSeenInput,
  InternalUpdateSemanticGroupColorLegendInput,
  SemanticGroupColorLegendEntry,
  SemanticGroupColorLegendState
} from "@seo-platform/contracts";
import type { SemanticGroupColorLegend } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { semanticGroupColorLegendEntries } from "./semantic-group-color-legend-input.js";

@Injectable()
export class SemanticGroupColorLegendService {
  public constructor(private readonly prisma: PrismaService) {}

  public async get(
    workspaceId: string,
    projectId: string,
    actorId: string
  ): Promise<SemanticGroupColorLegendState> {
    const legend = await this.prisma.semanticGroupColorLegend.findFirst({
      where: { workspaceId, projectId }
    });
    if (!legend) return emptyLegend();
    const receipt = await this.prisma.semanticGroupColorLegendRead.findUnique({
      where: {
        legendId_userId: { legendId: legend.id, userId: actorId }
      },
      select: { seenVersion: true }
    });
    return state(legend, (receipt?.seenVersion ?? 0) < legend.version);
  }

  public async update(
    input: InternalUpdateSemanticGroupColorLegendInput
  ): Promise<SemanticGroupColorLegendState> {
    if (!input.canManage) {
      throw new ForbiddenException("Semantic group color legend management is not allowed");
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`semantic-group-color-legend:${input.projectId}`}, 0)
        ) IS NULL AS "lockResult"
      `;
      const current = await transaction.semanticGroupColorLegend.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== input.version) versionConflict(currentVersion);
      const entries = input.entries.map(({ color, note }) => ({ color, note }));
      const legend = current
        ? await transaction.semanticGroupColorLegend.update({
            where: { id: current.id },
            data: {
              entries,
              updatedByUserId: input.actorId,
              version: { increment: 1 }
            }
          })
        : await transaction.semanticGroupColorLegend.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              entries,
              updatedByUserId: input.actorId
            }
          });
      await transaction.semanticGroupColorLegendRead.upsert({
        where: {
          legendId_userId: {
            legendId: legend.id,
            userId: input.actorId
          }
        },
        create: {
          legendId: legend.id,
          userId: input.actorId,
          seenVersion: legend.version
        },
        update: { seenVersion: legend.version }
      });
      return state(legend, false);
    });
  }

  public async markSeen(
    input: InternalMarkSemanticGroupColorLegendSeenInput
  ): Promise<SemanticGroupColorLegendState> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`semantic-group-color-legend:${input.projectId}`}, 0)
        ) IS NULL AS "lockResult"
      `;
      const legend = await transaction.semanticGroupColorLegend.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      if (!legend) return emptyLegend();
      if (input.version > legend.version) versionConflict(legend.version);
      if (input.version > 0) {
        await transaction.$executeRaw`
          INSERT INTO "semantic_group_color_legend_reads"
            ("legend_id", "user_id", "seen_version", "seen_at")
          VALUES
            (${legend.id}::uuid, ${input.actorId}::uuid, ${input.version}, CURRENT_TIMESTAMP)
          ON CONFLICT ("legend_id", "user_id") DO UPDATE
          SET
            "seen_version" = GREATEST(
              "semantic_group_color_legend_reads"."seen_version",
              EXCLUDED."seen_version"
            ),
            "seen_at" = CASE
              WHEN EXCLUDED."seen_version" >=
                "semantic_group_color_legend_reads"."seen_version"
              THEN CURRENT_TIMESTAMP
              ELSE "semantic_group_color_legend_reads"."seen_at"
            END
        `;
      }
      const receipt = await transaction.semanticGroupColorLegendRead.findUnique({
        where: {
          legendId_userId: { legendId: legend.id, userId: input.actorId }
        },
        select: { seenVersion: true }
      });
      return state(legend, (receipt?.seenVersion ?? 0) < legend.version);
    });
  }
}

function emptyLegend(): SemanticGroupColorLegendState {
  return { entries: [], version: 0, unread: false };
}

function state(
  legend: SemanticGroupColorLegend,
  unread: boolean
): SemanticGroupColorLegendState {
  return {
    entries: storedEntries(legend.entries),
    version: legend.version,
    unread,
    updatedAt: legend.updatedAt.toISOString(),
    updatedByUserId: legend.updatedByUserId
  };
}

function storedEntries(value: unknown): readonly SemanticGroupColorLegendEntry[] {
  try {
    return semanticGroupColorLegendEntries(value);
  } catch (error) {
    throw new Error("Stored semantic group color legend is invalid", {
      cause: error
    });
  }
}

function versionConflict(currentVersion: number): never {
  throw new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Semantic group color legend version conflict",
      currentVersion
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

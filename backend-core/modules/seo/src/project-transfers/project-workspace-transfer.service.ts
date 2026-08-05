import { BadRequestException, Injectable } from "@nestjs/common";
import type { InternalProjectSeoTransferResult } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class ProjectWorkspaceTransferService {
  public constructor(private readonly prisma: PrismaService) {}

  public async transfer(
    sourceWorkspaceId: string,
    destinationWorkspaceId: string,
    projectId: string
  ): Promise<InternalProjectSeoTransferResult> {
    if (sourceWorkspaceId === destinationWorkspaceId) {
      throw new BadRequestException("Destination workspace must differ");
    }
    const rows = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await transaction.$executeRaw`SET LOCAL statement_timeout = '120s'`;
      return transaction.$queryRaw<readonly { affectedRows: bigint }[]>`
        SELECT public.transfer_seo_project_workspace(
          ${sourceWorkspaceId}::uuid,
          ${destinationWorkspaceId}::uuid,
          ${projectId}::uuid
        ) AS "affectedRows"
      `;
    });
    const affectedRows = rows[0]?.affectedRows;
    if (affectedRows === undefined || affectedRows < 0n) {
      throw new Error("SEO project transfer returned an invalid result");
    }
    if (affectedRows > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("SEO project transfer affected too many rows");
    }
    return { status: "TRANSFERRED", affectedRows: Number(affectedRows) };
  }
}
